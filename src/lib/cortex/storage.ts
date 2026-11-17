import type { AiProvider, LogEntry, LogKind, Objective, Persisted, StoredFace, ThreatLevel } from "@/lib/cortex/types";

const KEY = "cortex.v1";
const AI_KEY = "cortex.ai";

export type AiSettings = {
  provider: AiProvider;
  apiKey: string;
};

export function defaultObjectives(): Objective[] {
  return [
    { id: "scan-unknown", text: "Skann etter uidentifiserte individer", done: false },
    { id: "verify-gabriel", text: "Verifiser systemintegritet (Gabriel)", done: false },
  ];
}

export function defaultState(): Persisted {
  return {
    faces: [],
    threat: "Grønn",
    objectives: defaultObjectives(),
    tolerance: 0.6,
    logs: [],
  };
}

export function clampTolerance(n: number): number {
  if (!Number.isFinite(n)) return 0.6;
  const stepped = Math.round(n * 20) / 20;
  return Math.min(0.7, Math.max(0.3, stepped));
}

function isFiniteVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 64 &&
    value.length <= 256 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export function isStoredFace(value: unknown): value is StoredFace {
  if (!value || typeof value !== "object") return false;
  const face = value as StoredFace;
  return (
    typeof face.label === "string" &&
    face.label.trim().length > 0 &&
    face.label.length <= 80 &&
    Array.isArray(face.descriptors) &&
    face.descriptors.length > 0 &&
    face.descriptors.every(isFiniteVector)
  );
}

function isThreat(value: unknown): value is ThreatLevel {
  return value === "Grønn" || value === "Gul" || value === "Rød";
}

function isKind(value: unknown): value is LogKind {
  return value === "system" || value === "anomaly" || value === "known" || value === "audio";
}

function isObjective(value: unknown): value is Objective {
  if (!value || typeof value !== "object") return false;
  const obj = value as Objective;
  return typeof obj.id === "string" && typeof obj.text === "string" && typeof obj.done === "boolean";
}

function isLog(value: unknown): value is LogEntry {
  if (!value || typeof value !== "object") return false;
  const log = value as LogEntry;
  return typeof log.id === "string" && typeof log.ts === "string" && typeof log.msg === "string" && isKind(log.kind);
}

export function loadState(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      faces: Array.isArray(parsed.faces) ? parsed.faces.filter(isStoredFace) : [],
      threat: isThreat(parsed.threat) ? parsed.threat : "Grønn",
      objectives: Array.isArray(parsed.objectives) ? parsed.objectives.filter(isObjective) : defaultObjectives(),
      tolerance: clampTolerance(typeof parsed.tolerance === "number" ? parsed.tolerance : 0.6),
      logs: Array.isArray(parsed.logs) ? parsed.logs.filter(isLog).slice(0, 80) : [],
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state: Persisted) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function parseFaceFile(text: string): StoredFace[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { faces?: unknown }).faces)
      ? (data as { faces: unknown[] }).faces
      : null;
  if (!list) throw new Error("Filen har ikke et gjenkjennelig databaseformat.");
  const faces = list.filter(isStoredFace).map((face) => ({
    label: face.label.trim(),
    descriptors: face.descriptors.slice(0, 8),
  }));
  if (!faces.length) throw new Error("Ingen gyldige subjekter i filen.");
  return faces;
}

export function mergeFace(faces: StoredFace[], label: string, descriptor: number[]): StoredFace[] {
  const key = label.toLocaleLowerCase("nb");
  const index = faces.findIndex((face) => face.label.toLocaleLowerCase("nb") === key);
  if (index === -1) return [...faces, { label, descriptors: [descriptor] }];
  const existing = faces[index];
  if (!existing) return faces;
  const next = faces.slice();
  next[index] = {
    ...existing,
    descriptors: [...existing.descriptors, descriptor].slice(-8),
  };
  return next;
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function loadAi(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (!raw) return { provider: "xai", apiKey: "" };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      provider: parsed.provider === "gemini" ? "gemini" : "xai",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return { provider: "xai", apiKey: "" };
  }
}

export function saveAi(settings: AiSettings) {
  localStorage.setItem(
    AI_KEY,
    JSON.stringify({
      provider: settings.provider === "gemini" ? "gemini" : "xai",
      apiKey: settings.apiKey,
    }),
  );
}

export function clearAi() {
  localStorage.removeItem(AI_KEY);
}
