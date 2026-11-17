# Protokoller

CORTEX har to typer protokoller: lokale (uten KI) og KI-baserte.

## Lokale protokoller

### Gabriel – Systemintegritet

Kjører helt lokalt og sjekker:

- Status på nevrale modeller (NOMINELL / DEGRADERT)
- Kamera (LIVE / AV)
- Antall kjente subjekter
- Antall ukjente denne økten
- Gjeldende toleranse
- Trusselnivå
- Antall logglinjer
- Samlet STATUS (NOMINELL eller BEGRENSET)

Nyttig som oppstartssjekk eller før et skift.

### Zadkiel – Operative mål

Viser:

- Gjeldende trusselnivå og tilhørende hint
- Antall kjente og ukjente
- Liste over alle operative mål (med status ✓ / ○)

## KI-protokoller

Krever gyldig API-nøkkel. De som bruker bilde krever også aktivt kamera.

| Protokoll     | Formål                                      | Bilde | Typisk bruk                          |
|--------------|-----------------------------------------------|-------|--------------------------------------|
| **Rafael**   | Bevegelse og romlig flyt                      | Ja    | Er situasjonen rolig eller urolig?  |
| **Metatron** | Prediktiv intensjon                           | Ja    | Hva er mest sannsynlig neste handling? |
| **Uriel**    | Miljøanalyse / malplasserte gjenstander      | Ja    | Noe som skiller seg ut?             |
| **Sandalphon** | Sosial dynamikk                             | Ja    | Avstand, blikk, spenning mellom personer |
| **Atferd**   | Nøktern atferdsobservasjon                  | Ja    | Holdning, blikk, uttrykk            |
| **Rapport**  | Skiftlogg                                     | Nei   | Strukturert status + hendelser + anbefaling |
| **Sammendrag** | Loggsammendrag                             | Nei   | 3–5 korte punkter fra loggen       |

### Regler for KI-svar

- Alltid på norsk
- Maks ca. 140 ord
- Ingen markdown
- Ingen oppdiktede detaljer
- Skiller observasjon fra antakelse
- Ingen dramatikk

### Rate limiting

Minst 1,2 sekunder mellom KI-kall for å unngå overbelastning.

## Anbefalt arbeidsflyt

1. Gabriel – sjekk at systemet er klart
2. Sett trusselnivå og mål
3. Overvåk med kamera og logg
4. Bruk KI-protokoller ved behov for dypere analyse
5. Zadkiel eller Rapport ved skiftslutt

Se [API](API.md) for tekniske detaljer om kallene.
