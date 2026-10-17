/* NährWert – „Einfach sagen“: Sprach- und Satzeingabe
   „Zum Frühstück zwei Eier, eine Scheibe Vollkornbrot mit Butter und ein Glas Orangensaft“
   → vier Einträge mit Mengen in Gramm bzw. ml. Die Nährwerte kommen unverändert aus den
   Datenbanken der App (Grundnahrungsmittel, BLS, Schweiz, Open Food Facts).

   Ohne KI-Modell und ohne eigenen Server:
   - Hören: Spracherkennung des Browsers (Web Speech API). Wo es die nicht gibt,
     funktioniert das Mikrofon der Handy-Tastatur im Textfeld genauso.
   - Verstehen: feste Regeln für Zahlwörter, Mengen („Scheibe“, „Glas“, „Handvoll“),
     Größen und Mahlzeiten. Das läuft komplett auf dem Gerät und auch offline.
   Vor dem Eintragen zeigt eine Liste, was erkannt wurde; Lebensmittel und Mengen
   lassen sich dort ändern. */
(function(){
"use strict";
if(typeof entryFromItem !== "function" || typeof allLocalItems !== "function") return;

const el = id => document.getElementById(id);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

/* ---------- Zahlen ---------- */
const ONES = {ein:1,eins:1,eine:1,einen:1,einem:1,einer:1,eines:1,zwei:2,zwo:2,drei:3,vier:4,funf:5,sechs:6,sieben:7,acht:8,neun:9};
const ARTICLES = new Set(["ein","eine","einen","einem","einer","eines"]);
const TEENS = {zehn:10,elf:11,zwolf:12,dreizehn:13,vierzehn:14,funfzehn:15,sechzehn:16,siebzehn:17,achtzehn:18,neunzehn:19};
const TENS = {zwanzig:20,dreissig:30,vierzig:40,funfzig:50,sechzig:60,siebzig:70,achtzig:80,neunzig:90};
/* „zweihundertfünfzig“ → 250, „fünfundzwanzig“ → 25, „anderthalb“ → 1,5 */
function wordNum(w){
  if(!w) return null;
  if(w === "anderthalb" || w === "eineinhalb") return 1.5;
  if(w === "dreiviertel") return 0.75;
  if(w === "doppelt" || w === "doppelte" || w === "doppelten") return 2;
  let m = w.match(/^(.+)einhalb$/);
  if(m){ const a = wordNum(m[1]); return a != null ? a + 0.5 : null; }
  m = w.match(/^(.*?)tausend(.*)$/);
  if(m){ const a = m[1] ? wordNum(m[1]) : 1, b = m[2] ? wordNum(m[2]) : 0; return a != null && b != null ? a * 1000 + b : null; }
  m = w.match(/^(.*?)hundert(.*)$/);
  if(m){ const a = m[1] ? wordNum(m[1]) : 1, b = m[2] ? wordNum(m[2]) : 0; return a != null && b != null ? a * 100 + b : null; }
  if(w in TEENS) return TEENS[w];
  if(w in TENS) return TENS[w];
  m = w.match(/^(.+)und(.+)$/);
  if(m && (m[1] in ONES) && (m[2] in TENS)) return ONES[m[1]] + TENS[m[2]];
  if(w in ONES) return ONES[w];
  return null;
}
// Bruchteile, die eine Anzahl verändern: „eine halbe Avocado“, „drei viertel Liter“
const FRACTION = {halb:0.5,halbe:0.5,halben:0.5,halber:0.5,halbes:0.5,halbem:0.5,viertel:0.25,drittel:1/3};

/* ---------- Mengen ---------- */
const UNIT_WORDS = {
  g:"g", gr:"g", gramm:"g", kg:"kg", kilo:"kg", kilogramm:"kg",
  ml:"ml", milliliter:"ml", l:"l", liter:"l", cl:"cl", zentiliter:"cl", dl:"dl", deziliter:"dl",
  stuck:"stueck", stucke:"stueck", stuckchen:"stueck", stk:"stueck",
  scheibe:"scheibe", scheiben:"scheibe", scheibchen:"scheibe",
  glas:"glas", glaser:"glas", glaschen:"glas", tasse:"tasse", tassen:"tasse", becher:"becher", pott:"becher",
  flasche:"flasche", flaschen:"flasche", dose:"dose", dosen:"dose", kanne:"kanne",
  essloffel:"el", el:"el", teeloffel:"tl", tl:"tl", loffel:"el",
  handvoll:"handvoll", portion:"portion", portionen:"portion",
  kugel:"kugel", kugeln:"kugel", riegel:"riegel", teller:"teller", schussel:"schuessel", schusseln:"schuessel",
  schale:"schale", schalchen:"schale", prise:"prise", prisen:"prise", zehe:"zehe", zehen:"zehe",
  packung:"packung", packungen:"packung", packchen:"packung", tute:"tute", stange:"stange", stangen:"stange",
  schuss:"schuss", spritzer:"schuss", bissen:"bissen", happen:"bissen"
};
const MASS = {g:1, kg:1000, ml:1, l:1000, cl:10, dl:100};
const UNIT_LABEL = {stueck:"Stück", scheibe:"Scheibe", glas:"Glas", tasse:"Tasse", becher:"Becher", flasche:"Flasche", dose:"Dose",
  kanne:"Kanne", el:"EL", tl:"TL", handvoll:"Handvoll", portion:"Portion", kugel:"Kugel", riegel:"Riegel", teller:"Teller",
  schuessel:"Schüssel", schale:"Schale", prise:"Prise", zehe:"Zehe", packung:"Packung", tute:"Tüte", stange:"Stange",
  schuss:"Schuss", bissen:"Bissen"};
// Übliche Mengen, wenn das Lebensmittel selbst keine passende Portion kennt: [fest, Getränk]
const UNIT_G = {stueck:[100,250], glas:[200,200], tasse:[150,150], becher:[150,250], flasche:[500,500], dose:[150,330],
  kanne:[1000,1000], el:[10,10], tl:[5,5], handvoll:[30,30], portion:[150,250], kugel:[60,60], riegel:[40,40], teller:[300,300],
  schuessel:[250,250], schale:[150,200], prise:[0.5,0.5], zehe:[4,4], packung:[150,500], tute:[150,150], stange:[80,80],
  schuss:[20,20], bissen:[20,20]};
function sliceGrams(it){
  const n = normalize(it.name);
  if(/toast/.test(n)) return 25;
  if(/brot|baguette|stuten|zopf/.test(n)) return 45;
  if(/kase|gouda|emmentaler|cheddar|scheiblett/.test(n)) return 20;
  if(/salami|schinken|wurst|mortadella|aufschnitt|speck|bacon|lachs/.test(n)) return 15;
  if(/ananas|melone/.test(n)) return 80;
  if(/zitrone|gurke|tomate/.test(n)) return 15;
  return 30;
}
const SIZE = {klein:0.75,kleine:0.75,kleinen:0.75,kleiner:0.75,kleines:0.75,kleinem:0.75,
  gross:1.3,grosse:1.3,grossen:1.3,grosser:1.3,grosses:1.3,grossem:1.3,
  riesig:1.6,riesige:1.6,riesigen:1.6,riesiger:1.6,riesiges:1.6,
  dick:1.3,dicke:1.3,dicken:1.3,dicker:1.3,dickes:1.3, dunn:0.7,dunne:0.7,dunnen:0.7,dunner:0.7,dunnes:0.7,
  mittel:1,mittlere:1,mittleren:1,mittlerer:1,mittleres:1,mittelgross:1,mittelgrosse:1,mittelgrossen:1,mittelgrosser:1,mittelgrosses:1};
const FILL = new Set(("ich,hab,habe,hatte,hatten,haben,esse,ass,essen,gegessen,getrunken,trinke,trank,trinken,noch,auch,heute,gerade,eben,grad," +
  "zum,zur,zu,als,am,beim,bei,im,in,fur,mir,mal,so,ca,circa,zirka,etwa,ungefahr,rund,knapp,gut,x,von,vom,der,die,das,den,dem,des," +
  "mein,meine,meinen,meinem,bitte,eintragen,trag,trage,notiere,notier,hinzufugen,fuge,gab,es,gibt,nahm,genommen,verputzt,jeweils,je,a,pro,davon").split(","));
// Beschreibende Wörter, die beim Suchen nur stören: „frische Erdbeeren“, „selbstgemachte Pizza“
["frisch","lecker","selbstgemacht","hausgemacht","warm","kalt","normal","lauwarm"].forEach(a => ["", "e", "en", "er", "es", "em"].forEach(e => FILL.add(a + e)));
const FEW = new Set(["etwas","bisschen","wenig","paar"]);

/* ---------- Mahlzeiten ---------- */
// „Frühstück“ auch getippt als „Fruehstueck“ oder „Fruhstuck“
const FR = "fr(?:ü|ue|u)hst(?:ü|ue|u)ck";
const MEAL_DEF = [["fruehstueck", FR + "en|" + FR + "|gefr(?:ü|ue|u)hst(?:ü|ue|u)ckt|morgens|morgen"],
  ["mittag", "mittagessen|mittags|mittag|lunch"], ["abend", "abendessen|abendbrot|abends|abend|dinner"],
  ["snack", "snacks|snack|zwischendurch|nachmittags|zwischenmahlzeit"]];
const MEAL_WORDS = MEAL_DEF.map(([k, a]) => [k, new RegExp("(^|\\s)(?:" + a + ")(?=\\s|$)", "i")]);
const MEAL_STRIP = new RegExp("(^|\\s)(?:(?:zum|zur|zu|als|am|heute|beim)\\s+)?(?:" + MEAL_DEF.map(m => m[1]).join("|") + ")(?=\\s|$)", "gi");

/* ---------- Häufige Wörter → Lebensmittel der App ---------- */
const SYN = {
  "milch":"Vollmilch 3,5 %", "kaffee":"Kaffee (schwarz)", "schwarzer kaffee":"Kaffee (schwarz)", "tee":"Schwarzer Tee",
  "wasser":"Mineralwasser", "sprudel":"Mineralwasser", "sprudelwasser":"Mineralwasser", "leitungswasser":"Wasser (Leitungswasser)",
  "reis":"Reis (gekocht)", "nudeln":"Nudeln (gekocht)", "pasta":"Nudeln (gekocht)", "spaghetti":"Spaghetti (gekocht)",
  "kartoffel":"Kartoffeln (gekocht)", "kartoffeln":"Kartoffeln (gekocht)", "salzkartoffeln":"Kartoffeln (gekocht)",
  "pommes":"Pommes frites", "fritten":"Pommes frites", "joghurt":"Naturjoghurt 3,5 %", "jogurt":"Naturjoghurt 3,5 %", "quark":"Magerquark",
  "o saft":"Orangensaft", "osaft":"Orangensaft", "o-saft":"Orangensaft", "paprika":"Paprika (rot)", "mohre":"Karotte", "mohren":"Karotte", "karotten":"Karotte",
  "hahnchen":"Hähnchenbrust", "huhn":"Hähnchenbrust", "pute":"Putenbrust", "hack":"Gemischtes Hackfleisch", "hackfleisch":"Gemischtes Hackfleisch",
  "thunfisch":"Thunfisch (Dose, Wasser)", "nutella":"Nuss-Nougat-Creme", "schokolade":"Milchschokolade", "schoki":"Milchschokolade",
  "salat":"Blattsalat", "kurbis":"Kürbis (Hokkaido)", "mais":"Mais (Dose)", "linsen":"Linsen (gekocht)", "kichererbsen":"Kichererbsen (gekocht)",
  "musli":"Müsli (ungesüßt)", "brot":"Roggenmischbrot", "kase":"Gouda", "eis":"Vanilleeis", "pizza":"Pizza Margherita", "doner":"Döner Kebab",
  "burger":"Hamburger", "chips":"Kartoffelchips", "kekse":"Butterkekse", "keks":"Butterkekse", "smoothie":"Smoothie (Frucht)", "kakao":"Kakao (mit Milch)",
  "latte":"Latte Macchiato", "wein":"Rotwein", "ruhrei":"Rührei (zubereitet)", "spiegeleier":"Spiegelei", "frikadellen":"Frikadelle",
  "bulette":"Frikadelle", "buletten":"Frikadelle", "semmel":"Brötchen", "semmeln":"Brötchen", "schrippe":"Brötchen", "schrippen":"Brötchen",
  "weck":"Brötchen", "wecken":"Brötchen", "brezel":"Laugenbrezel", "breze":"Laugenbrezel", "brezeln":"Laugenbrezel", "toast":"Toastbrot",
  "hafermilch":"Haferdrink (ungesüßt)", "sojamilch":"Sojadrink (ungesüßt)", "mandelmilch":"Mandeldrink (ungesüßt)", "tomatensauce":"Tomatensauce (Passata)",
  "tomatensosse":"Tomatensauce (Passata)", "sosse":"Tomatensauce (Passata)", "weintraube":"Weintrauben", "trauben":"Weintrauben", "ol":"Olivenöl",
  "nusse":["Walnüsse","Haselnüsse","Mandeln","Cashewkerne","Erdnüsse","Studentenfutter"], "nuss":["Walnüsse","Haselnüsse","Mandeln"],
  "obst":["Apfel","Banane","Orange"], "gemuse":["Tiefkühl-Gemüsemischung","Brokkoli","Karotte"], "beeren":["Blaubeeren","Erdbeeren","Himbeeren"]
};
// Beilagen nach „mit“: übliche Menge in g, true = je Scheibe/Stück des Hauptlebensmittels
const ADDON = [[/butter|margarine/,10,true],[/marmelade|konfiture|gelee/,20,true],[/honig/,10,true],[/nutella|nuss nougat|nougat|schokocreme/,15,true],
  [/frischkase/,20,true],[/kase|gouda|emmentaler|camembert|feta/,20,true],[/salami|schinken|wurst|mortadella|aufschnitt/,15,true],
  [/milch|drink/,150],[/zucker|sussstoff/,5],[/sahne/,20],[/ketchup|mayo|senf|remoulade/,15],[/pesto/,30],[/sosse|sauce|sugo|passata/,100],[/dressing/,20],
  [/\bol\b|olivenol|rapsol/,10],[/quark|joghurt|skyr/,100]];

/* ---------- Satz zerlegen ---------- */
function prep(text){
  return (" " + text + " ")
    .replace(/½/g, " 0§5 ").replace(/¼/g, " 0§25 ").replace(/¾/g, " 0§75 ")
    .replace(/(\d+)\s*\/\s*(\d+)/g, (m, a, b) => " " + String(Math.round(a / b * 1000) / 1000).replace(".", "§") + " ")
    .replace(/(\d)[,.](\d)/g, "$1§$2")
    .replace(/(\d)\s*([a-zA-ZäöüÄÖÜß])/g, "$1 $2")
    .replace(/([a-zA-ZäöüÄÖÜß])(\d)/g, "$1 $2")
    .replace(/\s*&\s*/g, " und ");
}
const SPLIT = /\s+(?:und|sowie|plus|dazu|ausserdem|außerdem|danach|dann|anschließend|anschliessend|zusätzlich|zusatzlich)\s+/i;

/* Ein Satzteil → {food, qty, unit, size, few} */
function parseSpec(raw){
  const toks = raw.split(/\s+/).filter(Boolean);
  const nums = [], units = [], food = [];
  let frac = 1, size = 1, few = false;
  for(let i = 0; i < toks.length; i++){
    const orig = toks[i].replace(/^[„"'(]+|[“"'),:]+$/g, "");
    const w = normalize(orig).replace(/[^a-z0-9§%-]/g, "");
    if(!w) continue;
    if(/^\d+(§\d+)?$/.test(w)){ nums.push({v: parseFloat(w.replace("§", ".")), i, art: false}); continue; }
    if(w in FRACTION){ frac *= FRACTION[w]; continue; }
    const n = wordNum(w);
    if(n != null){ nums.push({v: n, i, art: ARTICLES.has(w)}); continue; }
    if(w === "hand" && normalize(toks[i + 1] || "") === "voll"){ units.push({u: "handvoll", i}); i++; continue; }
    if(UNIT_WORDS[w]){ units.push({u: UNIT_WORDS[w], i}); continue; }
    if(w in SIZE){ size *= SIZE[w]; continue; }
    if(FEW.has(w)){ few = true; continue; }
    if(FILL.has(w)) continue;
    food.push(orig);
  }
  const before = idx => nums.filter(x => x.i < idx).pop() || null;
  let qty = null, unit = null, art = false;
  const mass = units.find(u => MASS[u.u]);
  if(mass){
    const nb = before(mass.i) || nums.find(x => x.i > mass.i);
    qty = nb ? nb.v : 1; unit = mass.u;
    // „2 Scheiben Brot à 40 g“ → 80 g
    const other = nums.find(x => x !== nb && x.i < (nb ? nb.i : mass.i) && !x.art);
    if(other && /(^|\s)(a|à|je|pro|jeweils)(\s|$)/i.test(raw)) qty *= other.v;
  } else if(units.length){
    const nb = before(units[0].i);
    qty = nb ? nb.v : (nums.length ? nums[0].v : 1); art = !!(nb && nb.art); unit = units[0].u;
  } else if(nums.length){
    const nb = nums.find(x => !x.art) || nums[0];
    qty = nb.v; art = nb.art;
    if(!nb.art && qty >= 15) unit = "g";            // „Banane 70“ – Einheit verschluckt
  }
  if(frac !== 1) qty = (qty == null ? 1 : qty) * frac;
  return {food: food.join(" ").trim(), qty, unit, size, few, art};
}

/* ---------- Lebensmittel finden ---------- */
/* _vn: Name ohne Klammerzusatz („Reis (gekocht)“ → „reis“), _vw: alle Wörter inkl. Klammer, _vc: Wortzahl ohne Klammer */
function vname(it){
  if(it._vn == null){
    const n = normalize(it.name);
    it._vn = n.replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9%]+/g, " ").trim();
    it._vw = n.replace(/[^a-z0-9%]+/g, " ").trim().split(" ").filter(Boolean);
    it._vc = it._vn.split(" ").filter(Boolean).length;
  }
  return it._vn;
}
// Wort aus dem Satz passt zu einem Wort im Namen: gleich, Anfang („banane“ → „bananenchips“),
// Wortende bei Komposita („milch“ → „vollmilch“) oder gebeugt („gekochte“ → „gekocht“)
// gleiches Wort, höchstens anders gebeugt („gekocht“/„gekochte“, „Ei“/„Eier“)
function sameWord(x, w){
  return x === w || (Math.min(x.length, w.length) >= 2 && Math.abs(x.length - w.length) <= 2 && (x.indexOf(w) === 0 || w.indexOf(x) === 0));
}
function wordHit(x, w){
  return x === w || x.indexOf(w) === 0 || (w.length >= 5 && x.length > w.length && x.slice(-w.length) === w) ||
    (x.length >= 4 && w.indexOf(x) === 0 && w.length - x.length <= 2);
}
function singular(w){
  const v = [];
  if(w.length > 4 && /en$/.test(w)) v.push(w.slice(0, -1), w.slice(0, -2));
  else if(w.length > 3 && /er$/.test(w)) v.push(w.slice(0, -2));
  else if(w.length > 4 && /[ln]$/.test(w)) v.push(w.slice(0, -1));
  else if(w.length > 4 && /[es]$/.test(w)) v.push(w.slice(0, -1));
  return v;
}
let _hist = null;
/* Wie oft wurde ein Lebensmittel schon eingetragen? (für „das, was ich sonst auch nehme“) */
function history(){
  if(_hist && _hist.n === log.length) return _hist;
  const c = {};
  log.slice(-400).forEach(e => { c[e.name] = (c[e.name] || 0) + 1; });
  const items = Object.keys(c).map(n => findItemByName(n)).filter(Boolean);
  _hist = {n: log.length, c, items};
  return _hist;
}
/* Grunddatenbanken (BLS, Schweiz) getrennt von den Markenprodukten der Offline-Erweiterung –
   die Suche über rund 8.000 statt 100.000 Einträge hält die Erkennung auch auf dem Handy flott */
let _split = null;
function splitItems(){
  const all = blsItems();
  if(!_split || _split.src !== all || _split.len !== all.length)
    _split = {src: all, len: all.length, gen: all.filter(it => !it.isOFF2), brand: all.filter(it => it.isOFF2)};
  return _split;
}
function genericItems(){ return splitItems().gen; }
function brandItems(){ return splitItems().brand; }
function searchList(list, nq){
  const terms = nq.split(/\s+/).filter(Boolean);
  if(!terms.length) return [];
  const out = [];
  for(let i = 0; i < list.length; i++){
    const it = list[i];
    if(terms.every(t => termHit(it, t) || stemHit(it, t))) out.push(it);
  }
  return out;
}
function srcBonus(it){
  return it.isRecipe ? 14 : it.src === "lokal" ? 12 : it.isOFF2 ? -15 : it.isProduct ? -20 : it.isFDC ? -25 : it.isCH ? -2 : 0;
}
function scoreItem(it, q, qw){
  vname(it);
  const nw = it._vw;
  if(!nw.length) return 0;
  let hit = 0;
  qw.forEach(w => {
    if(nw.some(x => wordHit(x, w))) hit++;
    else if(w.length >= 4 && it._vn.replace(/ /g, "").indexOf(w) >= 0) hit += 0.6;
  });
  if(hit < qw.length * 0.75) return 0;
  let s = 40 * hit / qw.length;
  // gleiche Wörter in anderer Reihenfolge: „gekochte Kartoffeln“ = „Kartoffeln (gekocht)“
  const same = hit === qw.length && nw.length === qw.length && nw.every(x => qw.some(w => sameWord(x, w)));
  if(it._vn === q || same) s += 60;
  else if(it._vn.indexOf(q + " ") === 0) s += 45;
  else if(nw[0] === qw[0]) s += 35;
  else if(nw[0].indexOf(qw[0]) === 0) s += 15;
  s -= Math.max(0, it._vc - qw.length) * 4;
  const h = history().c[it.name];
  if(h) s += Math.min(20, 4 * h);
  return s + srcBonus(it) - it.name.length * 0.01;   // bei Gleichstand der kürzere Name
}
/* Kandidaten für einen Namen, beste zuerst */
function findCandidates(phrase, depth){
  const q = normalize(phrase).replace(/[^a-z0-9%]+/g, " ").trim();
  if(!q) return [];
  const words = q.split(" ");
  const last = words[words.length - 1];
  const variants = [q].concat(singular(last).map(s => words.slice(0, -1).concat(s).join(" ")));
  const pool = new Map();
  const consider = (it, bonus) => {
    if(!it) return;
    let best = 0;
    variants.forEach((v, vi) => { const s = scoreItem(it, v, v.split(" ")) - (vi ? 3 : 0); if(s > best) best = s; });
    if(best <= 0 && !bonus) return;
    best += bonus || 0;
    const prev = pool.get(it.name);
    if(!prev || prev.s < best) pool.set(it.name, {it, s: best});
  };
  const syn = SYN[q] || SYN[q.replace(/ /g, "")] || variants.map(v => SYN[v]).find(Boolean);
  if(syn) [].concat(syn).forEach((n, i) => consider(findItemByName(n), 100 - i * 4));
  allLocalItems().forEach(it => consider(it));
  recipes.forEach((r, i) => { if(variants.some(v => scoreItem({name: r.name}, v, v.split(" ")) > 0)) consider(recipeToItem(r, "R" + i)); });
  history().items.forEach(it => consider(it));
  variants.forEach((v, vi) => { if(vi === 0 || pool.size < 3) searchList(genericItems(), v).forEach(it => consider(it)); });
  let list = Array.from(pool.values()).sort((a, b) => b.s - a.s);
  // Markenprodukte nur, wenn die Grunddatenbanken nichts Passendes haben
  if(!list.length || list[0].s < 70){
    searchProducts(q, 6).items.forEach(it => consider(it));
    searchList(brandItems(), q).slice(0, 12).forEach(it => consider(it));
    list = Array.from(pool.values()).sort((a, b) => b.s - a.s);
  }
  // „frische Erdbeeren“, „mein Proteinriegel“: notfalls nur mit dem Hauptwort (letztes Wort) suchen
  if((!list.length || list[0].s < 45) && words.length > 1 && !depth){
    findCandidates(words.slice(1).join(" "), 1).concat(words.length > 2 ? findCandidates(last, 1) : []).forEach(h => {
      const prev = pool.get(h.it.name);
      if(!prev || prev.s < h.s - 8) pool.set(h.it.name, {it: h.it, s: h.s - 8});
    });
    list = Array.from(pool.values()).sort((a, b) => b.s - a.s);
  }
  return list.slice(0, 8);
}
/* „Kaffee mit Milch“ als ein Lebensmittel behalten? Nur, wenn ein Name alle Wörter genau enthält. */
function strictWhole(phrase){
  const qw = normalize(phrase).replace(/[^a-z0-9%]+/g, " ").trim().split(" ").filter(w => w && w !== "mit");
  if(qw.length < 2) return null;
  const hits = findCandidates(phrase);
  for(const h of hits.slice(0, 4)){
    const it = h.it;
    if(it.isProduct || it.isOFF2) continue;
    const nw = it._vw || [];
    const match = x => qw.some(w => x === w || singular(x).indexOf(w) >= 0 || singular(w).indexOf(x) >= 0);
    const ok = qw.every(w => nw.some(x => x === w || singular(x).indexOf(w) >= 0 || singular(w).indexOf(x) >= 0));
    // höchstens zwei zusätzliche Wörter: „Kaffee (Getränk) mit Milch 3,5 % Fett“ ja,
    // „Haferflocken gesüßt, mit Milch … und Fruchtmischung“ nein
    const extra = (it._vn || "").split(" ").filter(x => x && x !== "mit" && !/^[\d%]+$/.test(x) && !match(x)).length;
    if(ok && extra <= 2 && nw[0] && nw[0].indexOf(qw[0].slice(0, 4)) === 0) return h;
  }
  return null;
}

/* ---------- Menge in g/ml ---------- */
function parsePortion(p){
  const m = String(p[0]).match(/^\s*([\d.,½¼¾]+)?\s*(.*)$/);
  let c = 1;
  if(m && m[1]) c = m[1] === "½" ? 0.5 : m[1] === "¼" ? 0.25 : m[1] === "¾" ? 0.75 : parseFloat(m[1].replace(",", ".")) || 1;
  const rest = ((m && m[2]) || "").trim();
  const word = normalize(rest).split(/[\s/(]+/)[0];
  const unit = UNIT_WORDS[word] || null;
  // „1 mittlere“ → Stück, „½ Avocado“ / „1 Pizza“ → so wie dort benannt
  const label = unit ? (UNIT_LABEL[unit] || rest) : (!word || word in SIZE) ? "Stück" : rest.split(/[\s/(]+/)[0];
  return {count: c, word, unit, grams: p[1], label};
}
/* g je Einheit; ohne Einheit zuerst eine Portion, die wie das Gesagte heißt („eine Pizza“ → „1 Pizza“) */
function portionFor(it, unit, said){
  const ps = (it.portions || []).map(parsePortion);
  let p = null;
  if(unit === "stueck" && said){
    const sw = [].concat.apply([], normalize(said).split(/\s+/).map(w => singular(w).concat(w)));
    p = ps.find(x => !x.unit && x.word && sw.indexOf(x.word) >= 0);
  }
  if(!p) p = ps.find(x => x.unit === unit);
  if(!p && unit === "stueck") p = ps.find(x => x.unit === "stueck") || ps.find(x => !x.unit || x.unit === "portion");
  if(!p && unit === "portion") p = ps.find(x => x.unit === "stueck") || ps[0];
  return p ? {g: p.grams / p.count, label: p.label} : null;
}
function addonGrams(phrase){
  const n = normalize(phrase);
  for(const a of ADDON) if(a[0].test(n)) return {g: a[1], perPiece: !!a[2]};
  return null;
}
function resolveAmount(it, spec, main){
  const drink = !!it.isDrink, u = drink ? "ml" : "g";
  if(it.isRecipe){
    const q = spec.qty != null && !MASS[spec.unit] ? spec.qty : 1;
    return {amount: Math.round(q * 2) / 2 || 1, how: q === 1 ? "1 Portion" : fmtQ(q) + " Portionen"};
  }
  if(spec.unit && MASS[spec.unit]) return {amount: Math.round(spec.qty * MASS[spec.unit]), how: ""};
  let per = null, label = "";
  if(spec.unit){
    const p = portionFor(it, spec.unit);
    if(p){ per = p.g; label = UNIT_LABEL[spec.unit] || p.label; }
    else {
      per = spec.unit === "scheibe" ? sliceGrams(it) : (UNIT_G[spec.unit] || [100, 250])[drink ? 1 : 0];
      label = UNIT_LABEL[spec.unit] || spec.unit;
    }
  } else if(main && spec.qty == null){
    // Beilage ohne eigene Menge: „Brot mit Butter“
    const a = addonGrams(spec.food);
    if(a){
      const coffee = /kaffee|tee|espresso|cappuccino|kakao|latte/.test(normalize(main.it.name));
      per = /milch/.test(normalize(spec.food)) ? (coffee ? 30 : 150) : a.g;
      const pieces = a.perPiece && main.spec.qty && main.spec.qty <= 4 && (main.spec.unit === "scheibe" || main.spec.unit === "stueck" || !main.spec.unit) ? main.spec.qty : 1;
      return {amount: Math.round(per * pieces), how: "übliche Menge als Beilage"};
    }
  }
  if(per == null){
    const p = portionFor(it, "stueck", spec.food) || (it.portions && it.portions[0] ? {g: it.portions[0][1], label: parsePortion(it.portions[0]).label} : null);
    if(p){ per = p.g; label = p.label; }
    else { per = drink ? 250 : 100; label = drink ? "Glas" : "Portion"; }
  }
  const q = spec.qty != null ? spec.qty : (spec.few ? 0.5 : 1);
  const amount = Math.max(1, Math.round(q * per * spec.size));
  const sizeTxt = spec.size > 1.05 ? " (groß)" : spec.size < 0.95 ? " (klein)" : "";
  const one = per * spec.size;
  const perTxt = fmt(one, one < 10 ? 1 : 0) + " " + u;
  return {amount, how: (q === 1 ? "1 " + label + sizeTxt + " = " : fmtQ(q) + " × " + label + sizeTxt + " à ") + perTxt};
}
function fmtQ(q){ return q === 0.5 ? "½" : q === 0.25 ? "¼" : q === 0.75 ? "¾" : q === 1.5 ? "1½" : fmt(q, q % 1 ? 1 : 0); }

/* ---------- Ganzer Text → Zeilen ---------- */
function parseText(text){
  const out = [];
  let meal = null;
  const clauses = [];
  prep(text).split(/[;,.!?:\n]+/).forEach(c => c.split(SPLIT).forEach(x => clauses.push(x)));
  clauses.forEach(clause => {
    const c = " " + clause.trim() + " ";
    MEAL_WORDS.forEach(([k, rx]) => { if(rx.test(c)) meal = k; });
    const keep = c.replace(MEAL_STRIP, "$1").replace(/\s+ohne\s.*$/i, "").trim();
    if(!keep) return;
    const parts = keep.split(/\s+mit\s+/i);
    const specs = parts.map(parseSpec);
    if(!specs[0].food && specs.length === 1) return;
    // Ganze Wendung behalten („Kaffee mit Milch“, „Müsli mit Milch & Obst“)?
    if(parts.length > 1 && specs.slice(1).every(s => s.qty == null && !s.unit)){
      const whole = strictWhole(specs.map(s => s.food).join(" mit "));
      if(whole){
        out.push(makeRow(parts.join(" mit "), Object.assign({}, specs[0], {food: specs.map(s => s.food).join(" mit ")}), meal, null, whole));
        return;
      }
    }
    let main = null;
    specs.forEach((s, i) => {
      if(!s.food) return;
      const row = makeRow(parts[i], s, meal, i > 0 ? main : null);
      out.push(row);
      if(i === 0) main = row;
    });
  });
  return out;
}
function makeRow(phrase, spec, meal, main, forced){
  const cands = findCandidates(spec.food);
  if(forced && !cands.some(c => c.it.name === forced.it.name)) cands.unshift(forced);
  if(forced) cands.sort((a, b) => (b.it === forced.it) - (a.it === forced.it));
  const row = {phrase: phrase.replace(/§/g, ",").replace(/\s+/g, " ").trim(), spec, meal, main, cands: cands.map(c => c.it), score: cands.length ? cands[0].s : 0, sel: 0};
  row.ok = cands.length > 0 && cands[0].s >= 45;
  if(row.ok) applyAmount(row);
  return row;
}
function applyAmount(row){
  const it = row.cands[row.sel];
  const r = resolveAmount(withEstimate(it), row.spec, row.main && row.main.ok ? {it: row.main.cands[row.main.sel], spec: row.main.spec} : null);
  row.amount = r.amount; row.how = r.how; row.edited = false;
}

/* ---------- Oberfläche ---------- */
const MIC_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const EXAMPLES = ["2 Eier, eine Scheibe Vollkornbrot mit Butter und ein Glas Orangensaft", "Banane 70 Gramm",
  "Mittags 250 g Nudeln mit Tomatensauce und ein Apfel", "Ein Cappuccino und eine Handvoll Mandeln"];

const css = document.createElement("style");
css.textContent = [
  ".speakbar{display:flex; align-items:center; gap:8px; margin:12px 0; padding:5px 5px 5px 6px; background:var(--surface); border:1px solid var(--line); border-radius:999px; box-shadow:var(--shadow)}",
  ".speakbar .sp-open{flex:1; min-width:0; background:transparent; text-align:left; color:var(--muted); font-size:14.5px; padding:9px 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}",
  ".sp-mic{flex:0 0 auto; width:44px; height:44px; border-radius:50%; background:var(--accent); color:var(--on-accent); display:flex; align-items:center; justify-content:center; padding:0}",
  ".sp-mic{position:relative}",
  ".sp-mic.on{animation:spPulse 1.3s ease-in-out infinite}",
  ".sp-mic.wait{opacity:.85}",
  ".sp-mic.wait::after{content:''; position:absolute; inset:-4px; border-radius:50%; border:2.5px solid transparent; border-top-color:var(--accent); border-right-color:var(--accent); animation:spSpin .8s linear infinite}",
  "@keyframes spSpin{to{transform:rotate(360deg)}}",
  ".sp-tip{font-size:12.5px; line-height:1.45; background:var(--surface2); border-radius:12px; padding:10px 12px; margin:6px 0 10px}",
  ".sp-tip .chip{margin-top:8px}",
  "@keyframes spPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent)}50%{box-shadow:0 0 0 11px color-mix(in srgb, var(--accent) 0%, transparent)}}",
  "@media (prefers-reduced-motion: reduce){.sp-mic.on{animation:none; outline:3px solid var(--accent-soft)} .sp-mic.wait::after{animation:none}}",
  ".sp-in{display:flex; gap:8px; align-items:flex-start; margin:4px 0 4px}",
  ".sp-in textarea{flex:1; min-height:66px}",
  ".sp-status{min-height:18px; margin:2px 0 6px}",
  ".sp-ex{display:flex; flex-wrap:wrap; gap:7px; margin:6px 0 4px}",
  ".sp-ex button.chip{text-align:left; white-space:normal}",
  ".sp-row{padding:9px 0; border-bottom:1px solid var(--line)}",
  ".sp-line{display:flex; gap:6px; align-items:center}",
  ".sp-line select{flex:1; min-width:0; padding:7px 8px}",
  ".sp-line input{width:74px; flex:0 0 auto; text-align:right; padding:7px 8px}",
  ".sp-unit{color:var(--muted); font-size:13px; min-width:20px}",
  ".sp-line .sp-del{flex:0 0 auto; padding:6px 9px; background:transparent; border:1px solid var(--line)}",
  ".sp-sub{font-size:11.5px; color:var(--muted); margin-top:3px}",
  ".sp-miss{display:flex; gap:8px; align-items:center; justify-content:space-between}",
  ".sp-miss b{font-weight:550}",
  ".sp-sum{margin:12px 0 2px; font-size:13.5px}",
  ".sp-tags{display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 2px}",
  ".sp-tag{font-size:12px; padding:3px 9px; border-radius:999px; background:var(--accent-soft); color:var(--accent)}",
  ".sp-how{margin-top:10px}"
].join("\n");
document.head.appendChild(css);

const sheet = document.createElement("div");
sheet.className = "sheet"; sheet.id = "speakSheet";
sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Einfach sagen");
sheet.innerHTML =
  '<div class="grab"></div>' +
  '<div class="head"><h3>Einfach sagen</h3><button class="ghost" data-close>Schließen</button></div>' +
  '<div class="body">' +
    '<div class="sp-in"><textarea id="spText" rows="2" placeholder="z. B. Zum Frühstück zwei Eier und ein Glas Orangensaft" autocomplete="off"></textarea>' +
    '<button class="sp-mic" id="spMic" aria-label="Sprechen" title="Sprechen">' + MIC_SVG + '</button></div>' +
    '<div class="small muted sp-status" id="spStatus" aria-live="polite"></div>' +
    '<div id="spTips"></div>' +
    '<div id="spList"></div>' +
    '<div id="spSum"></div>' +
    '<div id="spMealWrap" style="display:none;margin-top:12px"><div class="small" style="font-weight:600;margin-bottom:4px">Mahlzeit</div><div class="mealchips" id="spMeals"></div></div>' +
    '<button class="primary" id="spAdd" style="width:100%;display:none">Alle eintragen</button>' +
  '</div>';
document.body.appendChild(sheet);

const bar = document.createElement("div");
bar.className = "speakbar";
bar.innerHTML = '<button class="sp-mic" id="spBarMic" aria-label="Sprechen: sag, was du gegessen hast">' + MIC_SVG + '</button>' +
  '<button class="sp-open" id="spBarOpen">Sag, was du gegessen hast …</button>';
const heute = document.getElementById("view-heute");
const firstCard = heute && heute.querySelector(".card");
if(firstCard) firstCard.parentNode.insertBefore(bar, firstCard);

let rows = [], mealPick = null, mealTouched = false, parseTimer = null;

function status(t){ el("spStatus").textContent = t || ""; }
function idleHint(){
  return SR ? "Mikrofon antippen und sprechen – oder tippen. Mehrere Lebensmittel, Mengen und Mahlzeit in einem Satz."
            : "Tippen oder mit dem Mikrofon der Tastatur diktieren. Mehrere Lebensmittel, Mengen und Mahlzeit in einem Satz.";
}
function openSpeak(listen){
  closeSheets();
  openSheet("speakSheet");
  status(idleHint());
  render();
  checkMicPerm();
  if(listen) startVoice(false);
  else setTimeout(() => el("spText").focus(), 150);
}

function render(){
  const list = el("spList"), sum = el("spSum");
  if(!rows.length){
    list.innerHTML = el("spText").value.trim() ? '<div class="empty">Noch nichts erkannt – nenne ein Lebensmittel, z. B. „Banane 70 Gramm“.</div>'
      : '<div class="small" style="font-weight:600;margin-top:6px">Zum Ausprobieren antippen:</div><div class="sp-ex">' +
        EXAMPLES.map((x, i) => '<button class="chip" data-spex="' + i + '">' + esc(x) + '</button>').join("") + '</div>' +
        '<div class="small muted sp-how">Mengen wie „eine Scheibe“, „ein Glas“ oder „eine Handvoll“ werden in Gramm umgerechnet. Die Nährwerte kommen 1:1 aus den Datenbanken der App. Die Erkennung läuft auf deinem Gerät.</div>';
    sum.innerHTML = ""; el("spMealWrap").style.display = "none"; el("spAdd").style.display = "none";
    return;
  }
  list.innerHTML = rows.map((r, i) => {
    if(!r.ok){
      return '<div class="sp-row"><div class="sp-miss"><span><b>„' + esc(r.spec.food || r.phrase) + '“</b> <span class="small muted">nicht gefunden</span></span>' +
        '<span style="display:flex;gap:6px"><button class="chip" data-spfind="' + i + '">Suchen</button><button class="ghost sp-del" data-spdel="' + i + '" aria-label="Entfernen">✕</button></span></div></div>';
    }
    const it = r.cands[r.sel];
    const unit = it.isRecipe ? (r.amount === 1 ? "Port." : "Port.") : it.isDrink ? "ml" : "g";
    const e = entryFor(r);
    const showMeal = !it.isDrink && rows.some(x => x.meal && x.meal !== r.meal);
    return '<div class="sp-row"><div class="sp-line">' +
      '<select data-spsel="' + i + '" aria-label="Lebensmittel">' + r.cands.map((c, j) => '<option value="' + j + '"' + (j === r.sel ? " selected" : "") + '>' + esc(c.name) + srcTag(c) + '</option>').join("") + '</select>' +
      '<input type="text" inputmode="decimal" data-spamt="' + i + '" value="' + fmt(r.amount, r.amount % 1 ? 1 : 0).replace(/\./g, "") + '" aria-label="Menge">' +
      '<span class="sp-unit">' + unit + '</span>' +
      '<button class="sp-del" data-spdel="' + i + '" aria-label="Entfernen">✕</button></div>' +
      '<div class="sp-sub num">„' + esc(r.phrase) + '“' + (r.how && !r.edited ? ' · ' + esc(r.how) : '') + ' · ' + fmt(Math.round(e.n.kcal)) + ' kcal' +
        (showMeal ? ' · ' + MEAL_LABEL[r.meal || mealPick] : '') + (it.isDrink ? ' · Getränk' : '') + '</div></div>';
  }).join("");
  renderSum();
}
function srcTag(c){ return c.isRecipe ? " · Rezept" : c.isOFF2 || c.isProduct ? " · Marke" : c.isCH ? " · Schweiz" : c.isBLS ? " · BLS" : c.isFDC ? " · USDA" : ""; }
function entryFor(r){ return entryFromItem(r.cands[r.sel], r.amount, r.meal || mealPick); }
function renderSum(){
  const ok = rows.filter(r => r.ok && r.amount > 0);
  const sum = el("spSum");
  el("spMealWrap").style.display = ok.some(r => !r.cands[r.sel].isDrink) ? "" : "none";
  el("spMeals").innerHTML = MEALS.map(m => '<button class="chip" data-spmeal="' + m[0] + '" aria-pressed="' + (m[0] === mealPick ? "true" : "false") + '">' + m[1] + '</button>').join("");
  const add = el("spAdd");
  add.style.display = ok.length ? "" : "none";
  if(!ok.length){ sum.innerHTML = ""; return; }
  const T = computeTargets(profile);
  const tot = {};
  let noMicro = false;
  ok.forEach(r => { const e = entryFor(r); if(e.noMicro) noMicro = true; Object.keys(e.n).forEach(k => tot[k] = (tot[k] || 0) + (e.n[k] || 0)); });
  const after = (dayTotals(curDay()).kcal || 0) + (tot.kcal || 0);
  const top = MICROS.filter(m => m[0] !== "natrium" && T.micros[m[0]] > 0)
    .map(m => ({label: m[1], pct: (tot[m[0]] || 0) / T.micros[m[0]] * 100}))
    .filter(x => x.pct >= 8).sort((a, b) => b.pct - a.pct).slice(0, 5);
  sum.innerHTML = '<div class="sp-sum num"><b>' + ok.length + (ok.length === 1 ? " Eintrag" : " Einträge") + ' · ' + fmt(Math.round(tot.kcal || 0)) + ' kcal</b> · ' +
      fmt(tot.p || 0, 1) + ' g Protein · ' + fmt(Math.round(tot.c || 0)) + ' g KH · ' + fmt(Math.round(tot.f || 0)) + ' g Fett</div>' +
    '<div class="small muted num">Danach ' + (curDay() === todayKey() ? "heute" : dayWord(curDay())) + ': ' + fmt(Math.round(after)) + ' von ' + fmt(T.kcal) + ' kcal</div>' +
    (top.length ? '<div class="small" style="margin-top:8px">Davon vom Tagesbedarf:</div><div class="sp-tags num">' +
      top.map(x => '<span class="sp-tag">' + esc(x.label) + ' ' + fmt(Math.round(x.pct)) + ' %</span>').join("") + '</div>' : '') +
    (noMicro ? '<div class="small muted" style="margin-top:4px">Für Markenprodukte ohne Vitaminangaben sind keine Mikronährstoffe enthalten.</div>' : '');
  add.textContent = (curDay() === todayKey() ? "" : "Für " + dayWord(curDay()) + ": ") + (ok.length === 1 ? "Eintragen" : "Alle " + ok.length + " eintragen");
}

function parseNow(){
  clearTimeout(parseTimer);
  const text = el("spText").value;
  const old = new Map(rows.map(r => [r.phrase + "|" + (r.main ? "m" : ""), r]));
  rows = text.trim() ? parseText(text) : [];
  // Bereits angepasste Zeilen behalten ihre Auswahl
  rows.forEach(r => {
    const o = old.get(r.phrase + "|" + (r.main ? "m" : ""));
    if(o && o.ok && r.ok){
      const j = r.cands.findIndex(c => c.name === o.cands[o.sel].name);
      if(j >= 0 && (o.sel !== 0 || o.edited)){ r.sel = j; if(o.edited){ r.amount = o.amount; r.edited = true; } else applyAmount(r); }
    }
  });
  if(mealTouched) rows.forEach(r => r.meal = null);
  else {
    const found = rows.find(r => r.meal);
    mealPick = found ? found.meal : guessMeal();
  }
  render();
}

function addAll(){
  const ok = rows.filter(r => r.ok && r.amount > 0);
  if(!ok.length) return;
  const ids = [];
  let kcal = 0, caf = 0;
  ok.forEach(r => {
    const e = entryFor(r);
    log.push(e); ids.push(e.id); kcal += e.n.kcal || 0; caf += e.cf || 0;
  });
  sset("log", log);
  closeSheets();
  el("spText").value = ""; rows = []; mealTouched = false;
  renderAll();
  toast((ids.length === 1 ? ok[0].cands[ok[0].sel].name : ids.length + " Einträge") + " · " + fmt(Math.round(kcal)) + " kcal" +
    (curDay() !== todayKey() ? " (" + dayName(curDay()) + ")" : "") + cafNote({cf: caf}),
    {label: "Rückgängig", fn: () => { log = log.filter(x => ids.indexOf(x.id) < 0); sset("log", log); renderAll(); toast("Rückgängig gemacht"); }});
}

/* ---------- Mikrofon- und Kamerafreigabe ----------
   Ob der Browser eine Freigabe dauerhaft speichert, entscheidet er selbst (bzw. das iPhone) –
   eine Webseite kann das nicht übernehmen. Die App merkt sich aber, dass die Freigabe schon einmal
   erteilt wurde. Fragt der Browser trotzdem wieder, zeigt sie einmal, wo man „immer erlauben“
   einstellt. Wurde der Zugriff blockiert, steht dort, wie man ihn wieder freigibt. */
const UA = navigator.userAgent || "";
const ANDROID = /Android/.test(UA);
// iPadOS meldet sich wie ein Mac – erkennbar am Touchscreen
const IOS = !ANDROID && (/iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1));
const PERM = {
  key: k => "nw1.perm." + k,
  had(k){ try{ return localStorage.getItem(PERM.key(k)) === "1"; }catch(e){ return false; } },
  mark(k){ try{ localStorage.setItem(PERM.key(k), "1"); }catch(e){} },
  tipOff(k){ try{ return localStorage.getItem(PERM.key(k) + ".tip") === "aus"; }catch(e){ return false; } },
  setTipOff(k){ try{ localStorage.setItem(PERM.key(k) + ".tip", "aus"); }catch(e){} },
  // "granted" | "prompt" | "denied" | null (unbekannt)
  async state(k){
    try{
      if(!navigator.permissions || !navigator.permissions.query) return null;
      const r = await navigator.permissions.query({name: k === "mic" ? "microphone" : "camera"});
      return r && r.state || null;
    }catch(e){ return null; }
  }
};
function permSteps(k, blocked){
  const what = k === "mic" ? "Mikrofon" : "Kamera";
  if(IOS) return (blocked ? "Der Zugriff auf " + (k === "mic" ? "das Mikrofon" : "die Kamera") + " ist blockiert. " : "") +
    "Am iPhone: Einstellungen → Apps → Safari → " + what + " → „Erlauben“ (bei älteren iOS-Versionen: Einstellungen → Safari → " + what + "). " +
    "Dann fragt das iPhone nicht mehr nach – auch nicht in der App auf dem Home-Bildschirm." +
    (k === "mic" ? " Falls zusätzlich „Spracherkennung“ abgefragt wird: einmal erlauben, das bleibt gespeichert." : "");
  if(ANDROID) return (blocked ? "Der Zugriff ist blockiert. " : "") +
    "In Chrome: auf das Symbol links neben der Adresse tippen → Berechtigungen → " + what + " → „Zulassen“. " +
    "Bei der Abfrage „Bei Besuch der Website zulassen“ wählen, nicht „Nur dieses Mal“.";
  return (blocked ? "Der Zugriff ist blockiert. " : "") +
    "Im Browser auf das Symbol links neben der Adresse klicken → " + what + " → „Zulassen“ bzw. „Immer erlauben“.";
}
function permStepsAll(){
  if(IOS) return "Am iPhone: Einstellungen → Apps → Safari → Mikrofon und Kamera jeweils auf „Erlauben“ stellen (bei älteren iOS-Versionen: Einstellungen → Safari). Das gilt auch für die App auf dem Home-Bildschirm. Fragt das iPhone zusätzlich nach „Spracherkennung“: einmal erlauben, das bleibt gespeichert.";
  if(ANDROID) return "In Chrome: auf das Symbol links neben der Adresse tippen → Berechtigungen → Mikrofon und Kamera auf „Zulassen“. Bei der Abfrage „Bei Besuch der Website zulassen“ wählen, nicht „Nur dieses Mal“.";
  return "Im Browser auf das Symbol links neben der Adresse klicken und Mikrofon und Kamera auf „Zulassen“ bzw. „Immer erlauben“ stellen.";
}
/* Hinweis-Kasten in ein Fenster setzen (einmal pro Art, „Verstanden“ blendet ihn dauerhaft aus) */
function permTip(k, box, blocked){
  if(!box || (!blocked && PERM.tipOff(k))) return;
  const old = box.querySelector(".sp-tip[data-kind='" + k + "']");
  if(old) old.remove();
  const d = document.createElement("div");
  d.className = "sp-tip"; d.setAttribute("data-kind", k);
  d.innerHTML = '<b>' + (blocked ? (k === "mic" ? "Mikrofon blockiert" : "Kamera blockiert") : "Damit du nicht jedes Mal zustimmen musst") + '</b><br>' + esc(permSteps(k, blocked)) +
    (blocked ? '' : '<br><button class="chip" data-tipoff="' + k + '">Verstanden</button>');
  box.appendChild(d);
  const b = d.querySelector("[data-tipoff]");
  if(b) b.addEventListener("click", ev => { ev.stopPropagation(); PERM.setTipOff(k); d.remove(); });
}

/* ---------- Spracherkennung ----------
   Abgesichert gegen die Aussetzer, die bei Web-Spracherkennung vorkommen:
   - iOS 26/27: Lief vorher ein Video (z. B. die Kamera des Barcode-Scanners), bleibt die Erkennung
     stumm – das Mikrofon wirkt aktiv, es kommen aber weder Text noch Fehler noch Ende (WebKit-Bug
     321436). Darum: für jeden Versuch eine neue Erkennung, die alte wird hart abgebrochen; bleibt
     die neue stumm, startet die App sie nach kurzer Pause einmal selbst neu.
   - Meldet eine Erkennung nie ihr Ende, wird sie nach Zeitlimit verworfen – der Mikrofon-Knopf
     reagiert danach sofort wieder (vorher blieb er in „läuft noch“ hängen).
   - „Ich höre zu“ erscheint erst, wenn das Mikrofon wirklich Ton liefert; bis dahin „Mikrofon startet …“.
   - Safari beendet die Erkennung nicht immer von selbst: nach einer Sprechpause wird sie abgeschlossen. */
const V = {state: "idle", rec: null, id: 0, heard: false, audio: false, speech: false, err: null, userStop: false,
  baseText: "", retries: 0, timers: [], lastResult: 0, mediaAt: 0, local: false, log: []};
function vlog(m){ V.log.push(Math.round(performance.now()) + " " + m); if(V.log.length > 60) V.log.shift(); }
function vClear(){ V.timers.forEach(clearTimeout); V.timers = []; }
function vLater(fn, ms){ const id = V.id; V.timers.push(setTimeout(() => { if(id === V.id) fn(); }, ms)); }
function kill(r){
  if(!r) return;
  r.onresult = r.onerror = r.onend = r.onstart = r.onaudiostart = r.onsoundstart = r.onspeechstart = null;
  try{ r.abort(); }catch(e){}
}
function setMic(){
  [el("spMic"), el("spBarMic")].forEach(b => {
    if(!b) return;
    b.classList.toggle("on", V.state === "listening");
    b.classList.toggle("wait", V.state === "starting" || V.state === "stopping");
    b.setAttribute("aria-pressed", V.state === "idle" ? "false" : "true");
    b.setAttribute("aria-label", V.state === "idle" ? "Sprechen" : "Zuhören beenden");
  });
}
// Lief gerade ein Video oder Ton? (Auslöser des iOS-Fehlers)
document.addEventListener("play", () => { V.mediaAt = Date.now(); }, true);
document.addEventListener("pause", () => { V.mediaAt = Date.now(); }, true);
// Chrome: Spracherkennung auf dem Gerät nutzen, wenn das deutsche Sprachpaket schon installiert ist
try{ if(SR && SR.available) SR.available({langs: ["de-DE"], processLocally: true}).then(st => { V.local = st === "available"; }).catch(() => {}); }catch(e){}

const SR_ERR = {
  "not-allowed": "Kein Zugriff aufs Mikrofon.",
  "service-not-allowed": "Die Spracherkennung ist auf diesem Gerät nicht erlaubt. Tippe ins Feld und nutze das Mikrofon der Tastatur.",
  "audio-capture": "Kein Mikrofon gefunden – oder eine andere App nutzt es gerade.",
  "network": "Die Spracherkennung dieses Browsers braucht Internet. Offline geht es mit dem Mikrofon der Tastatur.",
  "language-not-supported": "Deutsch wird von der Spracherkennung hier nicht unterstützt. Nutze das Mikrofon der Tastatur."
};
function stopVoice(){ if(V.state !== "idle") finishVoice(true); }
function abortVoice(){ if(V.state === "idle") return; vlog("abort"); kill(V.rec); V.rec = null; vClear(); V.id++; V.state = "idle"; setMic(); }

function startVoice(isRetry){
  isRetry = isRetry === true;
  if(!SR){
    status("Dieser Browser hat keine eingebaute Spracherkennung. Tippe ins Feld und nutze das Mikrofon deiner Tastatur.");
    el("spText").focus();
    return;
  }
  // Zweiter Tipp während des Zuhörens = fertig
  if(!isRetry && (V.state === "starting" || V.state === "listening")){ finishVoice(true); return; }
  // Alles Alte weg – auch eine Erkennung, die hängt, ohne je ihr Ende zu melden
  kill(V.rec); V.rec = null; vClear(); V.id++;
  if(!isRetry){ V.retries = 0; V.heard = false; V.baseText = el("spText").value.trim(); }
  V.audio = V.speech = false; V.err = null; V.userStop = false; V.lastResult = 0;
  let r;
  try{
    r = new SR();
    r.lang = "de-DE"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    if(V.local) try{ r.processLocally = true; }catch(e){}
  }catch(e){ V.state = "idle"; setMic(); status(SR_ERR["service-not-allowed"]); return; }
  V.rec = r;
  const id = V.id;
  const mine = fn => ev => { if(id === V.id && V.rec === r) fn(ev); };
  const gotAudio = () => {
    if(V.audio) return;
    V.audio = true; V.state = "listening"; setMic();
    status("Ich höre zu … z. B. „Banane 70 Gramm“ oder „zwei Eier und ein Glas Milch“");
    if(!PERM.had("mic")) PERM.mark("mic");
  };
  r.onstart = mine(() => { vlog("start"); vLater(() => { if(!V.audio && V.state === "starting") gotAudio(); }, 900); });
  r.onaudiostart = mine(() => { vlog("audiostart"); gotAudio(); });
  r.onsoundstart = r.onspeechstart = mine(ev => { vlog(ev.type); V.speech = true; gotAudio(); });
  r.onresult = mine(ev => {
    let txt = "";
    for(let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
    txt = txt.trim();
    if(!txt) return;
    gotAudio();
    V.heard = true; V.speech = true; V.lastResult = Date.now();
    el("spText").value = (V.baseText ? V.baseText.replace(/[,\s]+$/, "") + ", " : "") + txt;
    clearTimeout(parseTimer);
    parseTimer = setTimeout(parseNow, 120);
    // Sprechpause → abschließen (Safari hört sonst manchmal endlos weiter)
    vLater(() => { if(V.state === "listening" && Date.now() - V.lastResult >= 2100) finishVoice(false); }, 2200);
  });
  r.onerror = mine(ev => { vlog("error " + ev.error); V.err = ev.error; });
  r.onend = mine(() => { vlog("end"); endVoice(); });
  V.state = "starting"; setMic();
  status(isRetry ? "Mikrofon wird neu gestartet …" : "Mikrofon startet …");
  try{ const ae = document.activeElement; if(ae && ae.blur) ae.blur(); }catch(e){}
  try{ r.start(); vlog("start() " + (isRetry ? "retry" : "")); }
  catch(e){ vlog("start() failed " + (e && e.name)); V.err = "start-failed"; endVoice(); return; }
  // Wächter: Mikrofon kommt nicht in Gang (beim ersten Mal länger warten – da steht die Freigabe-Abfrage)
  vLater(() => { if(!V.audio && !V.heard) stall("noaudio"); }, PERM.had("mic") ? 5000 : 15000);
  // Mikrofon läuft, liefert aber nichts (der iOS-Fehler nach Videowiedergabe)
  vLater(() => { if(!V.heard && !V.speech) stall("silent"); }, PERM.had("mic") ? 8000 : 18000);
  vLater(() => finishVoice(false), 30000);
}
/* Erkennung hängt oder bleibt stumm: verwerfen und einmal selbst neu starten */
function stall(kind){
  if(V.state === "idle") return;
  vlog("stall " + kind);
  kill(V.rec); V.rec = null; vClear();
  if(V.retries < 1){
    V.retries++;
    V.state = "starting"; setMic();
    status("Mikrofon hakt – wird neu gestartet …");
    const id = ++V.id;
    // nach Video/Ton im Hintergrund braucht iOS eine längere Pause
    setTimeout(() => { if(id === V.id) startVoice(true); }, Date.now() - V.mediaAt < 15000 ? 2500 : 700);
    return;
  }
  V.id++; V.state = "idle"; setMic();
  status(kind === "noaudio"
    ? "Das Mikrofon startet gerade nicht. Tippe nochmal aufs Mikrofon – oder ins Feld und nutze das Mikrofon der Tastatur."
    : "Das Mikrofon liefert gerade keinen Ton. Tippe nochmal aufs Mikrofon – oder ins Feld und nutze das Mikrofon der Tastatur.");
}
/* Zuhören beenden; meldet die Erkennung kein Ende, wird sie nach kurzer Zeit verworfen */
function finishVoice(byUser){
  if(V.state === "idle") return;
  vlog("finish " + (byUser ? "user" : "auto"));
  V.userStop = !!byUser;
  const r = V.rec;
  if(!r){ endVoice(); return; }
  V.state = "stopping"; setMic();
  try{ r.stop(); }catch(e){}
  vLater(() => { vlog("stop timeout"); kill(r); endVoice(); }, 1300);
}
function endVoice(){
  if(V.state === "idle") return;
  const r = V.rec;
  if(r){ r.onresult = r.onerror = r.onend = null; }
  V.rec = null; vClear(); V.id++;
  V.state = "idle"; setMic();
  if(V.heard){
    V.retries = 0;
    parseNow();
    status(rows.length ? "Prüfen und eintragen – oder nochmal aufs Mikrofon tippen, um etwas zu ergänzen." : idleHint());
    return;
  }
  const e = V.err;
  if(e === "not-allowed"){
    status(SR_ERR[e]);
    PERM.state("mic").then(st => permTip("mic", el("spTips"), st !== "prompt"));
    return;
  }
  if(e && e !== "aborted" && e !== "no-speech" && e !== "start-failed"){ status(SR_ERR[e] || "Spracherkennung nicht verfügbar (" + e + "). Nutze das Mikrofon der Tastatur."); return; }
  if(V.userStop){ status(idleHint()); return; }
  if(e === "no-speech" || V.speech){ status("Nichts verstanden – tippe aufs Mikrofon und sprich gleich los."); return; }
  // Ende ohne Ton und ohne Fehler: meist direkt nach der Freigabe-Abfrage oder nach dem Scanner
  if(V.retries < 1){
    V.retries++;
    V.state = "starting"; setMic();
    status("Mikrofon wird neu gestartet …");
    const id = V.id;
    setTimeout(() => { if(id === V.id) startVoice(true); }, Date.now() - V.mediaAt < 15000 ? 2500 : 700);
    return;
  }
  status("Das Mikrofon hat nicht reagiert. Tippe nochmal aufs Mikrofon – oder ins Feld und nutze das Mikrofon der Tastatur.");
}
/* Beim Öffnen: Fragt der Browser erneut, obwohl schon einmal erlaubt? Dann Hinweis zum dauerhaften Erlauben. */
function checkMicPerm(){
  PERM.state("mic").then(st => {
    const box = el("spTips");
    if(!box) return;
    if(st === "denied") permTip("mic", box, true);
    else if(st === "prompt" && PERM.had("mic")) permTip("mic", box, false);
  });
}

/* ---------- Kamera für den Barcode-Scanner ---------- */
if(typeof openScanner === "function"){
  const baseScanner = openScanner;
  openScanner = function(){
    const before = PERM.state("cam");                 // parallel – der Scanner startet ohne Verzögerung
    const res = baseScanner.apply(this, arguments);
    const box = document.querySelector("#scanSheet .body");
    let n = 0;
    // Sobald die Kamera läuft (oder abgelehnt wurde) – unabhängig davon, wann der Scanner fertig geladen ist
    const tick = async () => {
      if(typeof scanStream !== "undefined" && scanStream){
        const st = await before;
        if(st === "prompt" && PERM.had("cam")) permTip("cam", box, false);   // wurde schon wieder gefragt
        PERM.mark("cam");
        return;
      }
      const txt = (document.getElementById("scanStatus") || {}).textContent || "";
      if(/Kein Kamerazugriff/.test(txt)){
        const after = await PERM.state("cam");
        if(after === "denied" || /nicht erlaubt/.test(txt)) permTip("cam", box, true);
        return;
      }
      const open = document.getElementById("scanSheet");
      if(++n < 60 && open && open.classList.contains("open")) setTimeout(tick, 250);
    };
    setTimeout(tick, 150);
    return res;
  };
}

/* ---------- Profil: Übersicht der Freigaben ---------- */
function renderPermCard(){
  const host = document.getElementById("installInfo");
  const card = host && host.closest(".card");
  if(!card) return;
  let c = document.getElementById("permCard");
  if(!c){
    c = document.createElement("div");
    c.className = "card"; c.id = "permCard";
    card.parentNode.insertBefore(c, card.nextSibling);
  }
  Promise.all([PERM.state("mic"), PERM.state("cam")]).then(([m, k]) => {
    const word = (s, had) => s === "granted" ? "dauerhaft erlaubt" : s === "denied" ? "blockiert" : had ? "erlaubt, fragt aber jedes Mal" : s === "prompt" ? "noch nicht gefragt" : had ? "erlaubt" : "noch nicht genutzt";
    c.innerHTML = '<h2>Mikrofon &amp; Kamera</h2>' +
      '<div class="small muted" style="margin-bottom:8px">Die Freigabe speichert dein Browser bzw. dein Handy – nicht die App. So musst du nur einmal zustimmen:</div>' +
      '<table class="avg"><tr><td>Mikrofon (Spracheingabe)</td><td>' + word(m, PERM.had("mic")) + '</td></tr>' +
      '<tr><td>Kamera (Barcode-Scanner)</td><td>' + word(k, PERM.had("cam")) + '</td></tr></table>' +
      '<div class="small" style="margin-top:8px">' + esc(permStepsAll()) + '</div>';
  });
}
const _switchTab = typeof switchTab === "function" ? switchTab : null;
if(_switchTab){ switchTab = function(tab){ const r = _switchTab.apply(this, arguments); if(tab === "profil") renderPermCard(); return r; }; }

/* ---------- Ereignisse ---------- */
el("spBarMic").addEventListener("click", () => openSpeak(true));
el("spBarOpen").addEventListener("click", () => openSpeak(false));
el("spMic").addEventListener("click", () => startVoice(false));
el("spText").addEventListener("input", () => { clearTimeout(parseTimer); parseTimer = setTimeout(parseNow, 350); });
el("spText").addEventListener("keydown", ev => {
  if(ev.key === "Enter" && !ev.shiftKey){ ev.preventDefault(); parseNow(); ev.target.blur(); }
});
el("spAdd").addEventListener("click", addAll);
sheet.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if(!t) return;
  if(t.dataset.spex != null){ el("spText").value = EXAMPLES[+t.dataset.spex]; parseNow(); return; }
  if(t.dataset.spdel != null){ rows.splice(+t.dataset.spdel, 1); render(); return; }
  if(t.dataset.spmeal){ mealPick = t.dataset.spmeal; mealTouched = true; rows.forEach(r => r.meal = null); render(); return; }
  if(t.dataset.spfind != null){
    const r = rows[+t.dataset.spfind];
    const q = (r && (r.spec.food || r.phrase)) || "";
    closeSheets();
    openAdd(mealPick || guessMeal());
    el("searchInput").value = q;
    doSearch(q);
  }
});
sheet.addEventListener("change", ev => {
  const t = ev.target;
  if(t.dataset.spsel != null){ const r = rows[+t.dataset.spsel]; r.sel = +t.value; applyAmount(r); render(); }
});
sheet.addEventListener("input", ev => {
  const t = ev.target;
  if(t.dataset.spamt == null) return;
  const r = rows[+t.dataset.spamt];
  const v = parseFloat(String(t.value).replace(/\./g, "").replace(",", "."));
  if(!(v > 0)) return;
  r.amount = v; r.edited = true;
  const sub = t.closest(".sp-row").querySelector(".sp-sub");
  if(sub){ const e = entryFor(r); sub.textContent = "„" + r.phrase + "“ · " + fmt(Math.round(e.n.kcal)) + " kcal"; }
  renderSum();
});

// Schließen beendet das Zuhören sofort
const baseClose = closeSheets;
closeSheets = function(){ abortVoice(); return baseClose.apply(this, arguments); };

window.NW_SPRACHE = {parseText, parseSpec, wordNum, findCandidates, open: openSpeak, voiceLog: () => V.log.slice(), voiceState: () => V.state, perm: PERM};
})();
