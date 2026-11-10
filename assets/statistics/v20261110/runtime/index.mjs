import {createLifecycle} from './lifecycle.mjs';
import {createBrowserProvider} from './provider.mjs';
import {resolveStatisticsPath} from './routes.mjs';

export function createWebsiteMeasurement({storage, documentRef, windowRef, clock = Date.now, timers = globalThis}) {
  const path = resolveStatisticsPath(windowRef);
  const provider = createBrowserProvider({documentRef, windowRef, path, timers});
  const lifecycle = createLifecycle({storage, documentRef, windowRef, path, provider, clock, timers});

  function choose(choice, event) {
    if (event?.isTrusted !== true || !(event instanceof windowRef.Event)) {
      return Promise.resolve(Object.freeze({ok: false, reason: 'trusted_action_required', state: lifecycle.getState()}));
    }
    return lifecycle.choose(choice);
  }

  return Object.freeze({...lifecycle, choose});
}
