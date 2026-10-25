(function(){
"use strict";

/* =========================================================
   Grundlagen
   ========================================================= */
var APP_VERSION = "2026.10.24-c33d96b3";
var KEY2 = "maschenwerk.v2", KEY1 = "maschenwerk.v1", KEYP = "maschenwerk.prefs";
var KINDS = ["projects","patterns","yarns","needles","swatches"];
var S = {projects:{}, patterns:{}, yarns:{}, needles:{}, swatches:{}};
var UI = {tab:"home", stack:[], libQ:"", libF:"all", stockSeg:"yarn", toolSeg:"calc", abbrQ:"", showDone:false};
var PREF = {haptic:true, wake:true};
var assets = null, usage = null, syncState = "local";
var saveTimer = null;

function $(s, r){ return (r||document).querySelector(s); }
function $$(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function uid(){
  var a = "abcdefghijkmnopqrstuvwxyz0123456789", out = "", b = new Uint8Array(10);
  try{ crypto.getRandomValues(b); }catch(e){ for(var i=0;i<10;i++) b[i] = Math.floor(Math.random()*256); }
  for(var j=0;j<10;j++) out += a[b[j] % a.length];
  return out;
}
function now(){ return Date.now(); }
function n(v){ if(v===null || v===undefined || v==="") return NaN; var x = parseFloat(String(v).replace(",", ".")); return isFinite(x) ? x : NaN; }
function int(v){ var x = n(v); return isFinite(x) ? Math.round(x) : 0; }
function fmt(x, d){ if(!isFinite(x)) return "–"; return x.toLocaleString("de-DE", {maximumFractionDigits: d===undefined?1:d}); }
function fmtDur(ms){
  var m = Math.round((ms||0)/60000);
  if(m < 60) return m + " min";
  var h = Math.floor(m/60), r = m % 60;
  return h + " h" + (r ? " " + r + " min" : "");
}
function clock(ms){ var s = Math.floor((ms||0)/1000), h = Math.floor(s/3600), m = Math.floor(s%3600/60);
  return h ? h + ":" + String(m).padStart(2,"0") + " h" : m + ":" + String(s%60).padStart(2,"0"); }
function dstr(t){ try{ return new Date(t).toLocaleDateString("de-DE", {day:"numeric", month:"short", year:"numeric"}); }catch(e){ return ""; } }
function dtstr(t){ try{ return new Date(t).toLocaleString("de-DE", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}); }catch(e){ return ""; } }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function plural(k, one, many){ return k === 1 ? one : many; }

/* =========================================================
   Speicher: sofort lokal, mit Konto zusätzlich in der Cloud
   ========================================================= */
function loadLocal(){
  var o = null;
  try{ o = JSON.parse(localStorage.getItem(KEY2) || "null"); }catch(e){}
  if(!o){
    try{
      var v1 = JSON.parse(localStorage.getItem(KEY1) || "null");
      if(v1){ o = {}; ["projects","patterns","yarns","swatches"].forEach(function(k){ o[k] = v1[k] || {}; }); }
    }catch(e){}
  }
  if(o){
    KINDS.forEach(function(k){ if(o[k] && typeof o[k] === "object") S[k] = o[k]; });
    if(o.ui && o.ui.tab) UI.tab = o.ui.tab;
  }
  try{ Object.assign(PREF, JSON.parse(localStorage.getItem(KEYP) || "{}")); }catch(e){}
  Object.keys(S.projects).forEach(function(id){ normProject(S.projects[id]); });
}
function saveLocalSoon(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocalNow, 250);
}
function saveLocalNow(){
  clearTimeout(saveTimer);
  try{
    var o = {ui:{tab:UI.tab}};
    KINDS.forEach(function(k){ o[k] = S[k]; });
    localStorage.setItem(KEY2, JSON.stringify(o));
  }catch(e){}
}
function savePrefs(){ try{ localStorage.setItem(KEYP, JSON.stringify(PREF)); }catch(e){} }

function put(kind, obj, delay){
  obj.updatedAt = now();
  S[kind][obj.id] = obj;
  saveLocalSoon();
  pushSoon(kind, obj.id, delay === undefined ? 600 : delay);
  return obj;
}
function remove(kind, id){
  if(!S[kind][id]) return;
  /* nur eine Löschmarkierung ohne Inhalt bleibt, damit das Löschen alle Geräte erreicht */
  put(kind, {id:id, deleted:true}, 0);
}
/* =========================================================
   Fachlogik
   ========================================================= */
var STATUS = {wip:["In Arbeit","wip"], plan:["Geplant",""], hold:["Pausiert","hold"], done:["Fertig","done"]};
var STATUS_ORDER = ["wip","plan","hold","done"];

function live(kind){
  return Object.keys(S[kind]).map(function(k){ return S[kind][k]; })
    .filter(function(o){ return o && !o.deleted; });
}
function byRecent(a, b){ return (b.lastKnitAt||b.updatedAt||0) - (a.lastKnitAt||a.updatedAt||0); }

/* Projekte: alte Stände (ein Zählerfeld) in Teile, Zähler und Erinnerungen überführen */
function normProject(p){
  if(!p || typeof p !== "object" || p.deleted) return p;
  if(!Array.isArray(p.sections) || !p.sections.length){
    var cs = Array.isArray(p.counters) ? p.counters : [];
    var main = cs.filter(function(c){ return c.kind !== "rapport" && c.kind !== "repeat"; })[0];
    var sec = {id: main ? main.id : uid(), name: "Hauptteil", unit:"Reihe",
      row: main ? (int(main.value) + 1) : 1, target: main && main.target ? int(main.target) : 0, startSts: 0, done:false};
    p.sections = [sec];
    p.counters = cs.filter(function(c){ return c !== main; }).map(function(c){
      if(c.kind === "rapport") return {id:c.id||uid(), name:c.name||"Rapport", kind:"repeat",
        len:int(c.target)||4, start:int(c.offset)+1, sectionId:sec.id};
      return {id:c.id||uid(), name:c.name||"Zähler", kind:"manual", value:int(c.value)};
    });
    p.activeSection = sec.id;
  }
  if(!Array.isArray(p.counters)) p.counters = [];
  if(!Array.isArray(p.reminders)) p.reminders = [];
  if(!Array.isArray(p.log)) p.log = [];
  if(!Array.isArray(p.photos)) p.photos = [];
  if(!Array.isArray(p.yarns)) p.yarns = [];
  if(!Array.isArray(p.needleIds)) p.needleIds = [];
  if(!p.view || typeof p.view !== "object") p.view = {};
  if(!STATUS[p.status]) p.status = "wip";
  if(!p.sections.some(function(s){ return s.id === p.activeSection; })) p.activeSection = p.sections[0].id;
  p.sections.forEach(function(s){
    if(!(s.row >= 1)) s.row = 1;
    if(s.unit !== "Runde") s.unit = "Reihe";
  });
  return p;
}
function activeSec(p){
  return p.sections.filter(function(s){ return s.id === p.activeSection; })[0] || p.sections[0];
}
function secById(p, id){ return p.sections.filter(function(s){ return s.id === id; })[0]; }
function abbrU(s){ return s && s.unit === "Runde" ? "Rd" : "R"; }
function unitPl(s){ return s && s.unit === "Runde" ? "Runden" : "Reihen"; }

/* Erinnerungen: einmalig in Reihe X oder ab Reihe A alle B Reihen, C-mal */
function remsFor(p, s){
  return (p.reminders||[]).filter(function(r){ return !r.sectionId || r.sectionId === s.id; });
}
function dueNow(r, row){
  if(r.kind !== "repeat") return row === r.from ? {k:1, of:1} : null;
  if(!(r.every > 0) || row < r.from) return null;
  var d = row - r.from;
  if(d % r.every) return null;
  var k = d / r.every + 1;
  if(r.times && k > r.times) return null;
  return {k:k, of:r.times||0};
}
function nextDue(r, row){
  if(r.kind !== "repeat") return r.from > row ? r.from : null;
  if(!(r.every > 0)) return null;
  if(row < r.from) return r.from;
  var k = Math.floor((row - r.from) / r.every) + 1;
  if(r.times && k >= r.times) return null;
  return r.from + k * r.every;
}
function occBefore(r, row){
  if(r.kind !== "repeat") return r.from < row ? 1 : 0;
  if(!(r.every > 0) || row <= r.from) return 0;
  var k = Math.floor((row - 1 - r.from) / r.every) + 1;
  return r.times ? Math.min(k, r.times) : k;
}
function occIndex(r, row){            // welche Wiederholung ist die in Reihe `row`
  if(r.kind !== "repeat") return 1;
  return Math.floor((row - r.from) / r.every) + 1;
}
function remWhen(r, s){
  var u = abbrU(s);
  if(r.kind !== "repeat") return "in " + u + " " + r.from;
  var t = "ab " + u + " " + r.from + ", alle " + r.every + " " + (s && s.unit === "Runde" ? "Rd" : "R");
  return t + (r.times ? " · " + r.times + "×" : " · fortlaufend");
}
function remLast(r){ return r.kind === "repeat" && r.times ? r.from + (r.times-1)*r.every : (r.kind === "repeat" ? null : r.from); }
function stitchesAt(p, s, row){
  if(!(s.startSts > 0)) return null;
  var st = s.startSts;
  remsFor(p, s).forEach(function(r){ if(r.delta) st += r.delta * occBefore(r, row); });
  return st;
}
function rowsToCm(p, rows){
  var g = n(p.gaugeRows);
  if(!(g > 0)) return null;
  return rows / g * 10;
}
function ctrValue(p, c){
  if(c.kind !== "repeat") return {v:int(c.value)};
  var s = secById(p, c.sectionId) || activeSec(p);
  if(!(c.len > 0) || s.row < (c.start||1)) return {v:null};
  var d = s.row - (c.start||1);
  return {v: d % c.len + 1, of:c.len, rep: Math.floor(d / c.len) + 1};
}
function projProgress(p){
  var t = 0, d = 0;
  p.sections.forEach(function(s){
    if(s.target > 0){ t += s.target; d += s.done ? s.target : Math.min(s.target, s.row - 1); }
  });
  return t ? d / t : null;
}
function patternOf(p){ var x = p.patternId && S.patterns[p.patternId]; return x && !x.deleted ? x : null; }
function projYarns(p){
  var out = [];
  (p.yarns||[]).forEach(function(u){ var y = S.yarns[u.yarnId]; if(y && !y.deleted) out.push({y:y, balls:u.balls||0}); });
  if(!out.length && p.yarnName){
    var y = live("yarns").filter(function(x){ return x.name === p.yarnName; })[0];
    out.push(y ? {y:y, balls:0} : {y:{name:p.yarnName}, balls:0, ghost:true});
  }
  return out;
}
function projNeedles(p){
  return (p.needleIds||[]).map(function(id){ return S.needles[id]; }).filter(function(x){ return x && !x.deleted; });
}

/* Größenlauf-Erkennung: "110 (116) 121 (126)" und "110 (116, 121, 126)" */
var TOK = /\(\s*\d+(?:[.,]\d+)?(?:\s*[,/]\s*\d+(?:[.,]\d+)?)*\s*\)|\d+(?:[.,]\d+)?/g;
function findRuns(line){
  TOK.lastIndex = 0;
  var m, toks = [];
  while((m = TOK.exec(line)) !== null) toks.push({s:m.index, e:m.index + m[0].length, txt:m[0], grp:m[0].charAt(0) === "("});
  var runs = [], cur = null;
  for(var i=0;i<toks.length;i++){
    var t = toks[i];
    if(cur && /^\s*$/.test(line.slice(cur.e, t.s))){ cur.items.push(t); cur.e = t.e; }
    else { if(cur) runs.push(cur); cur = {s:t.s, e:t.e, items:[t]}; }
  }
  if(cur) runs.push(cur);
  return runs.filter(function(r){
    if(!r.items.some(function(t){ return t.grp; })) return false;
    r.nums = [];
    r.items.forEach(function(t){
      var inner = t.grp ? t.txt.slice(1, -1) : t.txt;
      inner.split(/[,/]/).forEach(function(q){ q = q.trim(); if(q) r.nums.push(q); });
    });
    return r.nums.length >= 2;
  });
}
function sizeCount(text){
  var freq = {};
  String(text||"").split("\n").forEach(function(line){
    findRuns(line).forEach(function(r){ freq[r.nums.length] = (freq[r.nums.length]||0) + 1; });
  });
  var best = 0, bestN = 0;
  Object.keys(freq).forEach(function(k){ if(freq[k] > best){ best = freq[k]; bestN = parseInt(k, 10); } });
  return bestN;
}
function renderPattern(text, idx){
  return String(text||"").split("\n").map(function(line){
    var runs = findRuns(line);
    if(!runs.length || idx < 0) return esc(line);
    var out = "", pos = 0;
    runs.forEach(function(r){
      out += esc(line.slice(pos, r.s));
      out += '<mark title="' + esc(r.nums.join(" / ")) + '">' + esc(r.nums[Math.min(idx, r.nums.length-1)]) + "</mark>";
      pos = r.e;
    });
    return out + esc(line.slice(pos));
  }).join("\n");
}

/* Garnstärken nach Craft Yarn Council */
var CYC = [
  [0,"Lace",400,99999,33,40,1.5,2.25,30,40],
  [1,"Fingering / Sockengarn 4-fach",350,400,27,32,2.25,3.25,18,30],
  [2,"Sport / Sockengarn 6-fach",250,350,23,26,3.25,3.75,14,18],
  [3,"DK",200,250,21,24,3.75,4.5,12,15],
  [4,"Worsted / Aran",120,200,16,20,4.5,5.5,9,12],
  [5,"Bulky / Chunky",60,120,12,15,5.5,8,6,9],
  [6,"Super Bulky",40,60,7,11,8,12.75,5,6],
  [7,"Jumbo",0,40,1,6,12.75,25,1,4]
];
function cycByLength(m100){ for(var i=0;i<CYC.length;i++){ if(m100 >= CYC[i][2] && m100 < CYC[i][3]) return CYC[i]; } return null; }
function cycBy(idx, val){ for(var i=0;i<CYC.length;i++){ if(val >= CYC[i][idx] && val <= CYC[i][idx+1]) return CYC[i]; } return null; }
var US = {"2":"0","2.25":"1","2.5":"1½","2.75":"2","3":"2½","3.25":"3","3.5":"4","3.75":"5","4":"6","4.5":"7","5":"8","5.5":"9",
  "6":"10","6.5":"10½","8":"11","9":"13","10":"15","12.75":"17","15":"19","19":"35","25":"50"};
function usSize(mm){ var k = String(Math.round(mm*100)/100); return US[k] || ""; }

function spread(total, count){
  if(!(count > 0) || !(total > 0) || count > total) return null;
  var base = Math.floor(total / count), rest = total % count, seq = [], err = 0;
  for(var i=0;i<count;i++){ err += rest; if(err >= count){ err -= count; seq.push(base + 1); } else seq.push(base); }
  return {base:base, rest:rest, seq:seq};
}

function haptic(ms){ if(PREF.haptic && navigator.vibrate){ try{ navigator.vibrate(ms); }catch(e){} } }

/* =========================================================
   Dateien (PDF, Fotos): auf dem Gerät in IndexedDB,
   mit Konto zusätzlich im Cloud-Speicher
   ========================================================= */
var IDBP = null;
function idb(){
  if(IDBP) return IDBP;
  IDBP = new Promise(function(res, rej){
    if(!window.indexedDB){ rej(new Error("no idb")); return; }
    var rq = indexedDB.open("maschenwerk", 1);
    rq.onupgradeneeded = function(){ if(!rq.result.objectStoreNames.contains("files")) rq.result.createObjectStore("files", {keyPath:"id"}); };
    rq.onsuccess = function(){ res(rq.result); };
    rq.onerror = function(){ rej(rq.error); };
  });
  IDBP.catch(function(){ IDBP = null; });
  return IDBP;
}
function idbTx(mode, fn){
  return idb().then(function(d){
    return new Promise(function(res, rej){
      var tx = d.transaction("files", mode), r = fn(tx.objectStore("files")), out;
      if(r) r.onsuccess = function(){ out = r.result; };
      tx.oncomplete = function(){ res(out); };
      tx.onerror = tx.onabort = function(){ rej(tx.error); };
    });
  });
}
function idbGet(id){ return idbTx("readonly", function(st){ return st.get(id); }); }
function idbPut(rec){ return idbTx("readwrite", function(st){ return st.put(rec); }); }
function idbDel(id){ return idbTx("readwrite", function(st){ return st["delete"](id); }); }
function idbAll(){ return idbTx("readonly", function(st){ return st.getAll(); }); }
function idbClear(){ return idbTx("readwrite", function(st){ return st.clear(); }); }
function recBlob(r){ return r.buf ? new Blob([r.buf], {type:r.type || ""}) : r.blob; }

var fileUrls = {};
function fileUrl(id, blob){ if(!fileUrls[id]) fileUrls[id] = URL.createObjectURL(blob); return fileUrls[id]; }
var FILES = {
  upload:function(blob, opt){
    var type = (opt && opt.type) || blob.type || "application/octet-stream";
    if(blob.size > 20 * 1048576) return Promise.reject({code:"too_large"});
    if(!blob.size) return Promise.reject({code:"invalid_request"});
    var id = uid() + uid();
    return blob.arrayBuffer().then(function(buf){
      var rec = {id:id, buf:buf, type:type, size:blob.size, synced:false, t:now()};
      return idbPut(rec).then(function(){
        cloudUploadFile(rec);
        return {id:id, sizeBytes:blob.size, contentType:type, url:fileUrl(id, new Blob([buf], {type:type}))};
      });
    }).catch(function(e){ return Promise.reject(e && e.code ? e : {code:"store_unavailable"}); });
  },
  blob:function(id){
    return idbGet(id).then(function(r){
      if(r && (r.buf || r.blob)) return recBlob(r);
      return cloudDownloadFile(id).then(function(b){
        return b.arrayBuffer().then(function(buf){
          idbPut({id:id, buf:buf, type:b.type, size:b.size, synced:true, t:now()}).catch(function(){});
          return new Blob([buf], {type:b.type});
        });
      });
    }, function(){ return cloudDownloadFile(id); });
  },
  url:function(id){
    if(fileUrls[id]) return Promise.resolve(fileUrls[id]);
    return FILES.blob(id).then(function(b){ return fileUrl(id, b); });
  },
  "delete":function(id){
    if(fileUrls[id]){ try{ URL.revokeObjectURL(fileUrls[id]); }catch(e){} delete fileUrls[id]; }
    return idbDel(id).catch(function(){}).then(function(){ return cloudDeleteFile(id); }).then(function(){ return {deleted:true}; });
  },
  list:function(){
    return idbAll().then(function(all){
      var b = 0, open = 0;
      all.forEach(function(r){ b += r.size || 0; if(!r.synced) open++; });
      return {assets:[], usage:{files:all.length, bytes:b, unsynced:open}};
    });
  }
};
assets = FILES;
function refreshUsage(){ FILES.list().then(function(r){ usage = r.usage; }, function(){}); }
function hydrateFiles(root){
  $$("img[data-file]", root || document).forEach(function(img){
    if(img.dataset.hy) return;
    img.dataset.hy = "1";
    FILES.url(img.dataset.file).then(function(u){ img.src = u; }, function(){
      img.alt = CL.user ? "Datei nicht erreichbar" : "Datei liegt auf einem anderen Gerät";
      img.classList.add("missing");
    });
  });
}

/* =========================================================
   Konto und Synchronisation über Supabase
   Lokal zuerst: jede Änderung landet sofort auf dem Gerät und
   wird, wenn ein Konto angemeldet ist, im Hintergrund abgeglichen.
   Konflikte: der jüngere Stand gewinnt (updatedAt).
   ========================================================= */
var CFG = window.MASCHENWERK_CONFIG || {};
var CL = {sb:null, user:null, dirty:{}, delq:[], pushing:false, again:false, pulling:false, timer:null, timerAt:0,
  retry:null, chan:null, rt:"", lastSync:0};
var KEYD = "maschenwerk.dirty", KEYQ = "maschenwerk.fdel", KEYO = "maschenwerk.owner", KEYC = "maschenwerk.cursor.";

function cloudConfigured(){
  return !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase && window.supabase.createClient);
}
function loadDirty(){
  try{ CL.dirty = JSON.parse(localStorage.getItem(KEYD) || "{}") || {}; }catch(e){ CL.dirty = {}; }
  try{ CL.delq = JSON.parse(localStorage.getItem(KEYQ) || "[]") || []; }catch(e){ CL.delq = []; }
}
function saveDirty(){
  try{ localStorage.setItem(KEYD, JSON.stringify(CL.dirty)); localStorage.setItem(KEYQ, JSON.stringify(CL.delq)); }catch(e){}
}
function pendingCount(){ return Object.keys(CL.dirty).length; }

/* ---------- Statusanzeige ---------- */
function setSync(st){
  syncState = st;
  $$(".sync").forEach(function(el){ el.className = "sync " + st; el.lastChild.textContent = syncWord(); });
}
function syncWord(){
  if(syncState === "local") return cloudConfigured() ? "nur dieses Gerät" : "auf diesem Gerät";
  return {on:"synchron", busy:"gleicht ab …", offline:"offline", err:"Abgleich gestört", wait:"verbinde …"}[syncState] || "";
}
function syncBadge(){
  return '<button type="button" class="sync ' + syncState + '" data-act="account" title="Konto und Abgleich"><i></i>' + esc(syncWord()) + "</button>";
}

/* ---------- Schreiben ---------- */
function pushSoon(kind, id, delay){
  CL.dirty[kind + "/" + id] = 1;
  saveDirty();
  if(CL.user) scheduleFlush(delay || 0);
}
function scheduleFlush(delay){
  var at = now() + delay;
  if(CL.timer && CL.timerAt <= at) return;
  clearTimeout(CL.timer);
  CL.timerAt = at;
  CL.timer = setTimeout(function(){ CL.timer = null; flushNow(); }, Math.max(0, delay));
}
function flushPushes(){ if(CL.user && CL.timer){ clearTimeout(CL.timer); CL.timer = null; flushNow(); } }
function rowFor(kind, id){
  var o = S[kind] && S[kind][id]; if(!o) return null;
  return {user_id:CL.user.id, kind:kind, id:id, data:o, updated_at:Math.round(o.updatedAt || 0), deleted:!!o.deleted};
}
function flushNow(){
  if(!CL.user || !CL.sb) return Promise.resolve();
  if(CL.pushing){ CL.again = true; return Promise.resolve(); }
  var keys = Object.keys(CL.dirty);
  if(!keys.length && !CL.delq.length){ uploadPendingFiles(); return Promise.resolve(); }
  CL.pushing = true;
  if(syncState !== "offline") setSync("busy");
  /* in Paketen bis ca. 400 KB, damit lange Anleitungstexte nicht an Grenzen stoßen */
  var batches = [], cur = [], size = 0, stamp = {};
  keys.forEach(function(k){
    var i = k.indexOf("/"), kind = k.slice(0, i), id = k.slice(i + 1);
    if(KINDS.indexOf(kind) < 0){ delete CL.dirty[k]; return; }
    var row = rowFor(kind, id);
    if(!row){ delete CL.dirty[k]; return; }
    stamp[k] = row.updated_at;
    var sz = JSON.stringify(row.data).length;
    if(cur.length && (size + sz > 400000 || cur.length >= 100)){ batches.push(cur); cur = []; size = 0; }
    cur.push(row); size += sz;
  });
  if(cur.length) batches.push(cur);
  var p = Promise.resolve();
  batches.forEach(function(b){
    p = p.then(function(){
      return CL.sb.from("items").upsert(b, {onConflict:"user_id,kind,id"}).then(function(r){
        if(r.error) throw r.error;
        b.forEach(function(row){
          var k = row.kind + "/" + row.id, o = S[row.kind][row.id];
          if(o && Math.round(o.updatedAt || 0) === stamp[k]) delete CL.dirty[k];
        });
        saveDirty();
      });
    });
  });
  return p.then(processFileDeletes).then(function(){
    CL.pushing = false; CL.lastSync = now();
    setSync("on");
    uploadPendingFiles();
    if(CL.again || pendingCount()){ CL.again = false; scheduleFlush(400); }
  }, function(err){
    CL.pushing = false; CL.again = false;
    syncFailed(err);
    clearTimeout(CL.retry);
    CL.retry = setTimeout(function(){ if(CL.user) scheduleFlush(0); }, 20000);
  });
}
function syncFailed(err){
  if(window.console) console.warn("Abgleich:", err);
  if(navigator.onLine === false || /fetch|network|Failed to/i.test(String(err && (err.message || err)))) setSync("offline");
  else setSync("err");
}

/* ---------- Lesen ---------- */
function msTrim(ts){ return String(ts || "").replace(/(\.\d{3})\d+/, "$1"); }
function overlapTs(ts){
  var d = Date.parse(msTrim(ts));
  return isFinite(d) && d > 10000 ? new Date(d - 5000).toISOString() : "1970-01-01T00:00:00Z";
}
function applyRow(row){
  if(!row || KINDS.indexOf(row.kind) < 0 || !row.data || !row.id) return false;
  var k = row.kind + "/" + row.id, l = S[row.kind][row.id], ru = Number(row.updated_at) || 0;
  if(l && Math.round(l.updatedAt || 0) >= ru) return false;
  var c; try{ c = clone(row.data); }catch(e){ return false; }
  c.id = row.id; c.updatedAt = ru;
  if(row.deleted) c.deleted = true;
  if(row.kind === "projects") normProject(c);
  S[row.kind][row.id] = c;
  delete CL.dirty[k];
  return true;
}
function pullNow(){
  if(!CL.user || !CL.sb || CL.pulling) return Promise.resolve();
  CL.pulling = true;
  var ck = KEYC + CL.user.id, cur = null;
  try{ cur = localStorage.getItem(ck); }catch(e){}
  var from = cur ? overlapTs(cur) : "1970-01-01T00:00:00Z", maxTs = cur || "", changed = {};
  function page(f){
    return CL.sb.from("items").select("kind,id,data,updated_at,deleted,server_updated")
      .gte("server_updated", f).order("server_updated", {ascending:true}).limit(500).then(function(r){
        if(r.error) throw r.error;
        var rows = r.data || [];
        rows.forEach(function(row){
          if(applyRow(row)) changed[row.kind] = 1;
          if(!maxTs || Date.parse(msTrim(row.server_updated)) > Date.parse(msTrim(maxTs))) maxTs = row.server_updated;
        });
        var last = rows.length ? rows[rows.length - 1].server_updated : null;
        if(rows.length === 500 && last && last !== f) return page(last);
      });
  }
  return page(from).then(function(){
    if(maxTs){ try{ localStorage.setItem(ck, maxTs); }catch(e){} }
    CL.pulling = false; CL.lastSync = now();
    saveDirty();
    var ks = Object.keys(changed);
    if(ks.length){ saveLocalSoon(); ks.forEach(onRemote); }
    if(!CL.pushing) setSync("on");
  }, function(err){ CL.pulling = false; syncFailed(err); });
}
function subscribe(){
  unsubscribe();
  try{
    CL.chan = CL.sb.channel("items-" + CL.user.id)
      .on("postgres_changes", {event:"*", schema:"public", table:"items", filter:"user_id=eq." + CL.user.id}, function(pl){
        var row = pl && pl["new"];
        if(row && applyRow(row)){ saveDirty(); saveLocalSoon(); onRemote(row.kind); }
      })
      .subscribe(function(status){ CL.rt = status; });
  }catch(e){ CL.rt = "error"; }
}
function unsubscribe(){
  if(CL.chan){ try{ CL.sb.removeChannel(CL.chan); }catch(e){} CL.chan = null; }
  CL.rt = "";
}

