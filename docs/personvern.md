# Personvern og sikkerhet

## Kjerneprinsipper

- **Lokal biometri** – alle face-descriptors og bilder behandles i nettleseren.
- **Ingen serverlagring** av ansiktsdata, logg, mål eller trusselnivå.
- **Valgfri KI** – ingen kall til eksterne API-er før du selv limer inn nøkkel og kjører en protokoll.
- **Minimal data til KI** – bare siste logglinjer + eventuelt ett bilde + tall (kjente/ukjente/trussel).

## Hva som lagres lokalt

| Data              | Sted            | Kan eksporteres |
|-------------------|-----------------|-----------------|
| Ansiktsdatabase   | localStorage    | Ja (JSON)       |
| Logg              | localStorage    | Ja              |
| Mål og trussel     | localStorage    | Ja              |
| API-nøkkel         | localStorage    | Nei (sensitiv)  |

## API-nøkler

- Lagres bare i `localStorage` under nøkkelen `cortex.ai`.
- Sendes aldri med i git.
- Valideres før bruk (lengde og tegnsett).
- Brukes kun i det øyeblikket du kjører `checkAiKey` eller `analyzeScene`.

## Nettverkstrafikk

| Destinasjon                  | Når                         | Hva sendes                  |
|------------------------------|------------------------------|-----------------------------|
| jsDelivr (face-api)          | Første lasting av modeller   | Ingen persondata            |
| api.x.ai                     | Kun ved KI-kall (Grok)       | Nøkkel + tekst + evt. bilde |
| generativelanguage.googleapis.com | Kun ved KI-kall (Gemini) | Nøkkel + tekst + evt. bilde |

Ingen andre eksterne kall for biometri eller tilstand.

## Anbefalinger

- Bruk en dedikert API-nøkkel med begrenset kvote hvis mulig.
- Eksporter og slett databasen når du er ferdig med en økt på delt maskin.
- Vær oppmerksom på at KI-leverandøren mottar det bildet og den loggen du sender.
- Appen sender aldri data uten at du aktivt trykker på en protokollknapp.

## Sikkerhetsfunksjoner i koden

- Input-validering på alle server-funksjoner
- Rate limiting (1,2 s)
- Begrensning på bildestørrelse og kontekstlengde
- Ingen automatiske bakgrunnskall til KI

Se også [API](API.md).
