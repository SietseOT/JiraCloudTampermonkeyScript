# Jira Cloud – OT label badges (Tampermonkey)

Een Tampermonkey-script voor Jira Cloud van OnderwijsTransparant (`onderwijstransparant.atlassian.net`).
Het script past alleen de weergave aan en wijzigt nooit tickets.

## Installeren (eenmalig)

1. Installeer de browserextensie **Tampermonkey** (Chrome Web Store of Edge Add-ons), als je die nog niet hebt.
2. Klik op deze link:
   **[Jira_Cloud_Tampermonkey.user.js installeren](https://raw.githubusercontent.com/SietseOT/JiraCloudTampermonkeyScript/main/Jira_Cloud_Tampermonkey.user.js)**
3. Tampermonkey opent een installatiepagina. Klik op **Installeren** / *Install* (of **Bijwerken** / *Update* als je al een eerdere versie had).
4. Herlaad Jira.

Had je het script eerder handmatig geplakt? Installeer het dan één keer via de link hierboven. Alleen dan krijg je automatische updates. Zie je daarna twee scripts met dezelfde naam in Tampermonkey, verwijder dan de oude.

## Updates

Tampermonkey kijkt automatisch (standaard één keer per dag) of er een nieuwe versie is en installeert die.
Meteen bijwerken: klik op het Tampermonkey-icoon → **Controleren op updates van userscripts** (*Check for userscript updates*).

## Wat het script doet

- **Labels als badges** in de koppen van swimlanes (bord, *Group: Story*), op bordkaarten (ook subtaken) en in de regels van de backlog.
- **Speciale opmaak** voor bekende labels:

  | Label | Weergave |
  |---|---|
  | `deadline…` (bijv. `deadline:2026-10-12`) | 📅 Deadline 12-10-2026 (blauw, vóór de titel) |
  | `overleg…` met datum (bijv. `overleg:2026-10-13`) | 💬 Overleg 13-10-2026 (paars, vóór de titel) |
  | `hotfix` | 🔥 Hotfix (rood) |
  | `tijdskritisch` | ⏰ Tijdskritisch (oranje) |
  | `urgent` | rood gevuld |
  | `onderzoek` | 🔍 Onderzoek |
  | `on-hold` | 🛑 On Hold (kaart wordt iets doorzichtig) |
  | `cross-refinement` | 🤝 Cross-refinement |
  | overige labels | grijze tag |

- **Divider:** een ticket met het label `divider` wordt in de backlog een scheidingslijn met de titel in het midden. Je kunt de regel nog steeds slepen en aanklikken.
- **Geflagde tickets** worden in de backlog geel, net als op het bord. Jira zelf kleurt ze in de backlog roze.
- **Due date met kader:** heeft een ticket een ingevulde due date én het label `overleg` (zonder datum erachter), dan krijgt het standaard due date-veld in de backlog een paars kader. Dat label zelf wordt niet als badge getoond. Zonder passend label blijft de normale opmaak. Meer label/kleur-combinaties zijn toe te voegen bij `DUE_DATE_RULES` bovenin het script.
- De labels `small`, `medium`, `large`, `geen-punten`, `onduidelijk-punten` en `overleg` worden niet als badge getoond.

Tip: zet in de bordinstellingen (**Card layout**) het veld *Labels* uit, anders zie je labels dubbel.

## Werkt het niet?

1. Open Jira, druk op **F12** en kies **Console**.
2. Typ `otclLabels.status()` en druk op Enter.
   - Staat er bij *gevonden* een 0 terwijl je wel kaarten of regels ziet? Dan heeft Atlassian de pagina veranderd. Alle herkenningspunten (`SELECTORS`) staan bovenin het script bij elkaar en zijn daar aan te passen.
   - Staat er iets bij *laatsteFout*? Dan gaat het ophalen bij Jira mis.
   - Bestaat `otclLabels` niet? Dan draait het script niet. Controleer in Tampermonkey of het aan staat.
3. Labels verouderd? Typ `otclLabels.clearCache()`.

## Onderdelen aan- of uitzetten

Rechtsonder in Jira staat een **tandwiel** (⚙). Klik erop om onderdelen aan of uit te zetten; bij elke optie staat wat die doet.
Je keuze geldt alleen voor jou, in deze browser, en blijft bewaard bij updates. Met **Standaard herstellen** zet je alles terug.
Het venster is ook te openen vanuit de console met `otclLabels.settings()`.

De standaardwaarden voor iedereen staan bovenin het script bij `DEFAULT_FEATURES`.

## Voor beheerders: een nieuwe versie uitbrengen

1. Pas het script aan en **verhoog `@version`** in de kop (en `SCRIPT_VERSION`). Zonder hoger versienummer krijgt niemand de update.
2. Zet de wijziging op de `main`-branch van deze repository.
3. Binnen een dag hebben alle gebruikers de nieuwe versie.
