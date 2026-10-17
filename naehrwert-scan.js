/* NährWert – Barcode-Scan und Nährwerte aus der Zutatenliste
   Wird nach dem Hauptskript geladen (defer) und ersetzt bzw. erweitert dort
   definierte Funktionen: openScanner, onCode, startLive, liveEstimate,
   withEstimate, renderAltHint, confirmAdd.

   1. Scanner: alle gängigen Strichcodes (EAN/UPC, Code 128, ITF, GS1-QR- und
      DataMatrix-Codes), Prüfziffer-Kontrolle, Taschenlampe und Foto-Scan.
   2. Unbekannte Barcodes: einmal über den Namen zuordnen – die App merkt sich
      den Barcode (nw1.codeMap) und erkennt ihn beim nächsten Scan sofort.
   3. Produkte mit lückenhaften Angaben (z. B. Bowls): jede Zutat der Zutatenliste
      wird im BLS bzw. der Schweizer Nährwertdatenbank gesucht und mit ihrem Anteil
      verrechnet. Daraus kommen fehlende Makros und Vitamine/Mineralstoffe. */
(function(){
"use strict";
if(typeof onCode !== "function" || typeof withEstimate !== "function") return;   // Hauptskript fehlt

/* ---------- Barcodes lesen ---------- */
// GTIN aus allem herausholen, was ein Scanner liefert: Ziffern, GS1-Klammerformat,
// GS1-DataMatrix (FNC1) oder GS1 Digital Link (QR-Code mit …/01/04012345678901)
function gtinFrom(raw){
  const s = String(raw || "").trim();
  const m = s.match(/\/01\/(\d{8,14})(?!\d)/) || s.match(/^\(01\)(\d{14})/) || s.replace(/[\x1d\s]/g, "").match(/^\]?[A-Za-z]?\d?01(\d{14})/);
  let d = m ? m[1] : (/^\d[\d\s-]*$/.test(s) ? s.replace(/\D/g, "") : "");
  if(d.length === 14 && d[0] === "0") d = d.slice(1);
  return d;
}
function validGtin(d){
  if(!/^(\d{8}|\d{12,14})$/.test(d)) return false;
  let sum = 0;
  for(let i = d.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += +d[i] * w;
  return (10 - sum % 10) % 10 === +d[d.length - 1];
}
// Gewichts-/Preis-Codes aus der Frischetheke (20…29): Preis/Gewicht steckt im Code –
// gemerkt wird nur der Artikelteil
function mapKey(code){ code = code.replace(/^0+(?=\d{8})/, ""); return code.length === 13 && code[0] === "2" ? code.slice(0, 7) : code; }

/* ---------- Gemerkte Zuordnungen Barcode → Lebensmittel ---------- */
let codeMap = sget("codeMap", {});
const SNAP_KEYS = ["id","name","isDrink","per100","portions","cf","src","isProduct","isBLS","isCH","isFDC","labelMicros","missing","code","brand","blsGroup"];
function snapshot(it){
  const o = {};
  SNAP_KEYS.forEach(k => { if(it[k] !== undefined) o[k] = it[k]; });
  return o;
}
function codeMapGet(code){
  const s = codeMap[mapKey(code)];
  if(!s) return null;
  const fresh = !s.isProduct && findItemByName(s.name);   // BLS/Schweiz: aktuelle Werte verwenden
  return fresh || Object.assign({}, s, {portions: (s.portions || []).map(p => p.slice()), _mapped: true});
}
function codeMapSet(code, it){
  const raw = it.raw || it;
  codeMap[mapKey(code)] = snapshot(raw.isProduct ? Object.assign({}, raw, {code: raw.code || code}) : raw);
  sset("codeMap", codeMap);
}

/* ---------- Scanner ---------- */
const WANT = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","code_93","itf","codabar","qr_code","data_matrix"];
let lastRead = "", lastReadN = 0;
function handleRead(raw){
  const d = gtinFrom(raw);
  if(!validGtin(d)) return false;
  // EAN-8/UPC-E sind kurz und anfälliger – zweimal gleich gelesen verlangen
  if(d.length === 8){ if(d !== lastRead){ lastRead = d; lastReadN = 1; return false; } if(++lastReadN < 2) return false; }
  lastRead = "";
  onCode(d);
  return true;
}
function scanTools(){
  let box = $("#scanTools");
  if(!box){
    $("#scanStatus").insertAdjacentHTML("afterend",
      '<div class="rowbtns" id="scanTools" style="margin:0 0 12px">' +
      '<button class="ghost" id="btnTorch" style="display:none">Licht an</button>' +
      '<label class="ghost" id="btnPhoto" style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer">Foto vom Barcode' +
      '<input type="file" accept="image/*" capture="environment" id="scanPhoto" style="display:none"></label></div>' +
      '<div id="scanUnknown"></div>');
    $("#scanPhoto").addEventListener("change", ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if(f) decodePhoto(f); });
    $("#btnTorch").addEventListener("click", toggleTorch);
    box = $("#scanTools");
  }
  $("#btnTorch").style.display = "none"; $("#btnTorch").textContent = "Licht an";
  $("#scanUnknown").innerHTML = "";
  return box;
}
let torchOn = false;
function toggleTorch(){
  const tr = scanStream && scanStream.getVideoTracks()[0];
  if(!tr) return;
  torchOn = !torchOn;
  tr.applyConstraints({advanced: [{torch: torchOn}]}).catch(() => {});
  $("#btnTorch").textContent = torchOn ? "Licht aus" : "Licht an";
}
async function zxing(){
  if(!window.ZXing) await loadScript("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js");
  return window.ZXing;
}
function zxHints(Z){
  const F = Z.BarcodeFormat, hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  return hints;
}
async function detector(){
  if(!("BarcodeDetector" in window)) return null;
  try{
    const sup = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : WANT;
    const formats = WANT.filter(f => sup.indexOf(f) >= 0);
    return formats.length ? new BarcodeDetector({formats}) : null;
  }catch(e){ return null; }
}
/* Foto vom Barcode: schärfer als das Videobild, hilft bei kleinen, gewölbten oder spiegelnden Codes */
async function decodePhoto(file){
  $("#scanStatus").textContent = "Foto wird ausgewertet …";
  scanBusy = false;
  try{
    const det = await detector();
    if(det){
      const bmp = await createImageBitmap(file);
      const r = await det.detect(bmp);
      for(const x of r) if(handleRead(x.rawValue)) return;
    }
    const Z = await zxing();
    const url = URL.createObjectURL(file);
    try{
      const res = await new Z.BrowserMultiFormatReader(zxHints(Z)).decodeFromImageUrl(url);
      if(res && handleRead(res.getText())) return;
    } finally { URL.revokeObjectURL(url); }
  }catch(e){}
  $("#scanStatus").textContent = "Im Foto wurde kein Barcode erkannt. Fotografiere ihn möglichst gerade und formatfüllend – oder tippe die Nummer ein.";
}
openScanner = async function(){
  $$(".sheet").forEach(x => x.classList.remove("open"));
  openSheet("scanSheet");
  scanBusy = false; torchOn = false; lastRead = "";
  scanTools();
  $("#codeInput").value = "";
  $("#scanBox").style.display = "";
  $("#scanStatus").textContent = "Kamera wird gestartet …";
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    $("#scanBox").style.display = "none";
    $("#scanStatus").textContent = "Die Kamera ist hier nicht verfügbar. Mach ein Foto vom Barcode oder tippe die Nummer ein.";
    return;
  }
  try{
    scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment", width:{ideal:1920}, height:{ideal:1080}}, audio:false});
  }catch(err){
    $("#scanBox").style.display = "none";
    $("#scanStatus").textContent = "Kein Kamerazugriff (" + (err && err.name === "NotAllowedError" ? "nicht erlaubt" : "nicht verfügbar") + "). Mach ein Foto vom Barcode oder tippe die Nummer ein.";
    return;
  }
  if(!$("#scanSheet").classList.contains("open")){ stopScanner(); return; }
  const tr = scanStream.getVideoTracks()[0];
  try{
    const cap = tr.getCapabilities ? tr.getCapabilities() : {};
    if(cap.focusMode && cap.focusMode.indexOf("continuous") >= 0) tr.applyConstraints({advanced: [{focusMode: "continuous"}]}).catch(() => {});
    if(cap.torch) $("#btnTorch").style.display = "";
  }catch(e){}
  const v = $("#scanVideo");
  v.srcObject = scanStream;
  try{ await v.play(); }catch(e){}
  $("#scanStatus").textContent = "Halte den Strichcode in den Rahmen – etwa 10 bis 20 cm Abstand.";
  const det = await detector();
  if(det){
    const tick = async () => {
      if(!scanStream || scanBusy) return;
      try{ const r = await det.detect(v); for(const x of r) if(handleRead(x.rawValue)) return; }catch(e){}
      scanLoop = setTimeout(tick, 200);
    };
    tick();
    return;
  }
  try{
    const Z = await zxing();
    if(!scanStream) return;
    zxReader = new Z.BrowserMultiFormatReader(zxHints(Z), 250);
    zxReader.decodeFromStream(scanStream, v, res => { if(res && !scanBusy) handleRead(res.getText()); });
  }catch(e){
    $("#scanStatus").textContent = "Live-Scanner konnte nicht geladen werden. Mach ein Foto vom Barcode oder tippe die Nummer ein.";
  }
};

