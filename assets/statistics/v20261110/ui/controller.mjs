const mounted = new WeakMap();
const POLICY_URL = '/privacy/site/';

export function describeState(state = {}) {
  const persistence = state.lastPersistence;
  if (persistence?.reason === 'revocation_not_persisted') {
    return {
      kind: 'error',
      text: 'Не удалось сохранить отказ. Отправка в этой вкладке остановлена. Чтобы прежнее разрешение не появилось при новом открытии, очистите данные этого сайта в настройках браузера.',
      needsManualReset: true
    };
  }
  if (persistence?.manualResetRequired) {
    return {kind:'error',text:'Не удалось сохранить выбор. Статистика в этой вкладке выключена. Чтобы сбросить прежний выбор, очистите данные этого сайта в настройках браузера.',needsManualReset:true};
  }
  if (persistence?.persistence === 'old_allow_removed') {
    return {kind:'notice',text:'Прежнее разрешение удалено. Статистика выключена, но отказ на 90 дней сохранить не удалось.'};
  }
  if (state.choiceState === 'storage_error' || state.phase === 'storage_error' || persistence?.ok === false) {
    return {kind:'error',text:'Не удалось сохранить выбор. Статистика в этой вкладке выключена. Проверьте, разрешено ли браузеру хранить данные этого сайта.',needsManualReset:true};
  }
  if (state.preferenceGranted) {
    if (state.requiresReload) {
      return {kind:'notice',text:'Разрешение сохранено. Чтобы подключить статистику, обновите страницу. Несохранённые значения на странице могут сброситься.'};
    }
    if (state.isControlOnly) {
      return {kind:'notice',text:'Разрешение сохранено для сайта. На странице политики статистика не отправляется.'};
    }
    if (state.phase === 'active' && state.actualTracking === true) {
      return {kind:'active',text:'Разрешение сохранено. Статистика подключена.'};
    }
    if (state.phase === 'loading' || state.phase === 'initializing') {
      return {kind:'notice',text:'Разрешение сохранено. Подключаем сервис…'};
    }
    if (state.phase === 'provider_blocked' || state.providerEligible === false) {
      return {kind:'notice',text:'Разрешение сохранено. На этой странице сервис не подключён.'};
    }
    return {kind:'notice',text:'Разрешение сохранено, но сервис сейчас недоступен.'};
  }
  if (state.choiceState === 'expired' || state.phase === 'expired') {
    return {kind:'off',text:'Срок действия выбора истёк. Статистика выключена; можно выбрать снова.'};
  }
  if (state.choice === 'withdrawn' || state.choiceState === 'withdrawn' || state.phase === 'withdrawn') {
    return {kind:'off',text:'Статистика выключена. Отказ сохранён в этом браузере на 90 дней.'};
  }
  if (state.choice === 'deny' || state.choiceState === 'denied' || state.phase === 'denied') {
    return {kind:'off',text:'Вы выбрали пользоваться сайтом без статистики. Выбор сохранён на 90 дней.'};
  }
  return {kind:'off',text:'Статистика выключена. Выбор ещё не сделан.'};
}

export function canReloadAfterWithdrawal(result, latestState) {
  return result?.ok === true && result?.reloadAllowed === true &&
    result?.manualResetRequired !== true && result?.productionBlocker !== true &&
    latestState?.preferenceGranted === false && latestState?.ownDispatchAllowed === false;
}

