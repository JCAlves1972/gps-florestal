'use strict';
const CACHE_NAME = 'gps-florestal-v9-offline';
const TILE_CACHE = 'gps-florestal-tiles-v1';
const BASE = self.registration.scope;
const FILES = [
  './','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./navegacao-florestal.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
const TILE_HOSTS = ['tile.openstreetmap.org','basemaps.cartocdn.com','server.arcgisonline.com'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(FILES.map(async file => {
    try {
      const request = new Request(file, {mode:'no-cors', cache:'reload'});
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) await cache.put(request, response);
    } catch (_) {}
  }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('gps-florestal-') && ![CACHE_NAME,TILE_CACHE].includes(key)).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isTile = TILE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.'+host));
  const isLibrary = url.hostname === 'unpkg.com' || url.hostname === 'cdnjs.cloudflare.com';
  if (isTile) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(request, response.clone());
          const keys = await cache.keys();
          if (keys.length > 1200) await cache.delete(keys[0]);
        }
        return response;
      } catch (_) { return cached || Response.error(); }
    })());
    return;
  }
  if (isLibrary) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try { const response = await fetch(request); if (response) await cache.put(request, response.clone()); return response; }
      catch (_) { return cached || Response.error(); }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try { const response = await fetch(request); if (response.ok) { await cache.put(request, response.clone()); return response; } } catch (_) {}
      return await cache.match(request) || await cache.match(new URL('./',BASE).href) || await cache.match(new URL('./index.html',BASE).href) || Response.error();
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME), cached = await cache.match(request);
    if (cached) return cached;
    try { const response = await fetch(request); if (response.ok) await cache.put(request,response.clone()); return response; }
    catch (_) { return Response.error(); }
  })());
});