/* ---------- Dateien in der Cloud ---------- */
function filePath(id){ return CL.user.id + "/" + id; }
function cloudUploadFile(rec){
  if(!CL.user || !CL.sb) return Promise.resolve(false);
  var blob = recBlob(rec);
  return CL.sb.storage.from("files").upload(filePath(rec.id), blob, {contentType:rec.type, upsert:true}).then(function(r){
    if(r.error && !/exist|duplicate/i.test(String(r.error.message || ""))) throw r.error;
    rec.synced = true;
    return idbPut(rec).then(function(){ return true; });
  }).catch(function(e){ if(window.console) console.warn("Datei-Upload:", e); return false; });
}
var upBusy = false;
function uploadPendingFiles(){
  if(!CL.user || upBusy) return;
  upBusy = true;
  idbAll().then(function(all){
    var p = Promise.resolve();
    all.filter(function(r){ return !r.synced; }).forEach(function(r){ p = p.then(function(){ return cloudUploadFile(r); }); });
    return p;
  }).catch(function(){}).then(function(){ upBusy = false; refreshUsage(); });
}
function cloudDownloadFile(id){
  if(!CL.user || !CL.sb) return Promise.reject(new Error("offline"));
  return CL.sb.storage.from("files").download(filePath(id)).then(function(r){
    if(r.error || !r.data) throw r.error || new Error("missing");
    return r.data;
  });
}
function cloudDeleteFile(id){
  if(!CL.user || !CL.sb) return Promise.resolve();
  return CL.sb.storage.from("files").remove([filePath(id)]).then(function(r){
    if(r.error) throw r.error;
  }).catch(function(){ if(CL.delq.indexOf(id) < 0){ CL.delq.push(id); saveDirty(); } });
}
function processFileDeletes(){
  if(!CL.delq.length || !CL.user) return Promise.resolve();
  var ids = CL.delq.slice();
  return CL.sb.storage.from("files").remove(ids.map(filePath)).then(function(r){
    if(r.error) throw r.error;
    CL.delq = CL.delq.filter(function(x){ return ids.indexOf(x) < 0; }); saveDirty();
  });
}

/* ---------- Anmeldung ---------- */
function cloudInit(){
  loadDirty();
  if(!cloudConfigured()){ setSync("local"); return; }
  try{
    CL.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:"maschenwerk-auth"}
    });
  }catch(e){ setSync("err"); return; }
  CL.sb.auth.onAuthStateChange(function(ev, session){
    var u = session && session.user;
    setTimeout(function(){
      if(ev === "PASSWORD_RECOVERY") newPasswordSheet(true);
      if(u && (!CL.user || CL.user.id !== u.id)) onSignedIn(u);
      else if(!u && CL.user) onSignedOut();
      else if(u) CL.user = u;
    }, 0);
  });
  CL.sb.auth.getSession().then(function(r){
    var u = r && r.data && r.data.session && r.data.session.user;
    if(u && !CL.user) onSignedIn(u);
    else if(!u) setSync("local");
  }, function(){ setSync("local"); });
  window.addEventListener("online", function(){ if(CL.user){ pullNow(); scheduleFlush(0); } });
  window.addEventListener("offline", function(){ if(CL.user) setSync("offline"); });
  document.addEventListener("visibilitychange", function(){
    if(!CL.user) return;
    if(document.visibilityState === "visible"){ pullNow(); scheduleFlush(300); }
    else flushPushes();
  });
  setInterval(function(){
    if(CL.user && document.visibilityState === "visible" && CL.rt !== "SUBSCRIBED") pullNow();
  }, 45000);
}
function onSignedIn(u){
  var owner = null;
  try{ owner = localStorage.getItem(KEYO); }catch(e){}
  if(owner && owner !== u.id) wipeLocal();                 /* anderes Konto auf diesem Gerät */
  if(owner !== u.id){                                      /* lokale Einträge ins Konto übernehmen */
    KINDS.forEach(function(k){ Object.keys(S[k]).forEach(function(id){ CL.dirty[k + "/" + id] = 1; }); });
    saveDirty();
  }
  try{ localStorage.setItem(KEYO, u.id); }catch(e){}
  CL.user = u;
  setSync("busy");
  pullNow().then(flushNow).then(function(){ uploadPendingFiles(); softRender(); });
  subscribe();
  softRender();
}
function onSignedOut(){
  CL.user = null;
  unsubscribe();
  setSync("local");
  softRender();
}
function wipeLocal(){
  KINDS.forEach(function(k){ S[k] = {}; });
  CL.dirty = {}; CL.delq = [];
  saveDirty(); saveLocalNow();
  Object.keys(fileUrls).forEach(function(id){ try{ URL.revokeObjectURL(fileUrls[id]); }catch(e){} delete fileUrls[id]; });
  idbClear().catch(function(){});
  try{
    localStorage.removeItem(KEYO);
    Object.keys(localStorage).forEach(function(k){ if(k.indexOf(KEYC) === 0) localStorage.removeItem(k); });
  }catch(e){}
  usage = null;
}

var AUTHERR = {
  invalid_credentials:"E-Mail oder Passwort stimmt nicht.",
  user_already_exists:"Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.",
  email_exists:"Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.",
  email_not_confirmed:"Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Mail.",
  weak_password:"Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen.",
  over_email_send_rate_limit:"Gerade wurden zu viele E-Mails verschickt. Bitte versuche es später noch einmal.",
  over_request_rate_limit:"Zu viele Versuche. Warte einen Moment.",
  signup_disabled:"Neue Konten sind gerade nicht freigeschaltet. Frag die Person, die dir die App gegeben hat.",
  email_address_invalid:"Diese E-Mail-Adresse wird nicht angenommen.",
  same_password:"Das neue Passwort muss sich vom alten unterscheiden.",
  email_address_not_authorized:"Der E-Mail-Versand ist für diese App noch nicht eingerichtet. Wende dich an die Person, die dir die App gegeben hat."
};
function authMsg(e){
  if(!e) return "Das hat nicht geklappt.";
  if(e.code && AUTHERR[e.code]) return AUTHERR[e.code];
  var m = String(e.message || e);
  if(/Invalid login/i.test(m)) return AUTHERR.invalid_credentials;
  if(/already registered/i.test(m)) return AUTHERR.user_already_exists;
  if(/not confirmed/i.test(m)) return AUTHERR.email_not_confirmed;
  if(/Password should|weak/i.test(m)) return AUTHERR.weak_password;
  if(/rate limit/i.test(m)) return AUTHERR.over_email_send_rate_limit;
  if(/Signups not allowed/i.test(m)) return AUTHERR.signup_disabled;
  if(/not authorized/i.test(m)) return AUTHERR.email_address_not_authorized;
  if(/fetch|network/i.test(m)) return "Keine Verbindung. Bist du online?";
  return "Das hat nicht geklappt: " + m;
}

/* ---------- Konto-Blätter ---------- */
function accountSheet(){
  if(!cloudConfigured()){
    openSheet({title:"Abgleich zwischen Geräten", cancel:"Schließen", body:
      '<p class="muted" style="color:var(--ink-2)">Der Abgleich ist für diese Installation nicht eingerichtet. Deine Daten bleiben auf diesem Gerät.</p>' +
      '<p class="hint" style="margin-top:10px">Wer die App betreibt, trägt in <b>config.js</b> die Adresse und den Schlüssel des Supabase-Projekts ein. Die Anleitung liegt im README.</p>'});
    return;
  }
  if(CL.user) return accountInfoSheet();
  var mode = "login";
  openSheet({title:"Konto", body:
    '<p class="muted" style="color:var(--ink-2);margin-bottom:6px">Mit einem Konto hast du deine Projekte auf allen Geräten: Handy, Tablet und Notebook. Ohne Konto bleibt alles auf diesem Gerät.</p>' +
    segc("mode", "login", [["login","Anmelden"],["signup","Neues Konto"]]) +
    fld("E-Mail", "email", "", {type:"email", attrs:'autocomplete="email" autocapitalize="off" spellcheck="false"'}) +
    fld("Passwort", "password", "", {type:"password", attrs:'autocomplete="current-password"', hint:""}) +
    '<p class="hint" id="acc-hint">Passwort vergessen? <a href="#" id="acc-reset">Neues Passwort anfordern</a></p>' +
    '<p class="hint"><a href="datenschutz.html" target="_blank" rel="noopener">Datenschutzhinweise</a></p>',
    ok:"Anmelden",
    mount:function(pn){
      function upd(){
        mode = sheetData().mode;
        var okb = $('[data-sheet="ok"]', pn); if(okb) okb.textContent = mode === "signup" ? "Konto anlegen" : "Anmelden";
        var pw = $("#f-password", pn); pw.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
        $("#acc-hint", pn).innerHTML = mode === "signup" ? "Mindestens 8 Zeichen. Deine bisherigen Projekte auf diesem Gerät kommen mit ins Konto." :
          'Passwort vergessen? <a href="#" id="acc-reset">Neues Passwort anfordern</a>';
        bindReset();
      }
      function bindReset(){
        var a = $("#acc-reset", pn); if(!a) return;
        a.onclick = function(e){ e.preventDefault(); var em = $("#f-email", pn).value.trim(); closeSheet(); resetSheet(em); };
      }
      $$("[data-seg-name] button", pn).forEach(function(b){ b.addEventListener("click", function(){ setTimeout(upd, 0); }); });
      bindReset();
      setTimeout(function(){ var e = $("#f-email", pn); if(e) e.focus(); }, 80);
    },
    onOk:function(d){
      if(!/^\S+@\S+\.\S+$/.test(d.email)) return "Bitte eine gültige E-Mail-Adresse eintragen.";
      if((d.password || "").length < 8) return "Das Passwort braucht mindestens 8 Zeichen.";
      var okb = $('#sheet [data-sheet="ok"]'); if(okb){ okb.disabled = true; okb.textContent = "Einen Moment …"; }
      var call = d.mode === "signup" ? CL.sb.auth.signUp({email:d.email, password:$("#f-password").value})
                                      : CL.sb.auth.signInWithPassword({email:d.email, password:$("#f-password").value});
      call.then(function(r){
        if(r.error) throw r.error;
        if(d.mode === "signup" && !(r.data && r.data.session)){
          closeSheet();
          openSheet({title:"Fast geschafft", cancel:"OK", body:'<p class="muted" style="color:var(--ink-2)">Wir haben dir eine E-Mail an <b>' + esc(d.email) + "</b> geschickt. Bestätige darin deine Adresse und melde dich dann hier an.</p>"});
          return;
        }
        closeSheet();
        toast(d.mode === "signup" ? "Konto angelegt. Deine Projekte werden jetzt gesichert." : "Angemeldet. Deine Projekte werden abgeglichen.");
      }).catch(function(e){
        if(okb){ okb.disabled = false; okb.textContent = d.mode === "signup" ? "Konto anlegen" : "Anmelden"; }
        var er = $("#sheet .err"); if(er){ er.textContent = authMsg(e); er.hidden = false; }
      });
      return false;
    }});
}
function accountInfoSheet(){
  var pend = pendingCount();
  refreshUsage();
  var st = {on:"Alles abgeglichen", busy:"Gleicht gerade ab", offline:"Offline: Änderungen werden nachgeholt", err:"Der letzte Abgleich ist fehlgeschlagen"}[syncState] || "";
  openSheet({title:"Konto", cancel:"Schließen", body:
    '<dl class="kv"><dt>Angemeldet als</dt><dd><b>' + esc(CL.user.email || "") + "</b></dd>" +
    "<dt>Status</dt><dd>" + esc(st) + (pend ? " · " + pend + " " + plural(pend, "Änderung", "Änderungen") + " offen" : "") + "</dd>" +
    (CL.lastSync ? "<dt>Letzter Abgleich</dt><dd>" + esc(dtstr(CL.lastSync)) + "</dd>" : "") + "</dl>" +
    '<div class="menu" style="margin-top:12px">' +
      '<button type="button" id="acc-sync">' + ic("undo") + '<span class="grow">Jetzt abgleichen</span></button>' +
      '<button type="button" id="acc-pw">' + ic("key") + '<span class="grow">Passwort ändern</span></button>' +
      '<button type="button" id="acc-out">' + ic("back") + '<span class="grow">Abmelden<span class="s">entfernt die Daten von diesem Gerät, im Konto bleiben sie</span></span></button>' +
      '<button type="button" id="acc-del" style="color:var(--alert)">' + ic("minus") + '<span class="grow">Konto löschen<span class="s">löscht alle Projekte, Anleitungen und Dateien endgültig</span></span></button>' +
    "</div>",
    mount:function(pn){
      $("#acc-sync", pn).onclick = function(){ closeSheet(); setSync("busy"); flushNow().then(pullNow).then(function(){ toast(syncState === "on" ? "Abgeglichen." : "Abgleich gerade nicht möglich."); }); };
      $("#acc-pw", pn).onclick = function(){ closeSheet(); newPasswordSheet(false); };
      $("#acc-out", pn).onclick = function(){ closeSheet(); logout(); };
      $("#acc-del", pn).onclick = function(){ closeSheet(); deleteAccountSheet(); };
    }});
}
function resetSheet(email){
  openSheet({title:"Neues Passwort anfordern", body:fld("E-Mail", "email", email || "", {type:"email", attrs:'autocomplete="email" autocapitalize="off"'}) +
    '<p class="hint">Du bekommst eine E-Mail mit einem Link. Öffne ihn auf diesem Gerät und vergib dann ein neues Passwort.</p>',
    ok:"Link schicken", onOk:function(d){
      if(!/^\S+@\S+\.\S+$/.test(d.email)) return "Bitte eine gültige E-Mail-Adresse eintragen.";
      CL.sb.auth.resetPasswordForEmail(d.email, {redirectTo:location.origin + location.pathname}).then(function(r){
        if(r.error) throw r.error;
        closeSheet(); toast("Falls es ein Konto gibt, ist die E-Mail unterwegs.");
      }).catch(function(e){ var er = $("#sheet .err"); if(er){ er.textContent = authMsg(e); er.hidden = false; } });
      return false;
    }});
}
function newPasswordSheet(recovery){
  openSheet({title:recovery ? "Neues Passwort vergeben" : "Passwort ändern",
    body:fld("Neues Passwort", "pw", "", {type:"password", attrs:'autocomplete="new-password" autofocus', hint:"Mindestens 8 Zeichen."}),
    ok:"Sichern", onOk:function(){
      var pw = $("#f-pw").value;
      if(pw.length < 8) return "Das Passwort braucht mindestens 8 Zeichen.";
      CL.sb.auth.updateUser({password:pw}).then(function(r){
        if(r.error) throw r.error;
        closeSheet(); toast("Passwort geändert.");
      }).catch(function(e){ var er = $("#sheet .err"); if(er){ er.textContent = authMsg(e); er.hidden = false; } });
      return false;
    }});
}
function logout(){
  var pend = pendingCount();
  confirmSheet("Abmelden?", (pend ? "Achtung: " + pend + " " + plural(pend, "Änderung ist", "Änderungen sind") + " noch nicht in der Cloud und gehen verloren, wenn du jetzt offline abmeldest. " : "") +
    "Deine Projekte werden von diesem Gerät entfernt. In deinem Konto bleiben sie erhalten.", "Abmelden", function(){
    flushNow().then(function(){ return CL.sb.auth.signOut({scope:"local"}); }).catch(function(){}).then(function(){
      wipeLocal(); CL.user = null; unsubscribe(); setSync("local");
      UI.stack = []; UI.tab = "home"; render(); toast("Abgemeldet.");
    });
  });
}
function deleteAccountSheet(){
  openSheet({title:"Konto löschen?", body:
    '<p class="muted" style="color:var(--ink-2)">Alle Projekte, Anleitungen, Garne, Fotos und PDFs in deinem Konto werden endgültig gelöscht, auf allen Geräten. Das lässt sich nicht rückgängig machen.</p>' +
    '<p class="hint">Vorher sichern: Werkzeug → Mehr → Sicherung herunterladen.</p>' +
    fld("Zur Bestätigung LÖSCHEN eintippen", "confirm", "", {attrs:'autocapitalize="characters" autocomplete="off"'}),
    ok:"Endgültig löschen", onOk:function(d){
      if(d.confirm.toUpperCase() !== "LÖSCHEN") return "Bitte LÖSCHEN eintippen.";
      var okb = $('#sheet [data-sheet="ok"]'); if(okb){ okb.disabled = true; okb.textContent = "Wird gelöscht …"; }
      var uidv = CL.user.id;
      function wipeFiles(){
        return CL.sb.storage.from("files").list(uidv, {limit:1000}).then(function(r){
          if(r.error) throw r.error;
          var names = (r.data || []).map(function(f){ return uidv + "/" + f.name; });
          if(!names.length) return;
          return CL.sb.storage.from("files").remove(names).then(function(x){ if(x.error) throw x.error; if(names.length === 1000) return wipeFiles(); });
        });
      }
      wipeFiles().then(function(){ return CL.sb.rpc("delete_my_account"); }).then(function(r){
        if(r && r.error) throw r.error;
        return CL.sb.auth.signOut({scope:"local"}).catch(function(){});
      }).then(function(){
        wipeLocal(); CL.user = null; unsubscribe(); setSync("local");
        closeSheet(); UI.stack = []; UI.tab = "home"; render();
        toast("Dein Konto und alle Daten sind gelöscht.");
      }).catch(function(e){
        if(okb){ okb.disabled = false; okb.textContent = "Endgültig löschen"; }
        var er = $("#sheet .err"); if(er){ er.textContent = "Das Löschen hat nicht geklappt: " + (e && e.message || e) + ". Bitte später erneut versuchen."; er.hidden = false; }
      });
      return false;
    }});
  var okb = $('#sheet [data-sheet="ok"]'); if(okb){ okb.classList.remove("primary"); okb.classList.add("danger"); }
}

/* =========================================================
   App-Rahmen: Dateien sichern, Offline-Betrieb, Installation
   ========================================================= */
var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function isStandalone(){
  try{ return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }catch(e){ return false; }
}
function saveFile(name, data, okMsg){
  var type = /\.json$/i.test(name) ? "application/json" : /\.pdf$/i.test(name) ? "application/pdf" : (data && data.type) || "application/octet-stream";
  var blob = data instanceof Blob ? data : new Blob([data], {type:type});
  function viaLink(){
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(u); a.remove(); }, 6000);
    toast(okMsg || "Gesichert.");
  }
  /* Auf iPhone und iPad landet eine Datei am zuverlässigsten über „Teilen“ in „Dateien sichern“ */
  if(IS_IOS && navigator.canShare && window.File){
    try{
      var f = new File([blob], name, {type:blob.type || type});
      if(navigator.canShare({files:[f]})){
        return navigator.share({files:[f], title:name}).then(function(){ toast(okMsg || "Gesichert."); }, function(e){
          if(e && e.name === "AbortError") return;
          viaLink();
        });
      }
    }catch(e){}
  }
  viaLink();
  return Promise.resolve();
}

