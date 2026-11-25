/* Prüfliste für „Einfach sagen“ (naehrwert-sprache.js): Satz → erwartete Lebensmittel in dieser Reihenfolge.
   Start im Hauptordner:  python3 -m http.server 8765  und dann  node tests/sprache-pruefliste.js
   Braucht Playwright mit vollem Chromium (die Headless-Shell stürzt bei der App ab). */
const {chromium} = require("playwright");
const CASES = [
  ["zwei Löffel Öl und eine Banane", ["Olivenöl 20", "Banane"]],
  ["zwei EL Olivenöl, eine Banane und ein Glas Milch", ["Olivenöl 20", "Banane", "Vollmilch 3,5 % 200"]],
  ["drei Eier zwei Scheiben Toast und ein Kaffee", ["Ei 180", "Toastbrot 50", "Kaffee (schwarz)"]],
  ["200 Gramm Hähnchen 150 Gramm Reis und Brokkoli", ["Hähnchenbrust 200", "Reis (gekocht) 150", "Brokkoli"]],
  ["einen Apfel eine Banane", ["Apfel", "Banane"]],
  ["eine Banane einen Apfel und zwei Kiwis", ["Banane", "Apfel", "Kiwi 150"]],
  ["eine Pizza Salami eine Cola", ["Pizza Salami", "Cola"]],
  ["zwei Löffel Zucker in den Kaffee", ["Zucker 20", "Kaffee (schwarz)"]],
  ["Salat mit Tomaten Gurke und Feta", ["Blattsalat", "Tomate 60", "Gurke 40", "Feta"]],
  ["Tomaten Gurke Paprika", ["Tomate", "Gurke", "Paprika (rot)"]],
  ["Müsli mit Joghurt und Heidelbeeren", ["Müsli (ungesüßt)", "Naturjoghurt 3,5 %", "Blaubeeren"]],
  ["zwei Brote mit Butter und Marmelade", ["Roggenmischbrot 90", "Butter 20", "Marmelade 40"]],
  ["Vollkornbrot mit Frischkäse und Gurke", ["Vollkornbrot", "Frischkäse 20", "Gurke 40"]],
  ["Zum Frühstück zwei Eier, eine Scheibe Vollkornbrot mit Butter und ein Glas Orangensaft", ["Ei 120", "Vollkornbrot 45", "Butter 10", "Orangensaft 200"]],
  ["Banane 70 Gramm", ["Banane 70"]],
  ["2 Scheiben Brot à 40 g", ["Roggenmischbrot 80"]],
  ["Brot mit 2 Scheiben Käse", ["Roggenmischbrot", "Gouda"]],
  ["Kaffee mit Milch", ["Kaffee (Getränk) mit Milch 3,5 % Fett"]],
  ["Kaffee mit Milch und zwei Löffel Zucker", ["Kaffee (Getränk) mit Milch 3,5 % Fett", "Zucker 20"]],
  ["eine große Portion Spaghetti Bolognese", ["Spaghetti Bolognese"]],
  ["Chili con Carne", ["Chili con Carne"]],
  ["Lachs mit Kartoffeln und Spinat", ["Lachs", "Kartoffeln (gekocht)", "Spinat"]],
  ["eine Handvoll Walnüsse und zwei Teelöffel Honig", ["Walnüsse", "Honig"]],
  ["einen halben Liter Wasser", ["Mineralwasser 500"]],
  ["n Apfel und ne Banane", ["Apfel", "Banane"]]
];
(async () => {
  const b = await chromium.launch({channel: "chromium"});
  const ctx = await b.newContext({serviceWorkers: "block"});
  const p = await ctx.newPage();
  await p.route("**/*.{webm,mov,webp}", r => r.abort());
  await p.goto(process.env.URL || "http://localhost:8765/index.html");
  await p.waitForFunction(() => window.NW_SPRACHE);
  let bad = 0;
  for(const [text, want] of CASES){
    const got = await p.evaluate(t => NW_SPRACHE.parseText(t).map(r => r.ok ? r.cands[r.sel].name + " " + r.amount : "?? " + r.spec.food), text);
    // „Name“ muss passen, „Name 20“ auch die Menge
    const ok = got.length === want.length && want.every((w, i) => {
      const m = w.match(/^(.*?)(?: (\d+))?$/);
      return got[i].startsWith(m[1] + " ") && (!m[2] || got[i] === m[1] + " " + m[2]);
    });
    if(!ok){ bad++; console.log("FEHLER »" + text + "«\n  erwartet: " + want.join(" | ") + "\n  erkannt:  " + got.join(" | ")); }
  }
  console.log((CASES.length - bad) + " von " + CASES.length + " Sätzen richtig");
  await b.close();
  process.exit(bad ? 1 : 0);
})();
