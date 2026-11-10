import {createWebsiteMeasurement} from './runtime/index.mjs';
import {resolveStatisticsPath} from './runtime/routes.mjs';
import {mountStatistics} from './ui/controller.mjs';
import {getBrowserStorage} from './ui/environment.mjs';

const marker = 'data-obihod-statistics-mounted';
if (resolveStatisticsPath(window) && !document.documentElement.hasAttribute(marker)) {
  document.documentElement.setAttribute(marker, 'starting');
  try {
    const runtime = createWebsiteMeasurement({
      storage: getBrowserStorage(window), documentRef: document, windowRef: window
    });
    mountStatistics(runtime, {documentRef: document, windowRef: window});
    runtime.attachLifecycle();
    document.documentElement.setAttribute(marker, 'mounted');
    Promise.resolve(runtime.start()).catch(() => {});
  } catch {
    document.documentElement.setAttribute(marker, 'unavailable');
  }
}
