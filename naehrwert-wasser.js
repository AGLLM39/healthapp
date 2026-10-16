/* NährWert – Mineralstoffe für Mineral-, Quell- und Tafelwasser
   Wird nach naehrwert-scan.js geladen und hängt sich an withEstimate, startLive,
   renderAltHint, pickItem und resultRow.

   Quellen je Wasser (die erste, die einen Wert kennt, gewinnt). Werte aus Datenbanken
   werden unverändert übernommen; geschätzt wird nur, wo ein Wert fehlt.
   0. selbst vom Etikett eingetragene Werte
   1. Analyseauszug im Etikettentext bei Open Food Facts (Angaben in mg/l)
   2. Mineralstoffe aus den Nährwerten bei Open Food Facts
   3. Schweizer Nährwertdatenbank: amtliche Analysen bekannter Marken (Evian, Vittel, Perrier …)
   4. Durchschnitt natürlicher Mineralwässer aus dem BLS (geschätzt, mit ≈ markiert)
   Vitamine, Omega-3 usw. enthält Wasser nicht – sie zählen als echte 0, nicht als „keine Angabe“.
   Ergebnisse je Barcode in nw1.waterMin. */
(function(){
"use strict";
if(typeof withEstimate !== "function") return;

const WATER_NAME = /(mineral|quell|tafel|heil|trink|leitungs|sprudel|tisch)wasser|\bwasser\b|\bwater\b|\beau\b|\bacqua\b|\baqua\b|\bagua\b|\bsprudel\b/;
const NOT_WATER = /\b(cola|tonic|bitter|ginger|tee|tea|saft|schorle|kokos|coconut|sirup|energy|protein|isoton|limo|limonade)\b/;
const MINERAL_KEYS = ["calcium","magnesium","natrium","kalium","eisen","zink","jod","kupfer","mangan","phosphor"];
const OFF_W = {calcium:["calcium_100g",1e3], magnesium:["magnesium_100g",1e3], natrium:["sodium_100g",1e3], kalium:["potassium_100g",1e3],
  eisen:["iron_100g",1e3], zink:["zinc_100g",1e3], jod:["iodine_100g",1e6], kupfer:["copper_100g",1e3], mangan:["manganese_100g",1e3], phosphor:["phosphorus_100g",1e3]};
// Weitere Inhaltsstoffe, die auf Wasseretiketten stehen (nur zur Anzeige, in mg/l)
const EXTRA = {hco3:["Hydrogencarbonat","bicarbonate_100g",3000], cl:["Chlorid","chloride_100g",2500], so4:["Sulfat","sulphate_100g",2500],
  f:["Fluorid","fluoride_100g",5], si:["Kieselsäure","silica_100g",150]};
// Namen im Analyseauszug (de/en/fr/it); kurze Ionen-Zeichen nur mit Ladung, sonst verwechselbar mit „mg“
const TEXT_NAMES = {
  calcium:"calcium|kalzium|calcio|ca2\\+|ca\\+\\+", magnesium:"magnesium|magnésium|magnesio|mg2\\+|mg\\+\\+",
  natrium:"natrium|sodium|sodio|na\\+", kalium:"kalium|potassium|potassio|k\\+", eisen:"eisen|iron|fer|ferro|fe2\\+",
  jod:"jodid|iodid|iodure|iodide|jod|iod", zink:"zink|zinc|zinco", mangan:"mangan|manganese|manganèse",
  hco3:"hydrogencarbonat|bicarbonat|hydrogénocarbonates?|bicarbonates?|hco3-?", cl:"chlorid|chloride|chlorures?|cloruri|cl-",
  so4:"sulfat|sulphate|sulfates?|solfati|so42-", f:"fluorid|fluoride|fluorures?|fluoruri|f-", si:"kieselsäure|silica|silice|sio2"};
// Nur für die eigene Eingabe: fängt Tippfehler ab (Höchstwerte in mg/l)
const MAXL = {calcium:700, magnesium:1200, natrium:2500, kalium:150, eisen:20, jod:500, zink:5, mangan:2, hco3:4000, cl:2500, so4:2500, f:5, si:150};

let waterMin = sget("waterMin", {});
const _busy = {};
const RETRY = 14 * 864e5;

function isWaterItem(it){
  if(!it || !it.isProduct || it.isRecipe || it.noEst) return false;
  const p = it.per100 || {};
  if((p.kcal || 0) >= 5 || (p.c || 0) > 1 || (p.z || 0) > 1 || (p.f || 0) > 0.5) return false;
  const c = it.code && waterMin[it.code];
  if(c && c.isWater != null) return c.isWater;
  const n = normalize(it.name || "");
  return WATER_NAME.test(n) && !NOT_WATER.test(n);
}
function sig(x){ return +(+x).toPrecision(3); }

/* Analyseauszug aus dem Etikettentext lesen, z. B. „Calcium (Ca²⁺) 80 mg/l“ */
function parseAnalysis(text){
  const out = {};
  if(!text) return out;
  const t = text.toLowerCase().replace(/[²]/g, "2").replace(/[³]/g, "3").replace(/[⁺]/g, "+").replace(/[⁻]/g, "-").replace(/\s+/g, " ");
  Object.keys(TEXT_NAMES).forEach(k => {
    const re = new RegExp("(?:^|[^a-zäöüé])(?:" + TEXT_NAMES[k] + ")(?![a-zäöüé])[^0-9a-zäöü]{0,6}(?:\\([^)]{0,14}\\))?[^0-9a-zäöü]{0,6}(\\d+(?:[.,]\\d+)?)\\s*(mg|µg|ug|mcg)?\\s*(?:/|je|pro|per|par)?\\s*(100\\s*ml|l|liter|litre)?", "i");
    const m = t.match(re);
    if(!m) return;
    let v = parseFloat(m[1].replace(",", "."));
    if(!(v >= 0)) return;
    const unit = (m[2] || "mg").replace(/ug|mcg/, "µg"), per = m[3] || "l";
    if(/100/.test(per)) v *= 10;                       // auf mg/l bzw. µg/l bringen
    if(k === "jod"){ if(unit === "mg") v *= 1000; }    // Jod in µg/l
    else if(unit === "µg") v /= 1000;
    out[k] = v;                                        // mg/l (Jod: µg/l), unverändert
  });
  return out;
}

/* Mineralstoff-Werte je 100 ml aus einem Open-Food-Facts-Produkt */
function fromOff(pr){
  const text = [pr.ingredients_text_de, pr.ingredients_text, pr.ingredients_text_fr, pr.ingredients_text_en, pr.ingredients_text_it]
    .filter(Boolean).join(" · ");
  const a = parseAnalysis(text);
  const v = {}, lab = {}, extra = {};
  // 1) Text (mg/l → mg/100 ml)
  MINERAL_KEYS.forEach(k => { if(a[k] != null){ v[k] = sig(a[k] / 10); lab[k] = "text"; } });
  Object.keys(EXTRA).forEach(k => { if(a[k] != null) extra[k] = sig(a[k]); });
  // 2) Mineralstoffe aus den Nährwerten bei Open Food Facts – unverändert übernommen
  const nu = pr.nutriments || {};
  const num = key => { const r = nu[key]; return r == null || r === "" || isNaN(+r) ? null : +r; };
  MINERAL_KEYS.forEach(k => {
    const r = num(OFF_W[k][0]);
    if(v[k] == null && r != null){ v[k] = sig(r * OFF_W[k][1]); lab[k] = "off"; }   // je 100 ml
  });
  Object.keys(EXTRA).forEach(k => {
    const r = num(EXTRA[k][1]);
    if(extra[k] == null && r != null) extra[k] = sig(r * 1e4);                        // mg/l
  });
  return {v, lab, extra};
}

async function waterLookup(it){
  const code = it.code;
  if(!code || !/^\d{6,14}$/.test(code)) return null;
  const have = waterMin[code];
  if(have && (Object.keys(have.v || {}).length || Date.now() - have.t < RETRY)) return have;
  if(_busy[code]) return _busy[code];
  return (_busy[code] = (async () => {
    try{
      const pr = await offProduct(code);
      const c = {t: Date.now(), v: {}, lab: {}, extra: {}};
      if(pr){
        const tags = pr.categories_tags || [];
        if(tags.some(t => /^en:([a-z-]*-)?waters$/.test(t))) c.isWater = true;
        else if(tags.some(t => /^en:(sodas|juices|teas|energy-drinks|sweetened-beverages|flavoured-waters|plant-based-beverages)/.test(t))) c.isWater = false;
        Object.assign(c, fromOff(pr));
      }
      waterMin[code] = c;
      const keys = Object.keys(waterMin);
      if(keys.length > 300) keys.sort((a, b) => waterMin[a].t - waterMin[b].t).slice(0, keys.length - 300).forEach(k => delete waterMin[k]);
      sset("waterMin", waterMin);
      return c;
    }catch(e){ return null; }        // offline – beim nächsten Mal erneut
    finally{ delete _busy[code]; }
  })());
}

/* Durchschnittswerte: Leitungs-/Trinkwasser oder natürliches Mineralwasser (BLS) */
function blsWater(name){
  const tap = /trinkwasser|leitungswasser|tafelwasser/.test(normalize(name));
  const want = tap ? "Trinkwasser" : "Natürliches Mineralwasser";
  return blsItems().find(x => !x.isCH && x.name === want) || null;
}

/* Wasser vollständig befüllen; Rückgabe wie withEstimate */
function waterItem(item){
  const c = item.code ? waterMin[item.code] : null;
  const ch = mineralWater(item.name);                  // Schweizer Analyse der Marke
  const avg = blsWater(item.name);
  const per100 = Object.assign({}, item.per100);
  MICROS.forEach(([k]) => per100[k] = 0);              // keine Vitamine im Wasser
  const srcOf = {}, estKeys = [];
  MINERAL_KEYS.forEach(k => {
    if(c && c.lab && c.lab[k] === "user"){ per100[k] = c.v[k]; srcOf[k] = "Etikett (selbst eingetragen)"; return; }
    if(c && c.lab && c.lab[k] === "text"){ per100[k] = c.v[k]; srcOf[k] = "Etikett (Analyseauszug, Open Food Facts)"; return; }
    if(c && c.v && c.v[k] != null){ per100[k] = c.v[k]; srcOf[k] = "Etikett (Open Food Facts)"; return; }
    // Natrium/Salz aus den mitgelieferten Produktdaten (unverändert), sofern dort angegeben
    if(k === "natrium" && item.per100.natrium != null && !(item.missing && item.missing.indexOf("Natrium") >= 0)){ srcOf[k] = "Etikett"; return; }
    if(ch && ch.per100[k] != null && (ch.per100[k] > 0 || ["calcium","magnesium","natrium","kalium"].indexOf(k) >= 0)){
      per100[k] = ch.per100[k]; srcOf[k] = "„" + ch.name + "“ (Schweizer Nährwertdatenbank)"; return; }
    if(avg && avg.per100[k] != null){ per100[k] = avg.per100[k]; srcOf[k] = "Durchschnitt „" + avg.name + "“ (BLS)"; estKeys.push(k); }
  });
  const used = [];
  estKeys.forEach(k => { if(used.indexOf(srcOf[k]) < 0) used.push(srcOf[k]); });
  const out = Object.assign({}, item, {per100, raw: item, labelMicros: MICROS.length, water: {src: srcOf, extra: (c && c.extra) || {}, pending: !c && !!item.code}});
  delete out.noNutrition;
  if(estKeys.length) Object.assign(out, {est: used.join(", "), estV: 2, estKeys});
  else { delete out.est; delete out.estKeys; }
  return out;
}

const _withEstimate = withEstimate;
withEstimate = function(item){
  if(item && item.water) return item;
  if(!isWaterItem(item && (item.raw || item))) return _withEstimate(item);
  return waterItem(item.raw || item);
};

const _startLive = startLive;
startLive = function(it){
  const raw = it && (it.raw || it);
  if(!isWaterItem(raw)) return _startLive(it);
  if(!raw.code || navigator.onLine === false || (waterMin[raw.code] && Object.keys(waterMin[raw.code].v || {}).length)) return;
  addCtx.liveBusy = raw.code;
  renderAltHint(withEstimate(raw));
  waterLookup(raw).then(() => {
    if(addCtx.liveBusy === raw.code) addCtx.liveBusy = null;
    const sel = addCtx.sel;
    if(!sel || addCtx.editId || ((sel.raw || sel).code !== raw.code)) return;
    addCtx.sel = withEstimate(sel.raw || sel);
    renderAltHint(addCtx.sel); updatePreview();
  });
};

/* Hinweis im Hinzufügen-Dialog */
const MIN_LABEL = {calcium:"Calcium", magnesium:"Magnesium", natrium:"Natrium", kalium:"Kalium"};
const _renderAltHint = renderAltHint;
renderAltHint = function(it){
  _renderAltHint(it);
  const w = it && it.water;
  if(!w || addCtx.editId) return;
  const box = $("#altHint");
  const busy = addCtx.liveBusy && addCtx.liveBusy === (it.raw || it).code;
  const p = it.per100;
  const main = Object.keys(MIN_LABEL).map(k => MIN_LABEL[k] + " " + fmt(p[k] * 10, p[k] * 10 < 10 ? 1 : 0) + (it.estKeys && it.estKeys.indexOf(k) >= 0 ? " (≈)" : "")).join(" · ");
  const ex = Object.keys(w.extra || {}).map(k => EXTRA[k][0] + " " + fmt(w.extra[k], w.extra[k] < 10 ? 1 : 0)).join(" · ");
  const srcs = [];
  Object.keys(w.src).forEach(k => { if(srcs.indexOf(w.src[k]) < 0) srcs.push(w.src[k]); });
  const code = (it.raw || it).code;
  const avgMain = it.estKeys && (it.estKeys.indexOf("calcium") >= 0 || it.estKeys.indexOf("magnesium") >= 0);
  box.innerHTML = '<div class="nodata althint"><b>Mineralwasser</b> – je Liter: ' + main + ' mg' + (ex ? '<br>' + ex + ' mg' : '') +
    '<br>Quelle: ' + esc(srcs.join("; ") || "–") + '. Vitamine enthält Wasser nicht.' +
    (busy ? '<br>Etikett wird online bei Open Food Facts gesucht …' : '') +
    (code && !busy ? '<details class="prep" style="margin:6px 0 0"' + (avgMain ? ' open' : '') + '><summary>' +
      (avgMain ? 'Für diese Marke sind keine Werte bekannt – vom Etikett eintragen' : 'Werte vom Etikett eintragen oder korrigieren') + '</summary>' +
      '<div class="small muted" style="margin:2px 0 6px">Angaben in mg pro Liter, wie im Analyseauszug auf der Flasche. Die App merkt sich die Werte für diesen Barcode.</div>' +
      '<div class="wform" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      Object.keys(MIN_LABEL).map(k => '<label class="small">' + MIN_LABEL[k] + '<input type="text" inputmode="decimal" autocomplete="off" placeholder="mg/l" data-wmin="' + k + '" value="' +
        (it.estKeys && it.estKeys.indexOf(k) >= 0 ? '' : sig(p[k] * 10)) + '"></label>').join("") +
      '</div><button class="chip" id="btnWaterSave" style="margin-top:8px">Werte übernehmen</button></details>' : '') + '</div>' +
    (addCtx.pendingCode ? '<div class="small muted" style="margin:-4px 0 10px">Wird mit Barcode ' + esc(addCtx.pendingCode) + ' verknüpft.</div>' : '');
  const btn = $("#btnWaterSave", box);
  if(btn) btn.onclick = () => {
    const c = waterMin[code] || (waterMin[code] = {t: Date.now(), v: {}, lab: {}, extra: {}});
    c.v = c.v || {}; c.lab = c.lab || {}; c.isWater = true;
    let n = 0;
    box.querySelectorAll("[data-wmin]").forEach(inp => {
      const x = parseFloat(String(inp.value).replace(",", "."));
      const k = inp.dataset.wmin;
      if(x >= 0 && x <= MAXL[k]){ c.v[k] = sig(x / 10); c.lab[k] = "user"; n++; }
    });
    if(!n){ toast("Bitte mindestens einen Wert in mg/l eintragen"); return; }
    sset("waterMin", waterMin);
    addCtx.sel = waterItem(it.raw || it);
    renderAltHint(addCtx.sel); updatePreview();
    toast("Mineralstoffe für diesen Barcode gespeichert");
  };
};

/* Auswahl: Hinweistext unter dem Namen passend für Wasser */
const _pickItem = pickItem;
pickItem = function(it){
  const r = _pickItem(it);
  if(isWaterItem(it && (it.raw || it)))
    $("#selInfo").textContent = "je 100 ml: " + fmt(Math.round(it.per100.kcal)) + " kcal · Mineralstoffe je nach Quelle, siehe unten.";
  return r;
};

/* Suchliste: „Mineralwasser“ statt „ohne Vitamine“ */
const _resultRow = resultRow;
resultRow = function(it, idx){
  const h = _resultRow(it, idx);
  if(!isWaterItem(it)) return h;
  const c = it.code && waterMin[it.code];
  const txt = c && Object.keys(c.v || {}).length ? "Mineralwasser · Mineralstoffe laut Etikett" : "Mineralwasser · Mineralstoffe" + (it.code ? " online" : " ≈ Durchschnitt");
  return h.replace(/Markenprodukt( · [^<]*)?/, txt);
};

window.NW_WASSER = {parseAnalysis, fromOff, isWaterItem, waterLookup, waterItem, cache: () => waterMin};
})();
