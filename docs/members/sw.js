// Members area service worker: makes it installable and lets the page open offline with a clear message.
// Network first for this site's own files; sign-in and data calls (supabase.co) are never touched or cached.
const C = "mri-members-v70"; // bump with version.json and the mri-version meta in index.html
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("mri-members-") && k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith("/members/")) return;
  // Pages always come fresh from the network (GitHub Pages lets browsers keep a copy for 10 minutes, which made
  // the installed app show an old version after an update); the cache is only the offline fallback.
  // 22 Oct 2026: pages and version.json are fetched with a throwaway query so neither the browser nor GitHub's CDN can
  // hand back an older copy straight after an update. Stored in the offline cache under the normal address.
  const fresh = e.request.mode === "navigate" || u.pathname.endsWith("/") || u.pathname.endsWith(".html") || u.pathname.endsWith("version.json");
  const req = fresh ? (() => { const b = new URL(e.request.url); b.searchParams.set("_fresh", Date.now()); return new Request(b, { cache: "no-store", credentials: "same-origin" }); })() : e.request;
  const keep = !u.pathname.endsWith("version.json");
  e.respondWith(fetch(req).then(r => { if (r.ok && keep) { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)).catch(() => {}); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
