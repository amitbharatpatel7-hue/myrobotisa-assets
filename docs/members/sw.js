// Members area service worker: makes it installable and lets the page open offline with a clear message.
// Network first for this site's own files; sign-in and data calls (supabase.co) are never touched or cached.
const C = "mri-members-v6";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("mri-members-") && k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith("/members/")) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)).catch(() => {}); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
