/* NährWert – Ergänzungen der Heute-, Woche- und Profil-Ansicht (nach dem Rezept-Modul geladen)
   1. Serie: „6 Tage in Folge erfasst“ unter der Wochenleiste – dezent, ohne Belohnungs-Animationen
   2. Fokus-Nährstoffe: bis zu zwei Nährstoffe als Kacheln neben Protein, Kohlenhydraten und Fett
   3. Koffein-Kurve: wie viel Koffein heute noch im Körper ist und was davon beim Schlafengehen übrig bleibt
   4. Wochenrückblick: eine Karte oben in „Woche“ mit Deutung statt nur Zahlen; montags ein Hinweis auf „Heute“
   5. Portionshilfe: kleine Bilder (in Blender gerendert) zu Portionsangaben wie „1 EL“ oder „1 Handvoll“
   6. „Mehr“: selten genutzte Funktionen (Koffein-Kurve, Essensplan) eingeklappt am Ende von Heute und Rezepte */
(function(){
"use strict";
if(typeof renderToday !== "function") return;
const el = id => document.getElementById(id);
const uiGetX = k => { try{ return localStorage.getItem("nw1.ui." + k); }catch(e){ return null; } };
const uiSetX = (k, v) => { try{ localStorage.setItem("nw1.ui." + k, v); }catch(e){} };

const css = document.createElement("style");
css.textContent = [
  "#streakNote{font-size:12.5px; color:var(--muted); text-align:center; margin:6px 0 0}",
  "#streakNote b{color:var(--accent); font-weight:700}",
  "#focusTiles{margin-top:8px}",
  "#focusTiles:empty{display:none}",
  ".cafcurve{margin-top:4px}",
  ".morefold .morebox > .card{box-shadow:none; border:none; padding:0; margin:0; background:none}",
  ".morefold .morebox > * + *{margin-top:16px; padding-top:14px; border-top:1px solid var(--line)}",
  ".morefold .morebox h2{font-size:15px}",
  ".cafcurve svg{display:block; width:100%; height:auto; margin-top:6px}",
  ".cafcurve .cl{fill:color-mix(in srgb, var(--drink) 22%, transparent); stroke:var(--drink); stroke-width:2}",
  ".cafcurve .cg{stroke:var(--line); stroke-width:1}",
  ".cafcurve .cn{stroke:var(--ink); stroke-width:1.5; stroke-dasharray:3 3}",
  ".cafcurve .cb{stroke:var(--warn); stroke-width:1.5; stroke-dasharray:4 3}",
  ".cafcurve text{font-size:10.5px; fill:var(--muted)}",
  ".wreview .wr-row{display:flex; gap:10px; align-items:flex-start; padding:7px 0; border-bottom:1px solid var(--line); font-size:14px; line-height:1.4}",
  ".wreview .wr-row:last-child{border-bottom:none}",
  ".wreview .wr-ic{flex:0 0 26px; font-size:18px; line-height:1.2; text-align:center}",
  ".wreview .wr-row b{font-weight:650}",
  ".wreview .wr-tip{background:var(--accent-soft); border-radius:12px; padding:10px 12px; margin-top:8px; font-size:14px; line-height:1.4}",
  ".focuspick{display:flex; flex-wrap:wrap; gap:6px; margin-top:8px}",
  ".focuspick .chip[aria-pressed='true']{background:var(--accent); color:var(--on-accent); border-color:var(--accent)}",
  ".porthelp{display:flex; gap:10px; align-items:center; background:var(--surface2); border-radius:12px; padding:6px 10px 6px 6px; margin:8px 0 2px}",
  ".porthelp img{width:64px; height:64px; flex:0 0 64px; object-fit:contain}",
  ".porthelp span{font-size:13px; line-height:1.35; color:var(--muted)}",
  ".porthelp b{color:var(--ink); font-weight:650}"
].join("\n");
document.head.appendChild(css);

/* ---------- 1. Serie ---------- */
function streak(){
  let k = todayKey();
  if(!dayHas(k)) k = shiftKey(k, -1);          // heute noch nichts erfasst: die Serie zählt bis gestern
  let n = 0;
  while(dayHas(k) && n < 400){ n++; k = shiftKey(k, -1); }
  return n;
}
function drawStreak(){
  const ws = el("weekStrip"); if(!ws) return;
  let s = el("streakNote");
  if(!s){ s = document.createElement("div"); s.id = "streakNote"; ws.insertAdjacentElement("afterend", s); }
  const n = streak();
  s.innerHTML = n >= 3 ? '<b class="num">' + n + ' Tage</b> in Folge erfasst' + (dayHas(todayKey()) ? '' : ' – heute noch eintragen, dann geht die Serie weiter') : "";
}

/* ---------- 2. Fokus-Nährstoffe ---------- */
const FOCUS_OPTS = () => MICROS.filter(m => m[0] !== "natrium").map(m => [m[0], m[1], m[2]]).concat([["b", "Ballaststoffe", "g"]]);
let focus = sget("focusNutr", []);
function drawFocusTiles(){
  const mr = el("macroRings"); if(!mr) return;
  let box = el("focusTiles");
  if(!box){ box = document.createElement("div"); box.id = "focusTiles"; box.className = "macrotiles num"; mr.insertAdjacentElement("afterend", box); }
  const T = computeTargets(profile), t = dayTotals(curDay());
  const opts = FOCUS_OPTS();
  const list = focus.map(k => opts.find(o => o[0] === k)).filter(Boolean);
  box.style.gridTemplateColumns = "repeat(" + Math.max(1, list.length) + ",1fr)";
  box.innerHTML = list.map(([k, label, unit]) => {
    const goal = k === "b" ? T.ballast : T.micros[k], val = t[k] || 0, p = goal > 0 ? val / goal : 0, rest = goal - val;
    const d = v => fmt(v, v < 10 && v % 1 ? 1 : 0);
    return '<div class="mtile" data-nutr="' + k + '" role="button" tabindex="0"><div class="ml">' + esc(label) + ' · Fokus</div>' +
      '<div class="mv">' + d(val) + '<small> / ' + fmtRef(goal) + ' ' + unit + '</small></div>' +
      '<div class="mbar"><i style="width:' + Math.min(100, p * 100) + '%;background:' + (p >= .7 ? "var(--ok)" : "var(--warn)") + '"></i></div>' +
      '<div class="mr">' + (rest > 0 ? "noch " + d(rest) + " " + unit : "Ziel erreicht") + '</div></div>';
  }).join("");
}
function drawFocusPicker(){
  const prof = el("view-profil"); if(!prof) return;
  let c = el("focusCard");
  if(!c){
    c = document.createElement("div"); c.className = "card"; c.id = "focusCard";
    const first = prof.querySelector(".card");
    prof.insertBefore(c, first ? first.nextSibling : null);
  }
  c.innerHTML = '<h2>Fokus-Nährstoffe</h2><div class="small muted">Bis zu zwei Nährstoffe, die dir besonders wichtig sind – sie erscheinen auf „Heute“ neben Protein, Kohlenhydraten und Fett.</div>' +
    '<div class="focuspick">' + FOCUS_OPTS().map(([k, label]) => '<button class="chip" data-focus="' + k + '" aria-pressed="' + (focus.indexOf(k) >= 0) + '">' + esc(label) + '</button>').join("") + '</div>';
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-focus]"); if(!b) return;
  const k = b.dataset.focus, i = focus.indexOf(k);
  if(i >= 0) focus.splice(i, 1); else { focus.push(k); if(focus.length > 2) focus.shift(); }
  sset("focusNutr", focus); drawFocusPicker(); drawFocusTiles();
});

