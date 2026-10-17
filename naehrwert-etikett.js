/* NährWert – Barcodes zuordnen, Etikettwerte übernehmen, letzte Schätzstufe
   Wird als letzte Datei geladen (nach naehrwert-sprache.js) und erweitert:
   productByCode, withEstimate, renderAltHint – plus einen Hook in showUnknown (naehrwert-scan.js).

   1. Scan findet auch die rund 100.000 Produkte aus naehrwert-offline-2.js. Deren Etikettwerte
      (Vitamine, Mineralstoffe) werden 1:1 übernommen – auch für Barcodes, die zusätzlich in der
      älteren Produktdatei stehen (dort fehlen alle Mikros).
   2. Unbekannter Barcode: Die ersten 7 Ziffern (GS1-Firmenpräfix) verraten den Hersteller –
      die App schlägt Produkte derselben Marke zum Verknüpfen vor (z. B. Gerolsteiner Medium).
   3. „Etikett eintragen“: Nährwerttabelle abtippen oder fotografieren (Texterkennung). Die Werte
      gelten danach für diesen Barcode und haben Vorrang vor jeder Schätzung.
   4. Letzte Schätzstufe: Hat ein Produkt keine Vitamin-/Mineralstoffwerte und keine andere Quelle
      passt, nimmt die App ähnliche Lebensmittel bzw. Gerichte aus BLS und Schweizer Datenbank
      (gleiches Hauptwort, ähnliche Kalorien) und bildet den Mittelwert – mit ≈ markiert. */
