// Park Log service worker: lets the app open without signal.
// Your own files always load fresh when you're online, so updates show up right away.
const VERSION = "parklog-v4";
const APP_FILES = [
  "./", "index.html", "styles.css", "app.js", "config.js", "park-log-data.json",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];
const CACHEABLE_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(VERSION)
    .then(c=>c.addAll(APP_FILES.map(u=>new Request(u, {cache:"reload"}))))
    .then(()=>self.skipWaiting()));
});

self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

self.addEventListener("fetch", e=>{
  if(e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Your own files: get the latest from GitHub, fall back to the saved copy when offline.
  if(url.origin === location.origin){
    e.respondWith(
      fetch(new Request(e.request.url, {cache:"no-cache"}))
        .then(res=>{
          if(res.ok){ const copy = res.clone(); caches.open(VERSION).then(c=>c.put(e.request, copy)); }
          return res;
        })
        .catch(()=>caches.match(e.request, {ignoreSearch:true}).then(hit=>hit || caches.match("index.html")))
    );
    return;
  }

  // Fonts and the Supabase library: use the saved copy, refresh it in the background.
  // Supabase data requests are never cached; your data always comes live from your account.
  if(!CACHEABLE_HOSTS.includes(url.hostname)) return;
  e.respondWith(caches.open(VERSION).then(async cache=>{
    const hit = await cache.match(e.request);
    const fresh = fetch(e.request).then(res=>{ if(res.ok || res.type==="opaque") cache.put(e.request, res.clone()); return res; }).catch(()=>hit);
    return hit || fresh;
  }));
});
