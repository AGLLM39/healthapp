/* NährWert – Service Worker: macht die App offline nutzbar.
   App-Dateien kommen aus dem Cache und werden im Hintergrund aktualisiert.
   Anfragen an fremde Server (Open Food Facts, Scanner-Bibliothek) laufen normal
   übers Netz; die Scanner-Bibliothek wird nach dem ersten Laden mitgecacht. */
const CACHE = "naehrwert-v24";
const FILES = ["./", "index.html", "naehrwert-design.css", "naehrwert-produkte.js", "naehrwert-bls.js", "naehrwert-ch.js", "naehrwert-scan.js", "naehrwert-wasser.js", "naehrwert-offline-2.js", "naehrwert-sprache.js", "naehrwert-etikett.js", "naehrwert-rezepte.js", "manifest.webmanifest",
               "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];

self.addEventListener("install", ev => {
  // cache: "reload" – am HTTP-Cache des Browsers vorbei, sonst landen beim Update alte Datendateien im neuen Cache
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", ev => {
  const req = ev.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const zxing = url.hostname === "cdn.jsdelivr.net" && url.pathname.indexOf("/@zxing/") >= 0;
  if(!own && !zxing) return;            // Open Food Facts usw. nie cachen
  // Die Seite selbst: zuerst aus dem Netz (damit Updates sofort ankommen), offline aus dem Cache
  if(req.mode === "navigate"){
    ev.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put("index.html", copy));
      return res;
    }).catch(() => caches.match("index.html", {ignoreSearch: true}).then(hit => hit || caches.match("./"))));
    return;
  }
  ev.respondWith(caches.open(CACHE).then(cache =>
    cache.match(req, {ignoreSearch: own}).then(hit => {
      const net = fetch(req).then(res => {
        if(res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(() => hit || (req.mode === "navigate" ? cache.match("index.html") : undefined));
      return hit || net;               // sofort aus dem Cache, im Hintergrund aktualisieren
    })
  ));
});
