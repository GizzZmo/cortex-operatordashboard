# API-dokumentasjon – CORTEX operatørdashboard

Dette dokumentet beskriver de interne API-ene og server-funksjonene i prosjektet.

All biometrisk data og tilstand lagres lokalt. De eneste nettverkskallene som gjøres er valgfrie kall til Grok (xAI) eller Gemini når du aktivt kjører en KI-protokoll.

## Innhold

- [Server-funksjoner (KI)](#server-funksjoner-ki)
- [Lokal lagring](#lokal-lagring)
- [Visjons-API (face-api)](#visjons-api)
- [Typer](#typer)

---

## Server-funksjoner (KI)

Disse er definert i `src/lib/cortex/analyze.ts` og kjører via TanStack Start (`createServerFn`).

### `checkAiKey`

Validerer en API-nøkkel mot valgt leverandør.

**Input**

```ts
type KeyInput = {
  provider: "xai" | "gemini";
  apiKey: string; // min 16 tegn, kun alfanumerisk + . -
};
```

**Retur**

```ts
type AnalyzeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };
```

**Rate limit**: Minst 1,2 sekunder mellom kall.

### `analyzeScene`

Kjører en protokoll-analyse.

**Input**

```ts
type AnalyzeInput = {
  kind: AnalyzeKind;          // se under
  context: string;            // siste logglinjer (maks 4000 tegn)
  image?: string;             // base64 JPEG (maks ~350 KB)
  threat: "Grønn" | "Gul" | "Rød";
  known: number;              // antall kjente subjekter
  unknown: number;            // ukjente denne økten
  provider: "xai" | "gemini";
  apiKey: string;
};
```

**AnalyzeKind**

| Kind         | Beskrivelse                          | Krever bilde |
|--------------|--------------------------------------|--------------|
| `rafael`     | Bevegelse og romlig flyt             | Ja           |
| `metatron`   | Prediktiv intensjon                  | Ja           |
| `uriel`      | Malplasserte gjenstander             | Ja           |
| `sandalphon` | Sosial dynamikk                      | Ja           |
| `behavior`   | Atferdsobservasjon                   | Ja           |
| `report`     | Skiftlogg                            | Nei          |
| `summary`    | Loggsammendrag                       | Nei          |

**Retur**: Samme `AnalyzeResult` som over.

**Modeller**
- Grok: `grok-4.5`
- Gemini: `gemini-2.5-flash` (fallback til `gemini-2.0-flash`)

Svar er alltid på norsk, maks ca. 140 ord, uten markdown.

---

## Lokal lagring

Definert i `src/lib/cortex/storage.ts`. Alt lagres i `localStorage`.

### Tilstand

```ts
type Persisted = {
  faces: StoredFace[];
  threat: ThreatLevel;
  objectives: Objective[];
  tolerance: number; // 0.3–0.7
  logs: LogEntry[];  // maks 80
};

type StoredFace = {
  label: string;
  descriptors: number[][]; // face-api descriptors
};
```

**Funksjoner**

- `loadState(): Persisted`
- `saveState(state: Persisted): void`
- `mergeFace(faces, label, descriptor): StoredFace[]`
- `parseFaceFile(json: string): StoredFace[]` – importerer eksportert database
- `downloadJson(filename, data): void`

### KI-innstillinger

```ts
type AiSettings = {
  provider: "xai" | "gemini";
  apiKey: string;
};
```

- `loadAi(): AiSettings`
- `saveAi(settings: AiSettings): void`
- `clearAi(): void`

Nøkkelen lagres bare lokalt og sendes aldri med i git.

---

## Visjons-API

Definert i `src/lib/cortex/vision.ts`. Bruker `@vladmandic/face-api` lastet fra CDN.

**Hovedfunksjoner**

- `loadFaceApi(): Promise<FaceApi>`
- `loadModels(api, onStep): Promise<void>` – laster detektor, landemerker, gjenkjenning og uttrykk
- `detectFaces(api, video): Promise<FaceHit[]>`
- `detectPrimary(api, video): Promise<FaceHit | null>`
- `buildMatcher(api, faces, tolerance): FaceMatcher | null`
- `paintOverlay(svg, video, items): void`
- `captureFrame(video): string | null` – returnerer base64 JPEG

**FaceHit**

```ts
type FaceHit = {
  box: { x: number; y: number; width: number; height: number };
  descriptor: Float32Array;
  expression: string | null; // norsk: nøytral, glad, trist, ...
};
```

---

## Typer

Fra `src/lib/cortex/types.ts`:

```ts
type ThreatLevel = "Grønn" | "Gul" | "Rød";
type LogKind = "system" | "anomaly" | "known" | "audio";
type AnalyzeKind =
  | "rafael" | "metatron" | "uriel" | "sandalphon"
  | "behavior" | "report" | "summary";
type AiProvider = "xai" | "gemini";
```

---

## Sikkerhet og personvern

- Ingen biometriske data forlater nettleseren.
- API-nøkler valideres og brukes kun ved eksplisitt kall.
- Rate limiting på KI-kall (1,2 s).
- Input valideres (lengde, format, størrelse på bilde).

Se også hoved-[README](../README.md) for brukerveiledning.
