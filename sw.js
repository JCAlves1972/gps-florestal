const CACHE_NAME='gps-florestal-v7';
const TILE_CACHE='gps-florestal-map-tiles-v1';
const CORE=['./','./index.html','./manifest.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gps-florestal-')&&k!==CACHE_NAME&&k!==TILE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 const isTile=url.hostname==='tile.openstreetmap.org'||url.hostname.endsWith('.tile.openstreetmap.org')||url.hostname==='server.arcgisonline.com';
 if(isTile){event.respondWith(caches.open(TILE_CACHE).then(async cache=>{const cached=await cache.match(event.request);if(cached)return cached;try{const response=await fetch(event.request);if(response&&response.ok)cache.put(event.request,response.clone()).catch(()=>{});return response}catch(err){return cached||Response.error()}}));return}
 if(url.origin!==location.origin)return;
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response&&response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy)).catch(()=>{})}return response}).catch(()=>caches.match('./index.html'))));
});