(function(){
"use strict";
if(typeof productByCode !== "function" || typeof withEstimate !== "function") return;

const MICRO_KEYS = () => MICROS.map(m => m[0]);
const sigE = x => +(+x).toPrecision(3);

/* ---------- 1. Barcode-Index über alle Offline-Daten ---------- */
let _off2 = null, _off2Src = null, _prefix = null;
// Die Liste der Offline-Markenprodukte kommt aus off2Index() des Hauptskripts (einmal gefiltert)
function off2List(){
  if(typeof off2Index === "function") return off2Index().items;
  return blsItems().filter(it => it.isOFF2);
}
function codeIndex(){
  const items = off2List();
  if(_off2 && _off2Src === items) return _off2;
  _off2 = {}; _off2Src = items; _prefix = null;
  items.forEach(it => { if(it.code) _off2[String(it.code).replace(/^0+/, "")] = it; });
  return _off2;
}
function off2Find(code){ return codeIndex()[String(code).replace(/^0+/, "")] || null; }

/* Unmarkierte Durchschnittswerte im Export erkennen: Exakt derselbe Mikro-Vektor bei mindestens
   25 Zeilen mit mindestens 15 verschiedenen Produktnamen ist kein Etikett, sondern ein aufgefüllter
   Gruppenwert (z. B. 163 Mineralwässer mit Calcium 7,13 mg). Die Werte selbst bleiben unverändert –
   sie zählen nur als Schätzung, nicht als Etikettwert. */
let _fill = null;
function fillCodes(){
  if(_fill) return _fill;
  _fill = new Set();
  const O = window.NW_OFF2;
  if(!O || !O.rows) return _fill;
  // Natrium bleibt außen vor: es steht als Salz fast immer auf dem Etikett, der Rest kann aufgefüllt sein
  const F = O.meta.felder, ix = O.meta.mikro_reihenfolge.filter(k => k !== "natrium").map(k => F.indexOf(k)), iC = F.indexOf("off_code");
  const freq = new Map(), names = new Map();
  const keyOf = r => ix.map(i => r[i]).join("|");
  O.rows.forEach(r => {
    const k = keyOf(r);
    freq.set(k, (freq.get(k) || 0) + 1);
    let s = names.get(k); if(!s){ s = new Set(); names.set(k, s); }
    if(s.size < 15) s.add(String(r[0]).toLowerCase().slice(0, 12));
  });
  O.rows.forEach(r => {
    const k = keyOf(r);
    if(freq.get(k) >= 25 && names.get(k).size >= 15 && k.split("|").filter(v => v !== "" && v !== "0").length >= 4)
      _fill.add(String(r[iC]).replace(/^0+/, ""));
  });
  // Produkte aus der Suche ehrlich kennzeichnen: Werte bleiben, gelten aber als geschätzt
  off2List().forEach(it => {
    if(!_fill.has(String(it.code).replace(/^0+/, ""))) return;
    it.estKeys = MICRO_KEYS().filter(k => k !== "natrium" && it.per100[k] > 0);
    it.est = "Standardwerten für dieses Lebensmittel (Open Food Facts)"; it.estV = 2; it.labelMicros = 0; it.fillVec = true;
  });
  return _fill;
}
function isFill(o){ return !!o && fillCodes().has(String(o.code).replace(/^0+/, "")); }
function realMicroKeys(o){ if(isFill(o)) return o.per100.natrium > 0 ? ["natrium"] : []; return MICRO_KEYS().filter(k => o.per100[k] > 0 && !((o.estKeys || []).indexOf(k) >= 0)); }

/* Wasser: echte Mineralwerte an die Wasser-Logik weitergeben (Quelle „Etikett (Open Food Facts)“) */
const SORTS = {naturell: /naturell|\bstill\b|ohne kohlensaure|\bnatur\b/, medium: /medium|wenig kohlensaure|\bmild\b|sanft/,
  sprudel: /sprudel|classic|klassik|spritzig|viel kohlensaure/, heil: /heilwasser/};
const W_KEYS = ["calcium","magnesium","natrium","kalium","eisen","zink","jod","kupfer","mangan","phosphor"];
const WATER_HINT = /wasser|sprudel|medium|naturell|still|classic|quelle|heilwasser|mineral|\bwater\b|\beau\b|\bacqua\b|\bagua\b/;
const NOT_W = /tee|tea|schorle|limo|saft|juice|cola|fruity|geschmack|flavou?r|plus|fit\b|energy|isoton|sirup|bier|radler|apfel|zitrone|orange|beere|pfirsich|litschi|minze|ingwer/;
function looksWater(it){
  const p = it.per100 || {};
  if((p.kcal || 0) >= 5 || (p.c || 0) > 1 || (p.z || 0) > 1 || (p.f || 0) > 0.5) return false;
  const n = normalize(it.name || "") + " " + normalize(it.brand || "");
  return WATER_HINT.test(n) && !NOT_W.test(n);
}
/* Mineralwerte eines anderen Wassers derselben Marke (gleiches Firmenpräfix, möglichst gleiche Sorte) */
function siblingWater(it){
  const c = String(it.code || "").replace(/^0+(?=\d{13})/, "");
  if(c.length !== 13 || c[0] === "2") return null;
  const e = prefixIndex()[c.slice(0, 7)];
  if(!e) return null;
  // Sorte entscheidet: Naturell, Medium und Sprudel stammen oft aus verschiedenen Quellen
  const sortOf = n => { n = normalize(n || ""); const s = Object.keys(SORTS).find(k => SORTS[k].test(n)); return s || ""; };
  const mySort = sortOf(it.name);
  const words = new Set(normalize(it.name || "").split(/[^a-z]+/).filter(w => w.length >= 4));
  const cands = [];
  e.items.forEach(x => {
    if(String(x.code) === String(it.code)) return;
    const o = off2Find(x.code) || x;
    if(!looksWater(o) || isFill(o)) return;
    const ca = o.per100.calcium, mg = o.per100.magnesium;
    if(!(ca > 0 && mg > 0) || ((o.estKeys || []).indexOf("calcium") >= 0)) return;
    const os = sortOf(o.name);
    if(mySort && os && os !== mySort && (mySort === "naturell" || os === "naturell")) return;   // Naturell ↔ andere: verschiedene Quellen
    cands.push({o, os, pair: ca + "/" + mg, s: normalize(o.name || "").split(/[^a-z]+/).filter(w => words.has(w)).length + (os && os === mySort ? 3 : os && mySort ? -2 : 0)});
  });
  if(!cands.length) return null;
  // Vorlage nur, wenn sie zum Rest der Marke passt: Ein Eintrag, der um mehr als das Fünffache vom
  // Median der Marke abweicht (z. B. mg/l als mg/100 ml eingetragen), wird nicht auf andere Produkte übertragen.
  // Der Eintrag selbst bleibt unverändert.
  const cas = cands.map(c => c.o.per100.calcium).sort((a, b) => a - b), med = cas[Math.floor(cas.length / 2)];
  let pool = cands.filter(c => c.o.per100.calcium <= med * 5 && c.o.per100.calcium >= med / 5);
  if(mySort && !pool.some(c => c.os === mySort)){
    // keine passende Vorlage derselben Sorte → andere Sorten derselben Marke (außer Naturell, oft eigene Quelle)
    pool = pool.filter(c => mySort === "naturell" ? c.os === "naturell" || !c.os : c.os !== "naturell");
  }
  if(!pool.length) return null;
  const cnt = {}; pool.forEach(c => cnt[c.pair] = (cnt[c.pair] || 0) + 1);
  pool.sort((a, b) => (b.s + cnt[b.pair]) - (a.s + cnt[a.pair]));
  return pool[0].o;
}
function feedWater(item, src){
  if(!window.NW_WASSER || !item || !item.code) return;
  try{
    const isW = NW_WASSER.isWaterItem(item) || looksWater(item);
    if(!isW) return;
    const cache = NW_WASSER.cache(), c = cache[item.code] || (cache[item.code] = {t: 0, v: {}, lab: {}, extra: {}});
    c.isWater = true;                                         // auch „Gerolsteiner Medium“ ohne „Wasser“ im Namen
    if(c.v && Object.keys(c.v).length) return;               // schon Werte vorhanden (Etikett, eigene Eingabe)
    let from = src && !isFill(src) ? src : null, sib = null;
    if(!from || !W_KEYS.some(k => from.per100[k] > 0 && !((from.estKeys || []).indexOf(k) >= 0))){ sib = siblingWater(item); from = sib; }
    if(!from) return;
    const v = {}, lab = {};
    W_KEYS.forEach(k => { if(from.per100[k] > 0 && !((from.estKeys || []).indexOf(k) >= 0)){ v[k] = from.per100[k]; lab[k] = "off"; } });
    if(Object.keys(v).length){ c.v = v; c.lab = lab; c.t = c.t || Date.now(); if(sib) c.sibling = sib.name; }
  }catch(e){}
}

const _productByCode = productByCode;
productByCode = function(code){
  const base = _productByCode(code);
  const o = off2Find(code);
  if(!o){ if(base) feedWater(base, null); return base; }
  const real = realMicroKeys(o);
  if(base){
    if(base.labelMicros >= 3 || !real.length){ feedWater(base, o); return base; }
    // ältere Produktdatei ohne Mikros: Etikettwerte aus Open Food Facts (Export) übernehmen
    const per100 = Object.assign({}, base.per100);
    real.forEach(k => { if(!per100[k]) per100[k] = o.per100[k]; });
    const it = Object.assign({}, base, {per100, labelMicros: real.length});
    feedWater(it, o);
    return it;
  }
  const it = Object.assign({}, o, {isProduct: true, isBLS: false, src: "Open Food Facts", labelMicros: real.length,
    portions: (o.portions || []).map(p => p.slice()), missing: o.missing || []});
  if(isFill(o)){
    // Standardwerte (für viele Produkte identisch) bleiben, gelten aber als Schätzung (≈)
    it.estKeys = MICRO_KEYS().filter(k => k !== "natrium" && o.per100[k] > 0);
    it.est = "Standardwerten für dieses Lebensmittel (Open Food Facts)"; it.estV = 2; it.labelMicros = 0;
  }
  feedWater(it, o);
  return it;
};

/* ---------- 2. Hersteller aus dem GS1-Firmenpräfix ---------- */
function prefixIndex(){
  codeIndex();
  if(_prefix) return _prefix;
  _prefix = {};
  const add = (it, brand) => {
    const c = String(it.code || "").replace(/^0+(?=\d{13})/, "");
    if(c.length !== 13 || c[0] === "2") return;              // Frischetheke (20–29) hat kein Firmenpräfix
    const p = c.slice(0, 7);
    const e = _prefix[p] || (_prefix[p] = {brands: {}, items: []});
    if(brand) e.brands[brand] = (e.brands[brand] || 0) + 1;
    if(e.items.length < 80) e.items.push(it);
  };
  productItems().forEach(it => add(it, (it.brand || "").split(",")[0].trim()));
  Object.values(_off2).forEach(it => add(it, ""));
  return _prefix;
}
function brandFor(code){
  const c = String(code).replace(/^0+(?=\d{13})/, "");
  if(c.length !== 13 || c[0] === "2") return null;
  const e = prefixIndex()[c.slice(0, 7)];
  if(!e || !e.items.length) return null;
  const b = Object.keys(e.brands).sort((a, b) => e.brands[b] - e.brands[a])[0] || "";
  // Meistgekaufte zuerst (Rang in der Produktdatei), dann die übrigen; Dubletten raus
  const seen = new Set(), items = [];
  const rank = it => it.isOFF2 ? 1e7 : (it.rank || 0);
  e.items.slice().sort((a, b) => rank(a) - rank(b)).map(it => productByCode(it.code) || it)
    .forEach(it => { const k = normalize(it.name); if(!seen.has(k)){ seen.add(k); items.push(it); } });
  return {brand: b, items: items.slice(0, 12)};
}
function mapKeyE(code){ code = String(code).replace(/^0+(?=\d{8})/, ""); return code.length === 13 && code[0] === "2" ? code.slice(0, 7) : code; }
function remember(code, it){
  const map = window.NW_SCAN ? NW_SCAN.codeMap() : sget("codeMap", {});
  const raw = it.raw || it, o = {};
  ["id","name","isDrink","per100","portions","cf","src","isProduct","isBLS","isCH","labelMicros","missing","code","brand","est","estV","estKeys","userLabel"].forEach(k => { if(raw[k] !== undefined) o[k] = raw[k]; });
  if(o.isProduct && !o.code) o.code = code;
  map[mapKeyE(code)] = o;
  sset("codeMap", map);
}
/* Hook aus showUnknown (naehrwert-scan.js): Hersteller-Vorschläge und „Etikett eintragen“ */
function unknownHook(code){
  const box = $("#scanUnknown");
  if(!box) return;
  const b = brandFor(code);
  let h = "";
  if(b){
    h += '<div class="nodata althint" style="margin-bottom:12px">Der Barcode gehört ' + (b.brand ? 'zum Hersteller <b>' + esc(b.brand) + '</b>' : 'zum selben Hersteller wie diese Produkte') +
      ' (an den ersten Ziffern erkennbar). Welches davon ist es? Die App merkt sich die Zuordnung.' +
      '<div style="margin-top:6px">' + b.items.map((it, i) => '<button class="chip" data-brandpick="' + i + '" style="margin:0 6px 6px 0">' + esc(it.name.length > 48 ? it.name.slice(0, 46) + "…" : it.name) +
        (it.labelMicros >= 3 && !isFill(off2Find(it.code)) ? ' · Etikettwerte' : '') + '</button>').join("") + '</div></div>';
  }
  h += '<div class="nodata althint" style="margin-bottom:12px">Nichts Passendes dabei? Trag die Nährwerte vom Etikett ein – abtippen oder fotografieren.' +
       '<br><button class="chip" id="btnLabelNew">Etikett eintragen</button></div>';
  box.insertAdjacentHTML("afterbegin", h);
  box.querySelectorAll("[data-brandpick]").forEach(btn => btn.onclick = () => {
    const it = b.items[+btn.dataset.brandpick];
    remember(code, it);
    closeSheets(); openSheet("addSheet"); pickItem(productByCode(it.code) || it);
    toast("Barcode " + code + " mit „" + it.name + "“ verknüpft");
  });
  $("#btnLabelNew").onclick = () => openLabel(code, null);
}

/* ---------- 3. Etikett eintragen (abtippen oder Foto) ---------- */
const LBL_MACROS = [["kcal","Energie","kcal"],["f","Fett","g"],["sf","davon gesättigte Fettsäuren","g"],["c","Kohlenhydrate","g"],
  ["z","davon Zucker","g"],["b","Ballaststoffe","g"],["p","Eiweiß","g"],["salz","Salz","g"]];
// Häufig auf Etiketten: zuerst Mineralstoffe (Wasser, angereicherte Lebensmittel), dann Vitamine
const LBL_MICROS = ["calcium","magnesium","kalium","natrium","eisen","zink","jod","vitC","vitD","b12","folat","vitE","vitA","b1","b2","b6","niacin","phosphor"];
// Wörter auf Etiketten je Nährstoff (für die Texterkennung)
const OCR_NAMES = {kcal:"kcal", f:"fett|fat", sf:"gesättigte|gesattigte|gesätt|saturates|ges[aä]tt", c:"kohlenhydrate|kohlenhydr|carbohydrate", z:"zucker|sugars?",
  b:"ballaststoffe|ballastst|fibre|fiber", p:"eiweiß|eiweiss|eiweis|protein", salz:"salz|salt",
  calcium:"calcium|kalzium", magnesium:"magnesium", kalium:"kalium|potassium", natrium:"natrium|sodium", eisen:"eisen|iron", zink:"zink|zinc", jod:"jod|iod",
  vitC:"vitamin c", vitD:"vitamin d", b12:"vitamin b12|b12", folat:"fols[aä]ure|folat", vitE:"vitamin e", vitA:"vitamin a", b1:"vitamin b1|thiamin",
  b2:"vitamin b2|riboflavin", b6:"vitamin b6", niacin:"niacin", phosphor:"phosphor"};
function unitOf(k){ const m = MICROS.find(x => x[0] === k); return m ? m[2] : "g"; }
function labelOf(k){ const m = MICROS.find(x => x[0] === k); return m ? m[1] : k; }
let lblCtx = null;
function ensureSheet(){
  if($("#labelSheet")) return;
  document.body.insertAdjacentHTML("beforeend",
    '<div class="sheet" id="labelSheet" role="dialog" aria-label="Etikett eintragen"><div class="grab"></div>' +
    '<div class="head"><h3>Etikett eintragen</h3><button class="ghost" data-close>Schließen</button></div><div class="body" id="labelBody"></div></div>');
}
function openLabel(code, item){
  ensureSheet();
  const water = !!(item && window.NW_WASSER && NW_WASSER.isWaterItem(item.raw || item));
  lblCtx = {code, item: item && (item.raw || item), drink: item ? !!item.isDrink : false};
  const p = (lblCtx.item && lblCtx.item.per100) || {};
  const est = new Set((item && item.estKeys) || []);
  const val = k => k === "salz" ? (p.natrium > 0 ? sigE(p.natrium * 2.5 / 1000) : "") : (p[k] > 0 && !est.has(k) ? sigE(p[k]) : "");
  const field = (k, label, unit) => '<label class="small" style="display:flex;flex-direction:column;gap:2px">' + esc(label) + ' <span class="muted">(' + unit + ')</span>' +
    '<input type="text" inputmode="decimal" autocomplete="off" data-lbl="' + k + '" value="' + val(k) + '"></label>';
  $("#labelBody").innerHTML =
    '<div class="small muted" style="margin-bottom:8px">' + (code ? 'Barcode ' + esc(code) + ' – ' : '') + 'Werte je 100 g bzw. 100 ml, wie in der Nährwerttabelle. Leere Felder schätzt die App, eingetragene Werte haben immer Vorrang.</div>' +
    '<label class="small" style="display:block;margin-bottom:8px">Name<input type="text" id="lblName" autocomplete="off" style="width:100%" value="' + esc((lblCtx.item && lblCtx.item.name) || "") + '"></label>' +
    '<label class="small" style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><input type="checkbox" id="lblDrink"' + (lblCtx.drink ? ' checked' : '') + '> Getränk (Werte je 100 ml)</label>' +
    '<button class="ghost" id="lblPhotoBtn" style="width:100%;margin-bottom:10px">📷 Nährwerttabelle fotografieren</button>' +
    '<input type="file" accept="image/*" capture="environment" id="lblPhoto" style="display:none">' +
    '<div class="small muted" id="lblOcr" style="margin-bottom:8px"></div>' +
    '<div class="small" style="font-weight:600;margin:4px 0">Nährwerte</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + LBL_MACROS.map(m => field(m[0], m[1], m[2])).join("") + '</div>' +
    '<details class="prep" style="margin:10px 0"' + (water ? ' open' : '') + '><summary>Vitamine und Mineralstoffe (falls angegeben)</summary>' +
    '<label class="small" style="display:flex;align-items:center;gap:8px;margin:4px 0 6px"><input type="checkbox" id="lblPerL"' + (water ? ' checked' : '') + '> Mineralstoffe in mg pro Liter (so steht es auf Mineralwasser)</label>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + LBL_MICROS.map(k => field(k, labelOf(k), unitOf(k))).join("") + '</div></details>' +
    '<button class="primary" id="lblSave" style="width:100%">Übernehmen</button>';
  // Name klingt nach Wasser → Getränk und mg/l vorschlagen
  $("#lblName").addEventListener("input", ev => { if(/wasser|sprudel|quelle|\bwater\b|\beau\b/i.test(ev.target.value)){ $("#lblDrink").checked = true; $("#lblPerL").checked = true; } });
  $("#lblPhotoBtn").onclick = () => $("#lblPhoto").click();
  $("#lblPhoto").addEventListener("change", ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if(f) ocrLabel(f); });
  $("#lblSave").onclick = saveLabel;
  $$(".sheet").forEach(x => x.classList.remove("open"));
  openSheet("labelSheet");
}
function numIn(k){
  const el = $('#labelBody [data-lbl="' + k + '"]');
  if(!el) return null;
  const v = parseFloat(String(el.value).replace(",", ".").replace(/[^\d.]/g, ""));
  return isNaN(v) ? null : v;
}
function saveLabel(){
  const c = lblCtx; if(!c) return;
  const name = $("#lblName").value.trim() || (c.item && c.item.name) || ("Produkt " + (c.code || ""));
  const drink = $("#lblDrink").checked;
  const perL = $("#lblPerL") && $("#lblPerL").checked;
  const base = c.item || {};
  const per100 = {};
  ALL_KEYS.forEach(k => per100[k] = 0);
  // Ausgangswerte des Produkts behalten, eingetragene Werte überschreiben sie
  if(base.per100) ALL_KEYS.forEach(k => { if(base.per100[k] > 0 && !((base.estKeys || []).indexOf(k) >= 0)) per100[k] = base.per100[k]; });
  let n = 0, micro = 0;
  LBL_MACROS.forEach(([k]) => { const v = numIn(k); if(v == null) return; n++; if(k === "salz") per100.natrium = v * 400; else per100[k] = v; });
  LBL_MICROS.forEach(k => { let v = numIn(k); if(v == null) return; n++; micro++; if(perL) v = v / 10; per100[k] = v; });
  if(!n){ toast("Bitte mindestens einen Wert eintragen"); return; }
  if(!per100.kcal && (per100.p || per100.c || per100.f)) per100.kcal = Math.round(4 * per100.p + 4 * per100.c + 9 * per100.f + 2 * (per100.b || 0));
  const realMicro = MICRO_KEYS().filter(k => per100[k] > 0).length;
  const it = {id: "L" + (c.code || Date.now()), code: c.code || base.code, name, isDrink: drink, per100,
    portions: (base.portions || []).map(p => p.slice()), cf: base.cf || 0, src: "Etikett (selbst eingetragen)", isProduct: true,
    missing: [], labelMicros: realMicro, userLabel: true};
  if(it.code) remember(it.code, it);
  // Wasser: Mineralstoffe als selbst eingetragen an die Wasser-Logik
  if(window.NW_WASSER && it.code){
    try{
      const cache = NW_WASSER.cache(), w = cache[it.code] || (cache[it.code] = {t: Date.now(), v: {}, lab: {}, extra: {}});
      ["calcium","magnesium","kalium","natrium","eisen","zink","jod"].forEach(k => { if(per100[k] > 0){ w.v[k] = per100[k]; w.lab[k] = "user"; } });
      if(NW_WASSER.isWaterItem(it)) w.isWater = true;
      sset("waterMin", cache);
    }catch(e){}
  }
  closeSheets(); openSheet("addSheet"); pickItem(it);
  toast(micro ? "Etikettwerte gespeichert – " + micro + " Vitamine/Mineralstoffe übernommen" : "Etikettwerte gespeichert");
}
/* Texterkennung: Nährwerttabelle vom Foto lesen und die Felder vorbelegen */
let _tess = null;
async function ocrLabel(file){
  const st = $("#lblOcr");
  st.textContent = "Texterkennung wird geladen (einmalig etwa 2 MB) …";
  try{
    if(!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
    if(!_tess) _tess = await Tesseract.createWorker("deu", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int"});
    st.textContent = "Etikett wird gelesen …";
    const r = await _tess.recognize(file);
    const found = parseLabel(r.data.text || "");
    let n = 0;
    Object.keys(found).forEach(k => {
      const el = $('#labelBody [data-lbl="' + k + '"]');
      if(el){ el.value = String(found[k]).replace(".", ","); n++; }
    });
    if(found._perL && $("#lblPerL")) $("#lblPerL").checked = true;
    if(Object.keys(found).some(k => LBL_MICROS.indexOf(k) >= 0)) $("#labelBody details").open = true;
    st.textContent = n ? n + " Werte erkannt – bitte kurz mit dem Etikett vergleichen und dann übernehmen." : "Keine Werte erkannt. Fotografiere die Nährwerttabelle möglichst gerade und formatfüllend – oder tippe die Werte ab.";
  }catch(e){
    st.textContent = "Texterkennung nicht verfügbar (Internet nötig). Tippe die Werte bitte ab.";
  }
}
function parseLabel(text){
  const t = text.toLowerCase().replace(/(\d),(\d)/g, "$1.$2").replace(/[|]/g, " ").replace(/\s+/g, " ");
  const out = {};
  const perL = /mg\s*\/\s*l|mg\/1\b|pro liter|je liter|analyse/.test(t);
  if(perL) out._perL = true;
  // Energie: „… kJ / 250 kcal“
  const kc = t.match(/(\d+(?:\.\d+)?)\s*kcal/);
  if(kc) out.kcal = +kc[1];
  Object.keys(OCR_NAMES).forEach(k => {
    if(k === "kcal") return;
    let re = new RegExp("(?:^|[^a-zäöü])(?:" + OCR_NAMES[k] + ")(?!\\d)[a-zäöüß\\s.,:()-]{0,28}?(<?\\s*\\d+(?:\\.\\d+)?)\\s*(mg|µg|ug|mcg|g)?", "i");
    // „Fett“ nicht aus „davon gesättigte Fettsäuren“ lesen
    if(k === "f") re = /(?:^|[^a-zäöü])(?:fett|fat)(?!s[aä]uren)[a-zäöüß\s.,:()-]{0,10}?(<?\s*\d+(?:\.\d+)?)\s*(g)?/i;
    const m = t.match(re);
    if(!m) return;
    let v = parseFloat(m[1].replace(/[<\s]/g, ""));
    if(isNaN(v)) return;
    const u = (m[2] || "").replace(/ug|mcg/, "µg");
    const want = LBL_MACROS.some(x => x[0] === k) ? "g" : unitOf(k);
    if(k !== "kcal" && u && want !== u){
      if(u === "g" && want === "mg") v *= 1000; else if(u === "mg" && want === "µg") v *= 1000;
      else if(u === "µg" && want === "mg") v /= 1000; else if(u === "mg" && want === "g") v /= 1000;
    }
    out[k] = sigE(v);
  });
  return out;
}

/* ---------- 4. Letzte Schätzstufe: ähnliche Lebensmittel und Gerichte ---------- */
const DISH_RE = /\b(bowl|poke|buddha|sushi|bento|wrap|burrito|salat|salad|curry|pfanne|eintopf|suppe|gericht|menu|menue|lasagne|risotto|auflauf|bolognese|gnocchi|tortellini|ravioli|sandwich|baguette|burger|pizza|box|snack|mahlzeit|meal|lunch|chili|paella|nudelsalat|couscous|bulgur|falafel|kebab|doner|frikassee|gulasch|ragout|tajine|ramen|noodles|bami|nasi)\b/;
const SIM_STOP = new Set(["bowl","poke","buddha","box","lunch","meal","snack","menu","gericht","mahlzeit","fertiggericht","style","art","nach","sauce","dressing"]);
let _dishes = null, _dishSrc = null;
function dishes(){
  const base = typeof blsBase === "function" ? blsBase() : blsItems().filter(it => !it.isOFF2);
  if(_dishes && _dishSrc === base) return _dishes;
  _dishSrc = base;
  return (_dishes = base.filter(x => (x.blsGroup === "X" || x.blsGroup === "Y") && !x.isDrink));
}
const stemE = w => w.replace(/(en|n|s|e)$/, "");
// Art des Gerichts → passende BLS-Gerichte (Name enthält eines dieser Wörter)
const DISH_TYPES = [
  [/\b(bowl|poke|buddha|bento)\b/, /reis|quinoa|bulgur|couscous|gemuse|salat|nudel|linsen|kichererbsen/],
  [/\b(salat|salad)\b/, /salat/], [/\bsushi\b/, /sushi|reis/], [/\bcurry\b/, /curry/], [/pfanne/, /pfanne|gebraten/],
  [/suppe|eintopf/, /suppe|eintopf/], [/lasagne|auflauf/, /lasagne|auflauf/], [/\b(wrap|burrito)\b/, /wrap|burrito|tortilla|fladen/],
  [/sandwich|baguette|burger/, /sandwich|baguette|burger|brotchen/], [/pizza/, /pizza/], [/risotto/, /risotto/], [/chili/, /chili/],
  [/ramen|noodles|bami|nasi/, /nudel|reis/]];
const ALC = /likor|wein|bier|radler|schnaps|brand\b|branntwein|wodka|vodka|\brum\b|whisky|whiskey|sekt|arrak|calvados|aquavit|spirituose|cocktail|tequila|\bgin\b|grappa|ouzo|cognac|weinbrand|punsch|gluhwein|desperados|prosecco|champagner|\bvol\b/;
const DISH_EXCL = /sauce|sosse|bruhe|dessert|pudding|kompott|kuchen|torte|creme|dip\b|dressing|kaiserreis|milchreis|getrank|\beis\b|gelee|konfiture/;
const _simCache = new Map();
function similarFoods(it){
  const key = (it.name || "") + "|" + ["kcal","p","c","f"].map(k => Math.round((it.per100 || {})[k] || 0)).join("/") + "|" + (it.isDrink ? 1 : 0);
  if(_simCache.has(key)) return _simCache.get(key);
  const r = similarFoodsCalc(it);
  if(_simCache.size > 500) _simCache.clear();
  _simCache.set(key, r);
  return r;
}
function similarFoodsCalc(it){
  const nm = normalize(String(it.name || "").replace(/\s*\([^)]*\)\s*$/, ""));
  const words = nm.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/\d/.test(w) && !MATCH_STOP.has(w) && !SIM_STOP.has(w));
  const per = it.per100 || {}, kc = per.kcal || 0, hasMac = (per.p || 0) + (per.c || 0) + (per.f || 0) > 0;
  const drink = !!it.isDrink;
  const ok = x => x && x.isBLS && !x.isOFF2 && !x.isProduct && !!x.isDrink === drink;
  const kDist = b => Math.abs(b.kcal - kc) / Math.max(b.kcal, kc, 50);
  const mDist = b => hasMac ? (Math.abs(b.p - per.p) + Math.abs(b.c - per.c) + Math.abs(b.f - per.f)) / Math.max(per.p + per.c + per.f, b.p + b.c + b.f, 8) : 0;
  // a) Lebensmittel mit gleichem Hauptwort („Lachs Bowl“ → Lachs, „Hähnchen“ → Hähnchen)
  const comp = new Map();
  const add = (x, rel) => { if(ok(x)) comp.set(x, Math.min(comp.has(x) ? comp.get(x) : 9, rel)); };
  const look = q => searchBLS(q, 120, false, true).items;
  words.forEach(w => {
    look(w).forEach(x => { const r = matchRel(w, x); if(r >= 0) add(x, r); });
    for(let i = 3; i <= w.length - 4; i++){             // Grundwort: „Gemüsepfanne“ → „pfanne“
      const s = w.slice(i);
      look(s).forEach(x => { const h = blsHead(x); if(h === s || stemE(h) === stemE(s)) add(x, 0.8); });
    }
  });
  const isDish = !drink && DISH_RE.test(nm);
  const compList = [...comp].map(([x, rel]) => [rel * 0.35 + kDist(x.per100) + (isDish ? 0 : mDist(x.per100)) + (/\bmit\b/.test(x._s) && rel < 1 ? 0.1 : 0), x])
    .sort((a, b) => a[0] - b[0]).filter(x => x[0] < 1.2);
  // b) Gerichte derselben Art (BLS-Gruppen X/Y), ohne Saucen und Desserts
  let dishList = [];
  if(!drink && kc > 0 && (isDish || !compList.length)){
    const type = DISH_TYPES.find(d => d[0].test(nm));
    let pool = dishes().filter(x => !DISH_EXCL.test(x._s) || DISH_EXCL.test(nm));
    if(type){ const f = pool.filter(x => type[1].test(x._s)); if(f.length >= 3) pool = f; }
    dishList = pool.map(x => [kDist(x.per100) + mDist(x.per100), x]).sort((a, b) => a[0] - b[0]).filter(x => x[0] < 1.2);
  }
  // c) Getränke ohne passendes Hauptwort: Getränke mit ähnlichen Nährwerten (Limo, Tee, Proteindrink, Pflanzendrink …)
  if(drink && !compList.length){
    const base = typeof blsBase === "function" ? blsBase() : blsItems().filter(x => !x.isOFF2);
    const alcNm = ALC.test(nm);
    dishList = base.filter(x => x.isDrink && x.isBLS && !x.isProduct && ALC.test(x._s) === alcNm)
      .map(x => [kDist(x.per100) * 0.6 + mDist(x.per100) + Math.abs((x.per100.z || 0) - (per.z || 0)) / 20, x]).sort((a, b) => a[0] - b[0]).filter(x => x[0] < 1.2);
  }
  const pick = isDish ? compList.slice(0, 3).concat(dishList.slice(0, 3)).map(x => x[1])
                      : (compList.length ? compList : dishList).slice(0, 6).map(x => x[1]);
  if(!pick.length) return null;
  const v = {};
  ALL_KEYS.forEach(k => {
    const vals = pick.map(x => x.per100[k]).filter(y => y != null && !isNaN(y));
    if(vals.length) v[k] = sigE(vals.reduce((a, y) => a + y, 0) / vals.length);
  });
  return {v, names: pick.map(x => x.name)};
}

/* Gruppen-Durchschnitt aus dem Export („Käse“, „Joghurt“ …) durch das konkret passende Lebensmittel
   aus BLS/Schweiz ersetzen – Gouda bekommt Gouda-Werte statt des Mittels aller Käse. Echte Etikettwerte bleiben. */
const _refined = new Map();
/* Schneller Abgleich nur in BLS/Schweiz: gleiches Hauptwort und ähnliche Makros (wie blsMatch, ohne Markenprodukte) */
// Fremdsprachige Produktnamen: häufige Lebensmittelwörter ins Deutsche (für den Abgleich mit BLS/Schweiz)
const TO_DE = {yogurt:"joghurt",yoghurt:"joghurt",yaourt:"joghurt",yogur:"joghurt",cheese:"kase",fromage:"kase",formaggio:"kase",queso:"kase",
  chocolate:"schokolade",chocolat:"schokolade",cioccolato:"schokolade",chicken:"hahnchen",poulet:"hahnchen",pollo:"hahnchen",dinde:"pute",turkey:"pute",
  beef:"rind",boeuf:"rind",pork:"schwein",porc:"schwein",ham:"schinken",jambon:"schinken",prosciutto:"schinken",salmon:"lachs",saumon:"lachs",salmone:"lachs",
  tuna:"thunfisch",thon:"thunfisch",tonno:"thunfisch",butter:"butter",beurre:"butter",burro:"butter",milk:"milch",lait:"milch",latte:"milch",leche:"milch",
  cream:"sahne",creme:"sahne",biscuit:"keks",biscuits:"keks",cookie:"keks",cookies:"keks",galletas:"keks",cracker:"cracker",bread:"brot",pain:"brot",pane:"brot",
  peanut:"erdnuss",peanuts:"erdnuss",cacahuete:"erdnuss",cacahuetes:"erdnuss",hazelnut:"haselnuss",noisette:"haselnuss",nocciola:"haselnuss",almond:"mandel",amande:"mandel",
  mandorla:"mandel",confiture:"konfiture",jam:"konfiture",marmellata:"konfiture",honey:"honig",miel:"honig",miele:"honig",rice:"reis",riz:"reis",riso:"reis",
  pasta:"teigwaren",oats:"hafer",avoine:"hafer",apple:"apfel",pomme:"apfel",mela:"apfel",apricot:"aprikose",abricot:"aprikose",strawberry:"erdbeere",fraise:"erdbeere",
  banana:"banane",orange:"orange",tomato:"tomate",tomate:"tomate",pomodoro:"tomate",potato:"kartoffel",pommes:"kartoffel",chips:"chips",crisps:"chips",
  cottage:"frischkase",ricotta:"ricotta",mozzarella:"mozzarella",egg:"ei",eggs:"ei",oeufs:"ei",oeuf:"ei",uova:"ei",fish:"fisch",poisson:"fisch",pesce:"fisch",
  sausage:"wurst",saucisse:"wurst",salsiccia:"wurst",nuggets:"chicken",wafer:"waffel",gaufre:"waffel",candy:"bonbon",gum:"kaugummi",sauce:"sauce",ketchup:"ketchup"};
let _heads = null, _headSrc = null;
function baseHeads(){
  const base = typeof blsBase === "function" ? blsBase() : blsItems().filter(x => !x.isOFF2);
  if(_heads && _headSrc === base) return _heads;
  _headSrc = base; _heads = new Set();
  base.forEach(x => { if(x.isBLS) _heads.add(blsHead(x)); });
  return _heads;
}
const DRINK_HINT = /saft|nektar|schorle|drink|getrank|limo|\bmilch\b|vollmilch|frischmilch|kefir|smoothie|buttermilch|\bmolke/;
function baseMatch(name, per, drink, group){
  // „ohne Rosine“: Wörter nach „ohne“ zählen nicht
  const nm = normalize(String(name || "").replace(/\s*\([^)]*\)\s*$/, "")).replace(/\bohne\s+\S+/g, " ");
  if(!drink && (DRINK_HINT.test(nm) || /^(Fruchtsaft|Milch)$/.test(group || ""))) drink = true;   // Export kennt keine Getränke-Markierung
  const raw = nm.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/\d/.test(w) && !MATCH_STOP.has(w));
  const words = raw.map(w => TO_DE[w] || w).filter(w => w.length >= 4 || w === "ei").slice(0, 5);
  // Grundwort langer Wörter: „Alpenvollmilchschokolade“ → „schokolade“, „Almkäse“ → „kase“
  // nur Grundwörter, die es als Hauptwort in BLS/Schweiz gibt (hält die Suche schnell)
  const heads = baseHeads();
  words.slice().forEach(w => { if(w.length < 8) return; for(let i = 3; i <= w.length - 4; i++){ const s = w.slice(i);
    if(words.indexOf(s) < 0 && (heads.has(s) || MATCH_SYN[s])){ words.push(s); break; } } });
  const stemB = w => w.replace(/(en|n|s|e)$/, "");
  let best = null;
  words.forEach((w, wi) => {
    [w, MATCH_SYN[w]].filter(Boolean).forEach(q => searchBLS(q, 120, false, true).items.forEach(x => {
      if(!x.isBLS || x.isOFF2 || !!x.isDrink !== !!drink) return;
      // gleiches Hauptwort: „Schafkäse“ ist kein „Schaf“, „Gouda“ passt zu „Gouda 48 %“
      const h = blsHead(x), syn = MATCH_SYN[w];
      if(!(h === w || stemB(h) === stemB(w) || (syn && (h === syn || x._c.indexOf(syn) === 0)) || x._c.indexOf(w) === 0)) return;
      const b = x.per100;
      const dk = Math.abs(b.kcal - per.kcal) / Math.max(b.kcal, per.kcal, 40);
      const dm = (Math.abs(b.p - per.p) + Math.abs(b.c - per.c) + Math.abs(b.f - per.f)) / Math.max(per.p + per.c + per.f, b.p + b.c + b.f, 8);
      if(dk + dm >= 0.4) return;
      const s = dk + dm + wi * 0.1 + (/\bmit\b/.test(x._s) ? 0.08 : 0) + (MATCH_PREP.test(x._s) ? 0.1 : 0) + x.name.length * 0.002 +
        (/^[^\s,(-]+-[^\s,]/.test(x.name) ? 0.15 : 0) +                                            // „Joghurt-Dressing“
        (/(dressing|sauce|sosse|dip\b|marinade|brotchen|hornchen|chips)/.test(x._s) && !/(dressing|sauce|sosse|dip|marinade|brotchen|hornchen|chips)/.test(nm) ? 0.3 : 0) +
        (/(getrocknet|pulver|trocken|konzentrat|instant)/.test(x._s) && !/(getrocknet|pulver|trocken|konzentrat|instant|flocken|mehl)/.test(nm) ? 0.3 : 0);
      if(!best || s < best.s) best = {s, x};
    }));
  });
  return best ? best.x : null;
}
function refineGroupEstimate(item){
  if(!item || !item.estKeys || !item.estKeys.length || item.userLabel || item.water) return item;
  if(!(item.isOFF2 || /Open Food Facts\)$/.test(item.est || "") || /^Durchschnittswerte für|^Standardwerten/.test(item.est || ""))) return item;
  if(item._refinedFrom) return item;
  const key = (item.code || item.name) + "|" + item.estKeys.length;
  if(_refined.has(key)) return _refined.get(key) || item;
  const grp = ((item.est || "").match(/Durchschnittswerte für „([^“]+)“/) || [])[1];
  const m = baseMatch(item.name, item.per100, item.isDrink, grp);
  if(!m){ _refined.set(key, null); return item; }
  const per100 = Object.assign({}, item.per100), keys = [];
  item.estKeys.forEach(k => { if(m.per100[k] > 0){ per100[k] = m.per100[k]; keys.push(k); } });
  if(!keys.length){ _refined.set(key, null); return item; }
  const rest = item.estKeys.filter(k => keys.indexOf(k) < 0);
  const res = Object.assign({}, item, {per100, est: "„" + m.name + "“ (" + dbName(m) + ")" + (rest.length ? "; übrige aus " + item.est : ""), estV: 2, estAlt: m.name, _refinedFrom: item.est});
  _refined.set(key, res);
  return res;
}
const _withEstimate = withEstimate;
withEstimate = function(item){
  const out0 = _withEstimate(item);
  const out = out0 && (out0.isProduct || out0.isOFF2) ? refineGroupEstimate(out0) : out0;
  if(!out || !out.isProduct || out.isRecipe || out.water || out.noEst || out.userLabel || out.labelMicros >= 3 || out.simEst) return out;
  const missing = MICRO_KEYS().filter(k => !out.per100[k]);
  // schon (fast) vollständig geschätzt → nichts zu tun
  if(out.est && missing.length <= 2) return out;
  const live = out.code && typeof liveEst === "object" ? liveEst[out.code] : null;
  const wantMacro = !out.est && live && live.nm && live.nm.length && !live.parts;
  if(!missing.length && !wantMacro) return out;
  const sim = similarFoods(out);
  if(!sim) return out;
  const per100 = Object.assign({}, out.per100), estKeys = (out.estKeys || []).slice(), filled = [];
  missing.forEach(k => { if(sim.v[k] > 0){ per100[k] = sim.v[k]; estKeys.push(k); filled.push(k); } });
  // fehlende Makros (laut Online-Prüfung nicht auf dem Etikett) ebenfalls aus ähnlichen Lebensmitteln
  const macroEst = (out.macroEst || []).slice();
  if(wantMacro) live.nm.forEach(k => { if(!per100[k] && sim.v[k] > 0 && macroEst.indexOf(k) < 0){ per100[k] = k === "kcal" ? Math.round(sim.v[k]) : sim.v[k]; macroEst.push(k); } });
  if(!filled.length && macroEst.length === (out.macroEst || []).length) return out;
  const names = sim.names.slice(0, 3).map(n => "„" + n + "“").join(", ") + (sim.names.length > 3 ? " u. a." : "");
  const txt = "ähnlichen Lebensmitteln (grob): " + names;
  const res = Object.assign({}, out, {per100, raw: out.raw || item, est: out.est ? out.est + "; übrige Nährstoffe aus " + txt : txt,
    estV: 2, estAlt: out.est ? out.estAlt : null, estKeys, simEst: true});
  if(macroEst.length) res.macroEst = macroEst;
  return res;
};