/* ---------- 6. „Mehr“-Bereich ----------
   Eingeklappte Karte am Ende einer Ansicht für selten genutzte Funktionen. Auf/zu wird gemerkt. */
function moreBox(view, id, hint){
  let d = el(id);
  if(!d){
    const sec = el("view-" + view); if(!sec) return null;
    d = document.createElement("details"); d.className = "card microfold morefold"; d.id = id;
    d.innerHTML = '<summary><h2>Mehr</h2><span class="state">' + esc(hint) + '</span></summary><div class="morebox"></div>';
    if(uiGetX(id) === "1") d.open = true;
    d.addEventListener("toggle", () => uiSetX(id, d.open ? "1" : "0"));
    sec.appendChild(d);
  }
  return d.querySelector(".morebox");
}
// Essensplan aus dem Rezepte-Modul in „Mehr“ verschieben; neu eingeplante Rezepte klappen den Bereich auf
(function movePlan(){
  const plan = el("mealPlan"), host = plan && moreBox("rezepte", "moreRezepte", "Essensplan");
  if(!host) return;
  plan.classList.remove("card"); host.appendChild(plan);
  const box = el("rvPlan"), cnt = () => box ? box.querySelectorAll("[data-rvplandel]").length : 0;
  let last = cnt();
  if(box) new MutationObserver(() => { const n = cnt(); if(n > last) el("moreRezepte").open = true; last = n; }).observe(box, {childList: true, subtree: true});
})();

