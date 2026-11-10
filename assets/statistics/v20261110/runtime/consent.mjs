import {COUNTER_ID as FIXED_COUNTER,CONSENT_KEY,POLICY_SHA256} from './generated-config.mjs';
export const COUNTER_ID=FIXED_COUNTER;
export const TTL_MS=90*24*60*60*1000;
export const DAY_MS=24*60*60*1000;
export const CHOICE_KEY=CONSENT_KEY;
export const PROBE_KEY=CONSENT_KEY+'.probe';
export const PURPOSE_VERSION='site_pageviews_v1';
export const POLICY_SHA=POLICY_SHA256;
const FIELDS=['schema_version','counter_id','purpose_version','policy_sha256','choice','chosen_at_ms','expires_at_ms'];
const choices=['allow','deny','withdrawn'];
const frozen=value=>Object.freeze(value);
const failed=(reason,extra={})=>frozen({ok:false,reason,granted:false,...extra});

export function createConsentStore({storage,clock=Date.now,policySha=POLICY_SHA,purposeVersion=PURPOSE_VERSION}) {
  if(!storage||typeof clock!=='function'||!/^[a-f0-9]{64}$/.test(policySha)||typeof purposeVersion!=='string'||!purposeVersion)throw new TypeError('Invalid consent dependencies');
  function now() {
    const value=clock();
    if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Invalid clock');
    return value;
  }
  function read() {
    try {
      const raw=storage.getItem(CHOICE_KEY);
      if(raw===null)return frozen({ok:true,state:'unknown',choice:null,granted:false,record:null});
      if(typeof raw!=='string'||raw.length>2048)return failed('invalid_record',{state:'unknown'});
      const r=JSON.parse(raw);
      if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==FIELDS.length||Object.keys(r).some(k=>!FIELDS.includes(k)))return failed('invalid_record',{state:'unknown'});
      if(r.schema_version!==1||r.counter_id!==COUNTER_ID||r.purpose_version!==purposeVersion||r.policy_sha256!==policySha||!choices.includes(r.choice))return failed('version_mismatch',{state:'unknown'});
      if(!Number.isSafeInteger(r.chosen_at_ms)||!Number.isSafeInteger(r.expires_at_ms)||r.chosen_at_ms<0||r.expires_at_ms-r.chosen_at_ms!==TTL_MS)return failed('invalid_time',{state:'unknown'});
      const time=now();
      if(time<r.chosen_at_ms)return failed('clock_rollback',{state:'unknown'});
      if(time>=r.expires_at_ms)return frozen({ok:true,state:'expired',choice:r.choice,granted:false,record:frozen(r)});
      return frozen({ok:true,state:r.choice==='allow'?'allowed':r.choice==='deny'?'denied':'withdrawn',choice:r.choice,granted:r.choice==='allow',record:frozen(r)});
    } catch {return failed('storage_read_failed',{state:'storage_error'});}
  }
  function probe() {
    try {
      storage.setItem(PROBE_KEY,'1');
      if(storage.getItem(PROBE_KEY)!=='1')throw new Error('probe_write_readback');
      storage.removeItem(PROBE_KEY);
      if(storage.getItem(PROBE_KEY)!==null)throw new Error('probe_remove_readback');
      return frozen({ok:true});
    } catch {
      try {storage.removeItem(PROBE_KEY);}catch {}
      return failed('storage_probe_failed',{state:'storage_error'});
    }
  }
  function startup() {
    const first=read();
    if(!first.granted)return first;
    const check=probe();
    if(!check.ok)return check;
    // Never trust event.newValue or the grant read before this write/read/remove.
    return read();
  }
  function removeFormerAllow() {
    try {
      storage.removeItem(CHOICE_KEY);
      if(storage.getItem(CHOICE_KEY)!==null)return failed('revocation_not_persisted');
      return frozen({ok:true,allowAbsent:true});
    } catch {return failed('revocation_not_persisted');}
  }
  function choose(choice) {
    if(arguments.length!==1||!choices.includes(choice))return failed('invalid_choice');
    let encoded;
    try {
      const time=now();
      if(!Number.isSafeInteger(time+TTL_MS))throw new TypeError('Invalid clock');
      const record={schema_version:1,counter_id:COUNTER_ID,purpose_version:purposeVersion,policy_sha256:policySha,choice,chosen_at_ms:time,expires_at_ms:time+TTL_MS};
      encoded=JSON.stringify(record);
      storage.setItem(CHOICE_KEY,encoded);
      if(storage.getItem(CHOICE_KEY)!==encoded)throw new Error('choice_write_readback');
      const check=read();
      if(!check.ok||check.choice!==choice||check.record?.chosen_at_ms!==time||check.state==='expired')throw new Error('choice_validation');
      return frozen({ok:true,saved:true,persistence:'record',granted:choice==='allow',state:check.state,record:check.record,reloadAllowed:choice!=='allow',allowAbsent:choice!=='allow',productionConsentCreated:choice==='allow'});
    } catch {
      const clear=removeFormerAllow();
      if(choice!=='allow'&&clear.ok)return frozen({ok:true,saved:false,persistence:'old_allow_removed',granted:false,state:choice==='deny'?'denied':'withdrawn',record:null,allowAbsent:true,reloadAllowed:true,productionConsentCreated:false});
      return failed(choice==='allow'?'choice_not_saved':'revocation_not_persisted',{state:'storage_error',saved:false,reloadAllowed:false,oldAllowMayRemain:!clear.ok,manualResetRequired:!clear.ok,productionBlocker:!clear.ok,productionConsentCreated:false});
    }
  }
  return frozen({read,startup,probe,choose,keys:frozen({choice:CHOICE_KEY,probe:PROBE_KEY})});
}
