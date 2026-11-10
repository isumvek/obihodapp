import {BUILD_PROFILE, COUNTER_ID, MEASURED_PATHS, PRODUCTION_ORIGIN} from './generated-config.mjs';
import {resolveStatisticsPath} from './routes.mjs';

export const INIT_OPTIONS=Object.freeze({defer:true,sendTitle:false,clickmap:false,trackLinks:false,trackHash:false,accurateTrackBounce:false,webvisor:false,ecommerce:false,childIframe:false,disableYtm:true,triggerEvent:true,type:0});
const unsafeContent = 'form,input,textarea,select,iframe,[contenteditable]:not([contenteditable="false"])';
const rejected=reason=>Object.freeze({ok:false,reason,delivery:'not_attempted'});

// The only provider in this release is the fixed production pageview counter.
export function createBrowserProvider({documentRef,windowRef,path,timers=globalThis,timeoutMs=10000}) {
  let script=null,stub=null,owned=false,loaded=false,initialized=false,ready=false,stopped=false;
  let pendingLoad=null,pendingInit=null,blockedReason=null;
  const cancellers=new Set();
  function guard() {
    try {
      if(BUILD_PROFILE!=='production_pageviews')return rejected('build_profile_off');
      if(!MEASURED_PATHS.includes(path)||resolveStatisticsPath(windowRef)!==path)return rejected('ineligible_route');
      if(!documentRef?.head||stopped)return rejected(stopped?'provider_stopped':'missing_document');
      if(documentRef.querySelector(unsafeContent))return rejected('input_or_embedded_content');
      return {ok:true};
    } catch {return rejected('document_check_failed');}
  }
  function checked() {const value=guard();blockedReason=value.ok?null:value.reason;return value;}
  function removeScript() {
    if(script){script.onload=null;script.onerror=null;try{script.remove();}catch{}script=null;}
  }
  function removeUnusedStub() {
    try {if(owned&&windowRef.ym===stub&&!initialized){delete windowRef.ym;owned=false;stub=null;}}catch{}
  }
  function waiting(kind,setup) {
    return new Promise(resolve=>{
      let done=false,timer=null,cleanup=()=>{};
      const finish=value=>{if(done)return;done=true;timers.clearTimeout(timer);cancellers.delete(cancel);cleanup();resolve(Object.freeze(value));};
      const cancel=()=>finish({ok:false,reason:'provider_stopped',delivery:'not_attempted'});
      timer=timers.setTimeout(()=>finish({ok:false,reason:kind+'_timeout',delivery:'not_attempted'}),timeoutMs);
      timer?.unref?.();cancellers.add(cancel);
      try {cleanup=setup(finish)||(()=>{});if(done)cleanup();}catch{finish({ok:false,reason:kind+'_failed',delivery:'not_attempted'});}
    });
  }
  const api={
    kind:'yandex_production',
    getState:()=>Object.freeze({loaded,initialized,ready,stopped,blockedReason,pendingLoad:Boolean(pendingLoad),pendingInit:Boolean(pendingInit),delivery:'unconfirmed'}),
    async load() {
      const permit=checked();if(!permit.ok)return permit;
      if(loaded)return {ok:true};if(pendingLoad)return pendingLoad;
      if(typeof windowRef.ym!=='undefined'&&!owned)return rejected('unknown_existing_ym_owner');
      stub=function(){(stub.a=stub.a||[]).push(arguments);};stub.l=Date.now();windowRef.ym=stub;owned=true;
      pendingLoad=waiting('load',finish=>{
        script=documentRef.createElement('script');script.async=true;script.referrerPolicy='no-referrer';script.src='https://mc.yandex.ru/metrika/tag.js';
        script.onload=()=>{if(stopped)return;loaded=true;finish({ok:true,delivery:'unconfirmed'});};
        script.onerror=()=>finish({ok:false,reason:'provider_load_failed',delivery:'not_attempted'});
        documentRef.head.appendChild(script);
        return ()=>{if(script){script.onload=null;script.onerror=null;}};
      });
      const result=await pendingLoad;pendingLoad=null;
      if(!result.ok){removeScript();removeUnusedStub();}
      return result;
    },
    async init() {
      const permit=checked();if(!permit.ok)return permit;
      if(ready)return {ok:true};if(pendingInit)return pendingInit;
      if(!loaded||initialized||typeof windowRef.ym!=='function')return rejected('invalid_provider_lifecycle');
      pendingInit=waiting('init',finish=>{
        const eventName='yacounter'+COUNTER_ID+'inited';
        const listener=()=>{if(stopped)return;ready=true;finish({ok:true,delivery:'unconfirmed'});};
        documentRef.addEventListener(eventName,listener);
        windowRef.addEventListener?.(eventName,listener);
        initialized=true;
        windowRef.ym(COUNTER_ID,'init',{...INIT_OPTIONS,url:PRODUCTION_ORIGIN+path,referrer:''});
        return ()=>{documentRef.removeEventListener(eventName,listener);windowRef.removeEventListener?.(eventName,listener);};
      });
      const result=await pendingInit;pendingInit=null;
      if(!result.ok)api.destruct();return result;
    },
    hit() {
      const permit=checked();if(!permit.ok)return permit;
      if(!ready)return rejected('invalid_hit');
      windowRef.ym(COUNTER_ID,'hit',PRODUCTION_ORIGIN+path,{referer:''});
      return Object.freeze({ok:true,attempted:true,delivery:'unconfirmed'});
    },
    destruct() {
      if(stopped)return Object.freeze({ok:true,alreadyStopped:true});
      stopped=true;
      for(const cancel of [...cancellers])cancel();cancellers.clear();pendingLoad=null;pendingInit=null;
      try {if(initialized&&owned&&typeof windowRef.ym==='function')windowRef.ym(COUNTER_ID,'destruct');}catch{}
      removeScript();removeUnusedStub();ready=false;initialized=false;
      return Object.freeze({ok:true,serverDeletion:false,cookieCleanup:false,inflightCancellation:false});
    }
  };
  return Object.freeze(api);
}