/* ---------- 3. Koffein-Kurve ----------
   Halbwertszeit von Koffein bei Erwachsenen im Mittel etwa 5 Stunden (große Spannbreite: 2–10 h).
   Aufnahme vereinfacht über 45 Minuten. Einträge ohne Uhrzeit (nachgetragen oder kopiert) bekommen die
   übliche Zeit ihrer Mahlzeit. */
const HALF = 5, BED = 23;
const MEAL_HOUR = {fruehstueck: 8, mittag: 12.5, snack: 15.5, abend: 19, getraenk: 10};
function hourOf(e){
  if(e.t){ const d = new Date(e.t); if(dateKey(d) === e.date) return d.getHours() + d.getMinutes() / 60; }
  return MEAL_HOUR[e.meal] || 12;
}
function cafAt(es, h){
  return es.reduce((s, e) => {
    const dt = h - e.h; if(dt <= 0) return s;
    const up = Math.min(1, dt / .75);
    return s + e.cf * up * Math.pow(.5, Math.max(0, dt - .375) / HALF);
  }, 0);
}
function drawCaffeine(){
  if(!el("cafVal")) return;
  let box = el("cafCurve");
  if(!box){ const host = moreBox("heute", "moreHeute", "Koffein-Kurve"); if(!host) return; box = document.createElement("div"); box.id = "cafCurve"; box.className = "cafcurve"; host.appendChild(box); }
  const day = curDay(), isToday = day === todayKey();
  const es = log.filter(e => e.date === day && e.cf > 0).map(e => ({cf: e.cf, h: hourOf(e)}));
  if(!es.length){ box.innerHTML = '<div class="small"><b>Koffein im Körper</b></div><div class="small muted">Sobald du ' + (isToday ? "heute" : "an diesem Tag") + ' Kaffee, Tee oder andere koffeinhaltige Getränke einträgst, siehst du hier, wie viel Koffein bis zum Schlafengehen übrig bleibt.</div>'; return; }
  const now = new Date(), hNow = now.getHours() + now.getMinutes() / 60;
  const atBed = cafAt(es, BED), atNow = cafAt(es, hNow);
  const pts = [], H0 = 6, H1 = 24.5;
  let mx = 50; for(let h = H0; h <= H1; h += .25){ const v = cafAt(es, h); pts.push([h, v]); if(v > mx) mx = v; }
  mx = Math.ceil(mx / 50) * 50;
  const W = 320, Hh = 92, L = 26, R = 6, Tp = 6, B = 18;
  const X = h => L + (h - H0) / (H1 - H0) * (W - L - R), Y = v => Tp + (1 - v / mx) * (Hh - Tp - B);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Koffein im Körper über den Tag">';
  [0, mx / 2, mx].forEach(v => { svg += '<line class="cg" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 4) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end">' + Math.round(v) + '</text>'; });
  svg += '<path class="cl" d="M' + X(H0) + ',' + Y(0) + ' ' + pts.map(p => 'L' + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(" ") + ' L' + X(H1) + ',' + Y(0) + ' Z"/>';
  svg += '<line class="cb" x1="' + X(BED) + '" x2="' + X(BED) + '" y1="' + Tp + '" y2="' + (Hh - B) + '"/>';
  if(isToday && hNow >= H0 && hNow <= H1) svg += '<line class="cn" x1="' + X(hNow) + '" x2="' + X(hNow) + '" y1="' + Tp + '" y2="' + (Hh - B) + '"/>';
  [6, 9, 12, 15, 18, 21, 24].forEach(h => { svg += '<text x="' + X(h) + '" y="' + (Hh - 4) + '" text-anchor="middle">' + (h === 24 ? "0" : h) + '</text>'; });
  svg += '</svg>';
  const late = atBed >= 50;
  box.innerHTML = '<div class="small"><b>Koffein im Körper</b>' + (isToday ? ' · jetzt etwa <b class="num">' + Math.round(atNow) + ' mg</b>' : '') +
    ' · um ' + BED + ' Uhr etwa <b class="num">' + Math.round(atBed) + ' mg</b></div>' + svg +
    '<div class="small muted">' + (late ? "Spät am Abend noch viel Koffein kann das Einschlafen und den Tiefschlaf stören. Studien raten, den letzten Kaffee etwa 8 bis 9 Stunden vor dem Schlafen zu trinken." :
      "Gestrichelt: 23 Uhr. Koffein wird im Mittel mit einer Halbwertszeit von etwa 5 Stunden abgebaut – bei manchen Menschen deutlich langsamer.") + '</div>';
}

/* ---------- 4. Wochenrückblick ---------- */
function weekId(){ const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dateKey(d); }   // Montag der Woche
function reviewData(){
  const T = computeTargets(profile), keys = last7Keys().filter(k => k !== todayKey()).concat([todayKey()]);
  const days = keys.filter(dayHas).map(k => ({k, t: dayTotals(k)}));
  if(days.length < 3) return null;
  const micro = MICROS.filter(m => m[0] !== "natrium" && T.micros[m[0]] > 0);
  days.forEach(d => { d.inTarget = micro.filter(m => (d.t[m[0]] || 0) / T.micros[m[0]] >= .7).length; d.kdev = Math.abs((d.t.kcal || 0) / T.kcal - 1); });
  const avgK = days.reduce((s, d) => s + (d.t.kcal || 0), 0) / days.length;
  const best = days.slice().sort((a, b) => b.inTarget - a.inTarget || a.kdev - b.kdev)[0];
  let gaps = []; try{ gaps = weeklyGaps().filter(g => !g.unsure); }catch(e){}
  const W = Object.keys(weights || {}).filter(k => weights[k] > 0).sort();
  const wNow = W.filter(k => k >= shiftKey(todayKey(), -7)), wPrev = W.filter(k => k < shiftKey(todayKey(), -7) && k >= shiftKey(todayKey(), -21));
  const wDiff = wNow.length && wPrev.length ? weights[wNow[wNow.length - 1]] - weights[wPrev[wPrev.length - 1]] : null;
  const prevDays = [7, 8, 9, 10, 11, 12, 13].map(i => shiftKey(todayKey(), -i)).filter(dayHas).map(k => dayTotals(k).kcal || 0);
  const prevAvg = prevDays.length >= 3 ? prevDays.reduce((a, b) => a + b, 0) / prevDays.length : null;
  return {T, days, micro, avgK, best, gaps, wDiff, prevAvg};
}
function drawReview(){
  const wv = el("view-woche"); if(!wv) return;
  let c = el("weekReview");
  if(!c){ c = document.createElement("div"); c.className = "card wreview"; c.id = "weekReview"; wv.insertBefore(c, wv.firstElementChild); }
  const r = reviewData();
  if(!r){ c.innerHTML = '<h2>Wochenrückblick</h2><div class="small muted">Erfasse mindestens drei Tage, dann fasst die App hier deine Woche zusammen.</div>'; return; }
  const row = (ic, html) => '<div class="wr-row"><span class="wr-ic" aria-hidden="true">' + ic + '</span><span>' + html + '</span></div>';
  const kp = Math.round(r.avgK / r.T.kcal * 100);
  let h = '<h2>Wochenrückblick</h2>';
  h += row("📅", '<b>' + r.days.length + ' von 7 Tagen</b> erfasst · Ø <b class="num">' + fmt(Math.round(r.avgK)) + ' kcal</b> (' + kp + ' % deines Ziels)' +
    (r.prevAvg ? ', Vorwoche Ø ' + fmt(Math.round(r.prevAvg)) + ' kcal' : '') + '.');
  h += row("⭐", 'Bester Tag: <b>' + esc(dayName(r.best.k)) + '</b> – ' + r.best.inTarget + ' von ' + r.micro.length + ' Vitaminen und Mineralstoffen im Ziel.');
  if(r.gaps.length) h += row("🔍", 'Größte Lücke: <b>' + esc(r.gaps[0].label) + '</b> mit ' + Math.round(r.gaps[0].pct) + ' %' +
    (r.gaps.length > 1 ? ', danach ' + r.gaps.slice(1, 3).map(g => esc(g.label) + ' (' + Math.round(g.pct) + ' %)').join(" und ") : '') + '.');
  else h += row("✅", 'Keine auffälligen Lücken – alle Nährstoffe im Wochenschnitt über 70 %.');
  if(r.wDiff != null) h += row("⚖️", 'Gewicht: <b class="num">' + (r.wDiff > 0 ? "+" : r.wDiff < 0 ? "−" : "±") + fmt(Math.abs(r.wDiff), 1) + ' kg</b> gegenüber der Vorwoche.');
  // Ein konkreter Tipp für die nächste Woche
  const g = r.gaps.find(x => x.key !== "vitD") || null;
  const tip = g && window.NW_REZEPTE && NW_REZEPTE.tipFor ? NW_REZEPTE.tipFor(g.key) : null;
  if(tip){
    // Wochendefizit (in Tagesbedarfen) durch den Beitrag einer Portion, begrenzt auf das, was pro Woche sinnvoll ist
    const times = Math.min(tip.maxWeek || 3, Math.max(1, Math.ceil((100 - g.pct) * 7 / Math.max(1, tip.pct))));
    h += '<div class="wr-tip"><b>Tipp für die nächste Woche:</b> ' + times + '× ' + esc(tip.name) + ' (' + esc(tip.label) + ') – jede Portion bringt etwa ' +
      Math.round(tip.pct) + ' % deines Tagesbedarfs an ' + esc(g.label) + '.</div>';
  } else if(r.gaps.length && r.gaps[0].key === "vitD"){
    h += '<div class="wr-tip"><b>Tipp:</b> Vitamin D bildet der Körper vor allem mit Sonnenlicht – über Lebensmittel ist es kaum zu decken. Im Winter mit der Ärztin oder dem Arzt über ein Präparat sprechen.</div>';
  }
  c.innerHTML = h;
}
function drawReviewNote(){
  const hn = el("homeNote"); if(!hn || hn.innerHTML.trim()) return;
  const dow = new Date().getDay();
  if((dow !== 0 && dow !== 1) || uiGetX("reviewSeen") === weekId() || curDay() !== todayKey()) return;
  if(!reviewData()) return;
  hn.innerHTML = '<div class="homenote"><span>Dein Wochenrückblick ist da: wie die letzten 7 Tage gelaufen sind und ein Tipp für die nächste Woche.</span>' +
    '<div class="acts"><button class="chip" data-review="open">Ansehen</button><button class="ghost" data-review="hide">Später</button></div></div>';
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-review]"); if(!b) return;
  uiSetX("reviewSeen", weekId());
  if(b.dataset.review === "open") switchTab("woche"); else renderToday();
});