/* ---------- Produkt aus Open Food Facts – auch mit lückenhaften Nährwerten ---------- */
const OFF_MACRO = {kcal:"energy-kcal_100g", p:"proteins_100g", c:"carbohydrates_100g", z:"sugars_100g", f:"fat_100g", sf:"saturated-fat_100g", b:"fiber_100g"};
function nval(nu, k){ const v = nu[k]; return v == null || v === "" || isNaN(+v) ? null : +v; }
function offKcal(nu){
  const k = nval(nu, "energy-kcal_100g");
  if(k != null) return k;
  const kj = nval(nu, "energy-kj_100g") != null ? nval(nu, "energy-kj_100g") : nval(nu, "energy_100g");
  return kj != null ? kj / 4.184 : null;
}
function isWater(pr){ return (pr.categories_tags || []).some(t => /^en:([a-z-]*-)?waters$/.test(t)); }
/* Welche Makros fehlen auf dem Etikett? */
function missingMacros(pr){
  const nu = pr.nutriments || {};
  if(isWater(pr)) return [];
  return Object.keys(OFF_MACRO).filter(k => k === "kcal" ? offKcal(nu) == null : nval(nu, OFF_MACRO[k]) == null);
}
function offToItem(pr, code){
  const nu = pr.nutriments || {}, water = isWater(pr);
  const per100 = {};
  Object.keys(OFF_MACRO).forEach(k => { const v = k === "kcal" ? offKcal(nu) : nval(nu, OFF_MACRO[k]); per100[k] = v ? Math.round(v * 10) / 10 : 0; });
  per100.kcal = Math.round(per100.kcal);
  MICROS.forEach(([k]) => per100[k] = 0);
  const na = nval(nu, "sodium_100g"), salt = nval(nu, "salt_100g");
  per100.natrium = na != null ? na * 1000 : salt != null ? salt * 400 : 0;
  const lm = offMicros(nu, per100);
  const tags = pr.categories_tags || [];
  const drink = water || (typeof offIsDrink === "function" ? offIsDrink(tags) : tags.some(t => t === "en:beverages" || t === "en:drinks" || t === "en:waters"));
  const nm = pr.product_name_de || pr.product_name || pr.generic_name_de || pr.generic_name || ("Produkt " + code);
  const portions = [];
  const sq = +pr.serving_quantity, pq = +pr.product_quantity;
  if(sq > 0 && sq < 2000) portions.push([drink ? "1 Portion (" + Math.round(sq) + " ml)" : "1 Portion laut Packung", Math.round(sq)]);
  if(pq > 0 && pq <= (drink ? 2000 : 1000) && Math.round(pq) !== Math.round(sq)) portions.push([drink ? "1 Flasche/Packung" : "ganze Packung", Math.round(pq)]);
  const mm = missingMacros(pr);
  return {id:"O" + code, code, name: nm + (pr.brands ? " (" + pr.brands.split(",")[0].trim() + ")" : ""), isDrink: drink, per100, portions,
    cf: 0, src: "Open Food Facts", isProduct: true, missing: [], labelMicros: lm, noNutrition: mm.length >= 6};
}

