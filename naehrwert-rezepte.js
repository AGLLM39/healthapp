/* NährWert – Rezepte ausgebaut
   Ersetzt die Darstellung im Tab „Rezepte“ (renderRecipes) und ergänzt:
   - „Passt heute zu dir“: Vorschläge nach dem, was dir heute noch fehlt (Mikronährstoffe,
     Ballaststoffe, Protein), nach den Lücken der Woche, der Tageszeit und den Rest-Kalorien.
   - Rezeptbuch: alle Rezepte mit Suche und Filtern (Frühstück, Warm, Brotzeit & Snack,
     vegetarisch, vegan, schnell, ohne Kochen, gemerkt).
   - Rezept-Ansicht: Nährwerte je Portion, Anteil am Tagesbedarf, was das Gericht heute für dich
     schließt, Zutaten für 1–8 Portionen, Einkaufsliste teilen, Zubereitung, Eintragen mit Portionsgröße.
   - Einkaufsliste für die Lücken der Woche: alltägliche Lebensmittel mit Wochenmengen, die die Nährstofflücken
     der letzten 7 Tage schließen (wahlweise vegetarisch/vegan), zum Abhaken und Teilen.
   - Eigene Rezepte: Zutaten per Satz oder Diktat anlegen („200 g Haferflocken, 300 ml Milch …“).
   Nährwerte kommen wie überall aus den Datenbanken der App (recipeToItem). */
