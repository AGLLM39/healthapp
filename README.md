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
