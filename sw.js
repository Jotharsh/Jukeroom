// Offline support for the app's own files. Rooms need the internet; this makes the app open instantly and survive a bad signal.
// Change VERSION whenever any file changes, so phones fetch the new files and drop the old cache.
const VERSION = 'v1';
const CACHE = `jukeroom-${VERSION}`;

const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'vendor/peerjs.min.js',
  'js/app.js', 'js/config.js', 'js/ui.js', 'js/install.js', 'js/store.js', 'js/room.js', 'js/sync.js', 'js/net.js', 'js/player.js', 'js/youtube.js',
  'js/views/home.js', 'js/views/room.js', 'js/views/more.js',
  'fonts/SpaceGrotesk-Variable.woff2', 'fonts/ShareTechMono.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jukeroom-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Cache first for our own files only. YouTube, PeerJS's broker and everything else go straight to the network.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    } catch {
      if (request.mode === 'navigate') return (await caches.match('index.html')) ?? Response.error();
      return Response.error();
    }
  })());
});
