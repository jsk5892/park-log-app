// Bump this version whenever you push changes, so phones pick up the new files.
const VERSION = "parklog-v2";
const APP_FILES = [
  "./", "index.html", "styles.css", "app.js", "config.js", "park-log-data.json",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];
const CACHEABLE_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(APP_FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
// Show the saved copy right away, then refresh it in the background.
// Supabase requests are never cached: your data always comes live from your account.
self.addEventListener("fetch", e=>{
  const url = new URL(e.request.url);
  if(e.request.method !== "GET") return;
  if(url.origin !== location.origin && !CACHEABLE_HOSTS.includes(url.hostname)) return;
  e.respondWith(caches.open(VERSION).then(async cache=>{
    const hit = await cache.match(e.request, {ignoreSearch: url.origin === location.origin});
    const fresh = fetch(e.request).then(res=>{ if(res.ok || res.type==="opaque") cache.put(e.request, res.clone()); return res; }).catch(()=>hit);
    return hit || fresh;
  }));
});
