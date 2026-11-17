# Utvikling

## Forutsetninger

- Node.js 22+
- npm
- Moderne nettleser med kameratilgang

## Oppsett

```bash
git clone https://github.com/GizzZmo/cortex-operatordashboard.git
cd cortex-operatordashboard
npm install
npm run dev
```

Appen kjører på `http://localhost:8080`.

## Scripts

| Kommando              | Beskrivelse                              |
|-----------------------|------------------------------------------|
| `npm run dev`         | Utviklingsserver (port 8080)             |
| `npm run build`       | Produksjonsbygg + database-migrering     |
| `npm run preview`     | Forhåndsvisning av produksjonsbygg         |
| `npm run typecheck`   | TypeScript-sjekk                         |
| `npm test`            | Kjør enhetstester                         |
| `npm run lint`        | ESLint                                   |
| `npm run format`      | Prettier                                 |
| `npm run check:auth`  | Sjekk auth-invarianter                   |

## Prosjektstruktur

```
src/components/cortex/     # Hoveddashboard
src/lib/cortex/            # Kjerne logikk (analyze, storage, vision, types)
scripts/                   # Bygg-, test- og PWA-scripts
docs/                      # Dokumentasjon
migrations/                # Database-migreringer (auth)
public/                    # Statiske filer + Grok PWA-assets
```

## Viktige filer

- `src/components/cortex/dashboard.tsx` – all UI og interaksjon
- `src/lib/cortex/analyze.ts` – KI server-funksjoner
- `src/lib/cortex/vision.ts` – face-api integrasjon
- `src/lib/cortex/storage.ts` – localStorage

## Testing

```bash
npm test
```

Tester ligger i `scripts/**/*.test.mjs` og noen TypeScript-tester under `src/lib/`.

## Bidrag

1. Fork repoet
2. Lag en branch
3. Gjør endringer
4. Kjør `npm run typecheck`, `npm test` og `npm run lint`
5. Åpne pull request

## Deploy

Prosjektet er konfigurert for Vercel (via TanStack Start / Nitro).  
`npm run build` produserer artefaktene.

Se [Arkitektur](arkitektur.md) for mer teknisk bakgrunn.