/* Offline-Betrieb und Updates */
var swWantReload = false;
function registerSW(){
  if(!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("sw.js").then(function(reg){
    function offer(w){
      toast("Eine neue Version von Maschenwerk ist da.", {label:"Aktualisieren", fn:function(){ swWantReload = true; w.postMessage("skipWaiting"); }}, 60000);
    }
    if(reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", function(){
      var w = reg.installing; if(!w) return;
      w.addEventListener("statechange", function(){ if(w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(function(){ reg.update().catch(function(){}); }, 3 * 3600000);
  }).catch(function(){});
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if(swWantReload){ swWantReload = false; flushPushes(); saveLocalNow(); location.reload(); }
  });
}

/* Installation als App */
var installEvt = null;
window.addEventListener("beforeinstallprompt", function(e){ e.preventDefault(); installEvt = e; softRender(); });
window.addEventListener("appinstalled", function(){ installEvt = null; toast("Maschenwerk ist installiert."); softRender(); });
function installHow(){
  if(isStandalone()) return "";
  if(installEvt) return "button";
  if(IS_IOS) return "Tippe in Safari unten auf <b>Teilen</b> und dann auf <b>Zum Home-Bildschirm</b>.";
  return "Öffne das Browsermenü und wähle <b>App installieren</b> oder <b>Zum Startbildschirm hinzufügen</b>.";
}
function installCard(dismissable){
  var how = installHow(); if(!how) return "";
  return '<section class="card install"><div class="sec-h"><span class="eyebrow">Als App installieren</span>' +
    (dismissable ? '<button type="button" class="add" data-act="noinstall" aria-label="Hinweis ausblenden">Ausblenden</button>' : "") + "</div>" +
    '<p class="muted" style="color:var(--ink-2)">Mit eigenem Symbol auf dem Startbildschirm, im Vollbild und auch ohne Internet.</p>' +
    (how === "button" ? '<button type="button" class="btn primary sm" data-act="install" style="margin-top:10px">Installieren</button>' : '<p class="hint" style="margin-top:8px">' + how + "</p>") +
    "</section>";
}
function doInstall(){
  if(!installEvt) return;
  installEvt.prompt();
  installEvt.userChoice.then(function(){ installEvt = null; softRender(); }, function(){});
}

/* =========================================================
   Oberfläche: Symbole, Hinweise, Blätter, Navigation
   ========================================================= */
var IC = {
  back:'<path d="M15 5l-7 7 7 7"/>',
  chev:'<path d="M9 5l7 7-7 7"/>',
  home:'<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="19" cy="17" r="1.6"/>',
  lib:'<path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5M8 13h8M8 16.5h5"/>',
  stock:'<circle cx="12" cy="12" r="8"/><path d="M6.5 7.5c4 2.5 7 6.5 8.5 11.5M17.5 7.5c-4 2.5-7 6.5-8.5 11.5M4.5 12.5c5-1 10-1 15 0"/>',
  tools:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7h7M8.5 11.5h1.5M14 11.5h1.5M8.5 15.5h1.5M14 15.5h1.5"/>',
  more:'<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  minus:'<path d="M5 12h14"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  note:'<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8 9h8M8 13h5"/>',
  hash:'<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
  ruler:'<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  size:'<path d="M4 7h16M4 12h10M4 17h6"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  key:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  photo:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>'
};
function ic(name){ return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (IC[name]||"") + "</svg>"; }

var toastTimer = null;
function toast(msg, action, ms){
  var t = $("#toast");
  t.innerHTML = "<span></span>" + (action ? '<button type="button">' + esc(action.label) + "</button>" : "");
  t.firstChild.textContent = msg;
  if(action) t.lastChild.onclick = function(){ t.hidden = true; action.fn(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.hidden = true; }, ms || (action ? 5200 : 3200));
}

/* ---------- Blätter (Formulare, Menüs, Rückfragen) ---------- */
var sheetCtx = null, renderPending = false;
function openSheet(o){
  var sh = $("#sheet"), pn = $(".panel", sh);
  var foot = "";
  if(o.ok || o.danger || o.cancel){
    foot = '<div class="foot">' +
      (o.danger ? '<button type="button" class="btn danger" data-sheet="danger">' + esc(o.danger.label) + "</button>" : "") +
      '<button type="button" class="btn" data-sheet="close">' + esc(o.cancel || "Abbrechen") + "</button>" +
      (o.ok ? '<button type="button" class="btn primary" data-sheet="ok">' + esc(o.ok) + "</button>" : "") + "</div>";
  }
  pn.innerHTML = '<div class="handle"></div>' + (o.title ? "<h2>" + esc(o.title) + "</h2>" : "") +
    '<form class="stack-s" id="sheetform" novalidate>' + (o.body||"") + '</form><p class="err" hidden></p>' + foot;
  sheetCtx = o;
  sh.hidden = false;
  pn.scrollTop = 0;
  if(o.mount) o.mount(pn);
  hydrateFiles(pn);
  var first = $("[autofocus]", pn);
  if(first) setTimeout(function(){ try{ first.focus(); }catch(e){} }, 60);
}
function closeSheet(){
  $("#sheet").hidden = true;
  var c = sheetCtx; sheetCtx = null;
  if(c && c.onClose) c.onClose();
  if(renderPending){ renderPending = false; render(); }
}
function sheetData(){
  var d = {};
  $$("#sheetform [name]").forEach(function(el){
    if(el.type === "checkbox") d[el.name] = el.checked;
    else if(el.type === "radio"){ if(el.checked) d[el.name] = el.value; }
    else d[el.name] = el.value.trim();
  });
  $$("#sheetform [data-seg-name]").forEach(function(seg){
    var b = $("button.on", seg); d[seg.dataset.segName] = b ? b.dataset.v : "";
  });
  return d;
}
function sheetOk(){
  if(!sheetCtx || !sheetCtx.onOk) return closeSheet();
  var res = sheetCtx.onOk(sheetData());
  if(typeof res === "string"){ var e = $("#sheet .err"); e.textContent = res; e.hidden = false; return; }
  if(res === false) return;
  closeSheet(); render();
}
function confirmSheet(title, text, okLabel, fn){
  openSheet({title:title, body:'<p class="muted" style="font-size:1rem;color:var(--ink-2)">' + esc(text) + "</p>",
    ok:okLabel, onOk:function(){ fn(); }});
  var okb = $('#sheet [data-sheet="ok"]'); if(okb){ okb.classList.remove("primary"); okb.classList.add("danger"); }
}
function menuSheet(title, items){
  openSheet({title:title, body:'<div class="menu">' + items.map(function(it, i){
    return '<button type="button" data-menu="' + i + '"' + (it.on ? ' class="on"' : "") + ">" + ic(it.icon||"chev") +
      '<span class="grow">' + esc(it.label) + (it.sub ? '<span class="s">' + esc(it.sub) + "</span>" : "") + "</span></button>";
  }).join("") + "</div>", mount:function(pn){
    $$("[data-menu]", pn).forEach(function(b){
      b.onclick = function(){ var it = items[+b.dataset.menu]; closeSheet(); setTimeout(it.fn, 10); };
    });
  }});
}
function fld(label, name, val, opts){
  opts = opts || {};
  var type = opts.type || "text", attrs = opts.attrs || "";
  if(type === "num") { type = "text"; attrs += ' inputmode="decimal"'; }
  if(type === "int") { type = "text"; attrs += ' inputmode="numeric"'; }
  return '<div' + (opts.cls ? ' class="' + opts.cls + '"' : "") + (opts.wa ? " " + opts.wa : "") + '><label class="f" for="f-' + name + '">' + esc(label) + "</label>" +
    '<input id="f-' + name + '" name="' + name + '" type="' + type + '" value="' + esc(val==null||val===0&&opts.blank0 ? "" : val) + '"' +
    (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : "") + " " + attrs + ">" +
    (opts.hint ? '<p class="hint" style="margin-top:4px">' + esc(opts.hint) + "</p>" : "") + "</div>";
}
function sel(label, name, val, options, opts){
  opts = opts || {};
  return '<div' + (opts.cls ? ' class="' + opts.cls + '"' : "") + '><label class="f" for="f-' + name + '">' + esc(label) + '</label><select id="f-' + name + '" name="' + name + '">' +
    options.map(function(o){ return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
    "</select></div>";
}
function area(label, name, val, ph, rows){
  return '<div><label class="f" for="f-' + name + '">' + esc(label) + '</label><textarea id="f-' + name + '" name="' + name + '" rows="' + (rows||4) + '"' +
    (ph ? ' placeholder="' + esc(ph) + '"' : "") + ">" + esc(val||"") + "</textarea></div>";
}
function segc(name, val, options){
  return '<div class="seg" data-seg-name="' + name + '">' + options.map(function(o){
    return '<button type="button" data-v="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' class="on"' : "") + ">" + esc(o[1]) + "</button>";
  }).join("") + "</div>";
}

/* ---------- Navigation ---------- */
var TABS = [
  {id:"home", label:"Projekte", icon:"home"},
  {id:"lib", label:"Anleitungen", icon:"lib"},
  {id:"stock", label:"Vorrat", icon:"stock"},
  {id:"tools", label:"Werkzeug", icon:"tools"}
];
function buildTabs(){
  $("#tabs").innerHTML = TABS.map(function(t){
    return '<button type="button" data-tab="' + t.id + '">' + ic(t.icon) + "<span>" + t.label + "</span></button>";
  }).join("");
}
function go(route){ UI.stack.push(route); render(); window.scrollTo(0, 0); }
function goBack(){ UI.stack.pop(); render(); window.scrollTo(0, 0); }
function topBar(title, extra){
  return '<header class="top"><button type="button" class="back" data-act="back" aria-label="Zurück">' + ic("back") + "</button>" +
    "<h1>" + esc(title) + "</h1>" + (extra||"") + "</header>";
}

var afterRender = null;
function render(){
  if(sheetCtx){ renderPending = true; return; }
  var ae = document.activeElement, keepId = ae && ae.id && $("#main").contains(ae) ? ae.id : null;
  var selStart = keepId && ae.selectionStart;
  afterRender = null;
  var top = UI.stack[UI.stack.length - 1], html;
  try{
    if(top){
      var pg = {project:pgProject, pattern:pgPattern, projlog:pgProjLog}[top.v];
      html = pg ? pg(top.id) : null;
      if(html === null){ UI.stack.pop(); return render(); }
    } else {
      html = ({home:pgHome, lib:pgLib, stock:pgStock, tools:pgTools}[UI.tab] || pgHome)();
    }
  }catch(err){
    html = '<div class="empty"><h2>Da ist etwas schiefgelaufen</h2><p>' + esc(err && err.message) + "</p></div>";
    if(window.console) console.error(err);
  }
  $("#main").innerHTML = html;
  $$("#tabs button").forEach(function(b){ b.classList.toggle("on", b.dataset.tab === UI.tab); });
  if(afterRender) afterRender();
  hydrateFiles($("#main"));
  if(keepId){
    var el = document.getElementById(keepId);
    if(el){ el.focus(); try{ if(selStart != null) el.setSelectionRange(selStart, selStart); }catch(e){} }
  }
}
var softTimer = null;
function softRender(){ clearTimeout(softTimer); softTimer = setTimeout(function(){ if(!W.pid) render(); }, 80); }
function onRemote(kind){
  if(W.pid){ if(kind === "projects" && !W.dirty) refreshWorkFromRemote(); return; }
  var ae = document.activeElement;
  if(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.id !== "libq") { renderPending = true; return; }
  softRender();
}

/* =========================================================
   Projekte
   ========================================================= */
function secLine(p, s){
  var t = s.target > 0 ? " von " + s.target : "";
  return s.name + " · " + s.unit + " " + s.row + t;
}
function nextRemText(p){
  var s = activeSec(p), row = s.row, best = null;
  remsFor(p, s).forEach(function(r){
    var d = dueNow(r, row);
    if(d){ best = {due:true, r:r, d:d, at:row}; return; }
    var at = nextDue(r, row);
    if(at != null && (!best || (!best.due && at < best.at))) best = {due:false, r:r, at:at};
  });
  return best;
}
function remLabel(r, k, of){
  var t = r.text || "Erinnerung";
  if(r.kind === "repeat") t += " (" + k + (of ? " von " + of : "") + ")";
  if(r.delta) t += " · " + (r.delta > 0 ? "+" : "−") + Math.abs(r.delta) + " M";
  return t;
}

function pgHome(){
  var ps = live("projects").sort(byRecent);
  var h = '<header class="top"><div class="brand">Maschen<em>werk</em></div>' + syncBadge() + "</header>";
  if(!ps.length){
    return h + '<div class="empty" style="padding-top:12vh"><h2>Dein erstes Projekt</h2>' +
      "<p>Lege ein Projekt an. Teile, Erinnerungen für Zu- und Abnahmen und die Anleitung kommen dazu, wenn du sie brauchst.</p>" +
      '<div class="stack-s" style="max-width:320px;margin:0 auto"><button type="button" class="btn primary big" data-act="newproj">Neues Projekt</button>' +
      '<button type="button" class="btn" data-act="example">Beispielprojekt ansehen</button>' +
      (cloudConfigured() && !CL.user ? '<p class="muted" style="margin-top:14px">Schon ein Konto? <a href="#" data-act="account">Anmelden</a>, dann erscheinen deine Projekte hier.</p>' : "") +
      "</div></div>" + (PREF.noInstallHint ? "" : '<div style="max-width:420px;margin:24px auto 0">' + installCard(true) + "</div>");
  }
  var cont = ps.filter(function(p){ return p.status === "wip"; })[0] || ps.filter(function(p){ return p.status === "plan"; })[0];
  if(cont) h += heroCard(cont);
  STATUS_ORDER.forEach(function(st){
    var g = ps.filter(function(p){ return p.status === st && p !== cont; });
    if(!g.length) return;
    if(st === "done" && !UI.showDone){
      h += '<div class="grp"><button type="button" class="btn quiet wide" data-act="showdone">Fertige Projekte anzeigen (' + g.length + ")</button></div>";
      return;
    }
    h += '<div class="grp"><span class="eyebrow">' + STATUS[st][0] + " · " + g.length + "</span>" + g.map(projCard).join("") + "</div>";
  });
  h += '<div class="grp"><button type="button" class="btn wide" data-act="newproj">' + ic("plus") + "Neues Projekt</button></div>";
  if(cloudConfigured() && !CL.user && !PREF.noAcctHint)
    h += '<section class="card grp"><div class="sec-h"><span class="eyebrow">Auf allen Geräten</span><button type="button" class="add" data-act="noaccthint">Ausblenden</button></div>' +
      '<p class="muted" style="color:var(--ink-2)">Deine Projekte liegen bisher nur auf diesem Gerät. Mit einem Konto hast du sie auch auf Tablet und Notebook, und sie sind gesichert.</p>' +
      '<button type="button" class="btn sm primary" data-act="account" style="margin-top:10px">Konto anlegen oder anmelden</button></section>';
  if(!PREF.noInstallHint) h += '<div class="grp">' + installCard(true) + "</div>";
  return h;
}
function heroCard(p){
  var s = activeSec(p), pat = patternOf(p), nx = nextRemText(p);
  var prog = s.target > 0 ? Math.min(1, (s.row - 1) / s.target) : null;
  var cm = s.row > 1 ? rowsToCm(p, s.row - 1) : null;
  var meta = [pat ? pat.title : p.patternName, p.size ? "Gr. " + p.size : ""].filter(Boolean).join(" · ");
  var h = '<article class="hero"><span class="eyebrow">' + (p.status === "wip" ? "Weiterstricken" : "Als Nächstes") + "</span>" +
    "<h2>" + esc(p.name) + "</h2>" + (meta ? '<p class="meta">' + esc(meta) + "</p>" : "") +
    '<div class="hero-row"><div class="bignum">' + s.row + "<small>" + esc(s.unit) + "</small></div>" +
    '<div class="grow"><b>' + esc(s.name) + (s.target > 0 ? ' <span class="muted">von ' + s.target + "</span>" : "") + "</b>" +
    (prog !== null ? '<div class="bar"><i style="width:' + (prog*100).toFixed(1) + '%"></i></div>' : "") +
    '<p class="muted small" style="margin-top:6px">' + [cm !== null ? "ca. " + fmt(cm) + " cm gestrickt" : "", p.timeMs >= 60000 ? fmtDur(p.timeMs) + " Strickzeit" : ""].filter(Boolean).join(" · ") + "</p>" +
    "</div></div>";
  if(nx){
    h += '<div class="nextline' + (nx.due ? " due" : "") + '">' + ic("bell") + '<span class="grow">' +
      (nx.due ? "Diese " + esc(s.unit) + ": " + esc(remLabel(nx.r, nx.d.k, nx.d.of))
              : "Nächste Erinnerung in " + abbrU(s) + " " + nx.at + ": " + esc(nx.r.text || "Erinnerung") + " (in " + (nx.at - s.row) + " " + abbrU(s) + ")") +
      "</span></div>";
  }
  h += '<div class="stack-s"><button type="button" class="btn primary big wide" data-act="work" data-id="' + p.id + '">Weiterstricken</button>' +
    '<button type="button" class="btn wide" data-act="openproj" data-id="' + p.id + '">Projekt öffnen</button></div></article>';
  return h;
}
function projCard(p){
  var s = activeSec(p), st = STATUS[p.status], pg = projProgress(p), pat = patternOf(p);
  return '<button type="button" class="pcard" data-act="openproj" data-id="' + p.id + '">' +
    '<div class="t">' + esc(p.name) + "</div>" +
    '<div class="m">' + esc([pat ? pat.title : p.patternName, p.size ? "Gr. " + p.size : "", s.name].filter(Boolean).join(" · ") || "—") + "</div>" +
    '<div class="b"><span class="pill ' + st[1] + '">' + st[0] + "</span>" +
    (pg !== null ? '<span class="bar' + (p.status === "done" ? " good" : "") + '"><i style="width:' + (pg*100).toFixed(0) + '%"></i></span>' : '<span class="grow"></span>') +
    '<span class="rw">' + abbrU(s) + " " + s.row + "</span></div></button>";
}

/* ---------- Projektseite ---------- */
function pgProject(id){
  var p = S.projects[id];
  if(!p || p.deleted) return null;
  normProject(p);
  var s = activeSec(p), pat = patternOf(p), st = STATUS[p.status];
  var h = topBar(p.name, '<button type="button" class="ico" data-act="projmenu" data-id="' + p.id + '" aria-label="Mehr">' + ic("more") + "</button>");
  h += '<div class="stack">';

  /* Kopf */
  var meta = [pat ? pat.title : p.patternName, p.size ? "Größe " + p.size : ""].filter(Boolean).join(" · ");
  h += '<div class="row wrap"><button type="button" class="pill ' + st[1] + '" data-act="status" data-id="' + p.id + '" style="border:0;min-height:30px">' + st[0] + " ▾</button>" +
    (meta ? '<span class="muted">' + esc(meta) + "</span>" : "") + "</div>";
  h += '<button type="button" class="btn primary big wide" data-act="work" data-id="' + p.id + '">Weiterstricken · ' + esc(s.name) + " " + abbrU(s) + " " + s.row + "</button>";

  /* Teile */
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Teile</span><button type="button" class="add" data-act="addsec" data-id="' + p.id + '">+ Teil</button></div>';
  h += p.sections.map(function(x){
    var prog = x.target > 0 ? Math.min(1, (x.done ? x.target : x.row - 1) / x.target) : null;
    var doneRows = x.done ? (x.target || x.row - 1) : x.row - 1;
    var cm = doneRows > 0 ? rowsToCm(p, doneRows) : null;
    var sts = stitchesAt(p, x, x.row);
    var sub = [x.done ? "fertig" : "", cm !== null ? "ca. " + fmt(cm) + " cm" : "", sts !== null && !x.done ? sts + " M auf der Nadel" : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="sec-row" data-act="editsec" data-id="' + p.id + '" data-s="' + x.id + '">' +
      '<span class="t">' + (x.id === p.activeSection ? '<span class="dot" title="aktiv"></span>' : "") + esc(x.name) + (x.done ? ' <span class="pill done">fertig</span>' : "") + "</span>" +
      '<span class="v">' + (x.done ? "✓" : abbrU(x) + " " + x.row) + (x.target > 0 ? ' <span class="muted small">/ ' + x.target + "</span>" : "") + "</span>" +
      (prog !== null ? '<span class="bar' + (x.done ? " good" : "") + '"><i style="width:' + (prog*100).toFixed(1) + '%"></i></span>' : "") +
      (sub ? '<span class="s">' + esc(sub) + "</span>" : "") + "</button>";
  }).join("");
  h += "</section>";

  /* Erinnerungen */
  var rems = (p.reminders||[]).slice().sort(function(a, b){
    var sa = secById(p, a.sectionId) || s, sb = secById(p, b.sectionId) || s;
    var na = nextDue(a, sa.row - 1), nb = nextDue(b, sb.row - 1);
    return (na == null ? 1e9 : na - sa.row) - (nb == null ? 1e9 : nb - sb.row);
  });
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Erinnerungen</span><button type="button" class="add" data-act="addrem" data-id="' + p.id + '">+ Erinnerung</button></div>';
  if(!rems.length){
    h += '<p class="muted">Für Zu- und Abnahmen, Knopflöcher oder alles, was „gleichzeitig“ passieren soll. Beim Stricken erscheint die Erinnerung genau in der richtigen Reihe.</p>';
  } else {
    h += rems.map(function(r){
      var rs = secById(p, r.sectionId), ss = rs || s;
      var nd = dueNow(r, ss.row) ? ss.row : nextDue(r, ss.row);
      var last = remLast(r);
      var state = nd == null ? "erledigt" : (nd === ss.row ? "jetzt" : abbrU(ss) + " " + nd);
      return '<button type="button" class="rem" data-act="editrem" data-id="' + p.id + '" data-r="' + r.id + '">' +
        '<span class="when">' + esc(state) + "</span>" +
        '<span class="grow"><span class="t">' + esc(r.text || "Erinnerung") + (r.delta ? " · " + (r.delta > 0 ? "+" : "−") + Math.abs(r.delta) + " M" : "") + "</span>" +
        '<span class="s" style="display:block">' + esc(remWhen(r, ss)) + (rs ? " · " + esc(rs.name) : " · alle Teile") + (last && r.kind === "repeat" ? " · letzte " + abbrU(ss) + " " + last : "") + "</span></span></button>";
    }).join("");
  }
  h += "</section>";

  /* Zähler */
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Zusätzliche Zähler</span><button type="button" class="add" data-act="addctr" data-id="' + p.id + '">+ Zähler</button></div>';
  if(!p.counters.length) h += '<p class="muted">Ein Rapportzähler läuft automatisch mit der Reihe mit und kann sich nicht verzählen. Ein freier Zähler zählt zum Beispiel Zopfkreuzungen.</p>';
  h += p.counters.map(function(c){
    var v = ctrValue(p, c);
    if(c.kind === "repeat"){
      var cs = secById(p, c.sectionId);
      return '<button type="button" class="li" data-act="editctr" data-id="' + p.id + '" data-c="' + c.id + '"><span class="grow"><span class="t">' + esc(c.name) + "</span>" +
        '<span class="s" style="display:block">Musterreihe von ' + c.len + ", ab " + abbrU(cs) + " " + (c.start||1) + (cs ? " · " + esc(cs.name) : "") + "</span></span>" +
        '<span class="v">' + (v.v === null ? "–" : v.v + "/" + v.of) + "</span></button>";
    }
    return '<div class="ctrl"><span class="grow"><b>' + esc(c.name) + "</b></span>" +
      '<button type="button" class="step" data-act="ctrdec" data-id="' + p.id + '" data-c="' + c.id + '" aria-label="minus">−</button>' +
      '<span class="v">' + v.v + "</span>" +
      '<button type="button" class="step" data-act="ctrinc" data-id="' + p.id + '" data-c="' + c.id + '" aria-label="plus">+</button>' +
      '<button type="button" class="ico" data-act="editctr" data-id="' + p.id + '" data-c="' + c.id + '" aria-label="Zähler bearbeiten">' + ic("more") + "</button></div>";
  }).join("");
  h += "</section>";

  /* Material */
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Material</span><button type="button" class="add" data-act="editproj" data-id="' + p.id + '">Bearbeiten</button></div><dl class="kv">';
  h += "<dt>Anleitung</dt><dd>" + (pat ? '<a href="#" data-act="openpat" data-id="' + pat.id + '">' + esc(pat.title) + "</a>" : esc(p.patternName || "—")) + "</dd>";
  if(p.size) h += "<dt>Größe</dt><dd>" + esc(p.size) + "</dd>";
  var gp = pat && pat.gaugeSts ? pat.gaugeSts + " × " + (pat.gaugeRows || "?") : "";
  var gi = p.gaugeSts ? p.gaugeSts + " × " + (p.gaugeRows || "?") : "";
  if(gp || gi) h += "<dt>Maschenprobe</dt><dd>" + (gi ? "<b>" + esc(gi) + "</b> M × R / 10 cm" : "") + (gp && gp !== gi ? '<br><span class="muted small">Anleitung: ' + esc(gp) + "</span>" : "") + "</dd>";
  var nds = projNeedles(p);
  h += "<dt>Nadeln</dt><dd>" + (nds.length ? nds.map(needleName).map(esc).join("<br>") + (p.needleMm ? "<br>" + esc(p.needleMm) : "") : esc(p.needleMm || "—")) +
    ' · <a href="#" data-act="projneedles" data-id="' + p.id + '">ändern</a></dd>';
  h += "</dl>";
  var ys = projYarns(p);
  h += '<div class="sec-h" style="margin-top:14px"><span class="eyebrow">Garn</span><button type="button" class="add" data-act="addyarn" data-id="' + p.id + '">+ Garn</button></div>';
  h += ys.length ? ys.map(function(u, i){
    var m = u.balls && u.y.metersPerBall ? u.balls * u.y.metersPerBall : 0;
    return '<button type="button" class="li" ' + (u.ghost ? "" : 'data-act="edityuse" data-id="' + p.id + '" data-y="' + u.y.id + '"') + '><span class="grow"><span class="t">' + esc(u.y.name) + "</span>" +
      '<span class="s" style="display:block">' + esc([u.y.colorway, u.y.lot ? "Partie " + u.y.lot : (u.ghost ? "nicht im Vorrat" : "Partie fehlt")].filter(Boolean).join(" · ")) + "</span></span>" +
      '<span class="v">' + (u.balls ? u.balls + " Kn." : "") + "</span>" + (m ? '<span class="muted small">' + m + " m</span>" : "") + "</button>";
  }).join("") : '<p class="muted">Noch kein Garn zugeordnet.</p>';
  if(p.status === "done" && ys.some(function(u){ return u.balls && !u.ghost; }) && !p.yarnBooked)
    h += '<button type="button" class="btn sm" data-act="bookyarn" data-id="' + p.id + '" style="margin-top:10px">Verbrauch vom Vorrat abbuchen</button>';
  h += "</section>";

  /* Notizen & Protokoll */
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Notizen</span><button type="button" class="add" data-act="editnotes" data-id="' + p.id + '">Bearbeiten</button></div>' +
    (p.notes ? '<p class="notes">' + esc(p.notes) + "</p>" : '<p class="muted">Änderungen an der Anleitung, Maße, Garnwechsel.</p>');
  h += '<div class="sec-h" style="margin-top:14px"><span class="eyebrow">Protokoll</span><button type="button" class="add" data-act="addlog" data-id="' + p.id + '">+ Eintrag</button></div>';
  var lg = p.log.slice(0, 4);
  h += lg.length ? lg.map(logItem).join("") + (p.log.length > 4 ? '<button type="button" class="add" data-act="openlog" data-id="' + p.id + '">Alle ' + p.log.length + " Einträge</button>" : "")
    : '<p class="muted">Notizen aus dem Strickmodus landen hier, mit Teil und Reihe.</p>';
  h += "</section>";

  /* Fotos */
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Fotos</span>' + (assets ? '<button type="button" class="add" data-act="addphoto" data-id="' + p.id + '">+ Foto</button>' : "") + "</div>";
  h += p.photos.length ? '<div class="photos">' + p.photos.map(function(ph){
    return '<button type="button" data-act="photo" data-id="' + p.id + '" data-a="' + esc(ph.id) + '"><img data-file="' + esc(ph.id) + '" alt="Projektfoto vom ' + esc(dstr(ph.t)) + '"></button>';
  }).join("") + "</div>" : '<p class="muted">' + (assets ? "Fortschritt, Maschenprobe, fertiges Stück." : "Fotos lassen sich in dieser Ansicht nicht speichern.") + "</p>";
  h += "</section>";

  /* Zahlen */
  h += '<section class="card"><span class="eyebrow">Überblick</span><dl class="kv" style="margin-top:8px">' +
    "<dt>Strickzeit</dt><dd>" + (p.timeMs >= 60000 ? fmtDur(p.timeMs) : "noch nicht gemessen") + "</dd>" +
    (p.startedAt ? "<dt>Begonnen</dt><dd>" + esc(dstr(p.startedAt)) + "</dd>" : "") +
    (p.finishedAt ? "<dt>Fertig</dt><dd>" + esc(dstr(p.finishedAt)) + "</dd>" : "") +
    (p.lastKnitAt ? "<dt>Zuletzt gestrickt</dt><dd>" + esc(dtstr(p.lastKnitAt)) + "</dd>" : "") +
    "</dl></section>";
  h += "</div>";
  return h;
}
function logItem(e){
  return '<div class="logi"><div class="s">' + esc(dtstr(e.t)) + (e.where ? " · " + esc(e.where) : "") + "</div>" + esc(e.text).replace(/\n/g, "<br>") + "</div>";
}
function pgProjLog(id){
  var p = S.projects[id]; if(!p || p.deleted) return null;
  return topBar("Protokoll") + '<p class="muted" style="margin-bottom:10px">' + esc(p.name) + "</p>" +
    '<section class="card">' + (p.log.length ? p.log.map(logItem).join("") : '<p class="muted">Noch keine Einträge.</p>') + "</section>";
}

/* ---------- Formulare: Projekt ---------- */
function patOptions(cur){
  var ps = live("patterns").sort(function(a, b){ return String(a.title).localeCompare(String(b.title), "de"); });
  return [["", "— keine —"]].concat(ps.map(function(x){ return [x.id, x.title]; }));
}
function projForm(p, preset){
  var isNew = !p;
  p = p || normProject({id:uid(), name:"", status:"wip", sections:[{id:uid(), name:"Hauptteil", unit:"Reihe", row:1, target:0, startSts:0}],
    patternId:"", startedAt:now()});
  if(isNew && preset) Object.assign(p, preset);
  var pat = patternOf(p), cnt = pat ? sizeCount(pat.text) : 0;
  var body = fld("Name", "name", p.name, {ph:"z. B. Pullover für Ivo", attrs:isNew ? "autofocus" : ""}) +
    sel("Anleitung", "patternId", p.patternId || "", patOptions()) +
    '<div class="g2">' + fld("Größe", "size", p.size, {ph:"z. B. M oder 3"}) +
      sel("Status", "status", p.status, STATUS_ORDER.map(function(k){ return [k, STATUS[k][0]]; })) + "</div>" +
    (cnt > 1 ? sel("Größe im Anleitungstext", "sizeIndex", p.sizeIndex == null ? 0 : p.sizeIndex,
      Array.from({length:cnt}, function(_, i){ return [i, (i+1) + ". Angabe im Größenlauf"]; }).concat([[-1, "alle anzeigen"]])) : "") +
    '<div class="eyebrow" style="margin-top:6px">Deine Maschenprobe (gewaschen)</div>' +
    '<div class="g3">' + fld("M / 10 cm", "gaugeSts", p.gaugeSts, {type:"num"}) + fld("R / 10 cm", "gaugeRows", p.gaugeRows, {type:"num"}) +
      fld("Nadel", "needleMm", p.needleMm, {ph:"4,5 mm"}) + "</div>" +
    '<p class="hint">Mit der Reihen-Maschenprobe rechnet Maschenwerk Reihen in Zentimeter um.</p>';
  openSheet({title:isNew ? "Neues Projekt" : "Projekt bearbeiten", body:body, ok:isNew ? "Anlegen" : "Sichern", onOk:function(d){
    if(!d.name) return "Bitte einen Namen eintragen.";
    p.name = d.name; p.size = d.size; p.status = d.status;
    if(d.patternId !== (p.patternId||"")){
      p.patternId = d.patternId;
      var np = patternOf(p);
      p.patternName = np ? np.title : "";
    }
    if(d.sizeIndex !== undefined) p.sizeIndex = int(d.sizeIndex);
    p.gaugeSts = isFinite(n(d.gaugeSts)) ? n(d.gaugeSts) : "";
    p.gaugeRows = isFinite(n(d.gaugeRows)) ? n(d.gaugeRows) : "";
    p.needleMm = d.needleMm;
    if(p.status === "done" && !p.finishedAt) p.finishedAt = now();
    put("projects", p);
    if(isNew){ UI.tab = "home"; UI.stack = [{v:"project", id:p.id}]; window.scrollTo(0, 0); }
  }});
}
function projFromPattern(pt){
  projForm(null, {name:pt.title, patternId:pt.id, patternName:pt.title, status:"plan",
    needleMm:pt.needleMm ? String(pt.needleMm).replace(".", ",") + " mm" : ""});
}
function statusSheet(p){
  menuSheet("Status", STATUS_ORDER.map(function(k){
    return {label:STATUS[k][0], icon:p.status === k ? "check" : "chev", on:p.status === k, fn:function(){
      p.status = k;
      if(k === "done" && !p.finishedAt) p.finishedAt = now();
      if(k === "wip" && !p.startedAt) p.startedAt = now();
      put("projects", p); render();
      if(k === "done") toast("Glückwunsch zum fertigen Stück.");
    }};
  }));
}
function projMenu(p){
  menuSheet(p.name, [
    {label:"Projekt bearbeiten", icon:"note", fn:function(){ projForm(p); }},
    {label:"Projektblatt als PDF", sub:"Teile, Erinnerungen, Material, Notizen", icon:"file", fn:function(){ exportPdf(p); }},
    {label:"Als Text kopieren", sub:"zum Einfügen in Ravelry oder eine Nachricht", icon:"note", fn:function(){ copyText(projText(p), "Projekt kopiert."); }},
    {label:"Projekt duplizieren", sub:"gleiche Teile und Erinnerungen, Zähler auf Anfang", icon:"layers", fn:function(){ dupProject(p); }},
    {label:"Projekt löschen", icon:"minus", fn:function(){
      confirmSheet("Projekt löschen?", "„" + p.name + "“ mit allen Zählerständen, Erinnerungen und dem Protokoll wird gelöscht. Fotos bleiben im Dateispeicher.", "Löschen", function(){
        remove("projects", p.id); UI.stack = []; toast("Projekt gelöscht.");
      });
    }}
  ]);
}
function dupProject(p){
  var c = clone(p);
  c.id = uid(); c.name = p.name + " (Kopie)"; c.status = "plan"; c.log = []; c.photos = []; c.timeMs = 0;
  c.startedAt = now(); c.finishedAt = 0; c.lastKnitAt = 0; c.yarnBooked = false;
  c.sections.forEach(function(s){ s.row = 1; s.done = false; });
  c.counters.forEach(function(k){ if(k.kind !== "repeat") k.value = 0; });
  delete c.deleted;
  put("projects", c);
  UI.stack = [{v:"project", id:c.id}]; render(); window.scrollTo(0, 0);
  toast("Kopie angelegt.");
}

/* ---------- Formulare: Teil ---------- */
function secForm(p, s){
  var isNew = !s;
  s = s || {id:uid(), name:"", unit:(activeSec(p)||{}).unit || "Reihe", row:1, target:0, startSts:0, done:false};
  var body = fld("Name", "name", s.name, {ph:"z. B. Rumpf, Ärmel links", attrs:isNew ? "autofocus" : ""}) +
    '<div><label class="f">Zählt in</label>' + segc("unit", s.unit, [["Reihe","Reihen"],["Runde","Runden"]]) + "</div>" +
    '<div class="g2">' + fld("Aktuelle " + s.unit, "row", s.row, {type:"int"}) + fld("Ziel gesamt", "target", s.target, {type:"int", blank0:true, ph:"offen"}) + "</div>" +
    fld("Maschen zu Beginn", "startSts", s.startSts, {type:"int", blank0:true, ph:"optional", hint:"Dann zeigt der Strickmodus, wie viele Maschen nach den Zu- und Abnahmen auf der Nadel liegen sollten."}) +
    (isNew ? "" : '<label class="check"><input type="checkbox" name="done"' + (s.done ? " checked" : "") + "> Teil ist fertig</label>") +
    (isNew ? "" : '<div class="wrap" style="margin-top:4px"><button type="button" class="btn sm" id="secdup">Duplizieren</button>' +
      (s.id !== p.activeSection ? '<button type="button" class="btn sm" id="secact">Als aktiven Teil setzen</button>' : "") + "</div>" +
      '<p class="hint">Duplizieren übernimmt Ziel und Erinnerungen, zum Beispiel für den zweiten Ärmel.</p>');
  openSheet({title:isNew ? "Teil hinzufügen" : "Teil bearbeiten", body:body, ok:isNew ? "Hinzufügen" : "Sichern",
    danger:isNew || p.sections.length < 2 ? null : {label:"Löschen"},
    mount:function(pn){
      var dup = $("#secdup", pn), act = $("#secact", pn);
      if(dup) dup.onclick = function(){ closeSheet(); dupSection(p, s); };
      if(act) act.onclick = function(){ p.activeSection = s.id; put("projects", p); closeSheet(); render(); };
      $$("[data-seg-name] button", pn).forEach(function(b){ b.addEventListener("click", function(){
        var lab = $('label[for="f-row"]', pn); if(lab) lab.textContent = "Aktuelle " + b.dataset.v; }); });
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){
        closeSheet();
        confirmSheet("Teil löschen?", "„" + (s.name||"Teil") + "“ und seine Erinnerungen werden gelöscht.", "Löschen", function(){
          p.sections = p.sections.filter(function(x){ return x.id !== s.id; });
          p.reminders = p.reminders.filter(function(r){ return r.sectionId !== s.id; });
          p.counters.forEach(function(c){ if(c.sectionId === s.id) c.sectionId = ""; });
          if(p.activeSection === s.id) p.activeSection = p.sections[0].id;
          put("projects", p);
        });
      };
    },
    onOk:function(d){
      s.name = d.name || ("Teil " + (p.sections.length + (isNew ? 1 : 0)));
      s.unit = d.unit === "Runde" ? "Runde" : "Reihe";
      s.row = Math.max(1, int(d.row) || 1); s.target = Math.max(0, int(d.target)); s.startSts = Math.max(0, int(d.startSts));
      if(!isNew){
        var was = s.done; s.done = !!d.done;
        if(s.done && !was) logAdd(p, s.name + " fertig (" + (s.row - 1) + " " + unitPl(s) + ")", s);
      }
      if(isNew){ p.sections.push(s); if(p.sections.length === 1) p.activeSection = s.id; }
      put("projects", p);
    }});
}
function dupSection(p, s){
  var c = clone(s); c.id = uid(); c.row = 1; c.done = false;
  var m = /^(.*?)(\d+)$/.exec(s.name);
  c.name = m ? m[1] + (int(m[2]) + 1) : s.name + " 2";
  var idx = p.sections.indexOf(s);
  p.sections.splice(idx + 1, 0, c);
  p.reminders.filter(function(r){ return r.sectionId === s.id; }).forEach(function(r){
    var rc = clone(r); rc.id = uid(); rc.sectionId = c.id; p.reminders.push(rc);
  });
  p.counters.filter(function(k){ return k.kind === "repeat" && k.sectionId === s.id; }).forEach(function(k){
    var kc = clone(k); kc.id = uid(); kc.sectionId = c.id; kc.name = k.name + " (" + c.name + ")"; p.counters.push(kc);
  });
  put("projects", p); render();
  toast("„" + c.name + "“ angelegt.");
}

/* ---------- Formulare: Erinnerung ---------- */
function remForm(p, r, presetSec){
  var isNew = !r, s = presetSec || activeSec(p);
  r = r || {id:uid(), text:"", kind:"repeat", sectionId:s.id, from:s.row, every:2, times:0, delta:0};
  var secOpts = [["", "alle Teile"]].concat(p.sections.map(function(x){ return [x.id, x.name]; }));
  var body = fld("Was ist zu tun?", "text", r.text, {ph:"z. B. Abnahme beidseitig", attrs:isNew ? "autofocus" : ""}) +
    segc("kind", r.kind, [["repeat","Wiederholt"],["once","Einmalig"]]) +
    sel("Teil", "sectionId", r.sectionId || "", secOpts) +
    '<div class="g3">' + fld("ab Reihe", "from", r.from, {type:"int"}) +
      fld("alle … Reihen", "every", r.every, {type:"int", wa:"data-rep"}) +
      fld("wie oft", "times", r.times, {type:"int", blank0:true, ph:"offen", wa:"data-rep"}) + "</div>" +
    fld("Maschen pro Mal", "delta", r.delta || "", {ph:"z. B. -2 oder 4", hint:"Minus für Abnahmen. Damit rechnet der Strickmodus die Maschenzahl mit."}) +
    '<div class="out" id="rem-prev"></div>';
  openSheet({title:isNew ? "Erinnerung" : "Erinnerung bearbeiten", body:body, ok:"Sichern", danger:isNew ? null : {label:"Löschen"},
    mount:function(pn){
      function upd(){
        var d = sheetData(), rep = d.kind !== "once";
        $$("[data-rep]", pn).forEach(function(el){ el.style.visibility = rep ? "" : "hidden"; });
        var lab = $('label[for="f-from"]', pn); if(lab) lab.textContent = rep ? "ab Reihe" : "in Reihe";
        var t = {kind:d.kind, from:int(d.from), every:int(d.every), times:int(d.times)};
        var out = $("#rem-prev", pn);
        if(!(t.from > 0) || (rep && !(t.every > 0))){ out.textContent = "Reihe eintragen."; return; }
        if(!rep){ out.innerHTML = "Erscheint in Reihe <b>" + t.from + "</b>."; return; }
        var rows = [], k = t.times || 6;
        for(var i=0;i<Math.min(k, 8);i++) rows.push(t.from + i*t.every);
        out.innerHTML = "Reihen <b>" + rows.join(", ") + (t.times > 8 || !t.times ? " …" : "") + "</b>" +
          (t.times ? "<br>letzte in Reihe " + (t.from + (t.times-1)*t.every) + (int(d.delta) ? " · zusammen " + (int(d.delta) > 0 ? "+" : "−") + Math.abs(int(d.delta)*t.times) + " M" : "") : "");
      }
      $("#sheetform", pn).addEventListener("input", upd);
      $$("[data-seg-name] button", pn).forEach(function(b){ b.addEventListener("click", function(){ setTimeout(upd, 0); }); });
      upd();
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){
        p.reminders = p.reminders.filter(function(x){ return x.id !== r.id; });
        put("projects", p); closeSheet(); render(); toast("Erinnerung gelöscht.");
      };
    },
    onOk:function(d){
      var from = int(d.from), every = int(d.every);
      if(!(from >= 1)) return "Bitte die Reihe eintragen, ab der die Erinnerung gilt.";
      if(d.kind !== "once" && !(every >= 1)) return "Bitte eintragen, alle wie viele Reihen es sich wiederholt.";
      r.text = d.text || "Erinnerung"; r.kind = d.kind === "once" ? "once" : "repeat"; r.sectionId = d.sectionId;
      r.from = from; r.every = r.kind === "repeat" ? every : 0; r.times = r.kind === "repeat" ? Math.max(0, int(d.times)) : 1;
      var dl = n(String(d.delta).replace("−", "-")); r.delta = isFinite(dl) ? Math.round(dl) : 0;
      if(isNew) p.reminders.push(r);
      put("projects", p);
      if(W.pid === p.id) drawDock();
    }});
}

/* ---------- Formulare: Zähler ---------- */
function ctrForm(p, c){
  var isNew = !c;
  c = c || {id:uid(), name:"", kind:"repeat", len:4, start:activeSec(p).row, sectionId:p.activeSection, value:0};
  var body = fld("Name", "name", c.name, {ph:c.kind === "repeat" ? "z. B. Zopfmuster" : "z. B. Zopfkreuzungen", attrs:isNew ? "autofocus" : ""}) +
    (isNew ? segc("kind", c.kind, [["repeat","Rapport (automatisch)"],["manual","Frei zählen"]]) : "") +
    '<div data-k="repeat" class="g2">' + fld("Musterreihen", "len", c.len, {type:"int"}) + fld("beginnt in Reihe", "start", c.start || 1, {type:"int"}) + "</div>" +
    '<div data-k="repeat">' + sel("Teil", "sectionId", c.sectionId || "", [["", "aktiver Teil"]].concat(p.sections.map(function(x){ return [x.id, x.name]; }))) + "</div>" +
    '<div data-k="manual">' + fld("Stand", "value", c.value || 0, {type:"int"}) + "</div>";
  openSheet({title:isNew ? "Zähler hinzufügen" : "Zähler bearbeiten", body:body, ok:"Sichern", danger:isNew ? null : {label:"Löschen"},
    mount:function(pn){
      function upd(){ var k = isNew ? sheetData().kind : c.kind;
        $$("[data-k]", pn).forEach(function(el){ el.hidden = el.dataset.k !== k; }); }
      $$("[data-seg-name] button", pn).forEach(function(b){ b.addEventListener("click", function(){ setTimeout(upd, 0); }); });
      upd();
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){ p.counters = p.counters.filter(function(x){ return x.id !== c.id; }); put("projects", p); closeSheet(); render(); };
    },
    onOk:function(d){
      if(isNew) c.kind = d.kind === "manual" ? "manual" : "repeat";
      c.name = d.name || (c.kind === "repeat" ? "Rapport" : "Zähler");
      if(c.kind === "repeat"){
        c.len = int(d.len); c.start = Math.max(1, int(d.start) || 1); c.sectionId = d.sectionId;
        if(!(c.len >= 1)) return "Bitte eintragen, wie viele Reihen ein Rapport hat.";
      } else c.value = Math.max(0, int(d.value));
      if(isNew) p.counters.push(c);
      put("projects", p);
      if(W.pid === p.id) drawDock();
    }});
}

/* ---------- Garn im Projekt ---------- */
function yarnUseForm(p, yarnId){
  var cur = (p.yarns||[]).filter(function(u){ return u.yarnId === yarnId; })[0];
  var ys = live("yarns").sort(function(a, b){ return String(a.name).localeCompare(String(b.name), "de"); });
  if(!ys.length){
    openSheet({title:"Garn zuordnen", body:'<p class="muted">Im Vorrat ist noch kein Garn erfasst. Lege es dort an, dann lässt es sich hier zuordnen und der Bestand rechnet mit.</p>',
      ok:"Garn erfassen", onOk:function(){ setTimeout(function(){ yarnForm(null); }, 20); }});
    return;
  }
  var body = sel("Garn", "yarnId", yarnId || ys[0].id, ys.map(function(y){ return [y.id, y.name + (y.colorway ? " · " + y.colorway : "")]; })) +
    fld("Knäuel für dieses Projekt", "balls", cur ? cur.balls : "", {type:"num", ph:"z. B. 8"});
  openSheet({title:cur ? "Garn im Projekt" : "Garn zuordnen", body:body, ok:"Sichern", danger:cur ? {label:"Entfernen"} : null,
    mount:function(pn){
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){ p.yarns = p.yarns.filter(function(u){ return u.yarnId !== yarnId; }); put("projects", p); closeSheet(); render(); };
    },
    onOk:function(d){
      var balls = n(d.balls); balls = isFinite(balls) ? balls : 0;
      p.yarns = (p.yarns||[]).filter(function(u){ return u.yarnId !== yarnId && u.yarnId !== d.yarnId; });
      p.yarns.push({yarnId:d.yarnId, balls:balls});
      if(p.yarnName && S.yarns[d.yarnId] && S.yarns[d.yarnId].name === p.yarnName) p.yarnName = "";
      put("projects", p);
    }});
}
function bookYarn(p){
  var ys = projYarns(p).filter(function(u){ return u.balls && !u.ghost; });
  confirmSheet("Verbrauch abbuchen?", ys.map(function(u){ return u.y.name + ": −" + fmt(u.balls) + " Kn."; }).join(", ") + ". Der Vorrat wird entsprechend verringert.", "Abbuchen", function(){
    ys.forEach(function(u){ u.y.ballCount = Math.max(0, (n(u.y.ballCount)||0) - u.balls); put("yarns", u.y); });
    p.yarnBooked = true; put("projects", p); toast("Vom Vorrat abgebucht.");
  });
  var okb = $('#sheet [data-sheet="ok"]'); if(okb){ okb.classList.remove("danger"); okb.classList.add("primary"); }
}

/* ---------- Notizen, Protokoll, Fotos ---------- */
function notesForm(p){
  openSheet({title:"Notizen", body:area("", "notes", p.notes, "Änderungen, Maße, Hinweise …", 10).replace('<label class="f" for="f-notes"></label>', ""),
    ok:"Sichern", onOk:function(d){ p.notes = d.notes; put("projects", p); }});
}
function logAdd(p, text, s){
  p.log.unshift({t:now(), text:text, where:s ? s.name + " · " + abbrU(s) + " " + s.row : ""});
  if(p.log.length > 300) p.log.length = 300;
}
function logForm(p, fromWork){
  var s = activeSec(p);
  openSheet({title:"Notiz", body:'<p class="muted">' + esc(s.name + " · " + s.unit + " " + s.row) + "</p>" +
    '<textarea name="text" id="f-logtext" rows="5" autofocus placeholder="z. B. hier 2 M mehr abgenommen"></textarea>',
    ok:"Sichern", onOk:function(d){
      if(!d.text) return "Bitte etwas eintragen.";
      logAdd(p, d.text, s); put("projects", p);
      if(fromWork) toast("Notiz gespeichert.");
    }});
}
var photoFor = null;
function addPhoto(p){
  if(!assets){ toast("Fotos lassen sich in dieser Ansicht nicht speichern."); return; }
  photoFor = p.id;
  pickFile("image/*", function(f){ uploadPhoto(p, f); });
}
function uploadPhoto(p, f){
  var t = /\.png$/i.test(f.name) ? "image/png" : /\.webp$/i.test(f.name) ? "image/webp" : /\.gif$/i.test(f.name) ? "image/gif" : (f.type && /^image\/(png|jpeg|gif|webp)$/.test(f.type) ? f.type : "image/jpeg");
  toast("Foto wird gespeichert …");
  assets.upload(f, {type:t}).then(function(res){
    p.photos.unshift({id:res.id, t:now()});
    put("projects", p); render(); refreshUsage(); toast("Foto gespeichert.");
  }, function(e){ toast(upErr(e)); });
}
function photoSheet(p, aid){
  var ph = p.photos.filter(function(x){ return x.id === aid; })[0]; if(!ph) return;
  openSheet({title:dstr(ph.t), body:'<img class="bigimg" data-file="' + esc(aid) + '" alt="Projektfoto">', danger:assets ? {label:"Löschen"} : null, cancel:"Schließen",
    mount:function(pn){
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){
        closeSheet();
        confirmSheet("Foto löschen?", "Das Foto wird endgültig entfernt.", "Löschen", function(){
          p.photos = p.photos.filter(function(x){ return x.id !== aid; });
          put("projects", p);
          if(assets) assets["delete"](aid).then(refreshUsage, function(){});
        });
      };
    }});
}

/* ---------- Teilen & Export ---------- */
function projLines(p){
  var L = [], pat = patternOf(p);
  var meta = [pat ? pat.title : p.patternName, p.size ? "Größe " + p.size : "", STATUS[p.status][0]].filter(Boolean);
  L.push({h:p.name, sub:meta.join(" · ")});
  L.push({sec:"Teile"});
  p.sections.forEach(function(s){
    var sts = stitchesAt(p, s, s.row);
    L.push({k:s.name, v:(s.done ? "fertig" : s.unit + " " + s.row) + (s.target ? " von " + s.target : "") + (sts !== null && !s.done ? ", " + sts + " M" : "")});
  });
  if(p.reminders.length){
    L.push({sec:"Erinnerungen"});
    p.reminders.forEach(function(r){
      var s = secById(p, r.sectionId);
      L.push({k:r.text || "Erinnerung", v:remWhen(r, s || activeSec(p)) + (r.delta ? ", " + (r.delta > 0 ? "+" : "-") + Math.abs(r.delta) + " M" : "") + (s ? " (" + s.name + ")" : "")});
    });
  }
  L.push({sec:"Material"});
  projYarns(p).forEach(function(u){ L.push({k:"Garn", v:u.y.name + (u.y.colorway ? ", " + u.y.colorway : "") + (u.y.lot ? ", Partie " + u.y.lot : "") + (u.balls ? ", " + fmt(u.balls) + " Kn." : "")}); });
  var nds = projNeedles(p);
  if(nds.length) nds.forEach(function(x){ L.push({k:"Nadel", v:needleName(x)}); });
  else if(p.needleMm) L.push({k:"Nadel", v:p.needleMm});
  if(p.gaugeSts) L.push({k:"Maschenprobe", v:p.gaugeSts + " M x " + (p.gaugeRows || "?") + " R / 10 cm"});
  if(p.timeMs >= 60000) L.push({k:"Strickzeit", v:fmtDur(p.timeMs)});
  if(p.notes){ L.push({sec:"Notizen"}); L.push({text:p.notes}); }
  if(p.log.length){ L.push({sec:"Protokoll"}); p.log.slice(0, 30).forEach(function(e){ L.push({k:dstr(e.t), v:(e.where ? e.where + ": " : "") + e.text}); }); }
  return L;
}
function projText(p){
  return projLines(p).map(function(l){
    if(l.h) return l.h.toUpperCase() + (l.sub ? "\n" + l.sub : "");
    if(l.sec) return "\n" + l.sec;
    if(l.text) return l.text;
    return "  " + l.k + ": " + l.v;
  }).join("\n") + "\n\n— Maschenwerk";
}
function copyText(t, msg){
  try{
    navigator.clipboard.writeText(t).then(function(){ toast(msg || "Kopiert."); }, function(){ showCopy(t); });
  }catch(e){ showCopy(t); }
}
function showCopy(t){
  openSheet({title:"Zum Kopieren markieren", body:'<textarea id="f-copy" rows="12" readonly>' + esc(t) + "</textarea>", cancel:"Schließen",
    mount:function(pn){ var ta = $("#f-copy", pn); setTimeout(function(){ ta.focus(); ta.select(); }, 60); }});
}
var scriptCache = {};
function loadScript(src){
  if(!scriptCache[src]) scriptCache[src] = new Promise(function(res, rej){
    var s = document.createElement("script"); s.src = src; s.onload = res;
    s.onerror = function(){ delete scriptCache[src]; rej(new Error("load")); };
    document.head.appendChild(s);
  });
  return scriptCache[src];
}
function exportPdf(p){
  toast("Projektblatt wird erstellt …");
  loadScript("vendor/jspdf.umd.min.js").then(function(){
    var J = window.jspdf && window.jspdf.jsPDF;
    if(!J) throw new Error("jspdf");
    var doc = new J({unit:"mm", format:"a4"}), x = 20, y = 24, W2 = 170;
    function room(h){ if(y + h > 280){ doc.addPage(); y = 22; } }
    function clean(s){ return String(s).replace(/≈/g, "ca.").replace(/−/g, "-").replace(/[  ]/g, " "); }
    projLines(p).forEach(function(l){
      if(l.h){
        doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(25);
        doc.text(clean(l.h), x, y); y += 7;
        if(l.sub){ doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110); doc.text(clean(l.sub), x, y); y += 4; }
        return;
      }
      if(l.sec){
        room(14); y += 6;
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(110);
        doc.text(l.sec.toUpperCase(), x, y); doc.setDrawColor(190); doc.line(x, y + 1.6, x + W2, y + 1.6); y += 7;
        return;
      }
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
      if(l.text){
        var tl = doc.splitTextToSize(clean(l.text), W2);
        tl.forEach(function(t){ room(6); doc.setTextColor(25); doc.text(t, x, y); y += 5.2; });
        return;
      }
      var lines = doc.splitTextToSize(clean(l.v), W2 - 50);
      room(lines.length * 5.2 + 1);
      doc.setTextColor(110); doc.text(clean(l.k), x, y, {maxWidth:46});
      doc.setTextColor(25); doc.text(lines, x + 50, y);
      y += Math.max(6, lines.length * 5.2 + .8);
    });
    doc.setFontSize(8); doc.setTextColor(140);
    doc.text("Maschenwerk · " + new Date().toLocaleDateString("de-DE"), x, 290);
    var nm = (p.name.replace(/[^\wäöüÄÖÜß -]/g, "").trim().replace(/\s+/g, "_") || "Projekt") + ".pdf";
    return saveFile(nm, doc.output("blob"), "Projektblatt gesichert.");
  }).catch(function(){ toast("Das Projektblatt konnte nicht erstellt werden. Text kopieren geht immer."); });
}

