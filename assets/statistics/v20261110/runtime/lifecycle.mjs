import {createConsentStore, CHOICE_KEY, DAY_MS} from './consent.mjs';
import {BUILD_PROFILE, MEASURED_PATHS, POLICY_URL} from './generated-config.mjs';

export function createLifecycle({storage, path, provider, documentRef, windowRef, clock = Date.now, timers = globalThis}) {
  const store = createConsentStore({storage, clock});
  const measured = MEASURED_PATHS.includes(path);
  const controlOnly = path === POLICY_URL;
  let decision = store.read(), phase = 'idle', generation = 0;
  let started = false, disposed = false, ownGate = false, denyLatch = false;
  let everLoadRequested = false, pageSent = false, timer = null, pending = null, lastPersistence = null;
  const detach = new Set(), listeners = new Set();

  function getState() {
    const info = provider.getState();
    return Object.freeze({
      profile: BUILD_PROFILE, path, phase, isControlOnly: controlOnly,
      choice: decision.choice ?? null, choiceState: decision.state,
      preferenceGranted: Boolean(decision.granted), ownDispatchAllowed: ownGate,
      actualTracking: ownGate && phase === 'active', sdkLoaded: info.loaded,
      providerEligible: measured && !info.blockedReason, providerBlockedReason: info.blockedReason,
      delivery: 'unconfirmed', expiresAt: decision.record?.expires_at_ms ?? null, lastPersistence,
      requiresReload: everLoadRequested && denyLatch, persistentRevocationUnresolved: lastPersistence?.productionBlocker === true
    });
  }
  function notify() {
    const state = getState();
    for (const fn of listeners) {
      try { fn(state); } catch {}
    }
    return state;
  }
  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('Listener required');
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function cancelTimer() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }
  function stop(next) {
    ownGate = false;
    denyLatch = true;
    generation++;
    cancelTimer();
    pending = null;
    phase = next;
    // A pending script also owns a continuation. Stop before waiting for it.
    if (everLoadRequested) provider.destruct();
    return notify();
  }
  function schedule() {
    cancelTimer();
    if (!decision.granted || disposed) return;
    try {
      const remaining = decision.record.expires_at_ms - clock();
      if (remaining <= 0) return refresh();
      timer = timers.setTimeout(refresh, Math.min(remaining, DAY_MS));
      timer?.unref?.();
    } catch {
      stop('storage_error');
    }
  }
  function refresh() {
    if (disposed) return getState();
    decision = store.read();
    if (!decision.granted) return stop(decision.state);
    schedule();
    return notify();
  }
  function stillAllowed(token) {
    if (disposed || token !== generation) return false;
    decision = store.read();
    if (!decision.granted) {
      stop(decision.state);
      return false;
    }
    return !denyLatch;
  }
  async function activate() {
    if (!measured || !stillAllowed(generation)) return getState();
    if (phase === 'active' || pending) return pending ?? getState();
    const token = ++generation;
    phase = 'loading';
    everLoadRequested = true;
    notify();
    const task = (async () => {
      try {
        if (!stillAllowed(token)) return getState();
        const loaded = await provider.load();
        if (!stillAllowed(token)) return getState();
        if (!loaded.ok) return stop(provider.getState().blockedReason ? 'provider_blocked' : 'provider_error');
        phase = 'initializing';
        notify();
        if (!stillAllowed(token)) return getState();
        const initialized = await provider.init();
        if (!stillAllowed(token)) return getState();
        if (!initialized.ok) return stop('provider_error');
        if (!pageSent) {
          pageSent = true;
          if (!provider.hit().ok) return stop('provider_error');
        }
        phase = 'active';
        ownGate = true;
        schedule();
        return notify();
      } catch {
        if (token === generation && !disposed) return stop('provider_error');
        return getState();
      } finally {
        if (token === generation) pending = null;
      }
    })();
    if (token === generation) pending = task;
    return task;
  }
  async function start() {
    if (disposed || started) return pending ?? getState();
    started = true;
    if (!measured && !controlOnly) {
      phase = 'unknown_route';
      return notify();
    }
    decision = store.startup();
    if (!measured) {
      phase = 'control_only';
      schedule();
      return notify();
    }
    if (!decision.granted) return stop(decision.state);
    denyLatch = false;
    schedule();
    return activate();
  }
  async function choose(choice) {
    if (disposed || (!measured && !controlOnly)) return {ok: false, reason: 'inactive_route', state: getState()};
    if (!['allow', 'deny', 'withdrawn'].includes(choice)) return {ok: false, reason: 'invalid_choice', state: getState()};
    if (choice !== 'allow') stop(choice === 'deny' ? 'denied' : 'withdrawn');
    lastPersistence = store.choose(choice);
    decision = store.read();
    notify();
    if (!lastPersistence.ok) stop('storage_error');
    else if (choice === 'allow') {
      if (everLoadRequested && denyLatch) {
        phase = 'reload_required';
        notify();
      } else {
        denyLatch = false;
        schedule();
        if (measured) await activate();
        else {
          phase = 'control_only';
          notify();
        }
      }
    }
    return Object.freeze({...lastPersistence, state: getState()});
  }
  function handleStorageEvent(event) {
    if (event && event.key !== null && event.key !== CHOICE_KEY) return getState();
    return refresh();
  }
  function attachLifecycle() {
    if (disposed || !windowRef || !documentRef) return () => {};
    const hooks = [
      [windowRef, 'storage', handleStorageEvent],
      [windowRef, 'pageshow', refresh],
      [windowRef, 'focus', refresh],
      [documentRef, 'visibilitychange', refresh]
    ];
    for (const [target, name, handler] of hooks) target.addEventListener(name, handler);
    const remove = () => {
      for (const [target, name, handler] of hooks) target.removeEventListener(name, handler);
      detach.delete(remove);
    };
    detach.add(remove);
    return remove;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop('disposed');
    for (const remove of detach) remove();
    listeners.clear();
  }

  return Object.freeze({start, choose, getState, subscribe, attachLifecycle, dispose});
}