(function(){
"use strict";
if(typeof renderRecipes !== "function" || typeof SUGGESTIONS === "undefined" || typeof recipeToItem !== "function") return;

const el = id => document.getElementById(id);

/* ---------- Daten ergänzen ---------- */
// Grießbrei war mit Haferflocken hinterlegt – jetzt mit Grieß aus dem BLS (sofern geladen)
(function fixData(){
  const r = SUGGESTIONS.find(x => x.name === "Grießbrei mit Beeren");
  if(r && typeof findItemByName === "function" && findItemByName("Weichweizen Grieß")){
    r.ings = r.ings.map(g => g[0] === "Haferflocken" ? ["Weichweizen Grieß", g[1]] : g);
  }
})();
const BREAKFAST = new Set(["Porridge mit Banane & Mandeln","Rührei auf Vollkornbrot","Skyr-Bowl mit Beeren","Quark mit Apfel & Walnüssen",
  "Gemüseomelett","Erdnussbutter-Banane-Toast","Overnight Oats mit Himbeeren","Rührei mit Champignons","Joghurt mit Kürbiskernen",
  "Haferflocken mit Skyr & Beeren","Grießbrei mit Beeren","Vollkornbrot mit Mandelmus & Banane","Käse-Omelett mit Salat"]);
const BROTZEIT = new Set(["Thunfisch-Sandwich","Quark mit Apfel & Walnüssen","Erdnussbutter-Banane-Toast","Tomate-Mozzarella mit Brot",
  "Sardinen auf Vollkornbrot","Joghurt mit Kürbiskernen","Vollkornbrot mit Harzer Käse","Bohnen-Mais-Salat","Hüttenkäse-Brot mit Radieschen",
  "Vollkornbrot mit Mandelmus & Banane","Skyr-Bowl mit Beeren","Spinat-Kichererbsen-Wrap"]);
const MEAT = /hahnchen|pute|rind|schwein|lachs|thunfisch|seelachs|hering|garnele|salami|schinken|wurst|speck|hack|steak|muschel|fisch|kabeljau|forelle|makrele|sardine|lamm|ente|leber|matjes|bacon|doner|gyros|frikadelle|scholle/;
const ANIMAL = /milch|joghurt|quark|skyr|kase|gouda|feta|mozzarella|parmesan|harzer|(^|\s)ei(\s|$)|spiegelei|ruhrei|eiklar|butter|honig|sahne|creme fraiche|schmand|kefir/;

/* Rezept mit Kennzeichen und Nährwerten je Portion (zwischengespeichert) */
const _meta = new Map();
function recMeta(kind, i){
  const r = kind === "S" ? SUGGESTIONS[i] : recipes[i];
  if(!r) return null;
  const key = kind + i + "|" + r.name + "|" + JSON.stringify(r.ings) + "|" + (r.serves || 1);
  const hit = _meta.get(key);
  if(hit) return hit;
  const item = recipeToItem(r, kind + i);
  const names = r.ings.map(g => normalize(String(g[0])));
  const veg = !names.some(n => MEAT.test(n));
  const vegan = veg && !names.some(n => ANIMAL.test(n));
  const cold = !!(r.steps && r.steps.some(s => s.indexOf("Kein Kochen nötig") >= 0));
  const m = {kind, i, id: kind + ":" + r.name, r, item, veg, vegan, cold, min: r.min || null,
    breakfast: BREAKFAST.has(r.name), brotzeit: BROTZEIT.has(r.name),
    warm: kind === "S" ? !BREAKFAST.has(r.name) && !BROTZEIT.has(r.name) : false};
  _meta.set(key, m);
  return m;
}
function allBook(){ return SUGGESTIONS.map((_, i) => recMeta("S", i)).filter(Boolean); }
function allOwn(){ return recipes.map((_, i) => recMeta("R", i)).filter(Boolean); }

/* ---------- Gemerkt ---------- */
let saved = sget("recipeSaved", []);
function isSaved(m){ return saved.indexOf(m.id) >= 0; }
function toggleSaved(m){
  const j = saved.indexOf(m.id);
  if(j >= 0) saved.splice(j, 1); else saved.push(m.id);
  sset("recipeSaved", saved);
  return j < 0;
}

/* ---------- Was fehlt dir heute noch? ---------- */
function microLabel(k){ const m = MICROS.find(x => x[0] === k); return m ? m[1] : k === "b" ? "Ballaststoffe" : k === "p" ? "Protein" : k; }
function goalOf(k, T){ return k === "b" ? T.ballast : k === "p" ? T.protein : T.micros[k]; }
/* Gewichtung: Nährstoffe, die in Deutschland häufig knapp sind (DGE/Nationale Verzehrsstudie), zählen mehr;
   solche, von denen fast alle genug bekommen, weniger – sonst „gewinnt“ ständig Mangan oder Biotin */
const PRIO = {vitD:1.6, jod:1.6, folat:1.5, calcium:1.4, eisen:1.3, b:1.4, o3:1.3, magnesium:1.2, kalium:1.2, vitE:1.1, zink:1.1, b12:1.1, p:1,
  vitA:0.9, vitC:0.9, vitK:0.8, b1:0.8, b2:0.8, b6:0.8, niacin:0.6, pantothen:0.5, biotin:0.5, phosphor:0.5, kupfer:0.5, mangan:0.5};
const prio = k => PRIO[k] || 1;
const FIT_KEYS = () => MICROS.map(m => m[0]).filter(k => k !== "natrium").concat(["b", "p"]);
function todayState(){
  const T = computeTargets(profile);
  const t = dayTotals(curDay());
  return {T, t, remKcal: T.kcal - (t.kcal || 0)};
}
/* Wie gut passt ein Rezept zu heute? Liefert Punkte und die größten Gewinne gegenüber dem Tagesstand. */
function fit(m, st, weekly){
  const tot = m.item.totals;
  let s = 0;
  const gains = [];
  FIT_KEYS().forEach(k => {
    const goal = goalOf(k, st.T);
    if(!(goal > 0)) return;
    const have = st.t[k] || 0, add = tot[k] || 0;
    const need = Math.max(0, goal - have);
    const useful = Math.min(add, need);
    s += Math.min(useful / goal, 0.5) * prio(k);
    const before = have / goal * 100, after = (have + add) / goal * 100;
    if(useful / goal >= 0.1) gains.push({k, label: microLabel(k), before, after: Math.min(after, 999), plus: useful / goal * 100});
  });
  // Lücken der letzten 7 Tage zählen mit
  if(weekly && weekly.length) weekly.forEach((g, gi) => { if((m.r.focus || []).indexOf(g.key) >= 0) s += 0.12 * (1 - gi / (weekly.length + 2)); });
  // Zu viel für den Rest des Tages?
  if(st.remKcal > 250 && tot.kcal > st.remKcal * 1.15) s *= 0.6;
  // Tageszeit
  const meal = guessMeal();
  if(meal === "fruehstueck") s *= m.breakfast ? 1.3 : 0.7;
  else if(meal === "snack") s *= m.brotzeit ? 1.25 : 0.85;
  else s *= m.warm || m.kind === "R" ? 1.2 : m.breakfast ? 0.7 : 1;
  // zuerst, was heute noch am weitesten vom Ziel entfernt ist und wo das Gericht viel bringt
  const w = g => g.plus * prio(g.k) * (1.2 - Math.min(1, g.before / 100));
  gains.sort((a, b) => w(b) - w(a));
  return {s, gains: gains.slice(0, 3)};
}

/* ---------- Oberfläche: Tab „Rezepte“ ---------- */
const css = document.createElement("style");
css.textContent = [
  ".rv-feat{background:color-mix(in srgb, var(--surface2) 45%, var(--surface)); border:1px solid var(--line); border-radius:16px; padding:14px; margin:10px 0; cursor:pointer}",
  ".rv-feat h4{margin:0 0 3px; font-size:16.5px; letter-spacing:-.005em}",
  ".rv-meta{font-size:13.5px; color:var(--muted)}",
  ".rv-gains{display:flex; flex-wrap:wrap; gap:6px; margin:9px 0 11px}",
  ".rv-gain{font-size:13px; padding:3px 10px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-weight:600}",
  ".rv-foot{display:flex; gap:8px; align-items:center}",
  ".rv-foot .ghost{flex:0 0 auto}",
  ".rv-foot select{flex:1; min-width:0; width:auto; padding:8px 10px; background:var(--surface)}",
  ".rv-search{margin:4px 0 8px}",
  ".rv-filters{display:flex; gap:7px; overflow-x:auto; padding:2px 2px 10px; scrollbar-width:none; -webkit-overflow-scrolling:touch}",
  ".rv-filters::-webkit-scrollbar{display:none}",
  ".rv-filters button{flex:0 0 auto}",
  ".rv-row{display:flex; align-items:center; gap:10px; padding:11px 0; border-bottom:1px solid var(--line); cursor:pointer}",
  ".rv-row:last-child{border-bottom:none}",
  ".rv-row .rv-txt{flex:1; min-width:0}",
  ".rv-row b{display:block; font-weight:600; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}",
  ".rv-row .rv-meta{display:block; margin-top:1px}",
  ".rv-row .rv-star{color:var(--warn); font-size:16px; flex:0 0 auto}",
  ".rv-row .rv-chev{color:var(--muted); flex:0 0 auto}",
  ".rv-more{width:100%; margin-top:8px}",
  ".rv-stats{display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; margin:12px 0 4px}",
  ".rv-stat{background:var(--surface2); border-radius:12px; padding:9px 4px; text-align:center}",
  ".rv-stat b{display:block; font-size:16px; letter-spacing:-.01em}",
  ".rv-stat span{font-size:12.5px; color:var(--muted)}",
  ".rv-sec{font-size:15.5px; font-weight:680; margin:20px 0 8px; display:flex; justify-content:space-between; align-items:center; gap:10px}",
  ".rv-today{background:var(--accent-soft); border-radius:14px; padding:12px 14px; margin:12px 0 4px; font-size:14px}",
  ".rv-today b{color:var(--accent)}",
  ".rv-today ul{margin:6px 0 0; padding-left:18px}",
  ".rv-today li{margin:2px 0}",
  ".rv-bar{display:grid; grid-template-columns:112px 1fr 46px; gap:8px; align-items:center; padding:4px 0; font-size:14px}",
  ".rv-bar i{display:block; height:8px; border-radius:99px; background:var(--surface2); overflow:hidden}",
  ".rv-bar i b{display:block; height:100%; border-radius:99px; background:var(--accent)}",
  ".rv-bar span:last-child{text-align:right; font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums}",
  ".rv-ing{display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid var(--line); font-size:15px}",
  ".rv-ing:last-child{border-bottom:none}",
  ".rv-ing span:last-child{color:var(--muted); white-space:nowrap; font-variant-numeric:tabular-nums}",
  ".rv-steps{padding-left:22px; margin:0}",
  ".rv-steps li{margin-bottom:9px; line-height:1.5; font-size:15px}",
  ".rv-steps li::marker{color:var(--accent); font-weight:700}",
  ".rv-stepper{display:flex; align-items:center; gap:6px; font-size:14px; font-weight:500}",
  ".rv-stepper button{width:34px; height:34px; padding:0; border-radius:50%; font-size:18px; line-height:1}",
  ".rv-eat{position:sticky; bottom:-20px; background:var(--surface); padding:10px 0 12px; margin:18px 0 -8px; border-top:1px solid var(--line)}",
  ".rv-eatrow{display:flex; gap:8px; margin-bottom:8px}",
  ".rv-eatrow select{flex:1; min-width:0; padding:8px 10px}",
  ".rv-chips{display:flex; flex-wrap:wrap; gap:7px; margin:6px 0 10px}",
  ".rv-tools{display:flex; gap:8px; flex-wrap:wrap; margin-top:10px}",
  ".rv-say{margin:2px 0 12px}",
  ".rv-say textarea{min-height:56px}",
  ".rv-say .rv-foot{margin-top:6px}",
  ".rv-gap{font-size:13px; padding:3px 10px; border-radius:999px; background:var(--surface2)}",
  ".rv-gap b{color:var(--accent)}",
  ".rv-shop{display:flex; align-items:center; gap:11px; padding:10px 0; border-bottom:1px solid var(--line)}",
  ".rv-shop:last-of-type{border-bottom:none}",
  ".rv-shop .rv-txt{flex:1; min-width:0}",
  ".rv-shop b{display:block; font-weight:600; font-size:15px}",
  ".rv-shop .rv-meta{display:block; margin-top:1px}",
  ".rv-for{display:block; font-size:12.5px; color:var(--accent); margin-top:2px}",
  ".rv-check{flex:0 0 auto; width:26px; height:26px; padding:0; border-radius:50%; border:2px solid var(--line); background:var(--surface)}",
  ".rv-shop.done .rv-check{background:var(--accent); border-color:var(--accent)}",
  ".rv-shop.done .rv-check::after{content:'✓'; color:var(--on-accent); font-size:14px; font-weight:700}",
  ".rv-shop.done .rv-txt{opacity:.5}",
  ".rv-shop.done b{text-decoration:line-through}",
  ".rv-find{flex:0 0 auto; padding:6px 10px; font-size:13px}"
].join("\n");
document.head.appendChild(css);

const view = el("view-rezepte");
const cards = view ? view.querySelectorAll(":scope > .card") : [];
const sugCard = cards[0], ownCard = cards[1];
if(sugCard){
  const h = sugCard.querySelector("h2"); if(h) h.textContent = "Passt heute zu dir";
  const sub = sugCard.querySelector(".small.muted"); if(sub) sub.textContent = "Ausgewählt nach dem, was dir heute noch fehlt, nach deinen Lücken der Woche und nach der Tageszeit.";
  const sh = el("btnShuffle"); if(sh) sh.textContent = "↻ Andere";
}
const book = document.createElement("div");
book.className = "card"; book.id = "recipeBook";
book.innerHTML = '<h2>Rezeptbuch</h2>' +
  '<input type="search" id="rvSearch" class="rv-search" placeholder="Rezept oder Zutat suchen …" autocomplete="off">' +
  '<div class="rv-filters" id="rvFilters"></div><div id="rvList"></div>';
if(sugCard && sugCard.parentNode) sugCard.parentNode.insertBefore(book, ownCard || null);
const shopCard = document.createElement("div");
shopCard.className = "card"; shopCard.id = "gapShop";
shopCard.innerHTML = '<h2>Einkaufsliste für deine Lücken</h2><div class="small muted" style="margin-top:-2px">Lebensmittel, die deine Nährstofflücken der letzten 7 Tage schließen.</div><div id="rvShop"></div>';
if(sugCard && sugCard.parentNode) sugCard.parentNode.insertBefore(shopCard, book);

const FILTERS = [["alle","Alle"],["fruehstueck","Frühstück"],["warm","Warm essen"],["brotzeit","Brotzeit & Snack"],["veg","Vegetarisch"],
  ["vegan","Vegan"],["schnell","Bis 15 Min."],["kalt","Ohne Kochen"],["gemerkt","★ Gemerkt"]];
let filter = "alle", query = "", showAll = false;
function matches(m){
  if(filter === "fruehstueck" && !m.breakfast) return false;
  if(filter === "warm" && !m.warm) return false;
  if(filter === "brotzeit" && !m.brotzeit) return false;
  if(filter === "veg" && !m.veg) return false;
  if(filter === "vegan" && !m.vegan) return false;
  if(filter === "schnell" && !(m.min && m.min <= 15)) return false;
  if(filter === "kalt" && !m.cold) return false;
  if(filter === "gemerkt" && !isSaved(m)) return false;
  if(query){
    const q = normalize(query);
    const hay = normalize(m.r.name + " " + m.r.ings.map(g => g[0]).join(" ") + " " + (m.r.desc || ""));
    if(!q.split(/\s+/).every(w => hay.indexOf(w) >= 0)) return false;
  }
  return true;
}
function metaLine(m, withDiet){
  const tot = m.item.totals;
  const bits = [];
  if(m.min) bits.push(m.min + " Min.");
  bits.push(fmt(Math.round(tot.kcal)) + " kcal");
  bits.push(fmt(Math.round(tot.p)) + " g Protein");
  if(withDiet) bits.push(m.vegan ? "vegan" : m.veg ? "vegetarisch" : "");
  if(m.cold && withDiet) bits.push("ohne Kochen");
  return bits.filter(Boolean).join(" · ");
}
function rowHTML(m){
  return '<div class="rv-row" data-rvopen="' + esc(m.kind + m.i) + '" role="button" tabindex="0"><span class="rv-txt"><b>' + esc(m.r.name) + '</b>' +
    '<span class="rv-meta num">' + esc(metaLine(m, true)) + (m.kind === "R" && (m.r.serves || 1) > 1 ? " · je Portion" : "") + '</span></span>' +
    (isSaved(m) ? '<span class="rv-star" aria-label="gemerkt">★</span>' : '') + '<span class="rv-chev">›</span></div>';
}

let lastRank = [];
function renderMine(){
  const st = todayState();
  const weekly = (() => { try{ const g = weeklyGaps(); const sure = g.filter(x => !x.unsure); return sure.length ? sure : g; }catch(e){ return []; } })();
  // 1. Passt heute zu dir – aus Rezeptbuch und eigenen Rezepten
  const ranked = allBook().concat(allOwn()).map(m => Object.assign({m}, fit(m, st, weekly))).sort((a, b) => b.s - a.s);
  lastRank = ranked;
  const pool = ranked.slice(0, Math.min(ranked.length, 12));
  const off = pool.length ? (shuffleOffset * 3) % pool.length : 0;
  const picks = pool.length ? [0, 1, 2].map(k => pool[(off + k) % pool.length]).filter((x, k, a) => a.indexOf(x) === k) : [];
  const box = el("suggestBox");
  if(box) box.innerHTML = picks.map(p => {
    const m = p.m;
    const why = p.gains.length ? p.gains.map(g => '<span class="rv-gain num">' + esc(g.label) + ' +' + fmt(Math.round(g.plus)) + ' %</span>').join("")
      : '<span class="rv-gain">' + esc((m.r.focus || []).map(f => FOCUS_LABEL[f] || f).slice(0, 2).join(" & ") || "Ausgewogen") + '</span>';
    return '<div class="rv-feat" data-rvopen="' + esc(m.kind + m.i) + '" role="button" tabindex="0">' +
      '<h4>' + esc(m.r.name) + '</h4><div class="rv-meta num">' + esc(metaLine(m, true)) + '</div>' +
      '<div class="rv-gains">' + why + '</div>' +
      '<div class="rv-foot"><select data-rvmeal="' + esc(m.kind + m.i) + '" aria-label="Mahlzeit">' + MEALS.map(x => '<option value="' + x[0] + '"' + (x[0] === guessMeal() ? ' selected' : '') + '>' + x[1] + '</option>').join("") + '</select>' +
      '<button class="primary" data-rvadd="' + esc(m.kind + m.i) + '">Eintragen</button></div></div>';
  }).join("") || '<div class="empty">Noch keine Rezepte.</div>';
  // 2. Rezeptbuch
  el("rvFilters").innerHTML = FILTERS.map(f => '<button class="chip" data-rvfilter="' + f[0] + '" aria-pressed="' + (f[0] === filter ? "true" : "false") + '">' + esc(f[1]) + '</button>').join("");
  const order = new Map(ranked.map((x, k) => [x.m.id, k]));
  const list = allBook().filter(matches).sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
  const shown = showAll || query || filter !== "alle" ? list : list.slice(0, 8);
  el("rvList").innerHTML = (shown.length ? shown.map(rowHTML).join("") : '<div class="empty">' + (filter === "gemerkt" ? "Noch nichts gemerkt – in einem Rezept auf ☆ Merken tippen." : "Kein Rezept passt dazu.") + '</div>') +
    (shown.length < list.length ? '<button class="ghost rv-more" data-rvmore="1">Alle ' + list.length + ' Rezepte zeigen</button>' : '');
  // 3. Eigene Rezepte
  const own = el("ownRecipeBox");
  if(own) own.innerHTML = recipes.length ? allOwn().map(rowHTML).join("") : '<div class="empty">Noch keine eigenen Rezepte. Mit „+ Neu“ anlegen – die Zutaten auch per Satz, z. B. „60 g Haferflocken, 200 ml Milch, eine Banane“.</div>';
  // 4. Einkaufsliste für die Lücken der Woche
  drawShop();
}
// Wird überall aufgerufen, wo die App die Rezepte neu zeichnet
renderRecipes = function(){ try{ renderMine(); }catch(e){ console.error(e); } };

/* ---------- Einkaufsliste für die Lücken der Woche ----------
   Aus einer Auswahl alltäglicher Lebensmittel wird eine kleine Wocheneinkaufsliste zusammengestellt,
   die die Nährstofflücken der letzten 7 Tage möglichst gut schließt. Die Nährwerte kommen 1:1 aus den
   Datenbanken der App; vorgegeben sind nur übliche Portionsgrößen und wie oft pro Woche sinnvoll ist.
   Vorgehen: Schritt für Schritt die Portion wählen, die die verbleibenden Lücken (gewichtet nach PRIO)
   am meisten verkleinert – im Verhältnis zu ihren Kalorien, mit Abschlag für Wiederholungen. */
// [Name in der Datenbank, Portion in g, Portionsangabe, höchstens je Woche, Gruppe, Ernährung: a = alle, v = vegetarisch, g = vegan]
const SHOP_FOODS = [
  ["Spinat", 150, "1 Portion", 4, "Gemüse", "g"], ["Brokkoli", 200, "1 Portion", 4, "Gemüse", "g"], ["Grünkohl", 150, "1 Portion", 3, "Gemüse", "g"],
  ["Feldsalat", 60, "1 Schale", 4, "Gemüse", "g"], ["Rucola", 50, "1 Handvoll", 4, "Gemüse", "g"], ["Paprika (rot)", 150, "1 Schote", 5, "Gemüse", "g"],
  ["Karotte", 120, "2 Stück", 5, "Gemüse", "g"], ["Rosenkohl", 150, "1 Portion", 3, "Gemüse", "g"], ["Erbsen (tiefgekühlt)", 150, "1 Portion", 3, "Gemüse", "g"],
  ["Süßkartoffel", 200, "1 Stück", 3, "Gemüse", "g"], ["Kürbis (Hokkaido)", 200, "1 Portion", 3, "Gemüse", "g"], ["Champignons", 150, "1 Portion", 3, "Gemüse", "g"],
  ["Fenchel", 150, "1 Knolle", 2, "Gemüse", "g"],
  ["Banane", 120, "1 Stück", 5, "Obst", "g"], ["Orange", 150, "1 Stück", 5, "Obst", "g"], ["Kiwi", 75, "1 Stück", 5, "Obst", "g"],
  ["Himbeeren", 125, "1 Schale", 4, "Obst", "g"], ["Blaubeeren", 125, "1 Schale", 4, "Obst", "g"], ["Erdbeeren", 150, "1 Schale", 4, "Obst", "g"],
  ["Aprikosen (getrocknet)", 30, "1 Handvoll", 4, "Obst", "g"],
  ["Linsen (gekocht)", 200, "1 Portion gegart", 3, "Hülsenfrüchte", "g"], ["Kichererbsen (gekocht)", 200, "1 Portion gegart", 3, "Hülsenfrüchte", "g"],
  ["Kidneybohnen (Dose)", 200, "½ Dose", 3, "Hülsenfrüchte", "g"], ["Edamame (Sojabohnen)", 150, "1 Portion", 3, "Hülsenfrüchte", "g"], ["Tofu", 150, "½ Packung", 3, "Hülsenfrüchte", "g"],
  ["Walnüsse", 30, "1 Handvoll", 7, "Nüsse & Samen", "g"], ["Mandeln", 30, "1 Handvoll", 7, "Nüsse & Samen", "g"], ["Haselnüsse", 30, "1 Handvoll", 7, "Nüsse & Samen", "g"],
  ["Kürbiskerne", 25, "1 Handvoll", 7, "Nüsse & Samen", "g"], ["Sonnenblumenkerne", 25, "1 Handvoll", 7, "Nüsse & Samen", "g"], ["Leinsamen (geschrotet)", 15, "1 EL", 7, "Nüsse & Samen", "g"],
  ["Chiasamen", 15, "1 EL", 7, "Nüsse & Samen", "g"], ["Paranüsse", 10, "2 Stück", 3, "Nüsse & Samen", "g"], ["Sesam", 10, "1 EL", 7, "Nüsse & Samen", "g"],
  ["Haferflocken", 50, "1 Portion", 7, "Getreide", "g"], ["Vollkornbrot", 50, "1 Scheibe", 10, "Getreide", "g"], ["Vollkornnudeln, roh", 100, "1 Portion", 3, "Getreide", "g"],
  ["Quinoa (gekocht)", 150, "1 Portion gegart", 3, "Getreide", "g"], ["Weizenkleie", 10, "1 EL", 7, "Getreide", "g"],
  ["Naturjoghurt 3,5 %", 150, "1 Becher", 7, "Milchprodukte & Ei", "v"], ["Vollmilch 3,5 %", 200, "1 Glas", 7, "Milchprodukte & Ei", "v"], ["Skyr", 150, "1 Becher", 5, "Milchprodukte & Ei", "v"],
  ["Magerquark", 150, "1 Portion", 5, "Milchprodukte & Ei", "v"], ["Emmentaler", 30, "1 Scheibe", 7, "Milchprodukte & Ei", "v"], ["Gouda", 30, "1 Scheibe", 7, "Milchprodukte & Ei", "v"],
  ["Hüttenkäse", 150, "1 Becher", 4, "Milchprodukte & Ei", "v"], ["Ei", 60, "1 Ei", 7, "Milchprodukte & Ei", "v"],
  ["Lachs", 125, "1 Filet", 2, "Fisch", "a"], ["Hering", 100, "1 Portion", 2, "Fisch", "a"], ["Makrele", 100, "1 Portion", 2, "Fisch", "a"],
  ["Sardinen (Dose)", 90, "1 Dose", 2, "Fisch", "a"], ["Seelachs", 125, "1 Filet", 2, "Fisch", "a"], ["Forelle", 125, "1 Filet", 2, "Fisch", "a"],
  ["Rindersteak", 150, "1 Steak", 2, "Fleisch", "a"], ["Hähnchenbrust", 150, "1 Filet", 3, "Fleisch", "a"],
  ["Rapsöl", 10, "1 EL", 7, "Öl & Würzen", "g"], ["Leinöl", 10, "1 EL", 7, "Öl & Würzen", "g"], ["Jodsalz", 2, "1 Prise zum Würzen", 7, "Öl & Würzen", "g"]
];
const SHOP_DIETS = [["a", "Alles"], ["v", "Vegetarisch"], ["g", "Vegan"]];
// Abwechslung und DGE-Empfehlungen: Fisch 1–2-mal, Fleisch höchstens 300 g pro Woche
const SHOP_GROUP = {"Gemüse": {foods: 3}, "Fisch": {foods: 2, portions: 2}, "Fleisch": {foods: 1, portions: 2}};
const groupLimit = g => Object.assign({foods: 2, portions: 99}, SHOP_GROUP[g] || {});
const dietOk = (d, f) => d === "a" || (d === "v" ? f !== "a" : f === "g");
let shopDiet = sget("gapShopDiet", "a");
const _shopItem = new Map();
function shopItem(name){
  if(!_shopItem.has(name)){
    const it = typeof findItemByName === "function" ? findItemByName(name) : null;
    _shopItem.set(name, it ? withEstimate(it) : null);
  }
  return _shopItem.get(name);
}
function shopGaps(){
  let g = [];
  try{ g = weeklyGaps(); }catch(e){ return {gaps: [], tracked: 0}; }
  const tracked = last7Keys().filter(k => log.some(e => e.date === k)).length;
  const sure = g.filter(x => !x.unsure);
  return {gaps: sure.length ? sure : g, tracked};
}
function buildShop(gaps){
  const T = computeTargets(profile);
  const week = {}, rem = {};
  gaps.forEach(g => { week[g.key] = goalOf(g.key, T) * 7; rem[g.key] = week[g.key] * Math.max(0, 1 - g.pct / 100); });
  const cands = SHOP_FOODS.filter(f => dietOk(shopDiet, f[5])).map(f => {
    const it = shopItem(f[0]);
    if(!it || !it.per100) return null;
    const n = {};
    gaps.forEach(g => { n[g.key] = (it.per100[g.key] || 0) * f[1] / 100; });
    return {name: f[0], grams: f[1], label: f[2], max: f[3], group: f[4], kcal: (it.per100.kcal || 0) * f[1] / 100, n, count: 0};
  }).filter(Boolean);
  // Jodsalz statt normalem Salz kostet nichts extra – bei einer Jod-Lücke immer dabei
  const salt = cands.find(c => c.name === "Jodsalz");
  if(salt && rem.jod > 0){ salt.count = 7; gaps.forEach(g => { rem[g.key] = Math.max(0, rem[g.key] - salt.n[g.key] * 7); }); }
  else if(salt) salt.max = 0;
  const gain = c => gaps.reduce((s, g) => s + prio(g.key) * Math.min(c.n[g.key], rem[g.key]) / week[g.key], 0);
  for(let step = 0; step < 60; step++){
    const used = cands.filter(c => c.count > 0 && c !== salt).length;
    let best = null, bestS = 0;
    cands.forEach(c => {
      if(c.count >= c.max || (!c.count && used >= 10)) return;
      const lim = groupLimit(c.group), same = cands.filter(x => x.group === c.group && x.count > 0);
      if(!c.count && same.length >= lim.foods) return;
      if(same.reduce((n, x) => n + x.count, 0) >= lim.portions) return;
      const s = gain(c) / (1 + c.kcal / 250) * Math.pow(0.8, c.count);
      if(s > bestS){ bestS = s; best = c; }
    });
    if(!best || gain(best) < 0.03) break;
    gaps.forEach(g => { rem[g.key] = Math.max(0, rem[g.key] - best.n[g.key]); });
    best.count++;
  }
  const items = cands.filter(c => c.count > 0).map(c => {
    // wofür das Lebensmittel auf der Liste steht: Lücken, zu denen es mindestens 5 % der Wochenmenge beiträgt
    const helps = gaps.filter(g => c.n[g.key] * c.count / week[g.key] >= 0.05)
      .sort((a, b) => c.n[b.key] / week[b.key] * prio(b.key) - c.n[a.key] / week[a.key] * prio(a.key)).slice(0, 3).map(g => g.label);
    return Object.assign(c, {helps});
  });
  const order = SHOP_FOODS.map(f => f[0]);
  items.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const after = gaps.map(g => ({key: g.key, label: g.label, before: g.pct, after: Math.min(100, 100 - rem[g.key] / week[g.key] * 100)}));
  return {items, after};
}
function shopAmount(c){
  if(c.name === "Jodsalz") return "statt normalem Salz";
  const tot = c.grams * c.count;
  return (c.count > 1 ? c.count + " × " : "") + c.label + (c.label.indexOf(" g") < 0 ? " (" + fmt(c.grams) + " g)" : "") + (c.count > 1 ? " = " + fmt(tot) + " g" : "");
}
// Abgehakte Einträge gelten, solange die Lücken dieselben sind
let shopNow = null;
function shopSig(gaps){ return gaps.map(g => g.key).join(",") + "|" + shopDiet; }
function shopChecked(){ const s = sget("gapShopChecked", null); return s && shopNow && s.sig === shopNow.sig ? s.names : []; }
function drawShop(){
  const box = el("rvShop"); if(!box) return;
  const {gaps, tracked} = shopGaps();
  if(!gaps.length){
    shopNow = null;
    box.innerHTML = '<div class="empty">' + (tracked ? "Diese Woche keine auffälligen Lücken – alle Werte über 70 % der Referenz. Für die Lücken ist nichts extra nötig." :
      "Erfasse ein paar Tage, dann stellt die App hier zusammen, was deine Lücken der Woche schließt.") + '</div>';
    return;
  }
  const res = buildShop(gaps);
  shopNow = Object.assign(res, {sig: shopSig(gaps), gaps});
  const done = shopChecked();
  let h = '<div class="rv-filters">' + SHOP_DIETS.map(d => '<button class="chip" data-rvshopdiet="' + d[0] + '" aria-pressed="' + (d[0] === shopDiet ? "true" : "false") + '">' + d[1] + '</button>').join("") + '</div>';
  const chips = res.after.slice(0, 6);
  h += '<div class="rv-gains">' + chips.map(a => '<span class="rv-gap num">' + esc(a.label) + ' ' + fmt(Math.round(a.before)) + ' % → <b>' + fmt(Math.round(a.after)) + ' %</b></span>').join("") +
    (res.after.length > chips.length ? '<span class="rv-gap">+ ' + (res.after.length - chips.length) + ' weitere</span>' : '') + '</div>';
  h += res.items.length ? res.items.map(c => {
    const on = done.indexOf(c.name) >= 0;
    return '<div class="rv-shop' + (on ? " done" : "") + '"><button class="rv-check" data-rvshopcheck="' + esc(c.name) + '" role="checkbox" aria-checked="' + on + '" aria-label="' + esc(c.name) + ' abhaken"></button>' +
      '<span class="rv-txt"><b>' + esc(c.name) + '</b><span class="rv-meta num">' + esc(shopAmount(c)) + '</span>' +
      (c.helps.length ? '<span class="rv-for">für ' + esc(c.helps.join(", ")) + '</span>' : '') + '</span>' +
      (c.name !== "Jodsalz" ? '<button class="ghost rv-find" data-rvshopfind="' + esc(c.name) + '">Rezepte</button>' : '') + '</div>';
  }).join("") : '<div class="empty">Mit dieser Auswahl lässt sich keine Lücke spürbar schließen.</div>';
  const low = res.after.filter(a => a.after < 70 && a.key !== "vitD");
  const notes = [];
  if(res.after.some(a => a.key === "vitD" && a.after < 70)) notes.push("Vitamin D bildet der Körper vor allem mit Sonnenlicht – über Lebensmittel ist es kaum zu decken.");
  if(low.length) notes.push("Auch mit dieser Liste noch unter 70 %: " + low.map(a => a.label).join(", ") + " – dafür braucht es Änderungen an den täglichen Mahlzeiten.");
  if(notes.length) h += '<div class="small muted" style="margin-top:8px">' + esc(notes.join(" ")) + '</div>';
  h += '<div class="small muted" style="margin-top:8px">Mengen für 7 Tage, zusätzlich zu dem, was du sonst isst. Grundlage: Schnitt aus ' + tracked + (tracked === 1 ? " erfasstem Tag" : " erfassten Tagen") +
    (gaps.some(g => g.unsure) ? "; ein Teil deiner Einträge hat keine Vitamindaten, die Lücken sind daher unsicher" : "") + '.</div>';
  if(res.items.length) h += '<div class="rv-tools"><button class="chip" data-rvshopshare="1">Einkaufsliste teilen</button></div>';
  box.innerHTML = h;
}
function gapShopText(){
  if(!shopNow) return "";
  return "Einkaufsliste für meine Nährstofflücken (7 Tage)\n" + shopNow.items.map(c => "• " + c.name + ": " + shopAmount(c)).join("\n");
}

/* ---------- Rezept-Ansicht ---------- */
const sheet = document.createElement("div");
sheet.className = "sheet"; sheet.id = "recipeView";
sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Rezept");
sheet.innerHTML = '<div class="grab"></div><div class="head"><h3 id="rvTitle">Rezept</h3><button class="ghost" data-close>Schließen</button></div><div class="body" id="rvBody"></div>';
document.body.appendChild(sheet);

let cur = null;   // {m, cook, eat, meal}
function fromKey(k){ return recMeta(k[0], +k.slice(1)); }
function openView(key){
  const m = fromKey(key);
  if(!m) return;
  cur = {m, cook: m.kind === "R" ? (m.r.serves || 1) : 1, eat: 1, meal: guessMeal()};
  closeSheets();
  openSheet("recipeView");
  drawView();
  const b = el("rvBody"); if(b) b.scrollTop = 0;
}
/* Stückgewicht aus den Portionsangaben der Datenbank („1 Stück“, „1 Ei“, „½ Avocado“ …) */
const PIECE_SKIP = /scheibe|glas|tasse|becher|el\b|tl\b|portion|handvoll|kugel|flasche|dose|teller|schussel|schale|prise|packung|riegel|zehe/;
function pieceGrams(name){
  const it = typeof findItemByName === "function" ? findItemByName(name) : null;
  const p = it && (it.portions || []).find(x => { const l = normalize(String(x[0])); return /^(1|½)\s/.test(l) && !PIECE_SKIP.test(l); });
  if(!p) return null;
  return String(p[0]).trim().charAt(0) === "½" ? p[1] * 2 : p[1];
}
function amountTxt(g, factor){
  const v = g[1] * factor;
  let t = fmt(v >= 20 ? Math.round(v / 5) * 5 : Math.round(v * 10) / 10, v < 20 && v % 1 ? 1 : 0) + " g";
  if(g[3]) return t + " (" + g[3] + (factor !== 1 ? " × " + fmt(factor, factor % 1 ? 1 : 0) : "") + ")";
  const pg = pieceGrams(g[0]);
  if(pg){
    const n = Math.round(v / pg * 2) / 2;
    if(n >= 0.5 && Math.abs(v / pg - n) < 0.2) t += " (≈ " + (n === 0.5 ? "½" : String(n).replace(".5", "½").replace(/^0/, "")) + " Stück)";
  }
  return t;
}
function drawView(){
  const m = cur.m, r = m.r, tot = m.item.totals;
  el("rvTitle").textContent = r.name;
  const st = todayState();
  const f = fit(m, st, null);
  const T = st.T;
  // Kopfzeile
  const diet = m.vegan ? "vegan" : m.veg ? "vegetarisch" : "";
  let h = '<div class="rv-meta num">' + esc([m.min ? m.min + " Min." : "", m.cold ? "ohne Kochen" : "", diet,
    m.kind === "R" && (r.serves || 1) > 1 ? "Rezept für " + r.serves + " Portionen" : ""].filter(Boolean).join(" · ")) + '</div>';
  h += '<div class="rv-tools"><button class="chip" data-rvsave="1">' + (isSaved(m) ? "★ Gemerkt" : "☆ Merken") + '</button>' +
    (m.kind === "R" ? '<button class="chip" data-rvedit="1">Bearbeiten</button><button class="chip" data-rvdel="1">Löschen</button>' : '') + '</div>';
  // Je Portion
  h += '<div class="rv-sec">Je Portion</div><div class="rv-stats num">' +
    [["kcal", fmt(Math.round(tot.kcal))], ["Protein", fmt(Math.round(tot.p)) + " g"], ["KH", fmt(Math.round(tot.c)) + " g"], ["Fett", fmt(Math.round(tot.f)) + " g"], ["Ballast", fmt(Math.round(tot.b)) + " g"]]
      .map(x => '<div class="rv-stat"><b>' + x[1] + '</b><span>' + x[0] + '</span></div>').join("") + '</div>';
  // Was es heute bringt
  if(f.gains.length){
    h += '<div class="rv-today"><b>Das bringt es dir heute</b><ul class="num">' + f.gains.map(g =>
      '<li>' + esc(g.label) + ': ' + fmt(Math.round(g.before)) + ' % → ' + fmt(Math.round(Math.min(g.after, 200))) + ' % deines Tagesbedarfs</li>').join("") + '</ul>' +
      '<div class="small" style="margin-top:6px">Danach ' + (curDay() === todayKey() ? "heute" : dayWord(curDay())) + ': ' + fmt(Math.round((st.t.kcal || 0) + tot.kcal)) + ' von ' + fmt(T.kcal) + ' kcal</div></div>';
  }
  // Tagesbedarf je Portion
  const micro = MICROS.filter(x => x[0] !== "natrium" && T.micros[x[0]] > 0).map(x => ({k: x[0], label: x[1], unit: x[2], v: tot[x[0]] || 0, pct: (tot[x[0]] || 0) / T.micros[x[0]] * 100}))
    .sort((a, b) => b.pct - a.pct);
  const bar = x => '<div class="rv-bar"><span>' + esc(x.label) + '</span><i><b style="width:' + Math.min(100, x.pct) + '%"></b></i><span>' + fmt(Math.round(x.pct)) + ' %</span></div>';
  h += '<div class="rv-sec">Vom Tagesbedarf je Portion</div>' + micro.slice(0, 7).map(bar).join("") +
    (micro.length > 7 ? '<details class="prep" style="margin-top:6px"><summary>Alle Vitamine und Mineralstoffe</summary>' + micro.slice(7).map(bar).join("") +
      '<div class="small muted" style="margin-top:6px">Natrium: ' + fmt(Math.round(tot.natrium || 0)) + ' mg je Portion.</div></details>' : '');
  if(m.kind === "R" && typeof recipeHasProducts === "function" && recipeHasProducts(m.item))
    h += '<div class="small muted" style="margin-top:6px">Enthält Markenprodukte ohne Vitaminangaben – die Werte oben sind dann zu niedrig.</div>';
  // Zutaten
  const per = m.kind === "R" ? 1 / (r.serves || 1) : 1;
  const factor = per * cur.cook;
  h += '<div class="rv-sec"><span>Zutaten</span><span class="rv-stepper num"><button class="ghost" data-rvcook="-1" aria-label="weniger Portionen">−</button>' +
    '<span>' + cur.cook + (cur.cook === 1 ? " Portion" : " Portionen") + '</span><button class="ghost" data-rvcook="1" aria-label="mehr Portionen">+</button></span></div>' +
    '<div>' + r.ings.map(g => '<div class="rv-ing"><span>' + esc(g[0]) + '</span><span>' + esc(amountTxt(g, factor)) + '</span></div>').join("") + '</div>' +
    '<div class="rv-tools"><button class="chip" data-rvshop="1">Einkaufsliste teilen</button></div>';
  // Zubereitung
  if(r.steps && r.steps.length) h += '<div class="rv-sec">Zubereitung</div><ol class="rv-steps">' + r.steps.map(s => '<li>' + esc(s) + '</li>').join("") + '</ol>';
  else if(r.desc) h += '<div class="rv-sec">Zubereitung</div><p style="margin:0;font-size:15px;line-height:1.5">' + esc(r.desc) + '</p>';
  // Eintragen – schmale Leiste, bleibt unten sichtbar
  h += '<div class="rv-eat"><div class="rv-eatrow">' +
    '<select data-rveatsel="1" aria-label="Portionen">' + [0.5, 1, 1.5, 2, 3].map(v => '<option value="' + v + '"' + (v === cur.eat ? " selected" : "") + '>' +
      (v === 0.5 ? "½" : v === 1.5 ? "1½" : v) + (v > 1 ? " Portionen" : " Portion") + '</option>').join("") + '</select>' +
    '<select data-rvmealsel="1" aria-label="Mahlzeit">' + MEALS.map(x => '<option value="' + x[0] + '"' + (x[0] === cur.meal ? " selected" : "") + '>' + x[1] + '</option>').join("") + '</select></div>' +
    '<button class="primary" data-rvaddcur="1" style="width:100%">' + (curDay() === todayKey() ? "" : "Für " + dayWord(curDay()) + ": ") + 'Eintragen · ' + fmt(Math.round(tot.kcal * cur.eat)) + ' kcal</button></div>';
  el("rvBody").innerHTML = h;
}
function addRecipe(m, amount, meal){
  const e = entryFromItem(m.item, amount, meal);
  log.push(e); sset("log", log);
  toast(m.r.name + " → " + MEAL_LABEL[e.meal] + (e.date !== todayKey() ? " (" + dayName(e.date) + ")" : ""), undoAdd(e.id));
  renderAll();
  if(document.getElementById("view-rezepte").classList.contains("active")) renderRecipes();
}
function shoppingText(){
  const m = cur.m, r = m.r;
  const per = m.kind === "R" ? 1 / (r.serves || 1) : 1;
  return "Einkaufsliste – " + r.name + " (" + cur.cook + (cur.cook === 1 ? " Portion" : " Portionen") + ")\n" +
    r.ings.map(g => "• " + g[0] + ": " + amountTxt(g, per * cur.cook)).join("\n");
}
async function shareShopping(text, into){
  text = text || shoppingText();
  try{
    if(navigator.share){ await navigator.share({title: "Einkaufsliste", text}); return; }
  }catch(e){ if(e && e.name === "AbortError") return; }
  try{ await navigator.clipboard.writeText(text); toast("Einkaufsliste kopiert"); return; }catch(e){}
  // Rückfall: Text zum Markieren anzeigen
  const b = into || el("rvBody");
  b.insertAdjacentHTML("beforeend", '<textarea readonly rows="6" style="margin-top:10px" onclick="this.select()">' + esc(text) + '</textarea>');
}

/* ---------- Eigene Rezepte: Zutaten per Satz ---------- */
(function sayBox(){
  const sheetEl = el("recipeSheet"), name = el("recName");
  if(!sheetEl || !name || !window.NW_SPRACHE) return;
  const d = document.createElement("div");
  d.className = "rv-say";
  d.innerHTML = '<div class="small" style="font-weight:600;margin-bottom:4px">Zutaten per Satz <span class="muted" style="font-weight:400">(tippen oder mit der Tastatur diktieren)</span></div>' +
    '<textarea id="rvSayText" rows="2" placeholder="z. B. 60 g Haferflocken, 200 ml Milch, eine Banane und eine Handvoll Mandeln"></textarea>' +
    '<div class="rv-foot"><button class="ghost" id="rvSayBtn">Zutaten übernehmen</button><span class="small muted" id="rvSayInfo"></span></div>';
  name.insertAdjacentElement("afterend", d);
  el("rvSayBtn").addEventListener("click", () => {
    const text = el("rvSayText").value.trim();
    if(!text) return;
    const rows = NW_SPRACHE.parseText(text);
    let n = 0; const miss = [];
    rows.forEach(r => {
      if(!r.ok){ miss.push(r.spec.food || r.phrase); return; }
      draft.ings.push([r.cands[r.sel].name, Math.max(1, Math.round(r.amount))]);
      n++;
    });
    renderDraft();
    el("rvSayInfo").textContent = (n ? n + (n === 1 ? " Zutat" : " Zutaten") + " übernommen" : "Nichts erkannt") + (miss.length ? " · nicht gefunden: " + miss.join(", ") : "");
    if(n) el("rvSayText").value = "";
  });
})();
// Beim Öffnen des Editors das Satz-Feld leeren
if(typeof openRecipeEditor === "function"){
  const baseEditor = openRecipeEditor;
  openRecipeEditor = function(){
    const r = baseEditor.apply(this, arguments);
    const t = el("rvSayText"), i = el("rvSayInfo");
    if(t) t.value = ""; if(i) i.textContent = "";
    return r;
  };
}

/* ---------- Ereignisse ---------- */
function keyOf(t, attr){ const n = t.closest("[" + attr + "]"); return n ? n.getAttribute(attr) : null; }
view && view.addEventListener("click", ev => {
  const t = ev.target;
  if(t.closest("select")) return;
  const add = keyOf(t, "data-rvadd");
  if(add){
    ev.stopPropagation();
    const m = fromKey(add), sel = view.querySelector('select[data-rvmeal="' + add + '"]');
    if(m) addRecipe(m, 1, sel ? sel.value : guessMeal());
    return;
  }
  const sd = keyOf(t, "data-rvshopdiet");
  if(sd){ shopDiet = sd; sset("gapShopDiet", sd); drawShop(); return; }
  const ck = keyOf(t, "data-rvshopcheck");
  if(ck && shopNow){
    const names = shopChecked().slice(), j = names.indexOf(ck);
    if(j >= 0) names.splice(j, 1); else names.push(ck);
    sset("gapShopChecked", {sig: shopNow.sig, names});
    drawShop(); return;
  }
  const fd = keyOf(t, "data-rvshopfind");
  if(fd){
    // Rezeptbuch nach dem Lebensmittel durchsuchen („Linsen (gekocht)“ → „Linsen“)
    query = fd.replace(/\s*\(.*\)\s*/g, " ").replace(/,.*$/, "").replace(/\s+\d.*$/, "").trim();
    filter = "alle"; showAll = false;
    if(search) search.value = query;
    renderMine();
    book.scrollIntoView({behavior: "smooth", block: "start"});
    return;
  }
  if(keyOf(t, "data-rvshopshare")){ shareShopping(gapShopText(), el("rvShop")); return; }
  const fl = keyOf(t, "data-rvfilter");
  if(fl){ filter = fl; showAll = false; renderMine(); return; }
  if(keyOf(t, "data-rvmore")){ showAll = true; renderMine(); return; }
  const op = keyOf(t, "data-rvopen");
  if(op){ openView(op); return; }
});
view && view.addEventListener("keydown", ev => {
  if(ev.key !== "Enter" && ev.key !== " ") return;
  const op = ev.target.getAttribute && ev.target.getAttribute("data-rvopen");
  if(op){ ev.preventDefault(); openView(op); }
});
const search = el("rvSearch");
if(search) search.addEventListener("input", () => { query = search.value.trim(); renderMine(); });
sheet.addEventListener("change", ev => {
  const t = ev.target;
  if(!cur) return;
  if(t.dataset.rveatsel){ cur.eat = +t.value; drawEatButton(); }
  if(t.dataset.rvmealsel){ cur.meal = t.value; }
});
function drawEatButton(){
  const b = sheet.querySelector("[data-rvaddcur]");
  if(b) b.textContent = (curDay() === todayKey() ? "" : "Für " + dayWord(curDay()) + ": ") + "Eintragen · " + fmt(Math.round(cur.m.item.totals.kcal * cur.eat)) + " kcal";
}
sheet.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if(!t || !cur) return;
  const m = cur.m;
  if(t.dataset.rvcook){ cur.cook = Math.max(1, Math.min(8, cur.cook + +t.dataset.rvcook)); drawView(); return; }
  if(t.dataset.rveat){ cur.eat = +t.dataset.rveat; drawView(); return; }
  if(t.dataset.rvmealpick){ cur.meal = t.dataset.rvmealpick; drawView(); return; }
  if(t.dataset.rvsave){ const on = toggleSaved(m); toast(on ? "Gemerkt" : "Nicht mehr gemerkt"); drawView(); renderMine(); return; }
  if(t.dataset.rvshop){ shareShopping(); return; }
  if(t.dataset.rvaddcur){ const amt = cur.eat, meal = cur.meal; closeSheets(); addRecipe(m, amt, meal); return; }
  if(t.dataset.rvedit){ const i = m.i; closeSheets(); openRecipeEditor(i); return; }
  if(t.dataset.rvdel){
    const i = m.i;
    closeSheets();
    askConfirm("Rezept löschen?", "„" + recipes[i].name + "“ wird entfernt. Bereits erfasste Einträge bleiben erhalten.", () => {
      recipes.splice(i, 1); sset("recipes", recipes); renderRecipes(); toast("Rezept gelöscht");
    }, "Löschen");
  }
});

window.NW_REZEPTE = {open: openView, fit, recMeta, render: renderMine};
})();