/* Hinweis im Dialog: „Etikett eintragen“ für jedes Produkt mit Barcode */
const _renderAltHint = renderAltHint;
renderAltHint = function(it){
  _renderAltHint(it);
  if(it && it.water && !addCtx.editId && window.NW_WASSER){
    const c = NW_WASSER.cache()[(it.raw || it).code];
    if(c && c.sibling){
      const b = $("#altHint .althint");
      if(b) b.insertAdjacentHTML("beforeend", '<br><span class="muted">Mineralwerte vom Etikett von „' + esc(c.sibling) + '“ – gleicher Hersteller und gleiche Sorte.</span>');
    }
  }
  if(!it || !it.isProduct || addCtx.editId || it.water) return;
  const raw = it.raw || it, code = raw.code || addCtx.pendingCode;
  const box = $("#altHint");
  const txt = raw.userLabel ? "Etikettwerte selbst eingetragen – ändern" : it.simEst ? "Nur grob geschätzt – Werte vom Etikett eintragen" : "Werte vom Etikett eintragen oder korrigieren";
  box.insertAdjacentHTML("beforeend", '<div style="margin:-4px 0 10px"><button class="chip" id="btnLabelEdit">' + txt + '</button></div>');
  $("#btnLabelEdit", box).onclick = () => openLabel(code, it);
};

// Kennzeichnung der Durchschnittswerte für die Suche vorbereiten, sobald die Daten geladen sind
window.addEventListener("load", () => setTimeout(() => { try{ fillCodes(); }catch(e){} }, 1500));

window.NW_ETIKETT = {isFill: o => isFill(o), fillCodes, siblingWater, looksWater, unknownHook, brandFor, openLabel, parseLabel, similarFoods, off2Find};
})();