export function mountStatistics(runtime, {documentRef = document, windowRef = window} = {}) {
  const doc = documentRef, win = windowRef;
  if (mounted.has(doc)) return mounted.get(doc);
  if (!doc.body || !runtime || typeof runtime.choose !== 'function' || typeof runtime.getState !== 'function') {
    throw new TypeError('A document body and measurement runtime are required');
  }
  const policyUrl = POLICY_URL;
  const root = doc.createElement('div');
  root.className = 'obihod-stats-root';
  root.id = 'obihod-statistics-root';
  root.setAttribute('data-obihod-statistics-root','');
  let disposed = false, dismissed = false, opener = null, actionRevision = 0;
  const removers = [];
  function element(tag, attrs = {}, text = '') {
    const node = doc.createElement(tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    if (text) node.textContent = text;
    return node;
  }
  function on(node, type, fn, options) {
    node.addEventListener(type,fn,options);
    removers.push(()=>node.removeEventListener(type,fn,options));
  }
  function button(text, className = '') {
    return element('button',{type:'button',class:'obihod-stats-button '+className},text);
  }
  function policyLink() {
    return element('a',{href:policyUrl,class:'obihod-stats-policy'},'Конфиденциальность сайта');
  }

  const bar = element('div',{class:'obihod-stats-bar'});
  const settings = button('Настройки статистики','obihod-stats-settings');
  settings.setAttribute('aria-haspopup','dialog');
  settings.setAttribute('aria-controls','obihod-stats-dialog');
  settings.setAttribute('aria-expanded','false');
  bar.append(settings,policyLink());

  const banner = element('section',{class:'obihod-stats-banner','aria-labelledby':'obihod-stats-banner-title'});
  const bannerHeader = element('div',{class:'obihod-stats-heading-row'});
  const bannerTitle = element('h2',{id:'obihod-stats-banner-title'},'Статистика сайта');
  const bannerClose = button('Закрыть','obihod-stats-close');
  bannerClose.setAttribute('aria-label','Закрыть сообщение о статистике без выбора');
  bannerHeader.append(bannerTitle,bannerClose);
  const description = 'Можно разрешить Яндекс Метрике учитывать просмотры страниц. Это помогает понять, какие материалы открывают посетители. Сервис использует cookie и технические данные браузера.';
  const bannerText = element('p',{},description);
  const bannerActions = element('div',{class:'obihod-stats-actions'});
  const bannerAllow = button('Разрешить');
  const bannerDeny = button('Отказаться');
  bannerActions.append(bannerAllow,bannerDeny);
  const bannerStatus = element('p',{class:'obihod-stats-status',role:'status','aria-live':'polite'});
  banner.append(bannerHeader,bannerText);
  banner.append(bannerActions,policyLink(),bannerStatus);

  const dialog = element('dialog',{id:'obihod-stats-dialog',class:'obihod-stats-dialog','aria-labelledby':'obihod-stats-dialog-title'});
  const dialogHeader = element('div',{class:'obihod-stats-heading-row'});
  const title = element('h2',{id:'obihod-stats-dialog-title',tabindex:'-1'},'Настройки статистики');
  const dialogClose = button('Закрыть','obihod-stats-close');
  dialogClose.setAttribute('aria-label','Закрыть настройки статистики');
  dialogHeader.append(title,dialogClose);
  const dialogStatus = element('p',{class:'obihod-stats-status',role:'status','aria-live':'polite'});
  const choiceActions = element('div',{class:'obihod-stats-actions'});
  const allow = button('Разрешить');
  const deny = button('Отказаться');
  choiceActions.append(allow,deny);
  const withdraw = button('Отключить и обновить страницу','obihod-stats-withdraw');
  const reloadWarning = element('p',{class:'obihod-stats-note'},'При обновлении несохранённые значения на странице могут сброситься. Отключение не удаляет уже переданную статистику и ранее созданные cookie.');
  const reload = button('Обновить страницу');
  const manualReset = element('p',{class:'obihod-stats-note'},'В настройках браузера можно разрешить хранение данных для этого сайта. Чтобы сбросить прежний выбор, удалите данные только этого сайта. До успешного сохранения или сброса нельзя считать отказ сохранённым для следующего открытия.');
  dialog.append(dialogHeader,element('p',{},description));
  dialog.append(dialogStatus,choiceActions,withdraw,reloadWarning,reload,manualReset,
    element('p',{class:'obihod-stats-note'},'Выбор запоминается на 90 дней. Без статистики материалы, файлы, калькулятор и переходы в приложения работают как обычно.'),policyLink());

  root.append(bar,banner,dialog);
  doc.body.append(root);
  function isDialogOpen() { return dialog.open === true || dialog.hasAttribute('open'); }
  function setText(node,text) { if (node.textContent !== text) node.textContent = text; }
  function hideBanner() {
    dismissed = true; banner.hidden = true;
    settings.focus();
  }
  function openDialog() {
    if (disposed || isDialogOpen()) return;
    opener = doc.activeElement;
    banner.hidden = true;
    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); }
      catch { dialog.setAttribute('open',''); dialog.setAttribute('aria-modal','false'); }
    } else {
      dialog.setAttribute('open',''); dialog.setAttribute('aria-modal','false');
    }
    settings.setAttribute('aria-expanded','true');
    render(); title.focus();
  }
  function closeDialog() {
    if (!isDialogOpen()) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    settings.setAttribute('aria-expanded','false');
    render();
    (opener?.isConnected && !opener.closest?.('[hidden]') ? opener : settings).focus();
  }
  function render() {
    if (disposed) return;
    const state = runtime.getState();
    const message = describeState(state);
    const refused = state.phase === 'denied' || state.phase === 'withdrawn';
    const unknown = !state.preferenceGranted && !refused &&
      (state.choice == null || state.choiceState === 'unknown' || state.choiceState === 'expired');
    banner.hidden = dismissed || isDialogOpen() || !unknown;
    setText(dialogStatus,message.text);
    setText(bannerStatus,message.kind === 'error' ? message.text : '');
    dialogStatus.setAttribute('data-state',message.kind);
    bannerStatus.setAttribute('data-state',message.kind);
    choiceActions.hidden = state.preferenceGranted === true;
    withdraw.hidden = state.preferenceGranted !== true;
    reload.hidden = !(state.requiresReload && state.preferenceGranted && !message.needsManualReset);
    reloadWarning.hidden = withdraw.hidden && reload.hidden;
    manualReset.hidden = message.needsManualReset !== true;
    const isStarting = state.preferenceGranted && (state.phase === 'loading' || state.phase === 'initializing');
    // Deny/close remain usable while an asynchronous provider starts.
    allow.disabled = Boolean(isStarting);
    bannerAllow.disabled = Boolean(isStarting);
  }
  async function choose(choice, event, origin) {
    if (disposed || event?.isTrusted !== true) return;
    const revision = ++actionRevision;
    let operation;
    try { operation = runtime.choose(choice, event); }
    catch {
      render(); return;
    }
    render();
    if (origin === 'banner' && banner.hidden) settings.focus();
    if (isDialogOpen() && doc.activeElement?.closest?.('[hidden]')) {
      (runtime.getState().preferenceGranted ? withdraw : allow).focus();
    }
    let result;
    try { result = await operation; }
    catch { if (!disposed) render(); return; }
    if (disposed || revision !== actionRevision) return;
    // Never render an old async result as a new success; read current state.
    render();
    if (choice === 'withdrawn' && canReloadAfterWithdrawal(result,runtime.getState())) {
      win.location.reload();
    }
  }
  on(settings,'click',openDialog);
  on(bannerClose,'click',hideBanner);
  on(dialogClose,'click',closeDialog);
  on(bannerAllow,'click',event=>choose('allow',event,'banner'));
  on(bannerDeny,'click',event=>choose('deny',event,'banner'));
  on(allow,'click',event=>choose('allow',event,'dialog'));
  on(deny,'click',event=>choose('deny',event,'dialog'));
  on(withdraw,'click',event=>choose('withdrawn',event,'dialog'));
  on(reload,'click',event=> {
    const current=runtime.getState();
    if (event.isTrusted && current.preferenceGranted && current.requiresReload &&
        !describeState(current).needsManualReset && current.choiceState!=='storage_error') win.location.reload();
  });
  on(dialog,'cancel',event=>{event.preventDefault();closeDialog();});
  on(dialog,'close',()=>{settings.setAttribute('aria-expanded','false');render();});
  on(dialog,'keydown',event=> {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
    if (event.key !== 'Tab') return;
    const candidates = [...dialog.querySelectorAll('button:not([disabled]),a[href]')]
      .filter(node=>!node.closest('[hidden]'));
    const first = candidates[0], last = candidates.at(-1);
    if (!first) { event.preventDefault();title.focus();return; }
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === title)) {
      event.preventDefault();last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();first.focus();
    }
  });
  on(banner,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();hideBanner();}});
  const unsubscribe = typeof runtime.subscribe === 'function' ? runtime.subscribe(render) : ()=>{};
  render();
  const controller = Object.freeze({
    open:openDialog, close:closeDialog,
    getState:()=>Object.freeze({dialogOpen:isDialogOpen(),bannerVisible:!banner.hidden,status:dialogStatus.textContent}),
    dispose() {
      if (disposed) return;
      disposed = true; actionRevision++;
      unsubscribe(); for (const remove of removers) remove();
      if (isDialogOpen() && typeof dialog.close === 'function') dialog.close();
      root.remove(); mounted.delete(doc);
    }
  });
  mounted.set(doc,controller);
  return controller;
}