/* ---------- 5. Portionshilfe ---------- */
const PORT_IMG = [
  [/esslöffel|\bel\b/i, "naehrwert-portion-el.webp", "1 Esslöffel", "etwa 10–15 g Öl, Zucker oder Kerne"],
  [/teelöffel|\btl\b/i, "naehrwert-portion-tl.webp", "1 Teelöffel", "etwa 3–5 g"],
  [/handvoll/i, "naehrwert-portion-handvoll.webp", "1 Handvoll", "so viel, wie in eine hohle Hand passt – bei Nüssen etwa 25–30 g"],
  [/scheibe/i, "naehrwert-portion-scheibe.webp", "1 Scheibe", "Brot etwa 40–50 g, Käse oder Wurst etwa 20–30 g"],
  [/\bglas\b/i, "naehrwert-portion-glas.webp", "1 Glas", "etwa 200–250 ml"],
  [/tasse|becher/i, "naehrwert-portion-tasse.webp", "1 Tasse", "etwa 150–200 ml"],
  [/portion|teller/i, "naehrwert-portion-teller.webp", "1 Portion", "gegarte Nudeln oder Reis etwa 200–250 g"]
];
function portHelp(label){
  const p = PORT_IMG.find(x => x[0].test(label || ""));
  return p ? '<div class="porthelp"><img src="' + p[1] + '" alt="" decoding="async"><span><b>' + esc(p[2]) + '</b><br>' + esc(p[3]) + '</span></div>' : "";
}
// In der Mengenauswahl beim Eintragen: zur gewählten Portionsangabe das passende Bild zeigen
function showPortHelp(label){
  const host = document.getElementById("portChips"); if(!host) return;
  let box = document.getElementById("portHelp");
  const html = portHelp(label);
  if(!html){ if(box) box.remove(); return; }
  if(!box){ box = document.createElement("div"); box.id = "portHelp"; host.insertAdjacentElement("afterend", box); }
  box.innerHTML = html;
}
document.addEventListener("click", ev => { const b = ev.target.closest("#portChips [data-amt]"); if(b) showPortHelp(b.textContent); });
if(typeof pickItem === "function"){
  const basePick = pickItem;
  pickItem = function(){
    const r = basePick.apply(this, arguments);
    try{ const first = document.querySelector("#portChips [data-amt]"); showPortHelp(first ? first.textContent : ""); }catch(e){}
    return r;
  };
}
window.NW_PORTHELP = portHelp;

/* ---------- Einhängen ---------- */
const baseToday = renderToday;
renderToday = function(){
  const r = baseToday.apply(this, arguments);
  [drawStreak, drawFocusTiles, drawCaffeine, drawReviewNote].forEach(f => { try{ f(); }catch(e){ if(window.nwErr) nwErr("Heute-Extras", e); } });
  return r;
};
if(typeof renderWeek === "function"){
  const baseWeek = renderWeek;
  renderWeek = function(){ const r = baseWeek.apply(this, arguments); try{ drawReview(); }catch(e){ if(window.nwErr) nwErr("Wochenrückblick", e); } return r; };
}
if(typeof renderProfile === "function"){
  const baseProf = renderProfile;
  renderProfile = function(){ const r = baseProf.apply(this, arguments); try{ drawFocusPicker(); }catch(e){ if(window.nwErr) nwErr("Fokus-Auswahl", e); } return r; };
}
try{ drawFocusPicker(); renderToday(); if(document.getElementById("view-woche").classList.contains("active")) renderWeek(); }catch(e){ if(window.nwErr) nwErr("Extras-Start", e); }
})();
