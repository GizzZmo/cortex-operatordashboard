# Brukerveiledning

## Oppstart

1. Start appen (`npm run dev` eller produksjonsbygg).
2. Vent til nevrale modeller er lastet (boot-skjerm med fremdrift).
3. Aktiver dashboardet og gi kameratilgang når nettleseren spør.
4. Kameraet starter automatisk. Du kan stoppe eller bytte kamera når som helst.

## Ansiktsdatabase

### Lagre et subjekt
- Sørg for at et ansikt er tydelig synlig i kameraet.
- Trykk **Fang**.
- Skriv inn et navn og bekreft.
- Subjektet lagres lokalt med en eller flere face-descriptors.

### Ukjente individer
- Ukjente ansikter som detekteres logges og kan lagres i etterkant via knappen for ukjente.
- Hver økt holder styr på antall ukjente.

### Administrasjon
- Se liste over kjente subjekter.
- Slett enkeltpersoner.
- Juster **toleranse** (0.3–0.7) – lavere verdi = strengere gjenkjenning.
- Eksporter hele databasen som JSON.
- Importer en tidligere eksportert fil.

## Trusselnivå

Sett manuelt:
- **Grønn** – Nominell observasjon
- **Gul** – Skjerpet observasjon
- **Rød** – Prioritert respons

Nivået vises i Zadkiel-protokollen og sendes med i KI-analyser.

## Operative mål

- Legg til nye mål.
- Kryss av når de er fullført.
- Standardmål inkluderer skanning av ukjente og verifisering av Gabriel.
- Vises i Zadkiel-protokollen.

## Systemlogg

- Automatisk logg over:
  - Kjent subjekt detektert
  - Ukjent individ
  - Systemhendelser
  - Protokollresultater
- Maks 80 linjer (eldste slettes).
- Tidsstemplet.

## KI-analyse

KI er av til du selv aktiverer den.

1. Gå til Analyse-seksjonen.
2. Velg leverandør: **Grok (xAI)** eller **Gemini**.
3. Lim inn API-nøkkel.
4. Trykk **Valider**.

Når nøkkelen er godkjent kan du kjøre KI-protokollene.

**Merk:** Nøkkelen lagres bare i nettleseren og brukes kun når du aktivt kjører en analyse.

## Kamerastyring

- Start / stopp
- Bytt mellom tilgjengelige kameraer
- Overlay viser bokser, navn/ukjent og uttrykk (når modeller er lastet)

## Tips

- God belysning og frontalt ansikt gir best gjenkjenning.
- Toleranse på 0.5–0.6 fungerer bra for de fleste.
- Gabriel-protokollen er nyttig for å sjekke at alt er i orden før et skift.
- Eksporter databasen jevnlig hvis du vil ta backup.

Se også [Protokoller](protokoller.md) og [API](API.md).