/* ---------- Unbekannter Barcode: über den Namen zuordnen ---------- */
function linkByName(code, nameHint){
  closeSheets();
  openAdd(guessMeal());
  addCtx.pendingCode = code;
  if(nameHint){ $("#searchInput").value = nameHint; doSearch(nameHint); }
  $("#apiStatus").textContent = "Wähle das passende Lebensmittel – der Barcode " + code + " wird damit verknüpft.";
}
function showUnknown(code, offline){
  if(!$("#scanUnknown")) scanTools();
  if(!$("#scanSheet").classList.contains("open")) openSheet("scanSheet");
  $("#scanStatus").textContent = offline
    ? "Barcode " + code + " ist nicht im mitgelieferten Bestand, und online ist gerade keine Suche möglich."
    : "Barcode " + code + " ist in keiner Datenbank (auch nicht bei Open Food Facts).";
  $("#scanUnknown").innerHTML =
    '<div class="nodata althint" style="margin-bottom:12px">Ordne ihn einmal über den Namen zu, z. B. „Mineralwasser“ oder „Lachs“. Die App merkt sich den Barcode und erkennt ihn beim nächsten Scan sofort.' +
    '<br><button class="chip" id="btnLinkName">Über den Namen zuordnen</button> <button class="chip" id="btnRescan">Nochmal scannen</button></div>';
  $("#btnLinkName").onclick = () => linkByName(code);
  $("#btnRescan").onclick = () => openScanner();
  // Hersteller-Vorschläge und „Etikett eintragen“ (naehrwert-etikett.js)
  if(window.NW_ETIKETT) try{ NW_ETIKETT.unknownHook(code); }catch(e){}
}
// Zuordnung verfällt, wenn der Hinzufügen-Dialog ohne Eintrag geschlossen wird
new MutationObserver(() => { if(!$("#addSheet").classList.contains("open") && addCtx.pendingCode) addCtx.pendingCode = null; })
  .observe($("#addSheet"), {attributes: true, attributeFilter: ["class"]});

