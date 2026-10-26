/* NährWert – Service Worker: macht die App offline nutzbar.
   App-Dateien kommen aus dem Cache und werden im Hintergrund aktualisiert.
   Anfragen an fremde Server (Open Food Facts, Scanner-Bibliothek) laufen normal
   übers Netz; die Scanner-Bibliothek wird nach dem ersten Laden mitgecacht. */
const CACHE = "naehrwert-v36";
const FILES = ["./", "index.html", "naehrwert-design.css", "naehrwert-produkte.js", "naehrwert-bls.js", "naehrwert-ch.js", "naehrwert-scan.js", "naehrwert-wasser.js", "naehrwert-offline-2.js", "naehrwert-sprache.js", "naehrwert-etikett.js", "naehrwert-rezepte.js", "manifest.webmanifest",
               "naehrwert-intro-hell.mov", "naehrwert-intro-dunkel.mov", "naehrwert-intro-hell.webm", "naehrwert-intro-dunkel.webm",
               "naehrwert-intro-hell.webp", "naehrwert-intro-dunkel.webp",
               "naehrwert-zoom-hell.mov", "naehrwert-zoom-dunkel.mov", "naehrwert-zoom-hell.webm", "naehrwert-zoom-dunkel.webm",
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
  // Videos (Startanimation): Safari fragt mit „Range“ nur Teilstücke an und spielt nur ab,
  // wenn genau diese Bytes als 206 zurückkommen – ein ganzes 200 aus dem Cache lehnt es ab
  if(own && req.headers.has("range")){
    ev.respondWith(caches.open(CACHE).then(cache => cache.match(req.url, {ignoreSearch: true}))
      .then(hit => hit ? partial(hit, req.headers.get("range")) : fetch(req)));
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

/* Teilstück „bytes=a-b“ (auch „a-“ und „-n“) aus einer vollständigen Antwort ausschneiden */
function partial(res, range){
  return res.arrayBuffer().then(buf => {
    const size = buf.byteLength;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    let start = 0, end = size - 1;
    if(m && m[1] === "" && m[2] !== "") start = Math.max(0, size - parseInt(m[2], 10));
    else if(m){ start = parseInt(m[1] || "0", 10); if(m[2] !== "") end = Math.min(size - 1, parseInt(m[2], 10)); }
    if(start >= size || start > end) return new Response(null, {status: 416, headers: {"Content-Range": "bytes */" + size}});
    return new Response(buf.slice(start, end + 1), {status: 206, statusText: "Partial Content", headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes"
    }});
  });
}
