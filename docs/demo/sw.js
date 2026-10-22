// Demo service worker: keeps the demo working offline once opened. Network first; the cache is only the offline copy.
// 22 Oct 2026: pages, data.js and version.json are fetched with a throwaway query so neither the browser nor GitHub's
// CDN can hand back an older copy straight after an update; only this folder's own files are touched; and old caches
// are cleared by name (the earlier version also deleted the members app's cache on the same site).
const C = "mri-demo-v16"; // bump with version.json and the mri-version meta in index.html
const FILES = ["./", "index.html", "data.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("mri-demo-") && k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith("/demo/")) return;
  const fresh = e.request.mode === "navigate" || /\/$|\.html$|data\.js$|version\.json$/.test(u.pathname);
  const req = fresh ? (() => { const b = new URL(e.request.url); b.searchParams.set("_fresh", Date.now()); return new Request(b, { cache: "no-store", credentials: "same-origin" }); })() : e.request;
  const keep = !u.pathname.endsWith("version.json");
  e.respondWith(fetch(req).then(r => { if (r.ok && keep) { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)).catch(() => {}); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
