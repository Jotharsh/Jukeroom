// "Install" help: the native prompt where the browser offers one, written instructions on iPhone/iPad and Mac Safari.
const DISMISS_KEY = 'jukeroom.installDismissedAt';
const DISMISS_DAYS = 14;
let deferredPrompt = null;
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
});

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at && Date.now() - at < DISMISS_DAYS * 86400000;
  } catch { return false; }
}

/** What to show right now: 'prompt', 'ios', 'mac', or null (nothing: already installed, dismissed, or not installable here). */
export function installMode() {
  if (isStandalone() || dismissedRecently()) return null;
  if (deferredPrompt) return 'prompt';
  if (isIOS) return 'ios';
  if (isMacSafari) return 'mac';
  return null;
}

export async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
}

export function dismissInstall() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  listeners.forEach((fn) => fn());
}

/** Subscribes to changes (the browser can offer installing after the page has loaded). Returns an unsubscribe function. */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