onCode = async function(raw){
  const code = gtinFrom(raw);
  if(!code || code.length < 6 || scanBusy) return;
  scanBusy = true;
  stopScanner();
  try{ if(navigator.vibrate) navigator.vibrate(60); }catch(e){}
  if($("#scanUnknown")) $("#scanUnknown").innerHTML = "";
  $("#scanStatus").textContent = "Barcode " + code + " – suche …";
  let it = codeMapGet(code) || productByCode(code), offline = false;
  if(!it){
    // 13-stellig mit führender 0 = UPC-A; beide Schreibweisen probieren
    const alts = [code];
    if(code.length === 13 && code[0] === "0") alts.push(code.slice(1));
    if(code.length === 12) alts.push("0" + code);
    for(const c of alts){
      try{ const pr = await offProduct(c, 9000); if(pr){ it = offToItem(pr, c); break; } }
      catch(e){ offline = true; }
    }
  }
  scanBusy = false;
  if(!it){ showUnknown(code, offline); return; }
  closeSheets();
  openSheet("addSheet");
  pickItem(it);
};

/* ---------- Nährwerte aus der Zutatenliste berechnen ---------- */
const ZERO_ING = /^(wasser|trinkwasser|mineralwasser|quellwasser|salz|speisesalz|meersalz|jodsalz|kochsalz|water|salt|sea salt|eis)$/;
const COOK_ING = /^(buchweizen|dinkel|reis|basmati|jasmin|sushireis|vollkornreis|wildreis|nudel|teigwaren|pasta|spaghetti|quinoa|bulgur|couscous|linse|bohne|kichererbse|kartoffel|hirse|graupen|gerste|edamame|soba|udon|glasnudel|reisnudel|mie)/;
const COOKED = /\b(gegart|gekocht|zubereitet|gedunstet|gedampft|abgetropft|konserve)\b/;
const DRY = /\b(pulver|getrocknet|trocken|konzentrat|extrakt|instant|flocken|grie(ss|s)|mehl|roh, trocken)\b/;
// Eigenschaftswörter sind keine Lebensmittel: „Lachs gekocht“ → „Lachs“, „natives Olivenöl extra“ → „Olivenöl“
const ING_STOP = new Set("gekocht,gekochte,gekochter,gegart,gegarte,roh,rohe,roher,frisch,frische,frischer,rehydriert,rehydrierte,nativ,natives,native,extra,rot,rote,roter,rotes,weiss,weisse,weisser,weisses,schwarz,schwarzer,schwarze,grun,grune,gruner,gelb,gelbe,getrocknet,getrocknete,gerauchert,geraucherter,geraucherte,mariniert,marinierte,gebraten,gebratene,bio,pasteurisiert,pasteurisierte,ganz,ganze,gehackt,gehackte,geschnitten,gewurfelt,gewurfelte,geroestet,gerostet,geroestete,gerostete,fein,feine,jung,junge,zart,zarte,susse,suss,saure,sauer,japanisch,japanischer,japanische,teilweise,geh,ger,konzentriert,aus,mit,und,von,in,der,die,das,zu,anteil,gemahlen,gemahlener".split(","));
const ING_SYN = {kochreis:"reis gekocht", sushireis:"reis gekocht", reisessig:"essig", alkoholessig:"essig", branntweinessig:"essig", rapsol:"rapsol", huhnerfleisch:"hahnchen", hahnchenbrustfilet:"hahnchen brust", putenbrustfilet:"pute brust", lachsfilet:"lachs", thunfischfilet:"thunfisch", sojabohnen:"sojabohne", gurken:"gurke", tomaten:"tomate", zwiebeln:"zwiebel", karotten:"karotte", mohren:"mohre", paprikaschoten:"gemusepaprika", paprika:"gemusepaprika", hahnchenbrust:"hahnchen brust", putenbrust:"pute brust",
  brokkoli:"broccoli", salatmischung:"kopfsalat", blattsalat:"kopfsalat", salat:"kopfsalat", eisbergsalat:"eisbergsalat", nudeln:"teigwaren", algen:"nori", joghurt:"joghurt nature", naturjoghurt:"joghurt nature",
  rinderhackfleisch:"rind hackfleisch", hackfleisch:"rind hackfleisch", schweinehackfleisch:"schwein hackfleisch", gemischtes:"rind hackfleisch",
  rindfleisch:"rind keule", schweinefleisch:"schwein keule", huhn:"hahnchen", hahnchenfleisch:"hahnchen brust", putenfleisch:"pute brust"};
