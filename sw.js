/* Maschenwerk – Service Worker: macht die App offline-fähig.
   Die Versionsnummer setzt das Build-Skript; jede neue Version
   lädt die App-Dateien einmal neu und fragt dann nach „Aktualisieren“. */
var VERSION = "2026.10.24-c33d96b3";
var CACHE = "maschenwerk-" + VERSION;
var SHELL = [
 "./",
 "index.html",
 "app.css",
 "app.js",
 "config.js",
 "manifest.webmanifest",
 "datenschutz.html",
 "vendor/supabase.js",
 "vendor/pdf.min.js",
 "vendor/pdf.worker.min.js",
 "vendor/jspdf.umd.min.js",
 "fonts/atkinson-hyperlegible-latin-400-italic.woff2",
 "fonts/atkinson-hyperlegible-latin-400-normal.woff2",
 "fonts/atkinson-hyperlegible-latin-700-normal.woff2",
 "fonts/barlow-condensed-latin-500-normal.woff2",
 "fonts/barlow-condensed-latin-600-normal.woff2",
 "fonts/barlow-condensed-latin-700-normal.woff2",
 "fonts/young-serif-latin-400-normal.woff2",
 "icons/apple-touch-icon.png",
 "icons/favicon-48.png",
 "icons/favicon.svg",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable-512.png"
];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(SHELL.map(function(u){ return c.add(new Request(u, {cache:"reload"})); }));
  }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf("maschenwerk-") === 0 && k !== CACHE; }).map(function(k){ return caches["delete"](k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("message", function(e){ if(e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;            /* Supabase & Co. gehen direkt ins Netz */
  /* config.js zuerst aus dem Netz, damit Änderungen sofort greifen */
  if(/\/config\.js$/.test(url.pathname)){
    e.respondWith(fetch(req).then(function(r){
      var copy = r.clone(); caches.open(CACHE).then(function(c){ c.put("config.js", copy); });
      return r;
    }).catch(function(){ return caches.match("config.js"); }));
    return;
  }
  /* Seitenaufrufe: die App-Hülle aus dem Speicher */
  if(req.mode === "navigate"){
    e.respondWith(caches.match(req, {ignoreSearch:true}).then(function(r){
      return r || fetch(req).catch(function(){ return caches.match("./"); });
    }));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch:true}).then(function(r){
    return r || fetch(req).then(function(resp){
      if(resp.ok && resp.type === "basic"){ var copy = resp.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
      return resp;
    });
  }));
});
