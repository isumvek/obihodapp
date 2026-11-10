import {MEASURED_PATHS, POLICY_URL, PRODUCTION_ORIGIN} from './generated-config.mjs';

export function resolveStatisticsPath(windowRef) {
  try {
    if (windowRef?.location?.origin !== PRODUCTION_ORIGIN || windowRef.top !== windowRef) return null;
    const pathname = windowRef.location.pathname;
    if (typeof pathname !== 'string') return null;
    const path = pathname.endsWith('/index.html') ? pathname.slice(0, -'index.html'.length) : pathname;
    return path === POLICY_URL || MEASURED_PATHS.includes(path) ? path : null;
  } catch {
    return null;
  }
}