// Grundwörter, die allein nichts über das Lebensmittel sagen („Teriyakisauce“ ist keine „Sauce Hollandaise“)
const EXTRA_SKIP = new Set(["sauce","sosse","creme","mischung","zubereitung","dressing","pulver","extrakt","aroma","paste","masse","fullung","topping","marinade"]);
const stem = w => w.replace(/(en|n|s|e)$/, "");
function ingredientMatch(names, cooked){
  for(const nm of names){
    const nq = normalize(nm).replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
    if(nq.length < 3 || nq.split(" ").length > 5) continue;           // lange Texte sind meist unzerlegte Zutatenlisten
    if(ZERO_ING.test(nq)) return "zero";
    const ws = nq.split(" ").filter(w => w.length >= 3 && !ING_STOP.has(w));
    if(ws.length === 1 && ZERO_ING.test(ws[0])) return "zero";
    // erst ohne Eigenschaftswörter („schwarzer Pfeffer“ → „pfeffer“), dann der volle Text
    const tries = ws.filter(w => ING_SYN[w]).map(w => ING_SYN[w]);   // feste Zuordnungen zuerst („Paprika“ = Gemüse, nicht Gewürz)
    if(ws.length) tries.push(ws.join(" "));
    if(tries.indexOf(nq) < 0) tries.push(nq);
    ws.slice().sort((a, b) => b.length - a.length).forEach(w => { if(tries.indexOf(w) < 0) tries.push(w); if(MATCH_SYN[w]) tries.push(MATCH_SYN[w]); if(ING_SYN[w]) tries.push(ING_SYN[w]); });
    // zuletzt das Grundwort zusammengesetzter Wörter: „Räucherlachs“ → „lachs“, „Sushireis“ → „reis“
    const extra = [];
    ws.forEach(w => { for(let i = 2; i <= w.length - 4; i++){ const x = w.slice(i); if(EXTRA_SKIP.has(x)) continue; extra.push(x); if(ING_SYN[x]) extra.push(ING_SYN[x]); if(MATCH_SYN[x]) extra.push(MATCH_SYN[x]); } });
    for(const q of tries.concat(extra)){
      const isExtra = tries.indexOf(q) < 0;
      const head = q.split(" ")[0], cq = compact(q);
      if(ING_STOP.has(head)) continue;
      let best = null;
      searchBLS(q, 60, false, true).items.forEach(it => {
        const h = blsHead(it);
        // Wortanfang allein reicht nicht: „Pfeffer“ ist keine „Pfefferminze“, „Sushireis“ kein „Sushi-Ingwer“
        let s = h === head || h === MATCH_SYN[head] ? -0.1 : stem(h) === stem(head) || h === stem(head) || stem(h) === head ? 0 : q.indexOf(" ") > 0 && it._c.indexOf(cq) === 0 ? 0.25 : 2;
        if(s > 1) return;                                   // nur gleiches Hauptwort zählt
        if(isExtra) s += 0.25;
        if(/^[^\s,(-]+-[^\s,]/.test(it.name)) s += 0.5;   // „Joghurt-Butter“, „Hackfleisch-Kohlpudding“
        if(/(dip|dressing|sauce|sosse|creme|aufstrich|mokka|schokolade|vanille|erdbeer)/.test(it._s) && !/(dip|dressing|sauce|sosse|creme|aufstrich|mokka|schokolade|vanille|erdbeer)/.test(nq)) s += 0.4;
        if(/\bmit\b/.test(it._s)) s += 0.6;
        if(MATCH_PREP.test(it._s) && !MATCH_PREP.test(nq)) s += 0.4;
        if(DRY.test(it._s) && !DRY.test(nq)) s += 0.3;
        if(/(saft|suppe|pure|puree|schorle|kuchen|torte|riegel)$/.test(h) && !/(saft|suppe|pure|puree|schorle|kuchen|torte|riegel)/.test(cq)) s += 0.5;
        if(COOK_ING.test(head)) s += (COOKED.test(it._s) ? -1 : 1) * (cooked ? 0.35 : -0.2);
        else if(/\b(gegart|gekocht|gedunstet|gedampft|pochiert|gegrillt)\b/.test(nq)) s += COOKED.test(it._s) || /pochiert|gegrillt|gedunstet/.test(it._s) ? -0.1 : 0.1;
        if(/\b(roh|frisch)\b/.test(it._s) && !COOK_ING.test(head)) s -= 0.15;
        s += it.name.length * 0.004;
        if(!best || s < best.s) best = {it, s};
      });
      if(best && best.s < 0.75) return best.it;
    }
  }
  return null;
}
// Englische Zutaten-IDs über das Wörterbuch der USDA-Suche ins Deutsche: „cucumber“ → „gurke“
const EN_DE = {};
if(typeof DE_EN === "object") Object.keys(DE_EN).forEach(k => { const e = DE_EN[k]; if(!EN_DE[e]) EN_DE[e] = k; if(/s$/.test(e) && !EN_DE[e.slice(0, -1)]) EN_DE[e.slice(0, -1)] = k; });
Object.assign(EN_DE, {cucumber:"gurke", salmon:"lachs", "rice vinegar":"essig", vinegar:"essig", seaweed:"algen", nori:"nori", avocado:"avocado", edamame:"edamame", soy:"soja", "soy sauce":"sojasauce", ginger:"ingwer", sesame:"sesam", "sesame seeds":"sesamsamen", "cream cheese":"frischkase", mango:"mango", tuna:"thunfisch", chicken:"hahnchen", "red cabbage":"rotkohl", "spring onion":"lauchzwiebel", coriander:"koriander"});
async function taxonomyDe(ids){
  if(!ids.length) return {};
  const ctl = new AbortController(), kill = setTimeout(() => ctl.abort(), 6000);
  try{
    const res = await fetch("https://world.openfoodfacts.org/api/v2/taxonomy?tagtype=ingredients&lc=de&fields=name&tags=" + encodeURIComponent(ids.slice(0, 40).join(",")), {signal: ctl.signal});
    const d = res.ok ? await res.json() : {};
    const out = {};
    ids.forEach(id => { const n = d[id] && d[id].name && d[id].name.de; if(n) out[id] = n; });
    return out;
  }catch(e){ return {}; } finally { clearTimeout(kill); }
}
function ingShare(list){
  // Anteile in % des Produkts; fehlende gleichmäßig auf den Rest verteilen
  let known = 0, unknown = 0;
  list.forEach(g => { const p = g.percent != null ? +g.percent : g.percent_estimate != null ? +g.percent_estimate : null; g._p = p > 0 ? p : null; if(g._p) known += g._p; else unknown++; });
  const rest = Math.max(0, 100 - known);
  list.forEach(g => { if(!g._p) g._p = unknown ? rest / unknown : 0; });
  const sum = list.reduce((a, g) => a + g._p, 0) || 1;
  return list.map(g => [g, g._p * 100 / sum]);
}
async function ingredientParts(pr, labelPer){
  const top = (pr.ingredients || []).filter(g => g && (g.text || g.id)).slice(0, 30);
  if(!top.length) return null;
  const ids = [];
  const collect = (l, d) => l.forEach(g => { if(g.id && ids.indexOf(g.id) < 0) ids.push(g.id); if(d < 2 && g.ingredients) collect(g.ingredients, d + 1); });
  collect(top, 0);
  const de = await taxonomyDe(ids);
  const kc = offKcal(pr.nutriments || {});
  const german = /^(de|ch|at)$/.test(pr.lang || pr.lc || "") || !!pr.ingredients_text_de;
  const cooked = kc == null || kc < 250;          // Fertiggericht: Reis, Nudeln & Co. gegart
  const v = {}; ALL_KEYS.forEach(k => v[k] = 0);
  let cov = 0;
  const list = [];
  const add = (g, share, depth) => {
    const label = (de[g.id] || g.text || g.id || "").replace(/^[a-z]{2}:/, "").replace(/-/g, " ");
    // Originaltext nur bei deutschsprachigen Produkten – sonst führt z. B. „vinaigre de riz“ zu „Riz Casimir“
    const enWord = g.id && /^en:/.test(g.id) ? g.id.slice(3).replace(/-/g, " ") : "";
    const names = [de[g.id], german ? g.text : null, enWord && EN_DE[enWord], g.id && /^de:/.test(g.id) ? g.id.slice(3).replace(/-/g, " ") : null].filter(Boolean);
    const m = ingredientMatch(names, cooked);
    if(m === "zero"){ cov += share; list.push([label, share, ""]); return; }
    if(m){ ALL_KEYS.forEach(k => v[k] += (m.per100[k] || 0) * share / 100); cov += share; list.push([label, share, m.name]); return; }
    if(depth < 2 && g.ingredients && g.ingredients.length){ ingShare(g.ingredients.slice(0, 20)).forEach(([s, p]) => add(s, share * p / 100, depth + 1)); return; }
    list.push([label, share, null]);
  };
  ingShare(top).forEach(([g, p]) => add(g, p, 0));
  ALL_KEYS.forEach(k => v[k] = sig(v[k]));
  return {v, cov: Math.round(cov) / 100, list: list.filter(x => x[1] >= 0.5).map(x => [x[0], Math.round(x[1] * 10) / 10, x[2]])};
}

/* liveEstimate erweitern: zusätzlich Zutaten einzeln (pv = Version der Zutatenrechnung) */
const _liveEstimate = liveEstimate;
liveEstimate = async function(raw){
  const c = await _liveEstimate(raw);
  const code = raw && raw.code;
  if(!c || !code || c.pv) return c;
  try{
    const pr = await offProduct(code);
    if(pr){
      const p = await ingredientParts(pr, raw.per100);
      if(p && p.cov >= 0.5) c.parts = p;
      c.nm = missingMacros(pr);
    }
    c.pv = 1;
    liveEst[code] = c; sset("liveEst", liveEst);
  }catch(e){}
  return c;
};
startLive = function(it){
  const raw = it && (it.raw || it);
  if(!raw || !raw.isProduct || raw.isRecipe || raw.noEst || !raw.code || navigator.onLine === false) return;
  const have = liveCached(raw.code);
  if(have && have.pv) return;
  if(raw.labelMicros >= 3 && !raw.noNutrition) return;
  addCtx.liveBusy = raw.code;
  renderAltHint(it);
  liveEstimate(raw).then(() => {
    if(addCtx.liveBusy === raw.code) addCtx.liveBusy = null;
    const sel = addCtx.sel;
    if(!sel || addCtx.editId || sel.noEst || (sel.raw || sel).code !== raw.code) return;
    const nx = withEstimate(sel.raw || sel);
    addCtx.sel = nx;
    renderAltHint(nx); updatePreview();
  });
};

/* Schätzung: Etikett → fehlende Makros aus den Zutaten → Vitamine/Mineralstoffe aus
   Zutatenliste (Open Food Facts), Zutaten einzeln (BLS/Schweiz), Produktname, Kategorie, USDA */
const MACRO_LABEL = {kcal:"Energie", p:"Protein", c:"Kohlenhydrate", z:"Zucker", f:"Fett", sf:"gesättigte Fettsäuren", b:"Ballaststoffe"};
withEstimate = function(item){
  if(!item || !item.isProduct || item.isRecipe || item.est || item.macroEst || item.noEst) return item;
  const live = item.code ? liveEst[item.code] : null;
  const parts = live && live.parts;
  const per100 = Object.assign({}, item.per100), macroEst = [];
  if(parts && parts.cov >= 0.6 && live.nm && live.nm.length){
    live.nm.forEach(k => { if(!per100[k] && parts.v[k] > 0){ per100[k] = k === "kcal" ? Math.round(parts.v[k]) : parts.v[k]; macroEst.push(k); } });
    if(macroEst.length && live.nm.indexOf("kcal") >= 0 && macroEst.indexOf("kcal") < 0 && (per100.p || per100.c || per100.f)){
      per100.kcal = Math.round(4 * per100.p + 4 * per100.c + 9 * per100.f + 2 * (per100.b || 0)); macroEst.push("kcal");
    }
  }
  if(!per100.sf && !per100.f) per100.sf = 0;
  const m = item.labelMicros >= 3 ? null : blsMatch(item.name, per100, item.isDrink);
  const cat = live && live.cat ? blsItems().find(x => x.name === live.cat) : null;
  const srcs = [];
  if(item.labelMicros < 3 || item.labelMicros == null){
    if(live && live.ing) srcs.push([live.ing, "Zutatenliste (Open Food Facts)"]);
    if(parts) srcs.push([parts.v, "Zutaten einzeln (BLS/Schweiz)"]);
    if(m) srcs.push([m.per100, "„" + m.name + "“ (" + dbName(m) + ")"]);
    if(cat && cat !== m) srcs.push([cat.per100, "„" + cat.name + "“ (" + dbName(cat) + ", über die Kategorie „" + live.catFrom + "“)"]);
    if(live && live.usda) srcs.push([live.usda.v, "„" + live.usda.n + "“ (USDA)"]);
  }
  const estKeys = [], used = [];
  MICROS.forEach(([k]) => {
    if(per100[k]) return;
    const s = srcs.find(s => s[0][k] > 0);
    if(!s) return;
    per100[k] = s[0][k]; estKeys.push(k);
    if(used.indexOf(s[1]) < 0) used.push(s[1]);
  });
  if(!estKeys.length && !macroEst.length) return item;
  const alt = m || cat;
  const out = Object.assign({}, item, {per100, raw: item});
  if(estKeys.length) Object.assign(out, {est: used.join(", "), estV: 2, estAlt: alt ? alt.name : null, estKeys});
  if(macroEst.length){ out.macroEst = macroEst; out.noNutrition = false; }
  return out;
};

/* Hinweis im Dialog: berechnete Makros, Zutatenaufstellung, Zuordnen über den Namen */
const _renderAltHint = renderAltHint;
renderAltHint = function(it){
  _renderAltHint(it);
  if(!it || !it.isProduct || addCtx.editId) return;
  const box = $("#altHint");
  if(it.macroEst && it.macroEst.length) box.innerHTML = box.innerHTML.replace("Energie, Makros und Salz kommen vom Etikett.", "Was auf dem Etikett steht, hat Vorrang.");
  const live = it.code ? liveEst[(it.raw || it).code] : null;
  const parts = live && live.parts;
  let h = "";
  if(it.macroEst && it.macroEst.length)
    h += '<div class="nodata althint">Auf dem Etikett fehlen ' + it.macroEst.map(k => MACRO_LABEL[k]).join(", ") +
         ' – diese Werte sind aus den Zutaten berechnet.</div>';
  else if(it.noNutrition && !(addCtx.liveBusy && addCtx.liveBusy === (it.raw || it).code))
    h += '<div class="nodata althint">Für dieses Produkt sind keine Nährwerte hinterlegt. Ordne es einem passenden Lebensmittel zu – die App merkt sich den Barcode.' +
         '<br><button class="chip" id="btnLinkName">Über den Namen zuordnen</button></div>';
  if(parts && parts.list.length && (it.est || it.macroEst) && /Zutaten einzeln/.test(it.est || "Zutaten einzeln"))
    h += '<details class="prep" style="margin:-4px 0 10px"><summary>Zutaten und ihre Anteile (' + Math.round(parts.cov * 100) + ' % zugeordnet)</summary><ul class="small" style="padding-left:18px;margin:4px 0">' +
         parts.list.map(x => '<li>' + esc(x[0]) + ' – ' + fmt(x[1], x[1] < 10 ? 1 : 0) + ' % → ' + (x[2] === "" ? 'ohne Nährwerte' : x[2] ? esc(x[2]) : '<span class="muted">nicht gefunden</span>') + '</li>').join("") +
         '</ul></details>';
  if(addCtx.pendingCode)
    h += '<div class="small muted" style="margin:-4px 0 10px">Wird mit Barcode ' + esc(addCtx.pendingCode) + ' verknüpft.</div>';
  if(h) box.insertAdjacentHTML("beforeend", h);
  const b = $("#btnLinkName", box);
  if(b && it.code) b.onclick = () => linkByName((it.raw || it).code, (it.name || "").replace(/\s*\([^)]*\)\s*$/, ""));
};

/* Eintragen: Barcode-Zuordnung merken */
const _confirmAdd = confirmAdd;
confirmAdd = function(){
  const code = addCtx.pendingCode, sel = addCtx.sel;
  if(code && sel && !addCtx.editId){
    codeMapSet(code, sel);
    addCtx.pendingCode = null;
    setTimeout(() => toast("Barcode " + code + " gemerkt – wird beim nächsten Scan erkannt"), 2600);
  }
  return _confirmAdd();
};

/* Eingetippte Nummern laufen ohne Prüfziffer-Kontrolle über onCode */
// für Tests in der Browser-Konsole
window.NW_SCAN = {gtinFrom, validGtin, ingredientMatch, ingredientParts, offToItem, codeMap: () => codeMap};
})();
