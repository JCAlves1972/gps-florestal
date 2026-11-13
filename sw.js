'use strict';

const CACHE_NAME = 'gps-florestal-v5-navigation';
const APP_BASE = self.registration.scope;
const CORE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './navegacao-florestal.js'
];

async function addNavigationScript(response) {
  if (!response || !response.ok) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  let html = await response.clone().text();
  if (!html.includes('navegacao-florestal.js')) {
    const tag = '<script src="./navegacao-florestal.js"></script>';
    if (/<\/body\s*>/i.test(html)) html = html.replace(/<\/body\s*>/i, tag + '</body>');
    else html += tag;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isPageRequest(request, url) {
  return request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/gps-florestal/') ||
    url.pathname.endsWith('/gps-florestal');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_FILES.map(async file => {
      try {
        const url = new URL(file, APP_BASE);
        const response = await fetch(url, {cache: 'reload'});
        if (!response.ok) return;
        const saved = file === './' || file.endsWith('index.html')
          ? await addNavigationScript(response)
          : response;
        await cache.put(url, saved);
      } catch (error) {
        // Um recurso indisponível não impede a instalação do restante do aplicativo.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('gps-florestal-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isPageRequest(request, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          const pageResponse = await addNavigationScript(networkResponse);
          await cache.put(request, pageResponse.clone());
          return pageResponse;
        }
      } catch (error) {
        // Sem internet: usa a página local, já com o módulo de navegação incluído.
      }
      return await caches.match(request) ||
        await caches.match(new URL('./', APP_BASE).href) ||
        await caches.match(new URL('./index.html', APP_BASE).href) ||
        Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return Response.error();
    }
  })());
});
