import { h, toast } from './ui.js';
import { home } from './views/home.js';
import { help, privacy } from './views/more.js';
import { roomScreen } from './views/room.js';

/** Routes are hash based (#/r/ABC123) so they work on any static host and inside an installed app. */
const routes = [
  { pattern: /^#\/?$/, view: home },
  { pattern: /^#\/help$/, view: help },
  { pattern: /^#\/privacy$/, view: privacy },
  { pattern: /^#\/r\/([^/]+)$/, view: roomScreen },
];

export function go(path) { location.hash = path; }

const root = document.getElementById('app');
let cleanup = null;
let renderToken = 0;

async function render() {
  const token = ++renderToken;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  const hash = location.hash || '#/';
  const match = routes.map((r) => ({ r, m: hash.match(r.pattern) })).find((x) => x.m);
  const screen = h('main', { class: 'screen', id: 'main' });
  root.replaceChildren(screen);
  window.scrollTo(0, 0);
  if (!match) {
    screen.append(h('div', { class: 'card center' }, h('h1', {}, 'Page not found'), h('a', { class: 'btn primary', href: '#/' }, 'Go home')));
    return;
  }
  try {
    const result = await match.r.view(screen, match.m.slice(1).map(decodeURIComponent), { go });
    if (token !== renderToken) { result?.(); return; }     // the user went somewhere else while this screen was loading
    cleanup = result ?? null;
  } catch (error) {
    console.error(error);
    screen.replaceChildren(h('div', { class: 'card center' }, h('h1', {}, 'Something went wrong'), h('p', { class: 'muted' }, 'Please go back and try again.'), h('a', { class: 'btn primary', href: '#/' }, 'Go home')));
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Jukeroom was updated. Close and reopen it to use the new version.', 6000);
    });
  } catch (error) { console.warn('Offline support could not start:', error); }
}

await render();
registerServiceWorker();
