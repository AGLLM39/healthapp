# NährWert

Ein Ernährungstagebuch für den Browser: Mahlzeiten und Getränke erfassen,
Makro- und Mikronährstoffe nach DGE-Referenzwerten verfolgen, Rezepte mit
Zubereitung, Wochenübersicht.

Alle Einträge bleiben im Browser des jeweiligen Geräts gespeichert. Dieses
Repository enthält nur die App, keine persönlichen Daten.

## Datenquellen

- Grundnahrungsmittel und Rezepte: gerundete Durchschnittswerte aus gängigen
  Nährwerttabellen.
- Markenprodukte (`naehrwert-produkte.js`) und Live-Suche:
  [Open Food Facts](https://world.openfoodfacts.org). Die Daten stehen unter der
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Lebensmittel-Datenbank (`naehrwert-bls.js`) sowie Vitamin E und Omega-3 der
  Grundnahrungsmittel: Max Rubner-Institut (2025): Bundeslebensmittelschlüssel
  (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe.
  DOI: [10.25826/Data20251217-134202-0](https://doi.org/10.25826/Data20251217-134202-0).
  Lizenz: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de).
  Für NährWert auf 21 Nährstoffe reduziert, gerundet sowie um Portionsgrößen und
  Koffein-Richtwerte ergänzt.
- Schweizer Nährwertdatenbank V 7.1 (`naehrwert-ch.js`), Bundesamt für
  Lebensmittelsicherheit und Veterinärwesen BLV, [naehrwertdaten.ch](https://naehrwertdaten.ch).
  Auswahl von 21 Nährstoffen, Getränke auf 100 ml umgerechnet, Portionen und
  Koffein ergänzt.
- Online-Nachschlagen: [USDA FoodData Central](https://fdc.nal.usda.gov)
  (gemeinfrei, CC0 1.0).
- Referenzwerte: Deutsche Gesellschaft für Ernährung (DGE), Mangan: EFSA.

### Abgeleitete Datenbank (ODbL)

`naehrwert-produkte.js` und `naehrwert-offline-2.js` enthalten bearbeitete Daten
aus Open Food Facts: Einheiten umgerechnet, Koffein und Portionsgrößen aus der
Produktkategorie abgeleitet, fehlende Vitamin- und Mineralstoffwerte durch den
Median ähnlicher Produkte derselben Gruppe geschätzt (Feld `geschaetzt`, in der
App mit „≈“ markiert). Diese beiden Dateien stehen unter der
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/),
einzelne Inhalte unter der [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).
Die ODbL gilt nur für diese Daten, nicht für den Programmcode und nicht für die
BLS- oder Schweizer Daten.

## Mitgelieferte Bibliotheken (`vendor/`)

Damit keine Daten an ein fremdes CDN gehen und alles offline läuft, liegen die
Bibliotheken im Repository:

- `vendor/zxing/` – [ZXing-js](https://github.com/zxing-js/library) 0.21.3, Apache License 2.0
- `vendor/tesseract/` – [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1
  und tesseract.js-core 5.1.1 (nur die LSTM-Varianten), Apache License 2.0
- `vendor/tesseract/lang/deu.traineddata.gz` – deutsche Sprachdaten aus
  tessdata_best (Apache License 2.0) über @tesseract.js-data/deu 1.0.0 (MIT)

## Rechtliches

Impressum, Datenschutzerklärung, Hinweis zur Nutzung und Quellen stehen in der
App unter Profil → Rechtliches und sind direkt verlinkbar (`#impressum`,
`#datenschutz`, `#hinweis`, `#quellen`). Die persönlichen Angaben stehen an
einer Stelle: `NW_BETREIBER` am Ende von `index.html`.
