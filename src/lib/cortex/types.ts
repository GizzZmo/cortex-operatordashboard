export type ThreatLevel = "Grønn" | "Gul" | "Rød";

export type LogKind = "system" | "anomaly" | "known" | "audio";

export type LogEntry = {
  id: string;
  ts: string;
  msg: string;
  kind: LogKind;
};

export type Objective = {
  id: string;
  text: string;
  done: boolean;
};

export type StoredFace = {
  label: string;
  descriptors: number[][];
};

export type Persisted = {
  faces: StoredFace[];
  threat: ThreatLevel;
  objectives: Objective[];
  tolerance: number;
  logs: LogEntry[];
};

export type AnalyzeKind =
  | "rafael"
  | "metatron"
  | "uriel"
  | "sandalphon"
  | "behavior"
  | "report"
  | "summary";

export type AnalyzeResult = { ok: true; text: string } | { ok: false; error: string };

export type AiProvider = "xai" | "gemini";