/* =========================================================
   Anleitung anzeigen: PDF, Foto oder Text, mit Markierband
   ========================================================= */
var PDFJS = "vendor/pdf.min.js";
var PDFW = "vendor/pdf.worker.min.js";
var pdfDocs = {};
function timeout(pr, ms){
  return new Promise(function(res, rej){
    var t = setTimeout(function(){ rej("timeout"); }, ms);
    pr.then(function(v){ clearTimeout(t); res(v); }, function(e){ clearTimeout(t); rej(e); });
  });
}
function openPdf(aid){
  if(!pdfDocs[aid]){
    pdfDocs[aid] = Promise.all([loadScript(PDFJS), FILES.blob(aid).then(function(b){ return b.arrayBuffer(); })]).then(function(res){
      var lib = window.pdfjsLib; if(!lib) throw new Error("pdfjs");
      lib.GlobalWorkerOptions.workerSrc = PDFW;
      var buf = res[1];
      function open(){ return lib.getDocument({data:new Uint8Array(buf.slice(0)), isEvalSupported:false}).promise; }
      return timeout(open(), 12000).catch(function(err){
        if(err !== "timeout") throw err;
        /* Hintergrund-Prozess kam nicht hoch: auf der Seite selbst rechnen */
        return loadScript(PDFW).then(open);
      });
    });
    pdfDocs[aid].catch(function(){ delete pdfDocs[aid]; });
  }
  return pdfDocs[aid];
}
function fileKind(pt){
  if(!pt || !pt.assetId) return "";
  var t = pt.assetType || "", nm = String(pt.assetName||"").toLowerCase();
  if(/pdf/.test(t) || /\.pdf$/.test(nm)) return "pdf";
  if(/^image\//.test(t)) return "img";
  if(/^text\/|json/.test(t)) return "txt";
  return "pdf";
}
var textCache = {};
function fileMissingMsg(){
  return CL.user ? "Die Datei ist gerade nicht erreichbar. Mit Internetverbindung wird sie geladen und danach auch offline gespeichert."
    : (cloudConfigured() ? "Die Datei liegt auf einem anderen Gerät. Melde dich mit deinem Konto an, dann wird sie hierher geholt." : "Die Datei ist auf diesem Gerät nicht vorhanden.");
}
function fetchText(aid){
  if(!textCache[aid]) textCache[aid] = FILES.blob(aid).then(function(b){ return b.text(); });
  textCache[aid].catch(function(){ delete textCache[aid]; });
  return textCache[aid];
}

function mountViewer(host, o){
  var pt = o.pattern, st = o.state || {}, fk = fileKind(pt), hasText = !!(pt && pt.text);
  var V = {st:st, kind:"none", pdf:null, pages:0, rendering:false, queued:false};
  if(st.zoom == null) st.zoom = 1;
  if(!st.mode) st.mode = fk ? "file" : (hasText ? "text" : "none");
  if(st.mode === "file" && !fk) st.mode = hasText ? "text" : "none";
  if(st.mode === "text" && !hasText) st.mode = fk ? "file" : "none";
  if(st.tapeOn == null) st.tapeOn = !!o.tape;
  if(!st.dir) st.dir = fk === "pdf" || fk === "img" ? "up" : "down";

  host.innerHTML = '<div class="viewer"><div class="vtools"></div><div class="vscroll"><div class="vcontent"></div></div></div>';
  var tools = $(".vtools", host), sc = $(".vscroll", host), ct = $(".vcontent", host);
  V.el = host.firstChild; V.sc = sc; V.ct = ct;

  function save(){ if(o.onState) o.onState(st); }
  function drawTools(){
    var h = "";
    if(fk && hasText) h += '<div class="seg" style="flex:none;min-width:150px"><button type="button" data-vm="file" class="' + (st.mode === "file" ? "on" : "") + '">Datei</button>' +
      '<button type="button" data-vm="text" class="' + (st.mode === "text" ? "on" : "") + '">Text</button></div>';
    if(V.kind === "pdf" && V.pages > 1) h += '<button type="button" class="vbtn" data-v="prev" aria-label="Seite zurück"' + (st.page <= 1 ? " disabled" : "") + ">‹</button>" +
      '<span class="vpos">' + st.page + "/" + V.pages + "</span>" +
      '<button type="button" class="vbtn" data-v="next" aria-label="Seite vor"' + (st.page >= V.pages ? " disabled" : "") + ">›</button>";
    h += '<span class="sp"></span>';
    if(V.kind !== "none"){
      if(o.tape) h += '<button type="button" class="vbtn' + (st.tapeOn ? " on" : "") + '" data-v="tape" aria-label="Markierband" title="Markierband">' + ic("ruler").replace("<svg", '<svg style="width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.9"') + "</button>";
      h += '<button type="button" class="vbtn" data-v="out" aria-label="Kleiner">−</button><button type="button" class="vbtn" data-v="in" aria-label="Größer">+</button>';
    }
    tools.innerHTML = h;
  }
  tools.addEventListener("click", function(e){
    var b = e.target.closest("[data-v],[data-vm]"); if(!b) return;
    if(b.dataset.vm){ st.mode = b.dataset.vm; save(); load(); return; }
    var a = b.dataset.v;
    if(a === "prev" && st.page > 1){ st.page--; save(); drawPdf(true); }
    else if(a === "next" && st.page < V.pages){ st.page++; save(); drawPdf(true); }
    else if(a === "in" || a === "out"){ st.zoom = Math.max(.6, Math.min(4, st.zoom * (a === "in" ? 1.25 : .8))); save(); relayout(); }
    else if(a === "tape"){ st.tapeOn = !st.tapeOn; save(); drawTools(); placeTape(); if(st.tapeOn) V.reveal(); }
  });

  function msg(html){ ct.style.width = ""; ct.innerHTML = '<div class="vmsg">' + html + "</div>"; V.kind = "none"; drawTools(); }
  function load(){
    ct.classList.toggle("inv", !!st.inv);
    if(st.mode === "file" && fk === "pdf"){
      V.kind = "pdf"; drawTools();
      ct.innerHTML = '<div class="vmsg">PDF wird geladen …</div>';
      openPdf(pt.assetId).then(function(doc){
        V.pdf = doc; V.pages = doc.numPages;
        if(!(st.page >= 1 && st.page <= V.pages)) st.page = 1;
        ct.innerHTML = "<canvas></canvas>";
        drawTools(); drawPdf(true);
      }, function(err){
        if(err && err.name === "PasswordException") return msg("Dieses PDF ist mit einem Passwort geschützt und lässt sich hier nicht öffnen.");
        msg(err && /offline|missing/i.test(String(err.message || "")) ? fileMissingMsg() :
          "Dieses PDF lässt sich hier nicht anzeigen. " + (pt.text ? "Der Text der Anleitung ist aber hinterlegt." : "Füge den Text der Anleitung ein, dann funktioniert auch der Größenfilter."));
      });
    } else if(st.mode === "file" && fk === "img"){
      V.kind = "img"; drawTools();
      ct.innerHTML = '<img alt="' + esc(pt.title) + '">';
      var im = $("img", ct);
      im.onload = function(){ relayout(); V.reveal(); };
      im.onerror = function(){ msg("Das Bild konnte nicht geladen werden."); };
      FILES.url(pt.assetId).then(function(u){ im.src = u; }, function(){ msg(fileMissingMsg()); });
      relayout();
    } else if(st.mode === "file" && fk === "txt"){
      V.kind = "text"; drawTools();
      ct.innerHTML = '<div class="vmsg">Wird geladen …</div>';
      fetchText(pt.assetId).then(function(t){ V.text = t; drawText(); }, function(){ msg(fileMissingMsg()); });
    } else if(st.mode === "text" && hasText){
      V.kind = "text"; V.text = pt.text; drawTools(); drawText();
    } else {
      V.kind = "none";
      msg(o.emptyHtml || "Zu dieser Anleitung ist weder eine Datei noch Text hinterlegt.");
    }
  }
  function drawText(){
    ct.style.width = "";
    ct.innerHTML = '<div class="ptext"></div>';
    var d = $(".ptext", ct);
    d.style.fontSize = (st.zoom * 1.02).toFixed(3) + "rem";
    d.innerHTML = renderPattern(V.text, o.sizeIndex == null ? 0 : o.sizeIndex);
    addTape(); placeTape(); V.reveal();
  }
  function drawPdf(reveal){
    if(!V.pdf) return;
    if(V.rendering){ V.queued = true; return; }
    V.rendering = true;
    var cv = $("canvas", ct); if(!cv){ V.rendering = false; return; }
    V.pdf.getPage(st.page).then(function(page){
      var avail = Math.max(200, sc.clientWidth);
      var base = page.getViewport({scale:1});
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var cssW = Math.floor(avail * st.zoom), scale = cssW / base.width;
      var vp = page.getViewport({scale:scale * dpr});
      var tmp = document.createElement("canvas");
      tmp.width = Math.floor(vp.width); tmp.height = Math.floor(vp.height);
      return page.render({canvasContext:tmp.getContext("2d"), viewport:vp}).promise.then(function(){
        cv.width = tmp.width; cv.height = tmp.height;
        cv.getContext("2d").drawImage(tmp, 0, 0);
        cv.style.width = cssW + "px"; cv.style.height = Math.floor(vp.height / dpr) + "px";
        ct.style.width = cssW + "px";
      });
    }).then(function(){
      V.rendering = false; drawTools(); addTape(); placeTape();
      if(reveal) V.reveal();
      if(V.queued){ V.queued = false; drawPdf(false); }
    }, function(){ V.rendering = false; });
  }
  function relayout(){
    if(V.kind === "pdf") drawPdf(false);
    else if(V.kind === "img"){
      var im = $("img", ct); if(im){ var w = Math.floor(sc.clientWidth * st.zoom); im.style.width = w + "px"; ct.style.width = w + "px"; }
      addTape(); placeTape();
    }
    else if(V.kind === "text") drawText();
  }

  /* --- Markierband --- */
  var tape = null, veilA = null, veilB = null;
  function addTape(){
    if(!o.tape || V.kind === "none") return;
    if(tape && tape.parentNode === ct) return;
    tape = document.createElement("div"); tape.className = "tape"; tape.innerHTML = '<span class="grip" aria-hidden="true"></span>';
    tape.setAttribute("role", "slider"); tape.setAttribute("aria-label", "Markierband");
    veilA = document.createElement("div"); veilA.className = "veil";
    veilB = document.createElement("div"); veilB.className = "veil";
    ct.appendChild(veilA); ct.appendChild(veilB); ct.appendChild(tape);
    bindTape();
  }
  function H(){ return Math.max(1, ct.scrollHeight); }
  function placeTape(){
    if(!tape) return;
    var on = st.tapeOn && V.kind !== "none";
    tape.hidden = !on; veilA.hidden = veilB.hidden = !(on && st.veil);
    if(!on) return;
    var h = H();
    if(!(st.tapeH > 0)) st.tapeH = V.kind === "text" ? Math.min(.2, 30 * st.zoom / h) : .035;
    if(!(st.tapeTop >= 0)) st.tapeTop = V.kind === "text" ? Math.min(.5, 14 / h) : .5;
    st.tapeTop = Math.max(0, Math.min(1 - st.tapeH, st.tapeTop));
    var top = st.tapeTop * h, th = st.tapeH * h;
    tape.style.top = top + "px"; tape.style.height = th + "px";
    veilA.style.top = "0px"; veilA.style.height = top + "px";
    veilB.style.top = (top + th) + "px"; veilB.style.height = Math.max(0, h - top - th) + "px";
  }
  function bindTape(){
    var drag = null;
    tape.addEventListener("pointerdown", function(e){
      e.preventDefault(); e.stopPropagation();
      drag = {y:e.clientY, top:st.tapeTop, h:st.tapeH, resize:!!e.target.closest(".grip"), H:H()};
      try{ tape.setPointerCapture(e.pointerId); }catch(x){}
    });
    tape.addEventListener("pointermove", function(e){
      if(!drag) return;
      var dy = (e.clientY - drag.y) / drag.H;
      if(drag.resize) st.tapeH = Math.max(8 / drag.H, Math.min(.5, drag.h + dy));
      else st.tapeTop = drag.top + dy;
      placeTape();
    });
    function end(){ if(drag){ drag = null; save(); } }
    tape.addEventListener("pointerup", end);
    tape.addEventListener("pointercancel", end);
    tape.addEventListener("click", function(e){ e.stopPropagation(); });
  }
  ct.addEventListener("click", function(e){
    var mk = e.target.closest("mark");
    if(mk){ e.stopPropagation(); toast("Größenlauf: " + mk.title); return; }
    if(!o.tape || !st.tapeOn || !tape || V.kind === "none") return;
    if(e.target.closest(".tape,a,button")) return;
    var r = ct.getBoundingClientRect(), y = e.clientY - r.top, h = H();
    st.tapeTop = (y - st.tapeH * h / 2) / h; placeTape(); save();
  });
  V.move = function(steps){
    if(!o.tape || !st.tapeOn || st.dir === "off" || V.kind === "none") return;
    st.tapeTop += (st.dir === "up" ? -1 : 1) * steps * st.tapeH;
    placeTape(); V.reveal(); save();
  };
  V.getTape = function(){ return {top:st.tapeTop, h:st.tapeH}; };
  V.setTape = function(t){ if(!t) return; st.tapeTop = t.top; st.tapeH = t.h; placeTape(); V.reveal(); save(); };
  V.reveal = function(){
    if(!tape || tape.hidden){ return; }
    var h = H(), top = st.tapeTop * h, bot = top + st.tapeH * h, vh = sc.clientHeight, m = Math.min(80, vh * .2);
    if(top < sc.scrollTop + m || bot > sc.scrollTop + vh - m) sc.scrollTop = Math.max(0, top - vh * .42);
  };
  V.set = function(k, v){ st[k] = v; save(); if(k === "inv") ct.classList.toggle("inv", !!v); drawTools(); placeTape(); if(k === "tapeOn" && v) V.reveal(); };
  V.setSize = function(i){ o.sizeIndex = i; if(V.kind === "text") drawText(); };
  V.reload = load;
  var rz = null;
  V.onResize = function(){ clearTimeout(rz); rz = setTimeout(relayout, 150); };
  window.addEventListener("resize", V.onResize);
  V.destroy = function(){ window.removeEventListener("resize", V.onResize); host.innerHTML = ""; };
  load();
  return V;
}

/* =========================================================
   Strickmodus
   ========================================================= */
var W = {pid:null, viewer:null, undo:[], timerOn:false, tStart:0, tick:null, wake:null, autoPaused:false, stateTimer:null};
function wp(){ return W.pid ? S.projects[W.pid] : null; }

function openWork(pid){
  var p = S.projects[pid]; if(!p) return;
  normProject(p);
  W.pid = pid; W.undo = [];
  if(p.status === "plan" || p.status === "hold"){ p.status = "wip"; if(!p.startedAt) p.startedAt = now(); }
  p.lastKnitAt = now(); put("projects", p, 2000);
  var w = $("#work");
  w.innerHTML =
    '<header class="wbar"><button type="button" class="back" data-w="close" aria-label="Strickmodus beenden">' + ic("back") + "</button>" +
    '<div class="wtitle"><b id="wname"></b><span id="wmeta"></span></div>' +
    '<button type="button" class="timer" data-w="timer" id="wtimer" aria-label="Zeitmessung"><i></i><span>0:00</span></button>' +
    '<button type="button" class="ico" data-w="menu" aria-label="Mehr">' + ic("more") + "</button></header>" +
    '<div class="wview" id="wview"></div>' +
    '<div class="dock">' +
      '<div class="chips" id="wchips"></div>' +
      '<div id="wrem" class="stack-s"></div>' +
      '<div class="dmain"><div class="dside">' +
        '<button type="button" data-w="minus" aria-label="Eine Reihe zurück">' + ic("minus") + "1</button>" +
        '<button type="button" data-w="undo" aria-label="Rückgängig">' + ic("undo") + "Zurück</button></div>" +
        '<button type="button" class="dplus" data-w="plus" id="wplus"><span class="dnum" id="wnum">1</span><span class="dlab" id="wlab">Reihe</span><span class="dsub" id="wsub"></span></button>' +
      "</div></div>";
  w.hidden = false;
  document.body.classList.add("working");
  mountWorkViewer();
  drawDock(); drawTimer();
  wakeOn();
}
function mountWorkViewer(){
  var p = wp(); if(!p) return;
  var pt = patternOf(p);
  if(W.viewer) W.viewer.destroy();
  var host = $("#wview");
  if(!pt){
    W.viewer = null;
    host.innerHTML = '<div class="viewer"><div class="vmsg" style="margin:auto">Diesem Projekt ist keine Anleitung zugeordnet.<br>' +
      '<button type="button" class="btn sm" data-w="setpat">Anleitung zuordnen</button></div></div>';
    return;
  }
  var emptyHtml = "Zu „" + esc(pt.title) + "“ ist noch keine Datei und kein Text hinterlegt." +
    (pt.source ? '<br><a class="btn sm" href="' + esc(pt.source) + '" target="_blank" rel="noopener noreferrer">Anleitung online öffnen ↗</a>' : "") +
    '<br><button type="button" class="btn sm" data-w="openpat">Datei oder Text hinzufügen</button>';
  W.viewer = mountViewer(host, {pattern:pt, state:p.view, tape:true, sizeIndex:p.sizeIndex == null ? 0 : p.sizeIndex, emptyHtml:emptyHtml,
    onState:function(stt){
      var q = wp(); if(!q) return;
      q.view = stt;
      clearTimeout(W.stateTimer);
      W.stateTimer = setTimeout(function(){ var r = wp(); if(r) put("projects", r, 1500); }, 800);
    }});
}
function closeWork(){
  if(W.timerOn) toggleTimer();
  wakeOff();
  if(W.viewer){ W.viewer.destroy(); W.viewer = null; }
  clearTimeout(W.stateTimer);
  var p = wp(); if(p) put("projects", p, 300);
  W.pid = null;
  $("#work").hidden = true; $("#work").innerHTML = "";
  document.body.classList.remove("working");
  flushPushes();
  render();
}
function refreshWorkFromRemote(){ if(wp()) drawDock(); }

function drawDock(){
  var p = wp(); if(!p) return;
  var s = activeSec(p), row = s.row;
  $("#wname").textContent = p.name;
  $("#wmeta").textContent = [s.name, p.size ? "Gr. " + p.size : ""].filter(Boolean).join(" · ");
  $("#wnum").textContent = row;
  $("#wlab").textContent = s.unit + (p.sections.length > 1 ? " · " + s.name : "");
  var cm = row > 1 ? rowsToCm(p, row - 1) : null, sts = stitchesAt(p, s, row);
  var dueList = remsFor(p, s).map(function(r){ return {r:r, d:dueNow(r, row)}; }).filter(function(x){ return x.d; });
  var after = sts;
  if(sts !== null) dueList.forEach(function(x){ if(x.r.delta) after += x.r.delta; });
  $("#wsub").textContent = [s.target > 0 ? "von " + s.target : "", cm !== null ? "ca. " + fmt(cm) + " cm" : "",
    sts !== null ? (after !== sts ? sts + " → " + after + " M" : sts + " M") : ""].filter(Boolean).join(" · ") || "tippen = " + s.unit + " fertig";

  /* Teile und Zähler */
  var ch = "";
  if(p.sections.length > 1) ch += p.sections.map(function(x){
    return '<button type="button" class="chip' + (x.id === s.id ? " on" : "") + '" data-w="sec" data-s="' + x.id + '">' + esc(x.name) +
      " <b>" + (x.done ? "✓" : x.row) + "</b></button>";
  }).join("");
  ch += p.counters.map(function(c){
    var v = ctrValue(p, c);
    if(c.kind === "repeat") return '<button type="button" class="chip" data-w="ctrinfo" data-c="' + c.id + '" style="background:var(--accent-soft);border-color:transparent;color:var(--accent-ink)">' +
      esc(c.name) + " <b>" + (v.v === null ? "–" : v.v + "/" + v.of) + "</b></button>";
    return '<button type="button" class="chip" data-w="ctr" data-c="' + c.id + '">' + esc(c.name) + " <b>" + v.v + "</b> +</button>";
  }).join("");
  var chips = $("#wchips"); chips.innerHTML = ch; chips.hidden = !ch;

  /* Erinnerungen */
  var rh = "";
  dueList.forEach(function(x){
    rh += '<div class="remline due">' + ic("bell") + '<div class="grow"><b>' + esc(remLabel(x.r, x.d.k, x.d.of)) + "</b>" +
      '<span class="s">in dieser ' + esc(s.unit) + (x.r.kind === "repeat" ? " · " + esc(remWhen(x.r, s)) : "") + "</span></div></div>";
  });
  if(s.target > 0 && row > s.target && !s.done){
    rh += '<div class="remline goal">' + ic("flag") + '<div class="grow"><b>Ziel erreicht: ' + s.target + " " + esc(unitPl(s)) + '</b><span class="s">' + esc(s.name) + "</span></div>" +
      '<button type="button" class="btn sm" data-w="finish">Teil abschließen</button></div>';
  } else if(s.target > 0 && row === s.target){
    rh += '<div class="remline goal">' + ic("flag") + '<div class="grow"><b>Letzte ' + esc(s.unit) + " von „" + esc(s.name) + "“</b></div></div>";
  }
  if(!dueList.length){
    var up = remsFor(p, s).map(function(r){ return {r:r, at:nextDue(r, row)}; }).filter(function(x){ return x.at != null; })
      .sort(function(a, b){ return a.at - b.at; })[0];
    if(up){
      var k = occIndex(up.r, up.at);
      rh += '<div class="remline">' + ic("bell") + '<div class="grow"><b>' + esc(abbrU(s)) + " " + up.at + ": " + esc(remLabel(up.r, k, up.r.times)) + "</b>" +
        '<span class="s">in ' + (up.at - row) + " " + esc(up.at - row === 1 ? s.unit : unitPl(s)) + "</span></div></div>";
    } else if(!rh && !p.reminders.length){
      rh += '<button type="button" class="remline" data-w="addrem" style="border:0;width:100%;text-align:left;color:var(--ink-3)">' + ic("bell") +
        '<div class="grow">Erinnerung für Zu- oder Abnahmen anlegen</div></button>';
    }
  }
  $("#wrem").innerHTML = rh;
}
function pushUndo(u){ W.undo.push(u); if(W.undo.length > 60) W.undo.shift(); }
function workPlus(){
  var p = wp(); if(!p) return;
  var s = activeSec(p);
  pushUndo({t:"row", sid:s.id, prev:s.row, tape:W.viewer ? W.viewer.getTape() : null});
  s.row++;
  p.lastKnitAt = now();
  if(W.viewer) W.viewer.move(1);
  put("projects", p, 1500);
  drawDock();
  var due = remsFor(p, s).some(function(r){ return dueNow(r, s.row); });
  haptic(due ? [25, 70, 25] : 12);
  var b = $("#wplus"); b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash");
}
function workMinus(){
  var p = wp(); if(!p) return;
  var s = activeSec(p);
  if(s.row <= 1){ toast("Das ist schon die erste " + s.unit + "."); return; }
  pushUndo({t:"row", sid:s.id, prev:s.row, tape:W.viewer ? W.viewer.getTape() : null});
  s.row--;
  if(W.viewer) W.viewer.move(-1);
  put("projects", p, 1500); drawDock(); haptic(8);
}
function workUndo(){
  var p = wp(), u = W.undo.pop();
  if(!p || !u){ toast("Nichts zum Zurücknehmen."); return; }
  if(u.t === "row"){ var s = secById(p, u.sid); if(s){ s.row = u.prev; p.activeSection = s.id; } if(W.viewer && u.tape) W.viewer.setTape(u.tape); }
  else if(u.t === "ctr"){ var c = p.counters.filter(function(x){ return x.id === u.cid; })[0]; if(c) c.value = u.prev; }
  else if(u.t === "sec"){ p.activeSection = u.prev; }
  put("projects", p, 1500); drawDock(); haptic(8);
}
function workCtr(cid){
  var p = wp(); if(!p) return;
  var c = p.counters.filter(function(x){ return x.id === cid; })[0]; if(!c) return;
  pushUndo({t:"ctr", cid:cid, prev:int(c.value)});
  c.value = int(c.value) + 1; put("projects", p, 1500); drawDock(); haptic(10);
}
function workSec(sid){
  var p = wp(); if(!p || p.activeSection === sid) return;
  pushUndo({t:"sec", prev:p.activeSection});
  p.activeSection = sid; put("projects", p, 1500); drawDock();
}
function workFinish(){
  var p = wp(); if(!p) return;
  var s = activeSec(p);
  s.done = true;
  logAdd(p, s.name + " fertig (" + (s.row - 1) + " " + unitPl(s) + ")", s);
  var nx = p.sections.filter(function(x){ return !x.done; })[0];
  if(nx) p.activeSection = nx.id;
  put("projects", p, 300); drawDock();
  toast(nx ? "„" + s.name + "“ fertig. Weiter mit „" + nx.name + "“." : "Alle Teile sind fertig.");
}
function setRowSheet(){
  var p = wp(); if(!p) return; var s = activeSec(p);
  openSheet({title:s.unit + " festlegen", body:fld("Aktuelle " + s.unit + " in „" + s.name + "“", "row", s.row, {type:"int", attrs:"autofocus"}),
    ok:"Übernehmen", onOk:function(d){
      var v = int(d.row); if(!(v >= 1)) return "Bitte eine Zahl ab 1 eintragen.";
      pushUndo({t:"row", sid:s.id, prev:s.row, tape:W.viewer ? W.viewer.getTape() : null});
      s.row = v; put("projects", p, 600); drawDock();
    }});
}
function workMenu(){
  var p = wp(); if(!p) return;
  var st = (W.viewer && W.viewer.st) || {}, pt = patternOf(p), cnt = pt ? sizeCount(pt.text) : 0, s = activeSec(p);
  var items = [
    {label:s.unit + " festlegen", sub:"springt direkt zu einer " + s.unit, icon:"hash", fn:setRowSheet},
    {label:"Notiz zu dieser " + s.unit, sub:"landet im Protokoll", icon:"note", fn:function(){ logForm(p, true); }},
    {label:"Erinnerung hinzufügen", sub:"Zu- und Abnahmen, Knopflöcher", icon:"bell", fn:function(){ remForm(p); }},
    {label:"Zähler hinzufügen", sub:"Rapport oder frei", icon:"plus", fn:function(){ ctrForm(p); }},
    {label:"Teil hinzufügen", sub:"Rumpf, Ärmel, Blende …", icon:"layers", fn:function(){ secForm(p); }}
  ];
  if(W.viewer && W.viewer.kind !== "none"){
    items.push({label:"Markierband", sub:{up:"wandert bei +1 nach oben (Diagramm)", down:"wandert bei +1 nach unten (Text)", off:"bleibt stehen"}[st.dir] + (st.tapeOn ? "" : " · ausgeblendet"), icon:"ruler", fn:tapeMenu});
    items.push({label:"Rest abdecken", sub:st.veil ? "an · nur das Band bleibt hell" : "aus", icon:"layers", on:!!st.veil, fn:function(){ W.viewer.set("veil", !st.veil); if(!st.tapeOn) W.viewer.set("tapeOn", true); }});
    if(W.viewer.kind === "pdf" || W.viewer.kind === "img")
      items.push({label:"Anleitung dunkel", sub:st.inv ? "an · Farben umgekehrt" : "aus · für abends", icon:"moon", on:!!st.inv, fn:function(){ W.viewer.set("inv", !st.inv); }});
  }
  if(cnt > 1) items.push({label:"Größe im Text", sub:p.sizeIndex === -1 ? "alle Angaben" : (int(p.sizeIndex) + 1) + ". Angabe im Größenlauf", icon:"size", fn:sizeMenu});
  items.push({label:"Tastatur und Fernbedienung", sub:"Leertaste, Pfeiltasten, Bluetooth-Seitenwender", icon:"key", fn:keysInfo});
  items.push({label:"Projekt öffnen", icon:"chev", fn:function(){ var id = p.id; closeWork(); UI.stack = [{v:"project", id:id}]; render(); }});
  menuSheet(p.name, items);
}
function tapeMenu(){
  var st = W.viewer.st;
  menuSheet("Markierband", [
    {label:"Nach oben wandern", sub:"für Strickschriften, die von unten gelesen werden", icon:st.dir === "up" && st.tapeOn ? "check" : "chev", on:st.dir === "up" && st.tapeOn, fn:function(){ W.viewer.set("dir", "up"); W.viewer.set("tapeOn", true); }},
    {label:"Nach unten wandern", sub:"für geschriebene Anleitungen", icon:st.dir === "down" && st.tapeOn ? "check" : "chev", on:st.dir === "down" && st.tapeOn, fn:function(){ W.viewer.set("dir", "down"); W.viewer.set("tapeOn", true); }},
    {label:"Stehen lassen", sub:"du schiebst es selbst", icon:st.dir === "off" && st.tapeOn ? "check" : "chev", on:st.dir === "off" && st.tapeOn, fn:function(){ W.viewer.set("dir", "off"); W.viewer.set("tapeOn", true); }},
    {label:"Ausblenden", icon:!st.tapeOn ? "check" : "chev", on:!st.tapeOn, fn:function(){ W.viewer.set("tapeOn", false); }}
  ]);
}
function sizeMenu(){
  var p = wp(), pt = patternOf(p), cnt = sizeCount(pt.text), cur = p.sizeIndex == null ? 0 : p.sizeIndex;
  var items = [];
  for(var i=0;i<cnt;i++) (function(i){
    items.push({label:(i+1) + ". Angabe", sub:i === 0 ? "erste Zahl vor der Klammer" : "", icon:cur === i ? "check" : "chev", on:cur === i, fn:function(){ setSize(i); }});
  })(i);
  items.push({label:"Alle anzeigen", icon:cur === -1 ? "check" : "chev", on:cur === -1, fn:function(){ setSize(-1); }});
  menuSheet("Größe im Text", items);
  function setSize(i){ p.sizeIndex = i; put("projects", p); if(W.viewer) W.viewer.setSize(i); }
}
function keysInfo(){
  openSheet({title:"Tastatur und Fernbedienung", cancel:"Schließen", body:
    '<p class="muted" style="color:var(--ink-2)">Ein Bluetooth-Seitenwender oder eine Tastatur steuert den Strickmodus, ohne dass du die Nadeln ablegen musst.</p>' +
    '<dl class="kv" style="margin-top:8px"><dt>+1 Reihe</dt><dd>Leertaste, Enter, Pfeil rechts oder unten, Bild ab</dd>' +
    "<dt>−1 Reihe</dt><dd>Pfeil links oder oben, Bild auf</dd><dt>Rückgängig</dt><dd>Strg + Z oder ⌘ + Z, oder U</dd><dt>Beenden</dt><dd>Esc</dd></dl>" +
    '<p class="hint" style="margin-top:10px">Der Bildschirm bleibt im Strickmodus an, solange dein Gerät das erlaubt.</p>'});
}

/* Zeitmessung */
function toggleTimer(){
  var p = wp(); if(!p) return;
  if(W.timerOn){ commitTime(); W.timerOn = false; clearInterval(W.tick); W.tick = null; put("projects", p, 300); }
  else { W.timerOn = true; W.tStart = now(); W.sessBase = p.timeMs || 0; W.tick = setInterval(timerTick, 1000); toast("Zeitmessung läuft. Sie pausiert, wenn du die App verlässt."); }
  drawTimer();
}
function commitTime(){
  var p = wp(); if(!p || !W.tStart) return;
  p.timeMs = (p.timeMs || 0) + (now() - W.tStart);
  W.tStart = now();
}
function timerTick(){
  if(!W.tStart) return;
  if(now() - W.tStart > 60000){ commitTime(); var p = wp(); if(p) put("projects", p, 3000); }
  drawTimer();
}
function drawTimer(){
  var p = wp(), b = $("#wtimer"); if(!p || !b) return;
  var sess = (p.timeMs || 0) - (W.sessBase || 0) + (W.timerOn && W.tStart ? now() - W.tStart : 0);
  b.classList.toggle("run", W.timerOn);
  b.lastChild.textContent = W.timerOn ? clock(sess) : (p.timeMs >= 60000 ? fmtDur(p.timeMs).replace(" min", "′") : "Zeit");
  b.setAttribute("aria-label", W.timerOn ? "Zeitmessung anhalten" : "Zeitmessung starten");
}
document.addEventListener("visibilitychange", function(){
  if(!W.pid) return;
  if(document.visibilityState === "hidden"){
    if(W.timerOn && W.tStart){ commitTime(); W.tStart = 0; W.autoPaused = true; var p = wp(); if(p) put("projects", p, 0); }
    flushPushes(); saveLocalNow();
  } else {
    if(W.autoPaused){ W.autoPaused = false; W.tStart = now(); }
    wakeOn();
  }
});
window.addEventListener("pagehide", function(){ flushPushes(); saveLocalNow(); });

function wakeOn(){
  if(!PREF.wake || !navigator.wakeLock || W.wake) return;
  try{
    navigator.wakeLock.request("screen").then(function(l){
      W.wake = l; l.addEventListener("release", function(){ W.wake = null; });
    }).catch(function(){});
  }catch(e){}
}
function wakeOff(){ if(W.wake){ try{ W.wake.release(); }catch(e){} W.wake = null; } }

$("#work").addEventListener("click", function(e){
  var b = e.target.closest("[data-w]"); if(!b) return;
  var a = b.dataset.w, p = wp();
  if(a === "close") closeWork();
  else if(a === "plus") workPlus();
  else if(a === "minus") workMinus();
  else if(a === "undo") workUndo();
  else if(a === "menu") workMenu();
  else if(a === "timer") toggleTimer();
  else if(a === "sec") workSec(b.dataset.s);
  else if(a === "ctr") workCtr(b.dataset.c);
  else if(a === "ctrinfo"){ var c = p.counters.filter(function(x){ return x.id === b.dataset.c; })[0]; if(c) ctrForm(p, c); }
  else if(a === "finish") workFinish();
  else if(a === "addrem") remForm(p);
  else if(a === "setpat"){ projForm(p); }
  else if(a === "openpat"){ var id = p.patternId; closeWork(); UI.tab = "lib"; UI.stack = [{v:"pattern", id:id}]; render(); }
});
document.addEventListener("keydown", function(e){
  if(!W.pid || sheetCtx) return;
  var t = e.target;
  if(t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
  var k = e.key;
  if((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")){ e.preventDefault(); workUndo(); return; }
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  if(k === " " || k === "Enter" || k === "ArrowRight" || k === "ArrowDown" || k === "PageDown"){ e.preventDefault(); if(!e.repeat) workPlus(); }
  else if(k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp"){ e.preventDefault(); workMinus(); }
  else if(k === "u" || k === "U"){ workUndo(); }
  else if(k === "Escape"){ closeWork(); }
});
document.addEventListener("keyup", function(e){
  if(W.pid && !sheetCtx && e.key === " " && e.target && e.target.tagName === "BUTTON") e.preventDefault();
});

/* =========================================================
   Anleitungen
   ========================================================= */
var UPERR = {
  too_large:"Die Datei ist zu groß. Erlaubt sind 20 MB.",
  unsupported_type:"Dieser Dateityp geht nicht. Möglich sind PDF, JPG, PNG, WEBP, GIF und Textdateien.",
  quota_or_state:"Der Dateispeicher ist voll. Entferne eine Datei, die du nicht mehr brauchst.",
  rate_limited:"Zu viele Uploads kurz hintereinander. Warte einen Moment.",
  upstream_auth:"Bitte die Seite neu laden und noch einmal versuchen.",
  invalid_request:"Die Datei konnte nicht gelesen werden.",
  store_unavailable:"Der Speicher antwortet gerade nicht. Bitte gleich noch einmal versuchen."
};
function upErr(e){ return (e && UPERR[e.code]) || "Das Hochladen hat nicht geklappt."; }
var TYPES = {pdf:"application/pdf", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp",
  txt:"text/plain", md:"text/markdown"};
function extOf(name){ var m = /\.([a-z0-9]+)$/i.exec(name||""); return m ? m[1].toLowerCase() : ""; }
function kb(b){ return b >= 1048576 ? fmt(b/1048576) + " MB" : Math.max(1, Math.round(b/1024)) + " KB"; }

var fileCb = null;
function pickFile(accept, cb){
  var fi = $("#file");
  fi.accept = accept; fi.value = ""; fileCb = cb;
  fi.click();
}
$("#file").addEventListener("change", function(){
  var f = this.files && this.files[0], cb = fileCb; fileCb = null; this.value = "";
  if(f && cb) cb(f);
});

function uploadPattern(pt, f){
  if(!assets){ toast("Dateien lassen sich in dieser Ansicht nicht speichern."); return; }
  var t = TYPES[extOf(f.name)] || (f.type && /^image\/(png|jpeg|gif|webp)$/.test(f.type) ? f.type : "");
  if(!t){ toast(UPERR.unsupported_type); return; }
  toast("„" + f.name + "“ wird hochgeladen …");
  assets.upload(f, {type:t}).then(function(res){
    var isNew = !pt;
    pt = pt || {id:uid(), title:f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Anleitung"};
    var old = pt.assetId;
    pt.assetId = res.id; pt.assetName = f.name; pt.assetSize = res.sizeBytes; pt.assetType = res.contentType;
    pt.view = {};
    put("patterns", pt);
    if(old && old !== res.id) assets["delete"](old).catch(function(){});
    refreshUsage();
    UI.tab = "lib"; UI.stack = [{v:"pattern", id:pt.id}];
    render(); window.scrollTo(0, 0);
    toast(isNew ? "Gespeichert. Trag Titel und Maschenprobe nach." : "Datei ersetzt.");
  }, function(e){ toast(upErr(e)); });
}

function pgLib(){
  var all = live("patterns");
  var q = (UI.libQ||"").toLowerCase().trim();
  var f = UI.libF;
  var ps = all.filter(function(p){
    if(f === "file" && !p.assetId) return false;
    if(f === "text" && !p.text) return false;
    if(f === "web" && (p.assetId || p.text || !p.source)) return false;
    if(f === "used" && !live("projects").some(function(x){ return x.patternId === p.id; })) return false;
    if(!q) return true;
    return [p.title, p.designer, p.notes, p.yarnWeight, p.sizes, p.language].join(" ").toLowerCase().indexOf(q) >= 0;
  }).sort(function(a, b){
    var ua = (a.assetId || a.text) ? 0 : 1, ub = (b.assetId || b.text) ? 0 : 1;
    return ua - ub || (b.updatedAt||0) - (a.updatedAt||0);
  });
  var h = '<header class="top"><h1>Anleitungen</h1><button type="button" class="btn sm primary" data-act="newpat">' + ic("plus") + "Neu</button></header>";
  h += '<div class="search">' + ic("search") + '<input id="libq" type="search" placeholder="Titel, Designer, Garn" value="' + esc(UI.libQ) + '" autocomplete="off"></div>';
  var cnt = {all:all.length,
    file:all.filter(function(p){ return p.assetId; }).length,
    text:all.filter(function(p){ return p.text; }).length,
    web:all.filter(function(p){ return !p.assetId && !p.text && p.source; }).length};
  h += '<div class="chips" style="margin-bottom:12px">' + [["all","Alle"],["file","Mit Datei"],["text","Mit Text"],["web","Nur online"],["used","In Projekten"]].map(function(x){
    return '<button type="button" class="chip' + (f === x[0] ? " on" : "") + '" data-act="libf" data-f="' + x[0] + '">' + x[1] + (cnt[x[0]] != null ? " · " + cnt[x[0]] : "") + "</button>";
  }).join("") + "</div>";
  if(!all.length){
    h += '<div class="empty"><h2>Noch keine Anleitung</h2><p>Lade ein PDF oder ein Foto der Papieranleitung hoch, füge den Text ein oder speichere einen Link.</p>' +
      '<button type="button" class="btn primary" data-act="newpat">Anleitung hinzufügen</button></div>';
    return h;
  }
  if(!ps.length) return h + '<div class="empty">Nichts gefunden' + (q ? " für „" + esc(UI.libQ) + "“" : "") + ".</div>";
  var shown = ps.slice(0, 150);
  h += '<section class="card" style="padding-block:4px">' + shown.map(function(p){
    var fk = fileKind(p), tag = fk ? (fk === "img" ? "FOTO" : fk === "txt" ? "TEXT" : "PDF") : (p.text ? "TEXT" : "WEB");
    var cls = fk ? "file" : (p.text ? "text" : "");
    var meta = [p.designer, p.sizes, p.yarnWeight, p.gaugeSts ? p.gaugeSts + " M" : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="patc" data-act="openpat" data-id="' + p.id + '"><span class="ic ' + cls + '">' + tag + "</span>" +
      '<span class="grow"><span class="t">' + esc(p.title) + "</span>" + (meta ? '<span class="m" style="display:block">' + esc(meta) + "</span>" : "") + "</span></button>";
  }).join("") + "</section>";
  if(ps.length > shown.length) h += '<p class="muted" style="margin-top:10px">' + (ps.length - shown.length) + " weitere. Suche eingrenzen, um sie zu sehen.</p>";
  return h;
}

function newPatternMenu(){
  var items = [];
  if(assets) items.push({label:"PDF oder Foto hochladen", sub:"auch ein Handyfoto der Papieranleitung", icon:"file", fn:function(){
    pickFile(".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,image/*,application/pdf", function(f){ uploadPattern(null, f); }); }});
  items.push({label:"Text einfügen", sub:"Größenangaben wie 110 (116) 121 werden erkannt", icon:"note", fn:function(){ patTextForm(null); }});
  items.push({label:"Nur Link und Angaben", sub:"zum Beispiel eine kostenlose Anleitung im Netz", icon:"link", fn:function(){ patForm(null); }});
  menuSheet("Anleitung hinzufügen", items);
}
function patForm(pt){
  var isNew = !pt;
  pt = pt || {id:uid()};
  var body = fld("Titel", "title", pt.title, {ph:"z. B. Ease Tee", attrs:isNew ? "autofocus" : ""}) +
    '<div class="g2">' + fld("Designer / Quelle", "designer", pt.designer) + fld("Sprache", "language", pt.language, {ph:"deutsch"}) + "</div>" +
    fld("Web-Adresse", "source", pt.source, {ph:"garnstudio.com/…", type:"url"}) +
    '<div class="eyebrow" style="margin-top:6px">Laut Anleitung</div>' +
    '<div class="g3">' + fld("Nadel mm", "needleMm", pt.needleMm, {type:"num"}) + fld("M / 10 cm", "gaugeSts", pt.gaugeSts, {type:"num"}) + fld("R / 10 cm", "gaugeRows", pt.gaugeRows, {type:"num"}) + "</div>" +
    '<div class="g2">' + fld("Garn / Stärke", "yarnWeight", pt.yarnWeight, {ph:"DK"}) + fld("Garnbedarf m", "meters", pt.meters, {type:"int"}) + "</div>" +
    fld("Art / Größen", "sizes", pt.sizes, {ph:"Pullover, Gr. XS–XXL"}) +
    area("Notizen", "notes", pt.notes, "", 3);
  openSheet({title:isNew ? "Anleitung anlegen" : "Angaben bearbeiten", body:body, ok:"Sichern", danger:isNew ? null : {label:"Löschen"},
    mount:function(pn){
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){ closeSheet(); delPattern(pt); };
    },
    onOk:function(d){
      if(!d.title) return "Bitte einen Titel eintragen.";
      ["title","designer","language","yarnWeight","sizes","notes"].forEach(function(k){ pt[k] = d[k]; });
      ["needleMm","gaugeSts","gaugeRows","meters"].forEach(function(k){ var v = n(d[k]); pt[k] = isFinite(v) ? v : ""; });
      if(d.source){ var u = safeUrl(d.source); if(!u) return "Die Web-Adresse sieht nicht richtig aus."; pt.source = u; } else pt.source = "";
      put("patterns", pt);
      live("projects").forEach(function(x){ if(x.patternId === pt.id && x.patternName !== pt.title){ x.patternName = pt.title; put("projects", x); } });
      if(isNew){ UI.tab = "lib"; UI.stack = [{v:"pattern", id:pt.id}]; window.scrollTo(0, 0); }
    }});
}
function patTextForm(pt){
  var isNew = !pt;
  var body = (isNew ? fld("Titel", "title", "", {ph:"z. B. Ease Tee"}) : "") +
    '<div><label class="f" for="f-ptext">Text der Anleitung</label><textarea id="f-ptext" name="text" rows="12" placeholder="z. B.&#10;Schlage 114 (114) 118 (118) M an …">' + esc(pt && pt.text || "") + "</textarea></div>" +
    '<p class="hint">Aus einem PDF lässt sich der Text meist markieren und kopieren. Maschenwerk erkennt Größenläufe wie 110 (116) 121 (126) und zeigt nur deine Größe.</p>';
  openSheet({title:isNew ? "Text einfügen" : "Text bearbeiten", body:body, ok:"Sichern", onOk:function(d){
    if(isNew && !d.title) return "Bitte einen Titel eintragen.";
    if(!d.text && isNew) return "Bitte den Text einfügen.";
    pt = pt || {id:uid(), title:d.title};
    pt.text = $("#f-ptext").value;
    put("patterns", pt);
    if(isNew){ UI.tab = "lib"; UI.stack = [{v:"pattern", id:pt.id}]; window.scrollTo(0, 0); }
  }});
}
function delPattern(pt){
  var used = live("projects").filter(function(x){ return x.patternId === pt.id; });
  confirmSheet("Anleitung löschen?", "„" + pt.title + "“" + (pt.assetId ? " und die hochgeladene Datei werden" : " wird") + " gelöscht." +
    (used.length ? " " + used.length + " " + plural(used.length, "Projekt behält", "Projekte behalten") + " den Namen der Anleitung." : ""), "Löschen", function(){
    var aid = pt.assetId;
    remove("patterns", pt.id);
    if(aid && assets) assets["delete"](aid).then(refreshUsage, function(){});
    used.forEach(function(x){ x.patternId = ""; put("projects", x); });
    UI.stack = [];
    toast("Anleitung gelöscht.");
  });
}
function safeUrl(u){
  u = String(u||"").trim();
  if(!u) return null;
  if(!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  if(!/^https?:\/\/[^\s]+$/i.test(u)) return null;
  return u;
}
function hostOf(u){ try{ return new URL(u).host.replace(/^www\./, ""); }catch(e){ return u; } }

var libViewer = null;
function pgPattern(id){
  var pt = S.patterns[id];
  if(!pt || pt.deleted) return null;
  var used = live("projects").filter(function(x){ return x.patternId === pt.id; });
  var fk = fileKind(pt), cnt = sizeCount(pt.text);
  var h = topBar(pt.title, '<button type="button" class="ico" data-act="patmenu" data-id="' + pt.id + '" aria-label="Mehr">' + ic("more") + "</button>");
  h += '<div class="stack">';
  var meta = [pt.designer, pt.language].filter(Boolean).join(" · ");
  if(meta) h += '<p class="muted">' + esc(meta) + "</p>";
  h += '<div class="stack-s"><button type="button" class="btn primary big wide" data-act="projfrompat" data-id="' + pt.id + '">Projekt damit starten</button>' +
    (pt.source ? '<a class="btn wide" href="' + esc(pt.source) + '" target="_blank" rel="noopener noreferrer">' + ic("link") + "Online öffnen · " + esc(hostOf(pt.source)) + "</a>" : "") + "</div>";

  if(fk || pt.text){
    h += '<div id="patview" style="height:min(72vh,720px);display:flex;flex-direction:column"></div>';
    if(cnt > 1){
      var idx = pt.sizeIndex == null ? 0 : pt.sizeIndex;
      h += '<section class="card"><div class="sec-h"><span class="eyebrow">Größe im Text</span></div><div class="sizebar">';
      for(var i=0;i<cnt;i++) h += '<button type="button" data-act="patsize" data-id="' + pt.id + '" data-i="' + i + '" class="' + (idx === i ? "on" : "") + '">' + (i+1) + "</button>";
      h += '<button type="button" data-act="patsize" data-id="' + pt.id + '" data-i="-1" class="' + (idx === -1 ? "on" : "") + '" style="font-family:var(--f-body);font-size:.9rem;padding:0 12px">alle</button></div>' +
        '<p class="hint" style="margin-top:8px">' + cnt + " Größen erkannt. Markiert ist jeweils die Zahl für die gewählte Größe. Tippe auf eine Zahl, um den ganzen Lauf zu sehen.</p></section>";
    }
  } else {
    h += '<section class="card"><p class="muted" style="margin-bottom:12px">Zu dieser Anleitung ist keine Datei und kein Text gespeichert' + (pt.source ? ", nur der Link." : ".") + " Mit Datei oder Text siehst du sie im Strickmodus direkt über dem Zähler.</p>" +
      '<div class="wrap">' + (assets ? '<button type="button" class="btn sm" data-act="patupload" data-id="' + pt.id + '">' + ic("file") + "PDF oder Foto</button>" : "") +
      '<button type="button" class="btn sm" data-act="pattext" data-id="' + pt.id + '">' + ic("note") + "Text einfügen</button></div></section>";
  }

  var facts = [];
  if(pt.gaugeSts) facts.push(["Maschenprobe", pt.gaugeSts + " M × " + (pt.gaugeRows || "?") + " R / 10 cm"]);
  if(pt.needleMm) facts.push(["Nadel", fmt(n(pt.needleMm), 2) + " mm" + (usSize(n(pt.needleMm)) ? " · US " + usSize(n(pt.needleMm)) : "")]);
  if(pt.yarnWeight) facts.push(["Garn", pt.yarnWeight]);
  if(pt.meters) facts.push(["Garnbedarf", pt.meters + " m"]);
  if(pt.sizes) facts.push(["Art / Größen", pt.sizes]);
  if(fk) facts.push(["Datei", (pt.assetName || "Datei") + (pt.assetSize ? " · " + kb(pt.assetSize) : "")]);
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Angaben</span><button type="button" class="add" data-act="editpat" data-id="' + pt.id + '">Bearbeiten</button></div>' +
    (facts.length ? '<dl class="kv">' + facts.map(function(f){ return "<dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd>"; }).join("") + "</dl>" : '<p class="muted">Maschenprobe, Nadel und Garnbedarf eintragen, dann rechnet der Rechner damit.</p>') +
    (pt.notes ? '<p class="notes" style="margin-top:10px">' + esc(pt.notes) + "</p>" : "") + "</section>";

  if(used.length){
    h += '<section class="grp"><span class="eyebrow">Verwendet in</span>' + used.map(projCard).join("") + "</section>";
  }
  h += "</div>";
  afterRender = function(){
    if(libViewer){ libViewer.destroy(); libViewer = null; }
    var host = $("#patview");
    if(host){
      pt.view = pt.view || {};
      libViewer = mountViewer(host, {pattern:pt, state:pt.view, tape:false, sizeIndex:pt.sizeIndex == null ? 0 : pt.sizeIndex,
        onState:function(st){ pt.view = st; }});
    }
  };
  return h;
}
function patMenu(pt){
  var fk = fileKind(pt), items = [
    {label:"Angaben bearbeiten", icon:"note", fn:function(){ patForm(pt); }},
    {label:pt.text ? "Text bearbeiten" : "Text einfügen", sub:"für den Größenfilter", icon:"note", fn:function(){ patTextForm(pt); }}
  ];
  if(assets) items.push({label:fk ? "Datei ersetzen" : "PDF oder Foto hochladen", icon:"file", fn:function(){
    pickFile(".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,image/*,application/pdf", function(f){ uploadPattern(pt, f); }); }});
  if(fk) items.push({label:"Datei auf dem Gerät sichern", icon:"file", fn:function(){ saveAsset(pt); }});
  if(fk && assets) items.push({label:"Datei entfernen", sub:"die Angaben bleiben", icon:"minus", fn:function(){
    confirmSheet("Datei entfernen?", "„" + (pt.assetName || "Datei") + "“ wird endgültig gelöscht.", "Entfernen", function(){
      var aid = pt.assetId; pt.assetId = ""; pt.assetName = ""; pt.assetSize = 0; pt.assetType = ""; pt.view = {};
      put("patterns", pt); assets["delete"](aid).then(refreshUsage, function(){});
    }); }});
  items.push({label:"Anleitung löschen", icon:"minus", fn:function(){ delPattern(pt); }});
  menuSheet(pt.title, items);
}
function saveAsset(pt){
  toast("Datei wird vorbereitet …");
  FILES.blob(pt.assetId).then(function(b){
    var ext = extOf(pt.assetName) || (fileKind(pt) === "img" ? "jpg" : "pdf");
    var name = pt.assetName && extOf(pt.assetName) ? pt.assetName : (pt.title || "Anleitung") + "." + ext;
    return saveFile(name, b, "Datei gesichert.");
  }).catch(function(){ toast("Die Datei konnte nicht geladen werden."); });
}

/* =========================================================
   Vorrat: Garn, Nadeln, Maschenproben
   ========================================================= */
var NTYPES = [["rund","Rundnadel"],["wechsel","Wechselspitzen"],["seil","Seil (für Wechselspitzen)"],["spiel","Nadelspiel"],["jacke","Jackenstricknadeln"],["haekel","Häkelnadel"],["zopf","Zopfnadel"]];
function ntype(k){ var t = NTYPES.filter(function(x){ return x[0] === k; })[0]; return t ? t[1] : "Nadel"; }
function needleName(x){
  if(!x) return "";
  var mm = n(x.mm);
  return (x.type === "seil" ? "Seil" : (isFinite(mm) ? fmt(mm, 2) + " mm" : "")) +
    " · " + ntype(x.type) + (x.lengthCm ? " · " + x.lengthCm + " cm" : "") + (x.material ? " · " + x.material : "");
}
function yarnReserved(y){
  var out = [];
  live("projects").forEach(function(p){
    if(p.status === "done" && p.yarnBooked) return;
    (p.yarns||[]).forEach(function(u){ if(u.yarnId === y.id && u.balls) out.push({p:p, balls:u.balls}); });
  });
  return out;
}

function pgStock(){
  var seg = UI.stockSeg;
  var h = '<header class="top"><h1>Vorrat</h1><button type="button" class="btn sm primary" data-act="' + {yarn:"newyarn", needle:"newneedle", swatch:"newswatch"}[seg] + '">' + ic("plus") + "Neu</button></header>";
  h += '<div class="seg" style="margin-bottom:14px">' + [["yarn","Garn"],["needle","Nadeln"],["swatch","Maschenproben"]].map(function(x){
    return '<button type="button" data-act="stockseg" data-s="' + x[0] + '" class="' + (seg === x[0] ? "on" : "") + '">' + x[1] + "</button>";
  }).join("") + "</div>";
  if(seg === "yarn") h += yarnList();
  else if(seg === "needle") h += needleList();
  else h += swatchList();
  return h;
}
function yarnList(){
  var ys = live("yarns").sort(function(a, b){ return String(a.name).localeCompare(String(b.name), "de"); });
  if(!ys.length) return '<div class="empty"><h2>Noch kein Garn</h2><p>Lauflänge und Gewicht pro Knäuel sind die wichtigsten Angaben. Damit rechnet Maschenwerk Meter, Gramm und Garnstärke.</p>' +
    '<button type="button" class="btn primary" data-act="newyarn">Garn erfassen</button></div>';
  var totM = 0, totG = 0;
  var h = '<section class="card" style="padding-block:4px">' + ys.map(function(y){
    var mpb = n(y.metersPerBall), gpb = n(y.gramsPerBall), bc = n(y.ballCount) || 0;
    var m100 = mpb > 0 && gpb > 0 ? mpb / gpb * 100 : 0, cat = m100 ? cycByLength(m100) : null;
    var res = yarnReserved(y), resB = res.reduce(function(a, r){ return a + r.balls; }, 0);
    if(mpb > 0) totM += mpb * bc; if(gpb > 0) totG += gpb * bc;
    var sub = [y.colorway, y.lot ? "Partie " + y.lot : "", cat ? "CYC " + cat[0] + " " + cat[1].split(" /")[0] : "", mpb ? mpb + " m / " + (gpb || "?") + " g" : ""].filter(Boolean).join(" · ");
    var free = bc - resB;
    return '<button type="button" class="li" data-act="edityarn" data-id="' + y.id + '"><span class="grow"><span class="t">' + esc(y.name) + "</span>" +
      '<span class="s" style="display:block">' + esc(sub || "—") + "</span>" +
      (res.length ? '<span class="s" style="display:block">verplant: ' + esc(res.map(function(r){ return r.p.name + " " + fmt(r.balls) + " Kn."; }).join(", ")) + "</span>" : "") +
      (!y.lot && bc > 1 ? '<span class="pill hold" style="margin-top:4px">Partie fehlt</span>' : "") +
      '</span><span style="text-align:right"><span class="v" style="display:block">' + fmt(bc) + " Kn.</span>" +
      (res.length ? '<span class="s' + (free < 0 ? '" style="color:var(--alert);font-weight:700' : "") + '">' + (free < 0 ? fmt(-free) + " fehlen" : fmt(free) + " frei") + "</span>" : "") + "</span></button>";
  }).join("") + "</section>";
  if(totM || totG) h += '<p class="muted" style="margin-top:10px">Gesamt: <span class="tnum">' + fmt(totM, 0) + " m · " + fmt(totG / 1000, 2) + " kg</span></p>";
  return h;
}
function yarnForm(y){
  var isNew = !y;
  y = y || {id:uid()};
  var res = isNew ? [] : yarnReserved(y);
  var body = (res.length ? '<p class="out">Verplant: ' + esc(res.map(function(r){ return r.p.name + " (" + fmt(r.balls) + " Kn.)"; }).join(", ")) + "</p>" : "") +
    fld("Garn", "name", y.name, {ph:"z. B. CaMaRose Snefnug", attrs:isNew ? "autofocus" : ""}) +
    fld("Zusammensetzung", "fiber", y.fiber, {ph:"z. B. 55 % Alpaka, 35 % Baumwolle"}) +
    '<div class="g3">' + fld("Meter/Knäuel", "metersPerBall", y.metersPerBall || "", {type:"int"}) + fld("Gramm/Knäuel", "gramsPerBall", y.gramsPerBall || "", {type:"int"}) +
      fld("Knäuel da", "ballCount", y.ballCount === 0 ? "0" : (y.ballCount || ""), {type:"num"}) + "</div>" +
    '<div class="g2">' + fld("Farbe", "colorway", y.colorway) + fld("Färbepartie", "lot", y.lot, {ph:"Lot-Nr."}) + "</div>" +
    '<div class="g2">' + fld("Nadel lt. Banderole", "needleMm", y.needleMm, {ph:"4–6 mm"}) + fld("MP lt. Banderole", "gaugeLabel", y.gaugeLabel, {ph:"16 M × 24 R"}) + "</div>" +
    area("Notizen", "notes", y.notes, "Pflege, Verhalten, wo gekauft …", 3) +
    '<p class="hint">Alle Knäuel eines Projekts aus derselben Färbepartie kaufen: sonst sieht man den Übergang.</p>';
  openSheet({title:isNew ? "Garn erfassen" : "Garn bearbeiten", body:body, ok:"Sichern", danger:isNew ? null : {label:"Löschen"},
    mount:function(pn){
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){ closeSheet(); confirmSheet("Garn löschen?", "„" + (y.name||"Garn") + "“ wird aus dem Vorrat entfernt. Projekte behalten ihren Eintrag nicht.", "Löschen", function(){ remove("yarns", y.id); }); };
    },
    onOk:function(d){
      if(!d.name) return "Bitte den Namen des Garns eintragen.";
      ["name","fiber","colorway","lot","needleMm","gaugeLabel","notes"].forEach(function(k){ y[k] = d[k]; });
      ["metersPerBall","gramsPerBall","ballCount"].forEach(function(k){ var v = n(d[k]); y[k] = isFinite(v) ? v : 0; });
      put("yarns", y);
    }});
}

function needleList(){
  var ns = live("needles").sort(function(a, b){ return (n(a.mm)||99) - (n(b.mm)||99) || String(a.type).localeCompare(String(b.type)) || (a.lengthCm||0) - (b.lengthCm||0); });
  if(!ns.length) return '<div class="empty"><h2>Noch keine Nadeln</h2><p>Mit deinem Nadelbestand siehst du sofort, ob die 3,5 mm in 80 cm da ist und in welchem Projekt sie gerade steckt.</p>' +
    '<button type="button" class="btn primary" data-act="newneedle">Nadel erfassen</button></div>';
  var inUse = {};
  live("projects").forEach(function(p){ if(p.status !== "done") (p.needleIds||[]).forEach(function(id){ (inUse[id] = inUse[id] || []).push(p.name); }); });
  var groups = [], cur = null;
  ns.forEach(function(x){
    var key = x.type === "seil" ? "Seile" : (isFinite(n(x.mm)) ? fmt(n(x.mm), 2) + " mm" : "ohne Stärke");
    if(!cur || cur.k !== key){ cur = {k:key, items:[], mm:n(x.mm)}; groups.push(cur); }
    cur.items.push(x);
  });
  return '<div class="search">' + ic("search") + '<input id="needleq" type="search" inputmode="decimal" placeholder="Stärke suchen, z. B. 3,5"></div>' +
    '<div id="needlegroups">' + groups.map(function(g){
    var us = usSize(g.mm);
    return '<section class="grp" data-mm="' + (isFinite(g.mm) ? g.mm : "") + '"><span class="eyebrow">' + esc(g.k) + (us ? " · US " + us : "") + '</span><div class="card" style="padding-block:4px">' +
      g.items.map(function(x){
        var u = inUse[x.id];
        return '<button type="button" class="li" data-act="editneedle" data-id="' + x.id + '"><span class="grow"><span class="t">' + esc(ntype(x.type)) + (x.lengthCm ? " · " + x.lengthCm + " cm" : "") + "</span>" +
          '<span class="s" style="display:block">' + esc([x.material, x.brand, x.notes].filter(Boolean).join(" · ") || "—") + "</span>" +
          (u ? '<span class="pill wip" style="margin-top:4px">in ' + esc(u.join(", ")) + "</span>" : "") + "</span>" +
          '<span class="v">' + (x.count > 1 ? x.count + "×" : "") + "</span></button>";
      }).join("") + "</div></section>";
  }).join("") + "</div>";
}
function needleForm(x){
  var isNew = !x;
  x = x || {id:uid(), type:"rund", count:1};
  var body = '<div class="g2">' + fld("Stärke mm", "mm", x.mm, {type:"num", ph:"3,5", attrs:isNew ? "autofocus" : ""}) + sel("Art", "type", x.type, NTYPES) + "</div>" +
    '<div class="g2">' + fld("Länge / Seil cm", "lengthCm", x.lengthCm, {type:"int", ph:"80"}) + fld("Anzahl", "count", x.count || 1, {type:"int"}) + "</div>" +
    '<div class="g2">' + sel("Material", "material", x.material || "", [["", "—"],["Metall","Metall"],["Holz","Holz"],["Bambus","Bambus"],["Carbon","Carbon"],["Kunststoff","Kunststoff"]]) + fld("Marke", "brand", x.brand, {ph:"addi, KnitPro …"}) + "</div>" +
    fld("Notiz", "notes", x.notes, {ph:"z. B. Spitze sehr spitz, gut für Lace"});
  openSheet({title:isNew ? "Nadel erfassen" : "Nadel bearbeiten", body:body, ok:"Sichern", danger:isNew ? null : {label:"Löschen"},
    mount:function(pn){
      var dg = $('[data-sheet="danger"]', pn);
      if(dg) dg.onclick = function(){
        remove("needles", x.id);
        live("projects").forEach(function(p){ if((p.needleIds||[]).indexOf(x.id) >= 0){ p.needleIds = p.needleIds.filter(function(i){ return i !== x.id; }); put("projects", p); } });
        closeSheet(); render(); toast("Nadel entfernt.");
      };
    },
    onOk:function(d){
      var mm = n(d.mm);
      if(d.type !== "seil" && !(mm > 0)) return "Bitte die Nadelstärke in mm eintragen.";
      x.mm = isFinite(mm) ? mm : ""; x.type = d.type; x.lengthCm = int(d.lengthCm) || ""; x.count = Math.max(1, int(d.count) || 1);
      x.material = d.material; x.brand = d.brand; x.notes = d.notes;
      put("needles", x);
    }});
}
function projNeedleForm(p){
  var ns = live("needles").sort(function(a, b){ return (n(a.mm)||99) - (n(b.mm)||99); });
  var body = ns.length ? '<div class="stack-s">' + ns.map(function(x){
    return '<label class="check" style="font-weight:400"><input type="checkbox" name="n_' + x.id + '"' + ((p.needleIds||[]).indexOf(x.id) >= 0 ? " checked" : "") + "> " + esc(needleName(x)) + "</label>";
  }).join("") + "</div>" : '<p class="muted">Im Vorrat sind noch keine Nadeln erfasst.</p>';
  body += fld("Oder als Text", "needleMm", p.needleMm, {ph:"z. B. 4 und 4,5 mm, 80 cm"});
  openSheet({title:"Nadeln im Projekt", body:body, ok:"Sichern", onOk:function(d){
    p.needleIds = ns.filter(function(x){ return d["n_" + x.id]; }).map(function(x){ return x.id; });
    p.needleMm = d.needleMm; put("projects", p);
  }});
}

function swatchList(){
  var ws = live("swatches").sort(function(a, b){ return (b.updatedAt||0) - (a.updatedAt||0); });
  var h = '<p class="muted" style="margin-bottom:12px">Für jede Rechnung zählt die gewaschene und getrocknete Probe. Bei Alpaka, Seide, Viskose und Superwash zusätzlich hängend messen: diese Garne längen sich.</p>';
  if(!ws.length) return h + '<div class="empty"><button type="button" class="btn primary" data-act="newswatch">Maschenprobe erfassen</button></div>';
  return h + '<section class="card" style="padding-block:4px">' + ws.map(function(w){
    var y = (w.yarnId && S.yarns[w.yarnId] && S.yarns[w.yarnId].name) || w.yarnName || "Garn";
    function g(a, b){ return a ? fmt(n(a)) + " × " + (b ? fmt(n(b)) : "?") : null; }
    var main = g(w.stsWashed, w.rowsWashed) || g(w.stsRaw, w.rowsRaw);
    var sub = [w.needleMm ? fmt(n(w.needleMm), 2) + " mm" : "", w.pattern, g(w.stsRaw, w.rowsRaw) && w.stsWashed ? "roh " + g(w.stsRaw, w.rowsRaw) : "", g(w.stsHung, w.rowsHung) ? "hängend " + g(w.stsHung, w.rowsHung) : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="li" data-act="editswatch" data-id="' + w.id + '"><span class="grow"><span class="t">' + esc(y) + "</span>" +
      '<span class="s" style="display:block">' + esc(sub || "—") + "</span></span>" +
      '<span style="text-align:right"><span class="v" style="display:block">' + esc(main || "–") + '</span><span class="s">' + (w.stsWashed ? "gewaschen" : "ungewaschen") + "</span></span></button>";
  }).join("") + "</section>";
}
function swatchForm(w){
  var isNew = !w;
  w = w || {id:uid()};
  var ys = live("yarns");
  var yid = w.yarnId || ((ys.filter(function(y){ return y.name === w.yarnName; })[0]) || {}).id || "";
  var body = sel("Garn", "yarnId", yid, [["", "— ohne —"]].concat(ys.map(function(y){ return [y.id, y.name]; }))) +
    '<div class="g2">' + fld("Nadel mm", "needleMm", w.needleMm, {type:"num"}) + fld("Muster", "pattern", w.pattern, {ph:"glatt rechts"}) + "</div>" +
    '<div class="eyebrow" style="margin-top:4px">Gewaschen und getrocknet · zählt</div><div class="g2">' + fld("M / 10 cm", "stsWashed", w.stsWashed, {type:"num"}) + fld("R / 10 cm", "rowsWashed", w.rowsWashed, {type:"num"}) + "</div>" +
    '<div class="eyebrow" style="margin-top:4px">Ungewaschen</div><div class="g2">' + fld("M / 10 cm", "stsRaw", w.stsRaw, {type:"num"}) + fld("R / 10 cm", "rowsRaw", w.rowsRaw, {type:"num"}) + "</div>" +
    '<div class="eyebrow" style="margin-top:4px">Hängend getrocknet</div><div class="g2">' + fld("M / 10 cm", "stsHung", w.stsHung, {type:"num"}) + fld("R / 10 cm", "rowsHung", w.rowsHung, {type:"num"}) + "</div>" +
    '<div class="g3">' + fld("Gewicht g", "weightG", w.weightG, {type:"num"}) + fld("Breite cm", "widthCm", w.widthCm, {type:"num"}) + fld("Höhe cm", "heightCm", w.heightCm, {type:"num"}) + "</div>" +
    '<p class="hint">Mit Gewicht und Maßen rechnet der Garnbedarf-Rechner am genauesten.</p>' +
    area("Notizen", "notes", w.notes, "", 2);
  openSheet({title:isNew ? "Maschenprobe" : "Maschenprobe bearbeiten", body:body, ok:"Sichern", danger:isNew ? null : {label:"Löschen"},
    mount:function(pn){ var dg = $('[data-sheet="danger"]', pn); if(dg) dg.onclick = function(){ remove("swatches", w.id); closeSheet(); render(); }; },
    onOk:function(d){
      w.yarnId = d.yarnId; w.yarnName = d.yarnId && S.yarns[d.yarnId] ? S.yarns[d.yarnId].name : "";
      w.pattern = d.pattern; w.notes = d.notes;
      ["needleMm","stsWashed","rowsWashed","stsRaw","rowsRaw","stsHung","rowsHung","weightG","widthCm","heightCm"].forEach(function(k){ var v = n(d[k]); w[k] = isFinite(v) ? v : ""; });
      put("swatches", w);
    }});
}

/* =========================================================
   Werkzeug: Rechner, Abkürzungen, Nachschlagen, Daten
   ========================================================= */
function pgTools(){
  var seg = UI.toolSeg;
  var h = '<header class="top"><h1>Werkzeug</h1></header>';
  h += '<div class="seg" style="margin-bottom:14px">' + [["calc","Rechner"],["abbr","Abkürzungen"],["more","Mehr"]].map(function(x){
    return '<button type="button" data-act="toolseg" data-s="' + x[0] + '" class="' + (seg === x[0] ? "on" : "") + '">' + x[1] + "</button>";
  }).join("") + "</div>";
  if(seg === "calc"){ h += calcPage(); afterRender = function(){ ["conv","size","yarn","spread","rap","double","cyc"].forEach(runCalc); }; }
  else if(seg === "abbr") h += abbrPage();
  else h += morePage();
  return h;
}

/* ---------- Rechner ---------- */
function calcCard(id, title, hint, body, open){
  return '<details class="calc" id="c-' + id + '"' + (open ? " open" : "") + '><summary><span class="grow">' + esc(title) + "<em>" + esc(hint) + "</em></span></summary>" +
    '<div class="calcbody">' + body + '<div class="out" id="o-' + id + '">Werte eingeben.</div></div></details>';
}
function nin(id, label, val, ph){
  return '<div><label class="f" for="' + id + '">' + esc(label) + '</label><input id="' + id + '" inputmode="decimal" value="' + esc(val == null ? "" : val) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + "></div>";
}
function calcPage(){
  var ws = live("swatches").filter(function(w){ return w.stsWashed; });
  var pick = ws.length ? '<div><label class="f" for="conv-pick">Deine Probe übernehmen</label><select id="conv-pick"><option value="">— auswählen —</option>' +
    ws.map(function(w){ var y = (w.yarnId && S.yarns[w.yarnId] && S.yarns[w.yarnId].name) || w.yarnName || "Probe";
      return '<option value="' + w.stsWashed + "|" + (w.rowsWashed || "") + '">' + esc(y) + " · " + fmt(n(w.stsWashed)) + " × " + fmt(n(w.rowsWashed)) + "</option>"; }).join("") + "</select></div>" : "";
  var h = "";
  h += calcCard("conv", "Anleitung umrechnen", "andere Maschenprobe",
    '<div class="g2">' + nin("conv-a", "MP Anleitung M/10 cm", 23) + nin("conv-b", "Deine MP M/10 cm", 16) + "</div>" +
    '<div class="g2">' + nin("conv-ra", "R/10 cm Anleitung", 35) + nin("conv-rb", "Deine R/10 cm", 24) + "</div>" + pick +
    '<div><label class="f" for="conv-v">Maschen- oder Reihenzahlen der Anleitung</label><input id="conv-v" value="114 260 316" placeholder="durch Leerzeichen getrennt"></div>' +
    segc("convk", "m", [["m","Maschen"],["r","Reihen"]]), true);
  h += calcCard("size", "Maschen aus Maß", "Breite × Maschenprobe",
    '<div class="g2">' + nin("size-cm", "Zielmaß cm", 121) + nin("size-mp", "MP M/10 cm", 16) + "</div>" + nin("size-rap", "Teilbar durch (optional)", "", "z. B. 4 für 2 re 2 li"));
  h += calcCard("yarn", "Garnbedarf", "in Metern und Knäueln",
    segc("yarnm", "pat", [["pat","Aus Anleitung"],["weigh","Probe wiegen"]]) +
    '<div id="yarn-pat"><div class="g3">' + nin("y-m", "Meter lt. Anl.", 950) + nin("y-a", "MP Anl.", 23) + nin("y-b", "Deine MP", 16) + "</div></div>" +
    '<div id="yarn-weigh" hidden><div class="g3">' + nin("y-pg", "Probe g", 12.4) + nin("y-pw", "Breite cm", 16) + nin("y-ph", "Höhe cm", 18) + "</div>" +
      '<div style="margin-top:10px">' + nin("y-area", "Fläche aller Teile cm²", 7000) + "</div></div>" +
    '<div class="g3">' + nin("y-ll", "m / Knäuel", 110) + nin("y-g", "g / Knäuel", 50) + nin("y-buf", "Reserve %", 10) + "</div>");
  h += calcCard("spread", "Gleichmäßig verteilen", "Zu- und Abnahmen",
    '<div class="g2">' + nin("sp-t", "Maschen auf der Nadel", 96) + nin("sp-n", "Zu- oder Abnahmen", 14) + "</div>" +
    segc("spk", "dec", [["dec","Abnehmen"],["inc","Zunehmen"]]) + segc("spr", "flat", [["flat","Hin und zurück"],["round","In Runden"]]));
  h += calcCard("rap", "Rapport prüfen", "passt die Maschenzahl?",
    '<div class="g3">' + nin("rp-m", "Maschen", 90) + nin("rp-r", "Rapport", 12) + nin("rp-z", "Rand-M", 4) + "</div>" + nin("rp-mp", "MP M/10 cm (optional)", 18));
  h += calcCard("double", "Fäden zusammen", "gemeinsame Lauflänge",
    '<div><label class="f" for="db-v">Lauflängen in m / 100 g</label><input id="db-v" value="400 800" placeholder="durch Leerzeichen getrennt"></div>');
  h += calcCard("cyc", "Garnstärke bestimmen", "aus Lauflänge, WPI oder MP",
    '<div class="g3">' + nin("cy-l", "m / 100 g", 220) + nin("cy-w", "WPI", "", "—") + nin("cy-m", "M / 10 cm", "", "—") + "</div>");
  return h;
}
function segVal(name){ var b = $('[data-seg-name="' + name + '"] button.on'); return b ? b.dataset.v : ""; }
function runCalc(id){
  var o = document.getElementById("o-" + id); if(!o) return;
  function g(x){ return n((document.getElementById(x) || {}).value); }
  try{
    if(id === "conv"){
      var rows = segVal("convk") === "r";
      var a = rows ? g("conv-ra") : g("conv-a"), b = rows ? g("conv-rb") : g("conv-b");
      if(!(a > 0 && b > 0)){ o.textContent = rows ? "Beide Reihen-Maschenproben eintragen." : "Beide Maschenproben eintragen."; return; }
      var f = b / a;
      var vals = (document.getElementById("conv-v").value || "").split(/[\s;]+/).map(n).filter(function(x){ return isFinite(x); });
      var tr = vals.map(function(v){ var ex = v * f;
        return '<tr><td class="n">' + fmt(v) + '</td><td class="n">' + fmt(ex) + '</td><td class="n"><b>' + Math.round(ex) + '</b></td><td class="n">' + Math.round(ex / 2) * 2 + "</td></tr>"; }).join("");
      o.innerHTML = '<span class="big">× ' + fmt(f, 3) + "</span>" +
        (tr ? '<div class="tablewrap"><table><thead><tr><th class="n">Anleitung</th><th class="n">exakt</th><th class="n">gerundet</th><th class="n">gerade</th></tr></thead><tbody>' + tr + "</tbody></table></div>" : "") +
        '<span class="note">' + (rows ? "Längen in der Anleitung lieber in Zentimetern messen als Reihen umrechnen." : "Nach dem Runden Rapport und Symmetrie prüfen. Reihen getrennt mit der Reihen-Maschenprobe rechnen.") + "</span>";
    }
    else if(id === "size"){
      var cm = g("size-cm"), mp = g("size-mp"), rp = g("size-rap");
      if(!(cm > 0 && mp > 0)){ o.textContent = "Zielmaß und Maschenprobe eintragen."; return; }
      var m = cm * mp / 10, out = '<span class="big">' + Math.round(m) + " M</span>exakt " + fmt(m) + " M · gerade " + Math.round(m / 2) * 2 + " M";
      if(rp > 1){ var lo = Math.floor(m / rp) * rp, hi = lo + rp;
        out += "<br>teilbar durch " + rp + ": <b>" + lo + "</b> (" + fmt(lo / mp * 10) + " cm) oder <b>" + hi + "</b> (" + fmt(hi / mp * 10) + " cm)"; }
      o.innerHTML = out + '<span class="note">Hat eine Größe der Anleitung diese Maschenzahl, stricke sie unverändert und miss Längen in Zentimetern.</span>';
    }
    else if(id === "yarn"){
      var mode = segVal("yarnm");
      $("#yarn-pat").hidden = mode !== "pat"; $("#yarn-weigh").hidden = mode !== "weigh";
      var ll = g("y-ll"), gr = g("y-g"), buf = g("y-buf"); if(!isFinite(buf)) buf = 10;
      var meters, grams = null, note;
      if(mode === "pat"){
        var mm = g("y-m"), ma = g("y-a"), mb = g("y-b");
        if(!(mm > 0 && ma > 0 && mb > 0)){ o.textContent = "Meter und beide Maschenproben eintragen."; return; }
        meters = mm * (mb / ma);
        note = "Meter skalieren mit der Maschendichte. Dickeres Garn braucht weniger Meter, meist aber mehr Gramm.";
      } else {
        var pg = g("y-pg"), pw = g("y-pw"), ph = g("y-ph"), ar = g("y-area");
        if(!(pg > 0 && pw > 0 && ph > 0 && ar > 0)){ o.textContent = "Probe wiegen, messen und die Fläche schätzen."; return; }
        grams = pg / (pw * ph) * ar;
        meters = ll > 0 && gr > 0 ? grams * (ll / gr) : NaN;
        note = "Die genaueste Methode, weil sie Muster und deine Strickfestigkeit erfasst. Zöpfe brauchen 20–40 % mehr als glatt rechts.";
      }
      var mb2 = meters * (1 + buf / 100);
      var out2 = '<span class="big">' + (isFinite(mb2) ? fmt(mb2, 0) + " m" : fmt(grams * (1 + buf / 100), 0) + " g") + "</span>" +
        (isFinite(meters) ? "ohne Reserve " + fmt(meters, 0) + " m · Reserve " + fmt(buf) + " %" : "");
      if(ll > 0 && isFinite(mb2)){ var balls = Math.ceil(mb2 / ll); out2 += "<br><b>" + balls + " Knäuel</b>" + (gr > 0 ? " = " + balls * gr + " g" : ""); }
      if(grams !== null && isFinite(meters)) out2 += "<br>Gewicht " + fmt(grams * (1 + buf / 100), 0) + " g inkl. Reserve";
      o.innerHTML = out2 + '<span class="note">' + note + " Alle Knäuel aus derselben Färbepartie kaufen.</span>";
    }
    else if(id === "spread"){
      var t = g("sp-t"), c = g("sp-n"), inc = segVal("spk") === "inc", round = segVal("spr") === "round";
      if(!(t > 0 && c > 0)){ o.textContent = "Maschenzahl und Anzahl eintragen."; return; }
      if(!inc && c * 2 > t){ o.textContent = "Für so viele Abnahmen reichen die Maschen nicht (je Abnahme werden 2 M zusammengestrickt)."; return; }
      var res;
      if(inc){
        var s = spread(t, round ? c : c + 1); if(!s){ o.textContent = "Mehr Zunahmen als Maschen."; return; }
        var seq = round ? s.seq : s.seq;
        var txt = round ? seq.map(function(x){ return x + " M, 1 Zun."; }) : seq.map(function(x, i){ return x + " M" + (i < seq.length - 1 ? ", 1 Zun." : ""); });
        res = '<span class="big">' + (t + c) + " M</span>" + (round ? "In der Runde: " : "In der Reihe: ") + compact(txt) +
          '<span class="note">Zunahmen zum Beispiel als M1L/M1R oder aus dem Querfaden. Die Abstände sind gleichmäßig eingestreut, nicht am Ende angehängt.</span>';
      } else {
        var rest = t - c * 2, s2 = spread(rest, round ? c : c + 1);
        if(!s2){ o.textContent = "Werte prüfen."; return; }
        var txt2 = round ? s2.seq.map(function(x){ return x + " M, 2 zus."; }) : s2.seq.map(function(x, i){ return x + " M" + (i < s2.seq.length - 1 ? ", 2 zus." : ""); });
        res = '<span class="big">' + (t - c) + " M</span>" + (round ? "In der Runde: " : "In der Reihe: ") + compact(txt2) +
          '<span class="note">Bei Reihen liegen an beiden Rändern Maschen ohne Abnahme, damit die Naht sauber bleibt.</span>';
      }
      o.innerHTML = res;
    }
    else if(id === "rap"){
      var M = g("rp-m"), R = g("rp-r"), Z = g("rp-z"); if(!isFinite(Z)) Z = 0;
      if(!(M > 0 && R > 0)){ o.textContent = "Maschenzahl und Rapport eintragen."; return; }
      var lo2 = Math.floor((M - Z) / R) * R + Z, hi2 = lo2 + R, ok = lo2 === M;
      var best = (M - lo2) <= (hi2 - M) ? lo2 : hi2, mp2 = g("rp-mp");
      o.innerHTML = ok ? '<span class="big">' + M + " M passen</span>" + (M - Z) / R + " Rapporte + " + Z + " Rand-M" :
        '<span class="big">' + best + " M</span>kleiner " + lo2 + " (" + (lo2 - Z) / R + " Rapporte, −" + (M - lo2) + ") · größer " + hi2 + " (" + (hi2 - Z) / R + " Rapporte, +" + (hi2 - M) + ")" +
        (mp2 > 0 ? "<br>" + best + " M ergeben " + fmt(best / mp2 * 10) + " cm" : "") +
        '<span class="note">Kleine Abweichungen in den Seitennähten oder einem glatten Streifen unterbringen, statt das Muster zu verzerren.</span>';
    }
    else if(id === "double"){
      var ls = (document.getElementById("db-v").value || "").split(/[\s;+]+/).map(n).filter(function(x){ return x > 0; });
      if(ls.length < 2){ o.textContent = "Mindestens zwei Lauflängen eintragen."; return; }
      var tot = 1 / ls.reduce(function(acc, x){ return acc + 1 / x; }, 0), cat = cycByLength(tot);
      o.innerHTML = '<span class="big">' + fmt(tot, 0) + " m / 100 g</span>" +
        (cat ? "etwa CYC " + cat[0] + " (" + esc(cat[1]) + "), " + cat[4] + "–" + cat[5] + " M / 10 cm, Nadel " + fmt(cat[6], 2) + "–" + fmt(cat[7], 2) + " mm" : "außerhalb der Tabelle") +
        '<span class="note">Gemeinsam geführte Fäden ergeben einen weicheren, luftigeren Stoff als ein Einzelgarn gleicher Stärke. Die Maschenprobe entscheidet.</span>';
    }
    else if(id === "cyc"){
      var hits = [], l = g("cy-l"), w = g("cy-w"), m2 = g("cy-m");
      if(l > 0){ var c1 = cycByLength(l); if(c1) hits.push(["Lauflänge", c1]); }
      if(w > 0){ var c2 = cycBy(8, w); if(c2) hits.push(["WPI", c2]); }
      if(m2 > 0){ var c3 = cycBy(4, m2); if(c3) hits.push(["Maschenprobe", c3]); }
      if(!hits.length){ o.textContent = "Mindestens einen Wert eintragen."; return; }
      o.innerHTML = hits.map(function(x){ var k = x[1];
        return "<div><b>CYC " + k[0] + " · " + esc(k[1]) + '</b> <span class="muted">(aus ' + x[0] + ")</span><br>" +
          (k[3] > 9000 ? "ab " + k[2] : k[2] + "–" + k[3]) + " m / 100 g · " + k[4] + "–" + k[5] + " M / 10 cm · Nadel " + fmt(k[6], 2) + "–" + fmt(k[7], 2) + " mm</div>"; }).join("<br>") +
        '<span class="note">Kategorie und Lauflänge zum Vorsortieren, die Maschenprobe zum Entscheiden.</span>';
    }
  }catch(e){ o.textContent = "Eingaben prüfen."; }
}
function compact(parts){
  var out = [], i = 0;
  while(i < parts.length){ var j = i; while(j + 1 < parts.length && parts[j + 1] === parts[i]) j++;
    var k = j - i + 1; out.push(k > 1 ? "<b>" + k + "×</b> (" + esc(parts[i]) + ")" : esc(parts[i])); i = j + 1; }
  return out.join(" · ");
}

/* ---------- Abkürzungen ---------- */
var ABBR = [
  ["k","knit","rechts (re)",""],
  ["p","purl","links (li)",""],
  ["st, sts","stitch(es)","Masche(n) (M)",""],
  ["RS / WS","right / wrong side","Hinreihe / Rückreihe","Vorder- bzw. Rückseite der Arbeit"],
  ["rnd","round","Runde (Rd)",""],
  ["CO","cast on","anschlagen",""],
  ["BO","bind off","abketten",""],
  ["k2tog","knit 2 together","2 M re zusammenstricken","rechtsgeneigte Abnahme"],
  ["ssk","slip, slip, knit","2 M einzeln wie zum Rechtsstricken abheben, zusammen re verschränkt stricken","linksgeneigte Abnahme"],
  ["skp","slip 1, knit 1, pass over","1 M abheben, 1 M re, die abgehobene überziehen","linksgeneigte Abnahme"],
  ["p2tog","purl 2 together","2 M li zusammenstricken",""],
  ["k3tog","knit 3 together","3 M re zusammenstricken","doppelte Abnahme, rechtsgeneigt"],
  ["sk2p","slip 1, k2tog, pass over","1 M abheben, 2 M re zus., die abgehobene überziehen","doppelte Abnahme, linksgeneigt"],
  ["cdd / s2kp","central double decrease","2 M zusammen wie zum Rechtsstricken abheben, 1 M re, beide überziehen","mittige doppelte Abnahme"],
  ["yo","yarn over","Umschlag (U)",""],
  ["m1l","make 1 left","Querfaden von vorn auffassen und re verschränkt stricken","linksgeneigte Zunahme"],
  ["m1r","make 1 right","Querfaden von hinten auffassen und re stricken","rechtsgeneigte Zunahme"],
  ["m1p","make 1 purlwise","aus dem Querfaden li zunehmen",""],
  ["kfb","knit front and back","1 M re und re verschränkt aus derselben M","Zunahme mit Knötchen"],
  ["LLI / RLI","left / right lifted increase","Zunahme aus der Masche darunter, links- bzw. rechtsgeneigt",""],
  ["tbl","through back loop","verschränkt",""],
  ["sl","slip","abheben","ohne Angabe meist wie zum Linksstricken"],
  ["kwise / pwise","knitwise / purlwise","wie zum Rechts- / Linksstricken",""],
  ["wyib / wyif","with yarn in back / front","Faden hinter / vor der Arbeit",""],
  ["psso","pass slipped stitch over","abgehobene M überziehen",""],
  ["pm / sm / rm","place / slip / remove marker","Markierer setzen / abheben / entfernen",""],
  ["BOR","beginning of round","Rundenbeginn",""],
  ["rep","repeat","wiederholen",""],
  ["* … ; rep from *","","ab * wiederholen",""],
  ["EOR","every other row","jede 2. Reihe",""],
  ["est.","as established","wie eingeteilt weiterstricken",""],
  ["work even","","ohne Zu- und Abnahmen weiterstricken",""],
  ["AT THE SAME TIME","","gleichzeitig","zwei Anweisungen laufen parallel: dafür Erinnerungen anlegen"],
  ["st st","stockinette stitch","glatt rechts",""],
  ["rev st st","reverse stockinette","glatt links",""],
  ["garter st","","kraus rechts",""],
  ["k1, p1 rib","","Bündchen 1 re, 1 li",""],
  ["w&t","wrap and turn","Masche umwickeln und wenden","verkürzte Reihen"],
  ["GSR / DS","German short rows / double stitch","verkürzte Reihen mit Doppelmasche",""],
  ["C4F / C4B","cable 4 front / back","2 M auf die Zopfnadel vor / hinter die Arbeit, 2 M re, dann die M der Zopfnadel re","Zopf nach links / rechts gekreuzt"],
  ["cn","cable needle","Zopfnadel",""],
  ["DPN","double-pointed needles","Nadelspiel",""],
  ["circ","circular needle","Rundstricknadel",""],
  ["LH / RH","left / right hand needle","linke / rechte Nadel",""],
  ["inc / dec","increase / decrease","Zunahme / Abnahme",""],
  ["pu","pick up","Maschen auffassen",""],
  ["MC / CC","main / contrast color","Hauptfarbe / Kontrastfarbe",""],
  ["tog","together","zusammen",""],
  ["foll","following","folgende",""],
  ["approx.","approximately","ungefähr",""],
  ["ease","","Bewegungsweite","Unterschied zwischen Kleidungsstück und Körpermaß"],
  ["gauge","","Maschenprobe",""],
  ["blocking","","Spannen","nass oder mit Dampf in Form bringen"],
  ["lifeline","","Rettungsfaden",""],
  ["frog / tink","","aufribbeln / Masche für Masche zurückstricken",""],
  ["WIP / FO / UFO","work in progress / finished / unfinished object","angefangen / fertig / liegengeblieben",""]
];
function abbrPage(){
  var q = (UI.abbrQ || "").toLowerCase().trim();
  var list = ABBR.filter(function(a){ return !q || a.join(" ").toLowerCase().indexOf(q) >= 0; });
  return '<div class="search">' + ic("search") + '<input id="abbrq" type="search" placeholder="z. B. ssk, Umschlag, verkürzte" value="' + esc(UI.abbrQ) + '" autocomplete="off"></div>' +
    '<p class="muted" style="margin-bottom:10px">Englisch – Deutsch, wie sie in Anleitungen stehen.</p>' +
    '<section class="card" style="padding-block:4px">' + (list.length ? list.map(function(a){
      return '<div class="abbr"><b>' + esc(a[0]) + '</b><span><span class="de">' + esc(a[2]) + "</span>" + (a[1] ? ' <span class="en">' + esc(a[1]) + "</span>" : "") + "</span>" +
        (a[3] ? '<span class="x">' + esc(a[3]) + "</span>" : "") + "</div>";
    }).join("") : '<p class="muted" style="padding:12px 0">Nichts gefunden.</p>') + "</section>";
}

/* ---------- Mehr ---------- */
var LINKS = [
  ["Ravelry", "ravelry.com", "Anleitungen und vor allem die Garndatenbank mit Projekten anderer"],
  ["DROPS Design", "garnstudio.com", "über 10.000 kostenlose Anleitungen auf Deutsch, mit Technikvideos"],
  ["YarnSub", "yarnsub.com", "Ersatzgarn finden, mit Vergleich von Faser und Lauflänge"],
  ["maschentext", "maschentext.de", "Strickwörterbuch Englisch–Deutsch und Lexikon"],
  ["nadelspiel", "nadelspiel.com", "die große deutschsprachige Sammlung von Technikvideos"],
  ["VeryPink Knits", "verypinkknits.com", "ruhige, genaue Videos für knifflige Techniken"],
  ["TECHknitting", "techknitting.blogspot.com", "Kanten, Maschenstich, unsichtbare Verbindungen"],
  ["Craft Yarn Council", "craftyarncouncil.com", "Garnstärken, Maschenproben und Körpermaße"]
];
function morePage(){
  var h = "";
  /* Konto */
  h += '<section class="card"><div class="sec-h"><span class="eyebrow">Konto und Abgleich</span>' + syncBadge() + "</div>";
  if(!cloudConfigured()) h += '<p class="muted">Der Abgleich zwischen Geräten ist für diese Installation nicht eingerichtet. Alles bleibt auf diesem Gerät.</p>';
  else if(CL.user) h += '<p class="muted" style="color:var(--ink-2)">Angemeldet als <b>' + esc(CL.user.email || "") + "</b>. Deine Projekte sind auf allen Geräten gleich, auf denen du angemeldet bist.</p>" +
    '<button type="button" class="btn sm" data-act="account" style="margin-top:10px">Konto verwalten</button>';
  else h += '<p class="muted" style="color:var(--ink-2)">Mit einem Konto hast du deine Projekte auf Handy, Tablet und Notebook. Ohne Konto bleibt alles auf diesem Gerät.</p>' +
    '<div class="wrap" style="margin-top:10px"><button type="button" class="btn sm primary" data-act="account">Anmelden oder Konto anlegen</button></div>';
  h += "</section>";
  h += installCard(false);
  h += '<section class="card"><span class="eyebrow">Einstellungen auf diesem Gerät</span><div class="stack-s" style="margin-top:8px">' +
    '<label class="check"><input type="checkbox" id="pref-haptic"' + (PREF.haptic ? " checked" : "") + "> Vibration beim Zählen</label>" +
    '<label class="check"><input type="checkbox" id="pref-wake"' + (PREF.wake ? " checked" : "") + "> Bildschirm im Strickmodus anlassen</label></div></section>";
  h += '<section class="card"><span class="eyebrow">Daten</span><dl class="kv" style="margin-top:8px">' +
    "<dt>Bestand</dt><dd>" + live("projects").length + " Projekte · " + live("patterns").length + " Anleitungen · " + live("yarns").length + " Garne · " + live("needles").length + " Nadeln</dd>" +
    (usage ? "<dt>Dateien auf dem Gerät</dt><dd>" + usage.files + " · " + kb(usage.bytes) + (CL.user && usage.unsynced ? " · " + usage.unsynced + " noch nicht hochgeladen" : "") + "</dd>" : "") +
    '</dl><div class="wrap" style="margin-top:12px"><button type="button" class="btn sm" data-act="backup">Sicherung herunterladen</button>' +
    '<button type="button" class="btn sm" data-act="restore">Sicherung einspielen</button></div>' +
    '<p class="hint" style="margin-top:8px">Die Sicherung enthält alle Einträge als JSON-Datei, aber keine PDFs und Fotos.</p></section>';
  h += '<section class="card"><span class="eyebrow">Nachschlagen</span><div style="margin-top:4px">' + LINKS.map(function(l){
    return '<a class="lnk" href="https://' + l[1] + '" target="_blank" rel="noopener noreferrer"><b>' + esc(l[0]) + "</b><span>" + esc(l[2]) + "</span></a>";
  }).join("") + "</div></section>";
  h += '<section class="card"><span class="eyebrow">Beispiel</span><p class="muted" style="margin:6px 0 10px">Ein ausgefülltes Projekt mit Teilen, Erinnerungen und Größenfilter, zum Ausprobieren.</p>' +
    '<button type="button" class="btn sm" data-act="example">Beispielprojekt anlegen</button></section>';
  h += '<p class="muted small" style="text-align:center;margin-top:18px">Maschenwerk ' + esc(APP_VERSION) + (CFG.operator ? " · bereitgestellt von " + esc(CFG.operator) : "") +
    ' · <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutz</a></p>';
  afterRender = function(){
    FILES.list().then(function(r){
      var ch = !usage || usage.files !== r.usage.files || usage.unsynced !== r.usage.unsynced;
      usage = r.usage;
      if(ch && UI.tab === "tools" && UI.toolSeg === "more" && !UI.stack.length && !sheetCtx) render();
    }, function(){});
  };
  return h;
}
function doBackup(){
  var o = {app:"Maschenwerk", version:2, exportedAt:new Date().toISOString()};
  KINDS.forEach(function(k){ o[k] = live(k); });
  var d = new Date(), nm = "maschenwerk-sicherung-" + d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0") + ".json";
  saveFile(nm, JSON.stringify(o, null, 1), "Sicherung gespeichert.");
}
function doRestore(){
  pickFile(".json,application/json", function(f){
    var r = new FileReader();
    r.onload = function(){
      var o; try{ o = JSON.parse(r.result); }catch(e){ toast("Die Datei ist keine Maschenwerk-Sicherung."); return; }
      if(!o || o.app !== "Maschenwerk"){ toast("Die Datei ist keine Maschenwerk-Sicherung."); return; }
      var cnt = 0;
      KINDS.forEach(function(k){
        (o[k] || []).forEach(function(x){
          if(!x || !x.id) return;
          var l = S[k][x.id];
          if(!l || (x.updatedAt||0) > (l.updatedAt||0)){ if(k === "projects") normProject(x); S[k][x.id] = x; saveLocalSoon(); pushSoon(k, x.id, 400 + cnt * 120); cnt++; }
        });
      });
      render(); toast(cnt ? cnt + " Einträge übernommen." : "Alles war schon aktuell.");
    };
    r.readAsText(f);
  });
}

/* ---------- Beispiel ---------- */
function makeExample(){
  var pt = {id:uid(), title:"Beispiel: Raglan von oben", designer:"Maschenwerk", language:"deutsch", needleMm:4, gaugeSts:22, gaugeRows:30,
    yarnWeight:"DK", meters:1100, sizes:"Pullover, Gr. S–XL",
    text:"BEISPIEL-ANLEITUNG\n\nHalsausschnitt\nSchlage 96 (100) 104 (108) M an und schließe zur Runde.\nStricke 6 (6) 7 (7) cm im Bündchenmuster 2 re, 2 li.\n\nPasse\nSetze 4 Markierer für die Raglanlinien.\nZunahmerunde: vor und nach jedem Markierer 1 M zunehmen (+8 M).\nDie Zunahmerunde in jeder 2. Runde insgesamt 26 (28) 30 (32) mal arbeiten.\nNun liegen 304 (324) 344 (364) M auf der Nadel.\n\nRumpf\nÄrmelmaschen stilllegen, 4 (6) 8 (10) M unter dem Arm anschlagen.\nGerade bis 32 (33) 34 (35) cm ab Achsel stricken.\n\nÄrmel\nAbnahmerunde: 1 M nach dem Rundenbeginn und 2 M davor abnehmen (−2 M).\nAbnahmerunde alle 8 (8) 7 (7) Runden insgesamt 9 (10) 11 (12) mal.",
    sizeIndex:1};
  put("patterns", pt);
  var rump = {id:uid(), name:"Passe", unit:"Runde", row:23, target:56, startSts:100, done:false};
  var body = {id:uid(), name:"Rumpf", unit:"Runde", row:1, target:96, startSts:0, done:false};
  var sl = {id:uid(), name:"Ärmel 1", unit:"Runde", row:1, target:120, startSts:70, done:false};
  var p = normProject({id:uid(), name:"Beispiel: Raglan in Petrol", patternId:pt.id, patternName:pt.title, size:"M", sizeIndex:1, status:"wip",
    gaugeSts:22, gaugeRows:30, needleMm:"4 mm, 80 cm", startedAt:now() - 9*864e5, lastKnitAt:now() - 864e5, timeMs:4.2*36e5,
    sections:[rump, body, sl], activeSection:rump.id,
    reminders:[
      {id:uid(), text:"Raglan-Zunahmen", kind:"repeat", sectionId:rump.id, from:2, every:2, times:28, delta:8},
      {id:uid(), text:"Markierer für die Raglanlinien setzen", kind:"once", sectionId:rump.id, from:1, every:0, times:1, delta:0},
      {id:uid(), text:"Ärmel-Abnahme", kind:"repeat", sectionId:sl.id, from:10, every:8, times:10, delta:-2}
    ],
    counters:[{id:uid(), name:"Rippen 2 re, 2 li", kind:"repeat", len:4, start:1, sectionId:rump.id}],
    notes:"Beispielprojekt. Halsbündchen 1 cm kürzer gestrickt als angegeben.",
    log:[{t:now() - 864e5, text:"Bündchen fertig, Markierer gesetzt.", where:"Passe · Rd 8"}]});
  put("projects", p);
  UI.tab = "home"; UI.stack = [{v:"project", id:p.id}]; render(); window.scrollTo(0, 0);
  toast("Beispielprojekt angelegt. Du kannst es jederzeit löschen.");
}

/* =========================================================
   Ereignisse
   ========================================================= */
$("#tabs").addEventListener("click", function(e){
  var b = e.target.closest("[data-tab]"); if(!b) return;
  if(UI.tab === b.dataset.tab && !UI.stack.length){ window.scrollTo(0, 0); return; }
  UI.tab = b.dataset.tab; UI.stack = []; saveLocalSoon(); render(); window.scrollTo(0, 0);
});
$("#sheet").addEventListener("click", function(e){
  var b = e.target.closest("[data-sheet]"); if(!b) return;
  var a = b.dataset.sheet;
  if(a === "close") closeSheet();
  else if(a === "ok") sheetOk();
  else if(a === "danger" && sheetCtx && sheetCtx.danger && sheetCtx.danger.fn){ var f = sheetCtx.danger.fn; closeSheet(); f(); }
});
$("#sheet").addEventListener("click", function(e){
  var b = e.target.closest("[data-seg-name] button"); if(!b) return;
  $$("button", b.parentNode).forEach(function(x){ x.classList.toggle("on", x === b); });
});
$("#sheet").addEventListener("keydown", function(e){
  if(e.key === "Escape"){ e.preventDefault(); closeSheet(); }
  else if(e.key === "Enter" && e.target.tagName === "INPUT"){ e.preventDefault(); if(sheetCtx && sheetCtx.ok) sheetOk(); }
});
$("#sheet").addEventListener("submit", function(e){ e.preventDefault(); });

$("#main").addEventListener("click", function(e){
  var el = e.target.closest("[data-act]"); if(!el) return;
  var a = el.dataset.act, id = el.dataset.id, p = id ? S.projects[id] : null;
  if(el.tagName === "A") e.preventDefault();
  switch(a){
    case "back": goBack(); break;
    case "newproj": projForm(null); break;
    case "example": makeExample(); break;
    case "showdone": UI.showDone = true; render(); break;
    case "openproj": UI.stack.push({v:"project", id:id}); render(); window.scrollTo(0, 0); break;
    case "work": openWork(id); break;
    case "projmenu": if(p) projMenu(p); break;
    case "status": if(p) statusSheet(p); break;
    case "editproj": if(p) projForm(p); break;
    case "addsec": if(p) secForm(p); break;
    case "editsec": if(p) secForm(p, secById(p, el.dataset.s)); break;
    case "addrem": if(p) remForm(p); break;
    case "editrem": if(p) remForm(p, p.reminders.filter(function(r){ return r.id === el.dataset.r; })[0]); break;
    case "addctr": if(p) ctrForm(p); break;
    case "editctr": if(p) ctrForm(p, p.counters.filter(function(c){ return c.id === el.dataset.c; })[0]); break;
    case "ctrinc": case "ctrdec":
      if(p){ var c = p.counters.filter(function(x){ return x.id === el.dataset.c; })[0];
        if(c){ c.value = Math.max(0, int(c.value) + (a === "ctrinc" ? 1 : -1)); put("projects", p, 1200); render(); } }
      break;
    case "addyarn": if(p) yarnUseForm(p, null); break;
    case "edityuse": if(p) yarnUseForm(p, el.dataset.y); break;
    case "bookyarn": if(p) bookYarn(p); break;
    case "projneedles": if(p) projNeedleForm(p); break;
    case "editnotes": if(p) notesForm(p); break;
    case "addlog": if(p) logForm(p); break;
    case "openlog": go({v:"projlog", id:id}); break;
    case "addphoto": if(p) addPhoto(p); break;
    case "photo": if(p) photoSheet(p, el.dataset.a); break;
    /* Anleitungen */
    case "newpat": newPatternMenu(); break;
    case "libf": UI.libF = el.dataset.f; render(); break;
    case "openpat": UI.stack.push({v:"pattern", id:id}); render(); window.scrollTo(0, 0); break;
    case "patmenu": if(S.patterns[id]) patMenu(S.patterns[id]); break;
    case "editpat": if(S.patterns[id]) patForm(S.patterns[id]); break;
    case "pattext": if(S.patterns[id]) patTextForm(S.patterns[id]); break;
    case "patupload": if(S.patterns[id]) pickFile(".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,image/*,application/pdf", function(f){ uploadPattern(S.patterns[id], f); }); break;
    case "projfrompat": if(S.patterns[id]) projFromPattern(S.patterns[id]); break;
    case "patsize":
      var pt = S.patterns[id];
      if(pt){ pt.sizeIndex = int(el.dataset.i); put("patterns", pt);
        $$('[data-act="patsize"]').forEach(function(b){ b.classList.toggle("on", b === el); });
        if(libViewer) libViewer.setSize(pt.sizeIndex); }
      break;
    /* Vorrat */
    case "stockseg": UI.stockSeg = el.dataset.s; render(); break;
    case "newyarn": yarnForm(null); break;
    case "edityarn": yarnForm(S.yarns[id]); break;
    case "newneedle": needleForm(null); break;
    case "editneedle": needleForm(S.needles[id]); break;
    case "newswatch": swatchForm(null); break;
    case "editswatch": swatchForm(S.swatches[id]); break;
    /* Werkzeug */
    case "toolseg": UI.toolSeg = el.dataset.s; render(); break;
    case "backup": doBackup(); break;
    case "restore": doRestore(); break;
    /* Konto und App */
    case "account": accountSheet(); break;
    case "install": doInstall(); break;
    case "noinstall": PREF.noInstallHint = true; savePrefs(); render(); break;
    case "noaccthint": PREF.noAcctHint = true; savePrefs(); render(); break;
  }
});
$("#main").addEventListener("click", function(e){
  var b = e.target.closest("details.calc [data-seg-name] button"); if(!b) return;
  $$("button", b.parentNode).forEach(function(x){ x.classList.toggle("on", x === b); });
  runCalc(b.closest("details.calc").id.slice(2));
});
$("#main").addEventListener("input", function(e){
  var t = e.target;
  if(t.id === "libq"){ UI.libQ = t.value; render(); return; }
  if(t.id === "abbrq"){ UI.abbrQ = t.value; render(); return; }
  if(t.id === "needleq"){
    var q = n(t.value);
    $$("#needlegroups .grp").forEach(function(g){ var mm = n(g.dataset.mm); g.hidden = isFinite(q) && !(Math.abs(mm - q) < .01); });
    return;
  }
  var d = t.closest("details.calc"); if(d) runCalc(d.id.slice(2));
});
$("#main").addEventListener("change", function(e){
  var t = e.target;
  if(t.id === "conv-pick" && t.value){
    var parts = t.value.split("|");
    $("#conv-b").value = String(parts[0]).replace(".", ",");
    if(parts[1]) $("#conv-rb").value = String(parts[1]).replace(".", ",");
    runCalc("conv");
  }
  if(t.id === "pref-haptic"){ PREF.haptic = t.checked; savePrefs(); if(t.checked) haptic(15); }
  if(t.id === "pref-wake"){ PREF.wake = t.checked; savePrefs(); }
});
$("#main").addEventListener("toggle", function(e){
  var d = e.target; if(d && d.matches && d.matches("details.calc") && d.open) runCalc(d.id.slice(2));
}, true);

/* =========================================================
   Start
   ========================================================= */
buildTabs();
loadLocal();
render();
cloudInit();
registerSW();
refreshUsage();
/* Startbildschirm-Kurzbefehl „Weiterstricken“ */
if(/[?&]weiter\b/.test(location.search)){
  var last = live("projects").filter(function(p){ return p.status === "wip"; }).sort(byRecent)[0];
  if(last) openWork(last.id);
  try{ history.replaceState(null, "", location.pathname); }catch(e){}
}
})();
