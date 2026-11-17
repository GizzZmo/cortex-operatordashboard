# Arkitektur

## Oversikt

CORTEX er en klienttung webapp bygget med:

- **React 19** + **TanStack Start / Router**
- **Vite**
- **Tailwind CSS 4** + Radix UI
- **face-api.js** (via CDN) for lokal biometri
- **localStorage** for all tilstand
- Valgfrie server-funksjoner for KI-kall

Ingen biometrisk data eller operativ tilstand lagres på server.

## Hovedmoduler

```
src/
├── components/cortex/dashboard.tsx   # Hoved-UI og logikk
└── lib/cortex/
    ├── analyze.ts                   # Server-funksjoner for KI
    ├── storage.ts                   # localStorage + import/eksport
    ├── types.ts                     # Delte typer
    └── vision.ts                    # face-api wrapper
```

## Dataflyt

1. **Boot** – laster face-api og modeller fra CDN.
2. **Live** – kamera → deteksjon hvert ~450 ms → overlay + logg.
3. **Tilstand** – faces, threat, objectives, logs og tolerance synkroniseres til `localStorage`.
4. **KI** – ved kall sendes nøkkel + kontekst (og eventuelt bilde) til Grok eller Gemini via server-funksjon.

## Lagring

| Nøkkel          | Innhold                  |
|------------------|--------------------------|
| `cortex.v1`      | Hele operative tilstanden |
| `cortex.ai`      | Provider + API-nøkkel    |

## KI-integrasjon

Server-funksjoner (`createServerFn`) i `analyze.ts`:

- Validerer input
- Rate limiting
- Kaller `https://api.x.ai/v1/chat/completions` (Grok) eller Gemini API
- Returnerer ren tekst

Bildet sendes som base64 JPEG (maks ~350 KB) bare når protokollen krever det.

## PWA / Grok-integrasjon

Prosjektet inneholder Grok PWA-plugins og branding (se `scripts/grok-pwa-*` og `public/__grok/`). Disse er del av plattformkontrakten og bør ikke fjernes.

## Begrensninger

- Krever kamera og moderne nettleser (WebGL/WebAssembly for face-api).
- Modeller lastes fra CDN første gang.
- Ingen offline-KI (krever nettverk for Grok/Gemini).
- localStorage har begrenset plass – store databaser bør eksporteres.

Se [API](API.md) og [Utvikling](utvikling.md) for mer.
