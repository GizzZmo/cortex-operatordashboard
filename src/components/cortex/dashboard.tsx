import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BrainCircuit, Database, ScanEye, ShieldAlert, Target, Terminal } from "lucide-react";
import { analyzeScene, checkAiKey } from "@/lib/cortex/analyze";
import {
  clampTolerance,
  clearAi,
  defaultObjectives,
  downloadJson,
  loadAi,
  loadState,
  mergeFace,
  parseFaceFile,
  saveAi,
  saveState,
} from "@/lib/cortex/storage";
import type { AiProvider, AnalyzeKind, LogEntry, LogKind, Objective, StoredFace, ThreatLevel } from "@/lib/cortex/types";
import {
  buildMatcher,
  captureFrame,
  detectFaces,
  detectPrimary,
  loadFaceApi,
  loadModels,
  paintOverlay,
  type FaceApi,
  type FaceMatcher,
  type PaintItem,
} from "@/lib/cortex/vision";

type Phase = "boot" | "lock" | "live";
type CameraInfo = { deviceId: string; label: string };
type ModalState = { title: string; body: string; pending: boolean; error?: boolean } | null;
type PendingFace = { descriptor: Float32Array; source: "capture" | "unknown" } | null;

const BOOT_STEPS = ["Kjernegrensesnitt", "Detektor", "Landemerker", "Gjenkjenning", "Uttrykk"];

const THREAT_HINT: Record<ThreatLevel, string> = {
  Grønn: "Nominell observasjon",
  Gul: "Skjerpet observasjon",
  Rød: "Prioritert respons",
};

const PROTOCOL_TITLES: Record<AnalyzeKind | "gabriel" | "zadkiel", string> = {
  gabriel: "GABRIEL // SYSTEMINTEGRITET",
  rafael: "RAFAEL // TRANSPORTANALYSE",
  metatron: "METATRON // PREDIKTIV INTENSJON",
  uriel: "URIEL // MILJØANALYSE",
  sandalphon: "SANDALPHON // SOSIAL DYNAMIKK",
  zadkiel: "ZADKIEL // OPERATIVE MÅL",
  behavior: "ATFERDSANALYSE",
  report: "SKIFTRAPPORT",
  summary: "LOGGSAMMENDRAG",
};

const VISION_KINDS = new Set<AnalyzeKind>(["rafael", "metatron", "uriel", "sandalphon", "behavior"]);

type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechResult) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  const host = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function plainText(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

function stamp(): string {
  return new Date().toLocaleTimeString("nb-NO", { hour12: false });
}

function cameraMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Kameratilgang ble avslått.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Ingen kamera funnet på denne enheten.";
  return "Kunne ikke starte kamera.";
}

export function Dashboard() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootStep, setBootStep] = useState(0);
  const [bootStatus, setBootStatus] = useState("Initialiserer nevralt nettverk…");
  const [modelOk, setModelOk] = useState(false);
  const [clock, setClock] = useState("--:--:--");
  const [faces, setFaces] = useState<StoredFace[]>([]);
  const [threat, setThreat] = useState<ThreatLevel>("Grønn");
  const [objectives, setObjectives] = useState<Objective[]>(defaultObjectives);
  const [tolerance, setTolerance] = useState(0.6);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackCount, setTrackCount] = useState(0);
  const [scanMs, setScanMs] = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);
  const [modal, setModal] = useState<ModalState>(null);
  const [pendingFace, setPendingFace] = useState<PendingFace>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<AnalyzeKind | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 12 }, () => 0));
  const [objectiveDraft, setObjectiveDraft] = useState("");
  const [provider, setProvider] = useState<AiProvider>("xai");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [aiReady, setAiReady] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const apiRef = useRef<FaceApi | null>(null);
  const matcherRef = useRef<FaceMatcher | null>(null);
  const facesRef = useRef(faces);
  const toleranceRef = useRef(tolerance);
  const unknownsRef = useRef<Float32Array[]>([]);
  const seenRef = useRef<Map<string, number>>(new Map());
  const scanErrorRef = useRef(false);
  const skipRef = useRef(false);
  const addLogRef = useRef<(msg: string, kind?: LogKind) => void>(() => {});
  const audioStopRef = useRef<() => void>(() => {});
  const nameInputRef = useRef<HTMLInputElement>(null);
  const closeModalRef = useRef<HTMLButtonElement>(null);
  const aiKeyRef = useRef("");
  const providerRef = useRef<AiProvider>("xai");

  facesRef.current = faces;
  toleranceRef.current = tolerance;

  function addLog(msg: string, kind: LogKind = "system") {
    setLogs((prev) => [{ id: crypto.randomUUID(), ts: stamp(), msg, kind }, ...prev].slice(0, 80));
  }
  addLogRef.current = addLog;

  useEffect(() => {
    const saved = loadState();
    const ai = loadAi();
    setFaces(saved.faces);
    setThreat(saved.threat);
    setObjectives(saved.objectives);
    setTolerance(saved.tolerance);
    setLogs(saved.logs);
    setProvider(ai.provider);
    providerRef.current = ai.provider;
    aiKeyRef.current = ai.apiKey;
    setAiReady(ai.apiKey.length > 0);
    setReady(true);

    let alive = true;
    void (async () => {
      try {
        setBootStatus("Henter nevralt bibliotek…");
        const api = await loadFaceApi();
        if (!alive) return;
        apiRef.current = api;
        setBootStatus("Laster modeller…");
        await loadModels(api, (step) => {
          if (alive) setBootStep(step);
        });
        if (!alive) return;
        setModelOk(true);
        addLogRef.current("Nevrale modeller lastet.", "known");
        setPhase((current) => (current === "boot" ? "lock" : current));
        setBootStatus("Modeller klare.");
      } catch (error) {
        if (!alive) return;
        setModelOk(false);
        setBootStatus(error instanceof Error ? error.message : "Modellasting feilet.");
        addLogRef.current("Modeller utilgjengelige. Biometri er degradert.", "anomaly");
        setPhase((current) => (current === "boot" ? "lock" : current));
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveState({ faces, threat, objectives, tolerance, logs });
  }, [ready, faces, threat, objectives, tolerance, logs]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString("sv-SE", { hour12: false }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    matcherRef.current = api && modelOk ? buildMatcher(api, faces, tolerance) : null;
  }, [faces, tolerance, modelOk]);

  useEffect(() => {
    if (phase !== "live" || !modelOk) return;
    let stop = false;
    let busyScan = false;
    const id = window.setInterval(() => {
      if (stop || busyScan) return;
      const video = videoRef.current;
      const overlay = overlayRef.current;
      const api = apiRef.current;
      if (!video || !overlay || !api || video.readyState < 2 || !video.videoWidth) return;
      busyScan = true;
      const started = performance.now();
      void detectFaces(api, video)
        .then((hits) => {
          if (stop) return;
          const items: PaintItem[] = [];
          for (const hit of hits) {
            const match = matcherRef.current?.findBestMatch(hit.descriptor);
            const known = Boolean(match && match.label !== "unknown");
            const confidence = match ? Math.max(0, Math.min(100, Math.round((1 - match.distance) * 100))) : 0;
            const expression = hit.expression ? ` · ${hit.expression}` : "";
            const label = known ? `${match?.label} ${confidence}%${expression}` : `UKJENT${expression}`;
            items.push({ box: hit.box, label, tone: known ? "known" : "unknown" });
            const announceKey = known ? `k:${match?.label}` : "";
            if (known && match && announceKey) {
              const prev = seenRef.current.get(announceKey) ?? 0;
              if (started - prev > 8000) {
                seenRef.current.set(announceKey, started);
                addLogRef.current(`Kjent subjekt: ${match.label} (${confidence}%).`, "known");
              }
            }
            if (!known) noteUnknown(api, hit.descriptor);
          }
          paintOverlay(overlay, video, items);
          setTrackCount(hits.length);
          setScanMs(Math.round(performance.now() - started));
          scanErrorRef.current = false;
        })
        .catch(() => {
          if (scanErrorRef.current) return;
          scanErrorRef.current = true;
          addLogRef.current("Deteksjonssløyfen feilet. Biometri fortsetter når bildet er stabilt.", "anomaly");
        })
        .finally(() => {
          busyScan = false;
        });
    }, 450);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [phase, modelOk]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioStopRef.current();
    };
  }, []);

  useEffect(() => {
    if (modal) closeModalRef.current?.focus();
  }, [modal]);

  useEffect(() => {
    if (pendingFace) nameInputRef.current?.focus();
  }, [pendingFace]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setModal(null);
      setPendingFace(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function noteUnknown(api: FaceApi, descriptor: Float32Array) {
    const knownNear = facesRef.current.some((face) =>
      face.descriptors.some((stored) => api.euclideanDistance(Float32Array.from(stored), descriptor) < toleranceRef.current),
    );
    if (knownNear) return;
    const duplicate = unknownsRef.current.some((existing) => api.euclideanDistance(existing, descriptor) < 0.45);
    if (duplicate) return;
    unknownsRef.current = [...unknownsRef.current, descriptor].slice(-12);
    setUnknownCount(unknownsRef.current.length);
    addLogRef.current("Ukjent individ detektert.", "anomaly");
    setObjectives((prev) => {
      if (!prev.some((item) => item.id === "scan-unknown" && !item.done)) return prev;
      return prev.map((item) => (item.id === "scan-unknown" ? { ...item, done: true } : item));
    });
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  async function refreshCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((device) => device.kind === "videoinput");
      setCameras(
        videos.map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Kamera ${index + 1}`,
        })),
      );
    } catch {
      setCameras([]);
    }
  }

  async function startCamera(deviceId?: string, allowFallback = true) {
    stopCamera();
    setCameraError(null);
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
    if (deviceId) videoConstraints.deviceId = { exact: deviceId };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setCameraOn(true);
      addLog("Kamerastrøm aktiv.", "system");
      await refreshCameras();
    } catch (error) {
      if (deviceId && allowFallback) {
        await startCamera(undefined, false);
        return;
      }
      setCameraError(cameraMessage(error));
      addLog(cameraMessage(error), "anomaly");
    }
  }

  async function activate() {
    setPhase("live");
    addLog("Operatørdashboard aktivert.", "system");
    await startCamera();
  }

  function skipBoot() {
    skipRef.current = true;
    setPhase("lock");
    setBootStatus("Modellasting fortsetter i bakgrunnen.");
  }

  async function capture() {
    const api = apiRef.current;
    const video = videoRef.current;
    if (!api || !video) {
      addLog("Registrering utilgjengelig uten modeller.", "anomaly");
      return;
    }
    addLog("Innhenter ansiktsdata…", "system");
    try {
      const hit = await detectPrimary(api, video);
      if (!hit) {
        addLog("Registrering feilet: ingen ansikt funnet.", "anomaly");
        return;
      }
      setName("");
      setPendingFace({ descriptor: hit.descriptor, source: "capture" });
    } catch {
      addLog("Registrering feilet.", "anomaly");
    }
  }

  function openUnknown() {
    const descriptor = unknownsRef.current.at(-1);
    if (!descriptor) return;
    setName("");
    setPendingFace({ descriptor, source: "unknown" });
  }

  function savePending(event: FormEvent) {
    event.preventDefault();
    const label = name.trim();
    if (!label || !pendingFace) return;
    const descriptor = Array.from(pendingFace.descriptor);
    setFaces((prev) => mergeFace(prev, label, descriptor));
    if (pendingFace.source === "unknown") {
      const api = apiRef.current;
      unknownsRef.current = unknownsRef.current.filter(
        (item) => !api || api.euclideanDistance(item, pendingFace.descriptor) >= 0.2,
      );
      setUnknownCount(unknownsRef.current.length);
    }
    addLog(`Subjekt «${label}» lagret i databasen.`, "known");
    setPendingFace(null);
    setName("");
  }

  function removeFace(label: string) {
    setFaces((prev) => prev.filter((face) => face.label !== label));
    addLog(`Subjekt «${label}» fjernet.`, "system");
  }

  function runGabriel() {
    setObjectives((prev) => prev.map((item) => (item.id === "verify-gabriel" ? { ...item, done: true } : item)));
    const lines = [
      `Modeller: ${modelOk ? "NOMINELL" : "DEGRADERT"}`,
      `Kamera: ${cameraOn ? "LIVE" : "AV"}`,
      `Kjente subjekter: ${faces.length}`,
      `Ukjente denne økten: ${unknownCount}`,
      `Toleranse: ${tolerance.toFixed(2)}`,
      `Trussel: ${threat.toUpperCase()}`,
      `Logglinjer: ${logs.length}`,
      cameraOn && modelOk ? "STATUS: NOMINELL" : "STATUS: BEGRENSET",
    ];
    setModal({ title: PROTOCOL_TITLES.gabriel, body: lines.join("\n"), pending: false });
    addLog("Gabriel: integritetskontroll fullført.", "known");
  }

  function runZadkiel() {
    const lines = [
      `Trussel: ${threat.toUpperCase()} — ${THREAT_HINT[threat]}`,
      `Kjente subjekter: ${faces.length}`,
      `Ukjente denne økten: ${unknownCount}`,
      "",
      objectives.length ? "Mål:" : "Ingen operative mål.",
      ...objectives.map((item) => `${item.done ? "✓" : "○"} ${item.text}`),
    ];
    setModal({ title: PROTOCOL_TITLES.zadkiel, body: lines.join("\n"), pending: false });
  }

  async function runAnalyze(kind: AnalyzeKind) {
    if (busy) return;
    const title = PROTOCOL_TITLES[kind];
    if (!aiKeyRef.current) {
      setModal({
        title,
        body: "KI er av. Legg inn en API-nøkkel og valider den først.",
        pending: false,
        error: true,
      });
      return;
    }
    const video = videoRef.current;
    const image = VISION_KINDS.has(kind) && video ? captureFrame(video) ?? undefined : undefined;
    if (VISION_KINDS.has(kind) && !image) {
      setModal({
        title,
        body: "Ingen bilderamme. Start kamera og vent til bildet er oppe.",
        pending: false,
        error: true,
      });
      return;
    }
    const context = [...logs]
      .reverse()
      .slice(-30)
      .map((entry) => `[${entry.ts}] ${entry.msg}`)
      .join("\n")
      .slice(0, 3500);
    setBusy(kind);
    setModal({ title, body: "Behandler signal…", pending: true });
    try {
      const result = await analyzeScene({
        data: {
          kind,
          context,
          image,
          threat,
          known: faces.length,
          unknown: unknownCount,
          provider: providerRef.current,
          apiKey: aiKeyRef.current,
        },
      });
      if (!result.ok) {
        setModal({ title, body: result.error, pending: false, error: true });
        addLog(`${title}: ${result.error}`, "anomaly");
        return;
      }
      setModal({ title, body: plainText(result.text), pending: false });
      addLog(`${title} fullført.`, "known");
    } catch {
      setModal({ title, body: "Kunne ikke nå analysen. Prøv igjen.", pending: false, error: true });
      addLog(`${title} feilet.`, "anomaly");
    } finally {
      setBusy(null);
    }
  }

  async function validateKey(event: FormEvent) {
    event.preventDefault();
    const apiKey = apiKeyInput.trim();
    if (apiKey.length < 16) {
      addLog("Nøkkelen er for kort.", "anomaly");
      return;
    }
    setAiChecking(true);
    try {
      const result = await checkAiKey({ data: { provider, apiKey } });
      if (!result.ok) {
        addLog(result.error, "anomaly");
        setModal({ title: "API-NØKKEL", body: result.error, pending: false, error: true });
        return;
      }
      saveAi({ provider, apiKey });
      aiKeyRef.current = apiKey;
      providerRef.current = provider;
      setAiReady(true);
      setApiKeyInput("");
      const label = provider === "gemini" ? "Gemini" : "Grok";
      addLog(`${label} er aktivert. Nøkkelen ligger bare på denne enheten.`, "known");
    } catch {
      addLog("Kunne ikke validere nøkkelen.", "anomaly");
    } finally {
      setAiChecking(false);
    }
  }

  function forgetKey() {
    clearAi();
    aiKeyRef.current = "";
    setAiReady(false);
    setApiKeyInput("");
    addLog("API-nøkkel fjernet fra denne enheten.", "system");
  }

  function stopAudio() {
    audioStopRef.current();
    audioStopRef.current = () => {};
    setAudioOn(false);
    setLevels(Array.from({ length: 12 }, () => 0));
  }

  async function toggleAudio() {
    if (audioOn) {
      stopAudio();
      addLog("Lydlogg stoppet.", "audio");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      let last = 0;
      const tick = (time: number) => {
        if (time - last > 90) {
          last = time;
          analyser.getByteFrequencyData(bins);
          const next = Array.from({ length: 12 }, (_, index) => {
            const start = Math.floor((index / 12) * bins.length);
            const end = Math.floor(((index + 1) / 12) * bins.length);
            let sum = 0;
            for (let i = start; i < end; i += 1) sum += bins[i] ?? 0;
            return Math.min(100, Math.round((sum / Math.max(1, end - start) / 255) * 100));
          });
          setLevels(next);
        }
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);

      const Ctor = speechCtor();
      let recognition: SpeechRec | null = null;
      if (Ctor) {
        recognition = new Ctor();
        recognition.lang = "nb-NO";
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
          const latest = event.results[event.results.length - 1];
          const text = latest?.[0]?.transcript?.trim();
          if (text) addLogRef.current(text, "audio");
        };
        recognition.onerror = () => undefined;
        try {
          recognition.start();
        } catch {
          recognition = null;
        }
      }

      audioStopRef.current = () => {
        window.cancelAnimationFrame(raf);
        try {
          recognition?.stop();
        } catch {
          /* already stopped */
        }
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
      };
      setAudioOn(true);
      addLog(Ctor ? "Lydlogg aktiv. Tale skrives til loggen." : "Lydlogg aktiv. Tale-til-tekst støttes ikke her.", "audio");
    } catch {
      addLog("Mikrofontilgang ble avslått.", "anomaly");
    }
  }

  function exportDb() {
    downloadJson("cortex_db.json", faces);
    addLog(`Eksporterte ${faces.length} subjekter.`, "system");
  }

  function importDb(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseFaceFile(String(reader.result ?? ""));
        setFaces(imported);
        addLog(`${imported.length} individer importert.`, "known");
      } catch (error) {
        addLog(error instanceof Error ? error.message : "Import feilet.", "anomaly");
      }
    };
    reader.readAsText(file);
  }

  function addObjective(event: FormEvent) {
    event.preventDefault();
    const text = objectiveDraft.trim();
    if (!text) return;
    setObjectives((prev) => [...prev, { id: crypto.randomUUID(), text: text.slice(0, 120), done: false }]);
    setObjectiveDraft("");
  }

  function setThreatLevel(level: ThreatLevel) {
    setThreat(level);
    addLog(`Trusselnivå endret til ${level.toUpperCase()}.`, level === "Rød" ? "anomaly" : "system");
  }

  const threatClass = (level: ThreatLevel, active: string) =>
    threat === level
      ? active
      : "border-border bg-bg text-muted hover:border-primary hover:text-fg";

  return (
    <main data-threat={threat} className="min-h-screen px-3 py-3 text-fg md:px-4 md:py-4">
      <div inert={phase !== "live" ? true : undefined} className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="panel flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs tracking-widest text-muted">OPERATØRDASHBOARD v8.2.36</p>
            <h1 className="text-balance text-2xl text-primary">CORTEX</h1>
          </div>
          <p className="text-sm text-primary tabular-nums">{clock}</p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Status label="Modeller" value={modelOk ? "Nominell" : phase === "boot" ? "Laster" : "Degradert"} />
          <Status label="Kamera" value={cameraOn ? "Live" : "Av"} />
          <Status label="Database" value={`${faces.length} subjekter`} />
          <Status label="Trussel" value={threat} />
        </div>

        {threat !== "Grønn" ? (
          <p
            className={`border px-3 py-2 text-sm ${threat === "Rød" ? "border-danger text-danger" : "border-warn text-warn"}`}
          >
            Trusselnivå {threat.toUpperCase()} — {THREAT_HINT[threat]}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="panel order-1 min-w-0 p-4 lg:col-span-8">
            <PanelTitle icon={<ScanEye className="size-4" aria-hidden="true" />}>Hovedstrøm · biometrisk analyse</PanelTitle>
            <div className="video-frame relative aspect-video overflow-hidden border border-border bg-bg">
              <video ref={videoRef} className="absolute inset-0 h-full w-full object-contain" autoPlay muted playsInline />
              <svg ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              <div className="scanlines absolute inset-0" />
              {phase === "live" && cameraOn ? (
                <p className="absolute top-3 left-3 z-20 border border-border bg-bg px-2 py-1 text-xs text-primary tabular-nums">
                  SPOR {trackCount}
                  {scanMs ? ` · ${scanMs} ms` : ""}
                </p>
              ) : null}
              {cameraError || !cameraOn ? (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/85 p-4 text-center">
                  <p className="max-w-sm text-sm text-pretty text-muted">
                    {cameraError ?? (phase === "live" ? "Kamera i standby." : "Strømmen venter på operatør.")}
                  </p>
                  {phase === "live" ? (
                    <CmdButton onClick={() => void startCamera()}>Prøv kamera igjen</CmdButton>
                  ) : null}
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted">Kjent spor er cyan. Ukjent spor er magenta. Data blir på denne enheten.</p>
          </section>

          <div className="order-2 flex min-w-0 flex-col gap-4 lg:col-span-4 lg:row-span-2">
            <section className="panel p-4">
              <PanelTitle icon={<ShieldAlert className="size-4" aria-hidden="true" />}>Kontroll og protokoller</PanelTitle>
              <p className="text-xs tracking-widest text-muted">Trusselresponsskala</p>
              <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Trusselresponsskala">
                <button
                  type="button"
                  aria-pressed={threat === "Grønn"}
                  onClick={() => setThreatLevel("Grønn")}
                  className={`min-h-11 border text-xs tracking-widest ${threatClass("Grønn", "border-ok bg-ok/15 text-ok")}`}
                >
                  GRØNN
                </button>
                <button
                  type="button"
                  aria-pressed={threat === "Gul"}
                  onClick={() => setThreatLevel("Gul")}
                  className={`min-h-11 border text-xs tracking-widest ${threatClass("Gul", "border-warn bg-warn/15 text-warn")}`}
                >
                  GUL
                </button>
                <button
                  type="button"
                  aria-pressed={threat === "Rød"}
                  onClick={() => setThreatLevel("Rød")}
                  className={`min-h-11 border text-xs tracking-widest ${threatClass("Rød", "border-danger bg-danger/15 text-danger")}`}
                >
                  RØD
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">{THREAT_HINT[threat]}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <CmdButton onClick={runGabriel}>Gabriel</CmdButton>
                <CmdButton disabled={!aiReady || busy !== null} onClick={() => void runAnalyze("rafael")}>
                  Rafael
                </CmdButton>
                <CmdButton disabled={!aiReady || busy !== null} onClick={() => void runAnalyze("metatron")}>
                  Metatron
                </CmdButton>
                <CmdButton disabled={!aiReady || busy !== null} onClick={() => void runAnalyze("uriel")}>
                  Uriel
                </CmdButton>
                <CmdButton disabled={!aiReady || busy !== null} onClick={() => void runAnalyze("sandalphon")}>
                  Sosial
                </CmdButton>
                <CmdButton onClick={runZadkiel}>Zadkiel</CmdButton>
              </div>
            </section>

            <section className="panel p-4">
              <PanelTitle icon={<BrainCircuit className="size-4" aria-hidden="true" />}>Analyse</PanelTitle>
              <form onSubmit={(event) => void validateKey(event)} className="mb-3 space-y-2">
                <label className="block text-xs text-muted" htmlFor="ai-provider">
                  Valgfri KI
                  <select
                    id="ai-provider"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value === "gemini" ? "gemini" : "xai")}
                    className="mt-1 min-h-11 w-full border border-border bg-bg px-3 text-sm text-fg"
                  >
                    <option value="xai">Grok (xAI)</option>
                    <option value="gemini">Gemini (Google)</option>
                  </select>
                </label>
                <label className="block text-xs text-muted" htmlFor="api-key">
                  API-nøkkel
                  <input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    placeholder={aiReady ? "Ny nøkkel for å bytte…" : "Lim inn nøkkel…"}
                    className="mt-1 min-h-11 w-full border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-primary"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <CmdButton type="submit" disabled={aiChecking || apiKeyInput.trim().length < 16}>
                    {aiChecking ? "Validerer" : "Valider"}
                  </CmdButton>
                  <CmdButton type="button" disabled={!aiReady || aiChecking} onClick={forgetKey}>
                    Fjern nøkkel
                  </CmdButton>
                </div>
                <p className={aiReady ? "text-xs text-ok" : "text-xs text-muted"}>
                  {aiReady
                    ? `${providerRef.current === "gemini" ? "Gemini" : "Grok"} er på. Nøkkelen forlater ikke denne enheten unntatt i selve kallet.`
                    : "KI-protokollene er av til en nøkkel er validert."}
                </p>
              </form>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CmdButton disabled={!aiReady || busy !== null} onClick={() => void runAnalyze("behavior")}>
                  Atferdsanalyse
                </CmdButton>
                <CmdButton disabled={!aiReady || busy !== null} onClick={() => void runAnalyze("report")}>
                  Generer rapport
                </CmdButton>
                <CmdButton disabled={!aiReady || busy !== null} onClick={() => void runAnalyze("summary")}>
                  Loggsammendrag
                </CmdButton>
                <CmdButton onClick={() => void toggleAudio()}>{audioOn ? "Stopp lydlogg" : "Start lydlogg"}</CmdButton>
              </div>
              <div className="mt-3 flex h-11 items-end gap-1" aria-hidden="true">
                {levels.map((level, index) => (
                  <span
                    key={index}
                    className="flex-1 bg-primary"
                    style={{ height: `${Math.max(8, level)}%` }}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-pretty text-muted">
                Velg Grok eller Gemini, valider nøkkelen, og kjør deretter protokollene. Lydlogg bruker nettleserens
                talegjenkjenning og trenger ikke nøkkel.
              </p>
            </section>

            <section className="panel p-4">
              <PanelTitle icon={<Database className="size-4" aria-hidden="true" />}>Database</PanelTitle>
              <div className="grid grid-cols-2 gap-2">
                <CmdButton disabled={!modelOk || !cameraOn} onClick={() => void capture()}>
                  Registrer
                </CmdButton>
                <CmdButton onClick={exportDb}>Eksporter DB</CmdButton>
                <label className="flex min-h-11 items-center justify-center border border-primary px-2 text-center text-xs tracking-widest text-primary uppercase hover:bg-primary hover:text-bg">
                  Importer DB
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    onChange={(event) => {
                      importDb(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                <CmdButton disabled={unknownCount === 0} onClick={openUnknown}>
                  Lagre ukjente
                </CmdButton>
              </div>
              {cameras.length > 1 ? (
                <label className="mt-3 block text-xs text-muted">
                  Kamera
                  <select
                    className="mt-1 min-h-11 w-full border border-border bg-bg px-3 text-sm text-fg"
                    onChange={(event) => void startCamera(event.target.value)}
                  >
                    {cameras.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {camera.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="mt-3 block text-xs text-muted" htmlFor="tolerance">
                Toleranse <span className="text-primary tabular-nums">{tolerance.toFixed(2)}</span>
                <input
                  id="tolerance"
                  className="tolerance w-full"
                  type="range"
                  min={0.3}
                  max={0.7}
                  step={0.05}
                  value={tolerance}
                  onChange={(event) => setTolerance(clampTolerance(Number(event.target.value)))}
                />
              </label>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {faces.length === 0 ? (
                  <li className="text-sm text-muted">Ingen registrerte subjekter.</li>
                ) : (
                  faces.map((face) => (
                    <li key={face.label} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {face.label}
                        <span className="text-muted"> · {face.descriptors.length}</span>
                      </span>
                      <button
                        type="button"
                        className="min-h-11 shrink-0 px-2 text-xs tracking-widest text-accent uppercase"
                        onClick={() => removeFace(face.label)}
                      >
                        Fjern
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className="panel flex max-h-72 flex-col p-4">
              <PanelTitle icon={<Terminal className="size-4" aria-hidden="true" />}>Systemlogg</PanelTitle>
              <ul className="min-h-24 flex-1 space-y-1 overflow-y-auto text-xs">
                {logs.length === 0 ? (
                  <li className="text-muted">Ingen hendelser ennå.</li>
                ) : (
                  logs.map((entry) => (
                    <li key={entry.id} className={`log-${entry.kind} py-0.5 pr-1 pl-2 break-words`}>
                      <span className="tabular-nums">[{entry.ts}]</span> {entry.msg}
                    </li>
                  ))
                )}
              </ul>
            </section>
          </div>

          <section className="panel order-3 min-w-0 p-4 lg:col-span-8">
            <PanelTitle icon={<Target className="size-4" aria-hidden="true" />}>Operative mål · Zadkiel</PanelTitle>
            {objectives.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Ingen aktive mål. Systemet overvåker.</p>
            ) : (
              <ul className="space-y-1">
                {objectives.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setObjectives((prev) =>
                          prev.map((goal) => (goal.id === item.id ? { ...goal, done: !goal.done } : goal)),
                        )
                      }
                      className="flex min-h-11 w-full items-center gap-3 text-left text-sm"
                    >
                      <span
                        className={`size-2 shrink-0 ${item.done ? "bg-muted" : "pulse-led bg-primary"}`}
                        aria-hidden="true"
                      />
                      <span className={item.done ? "text-muted line-through" : "text-fg"}>{item.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {objectives.length > 0 && objectives.every((item) => item.done) ? (
              <p className="mt-2 text-sm text-ok">Alle operative mål fullført.</p>
            ) : null}
            <form onSubmit={addObjective} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="objective">
                Nytt mål
              </label>
              <input
                id="objective"
                value={objectiveDraft}
                onChange={(event) => setObjectiveDraft(event.target.value)}
                placeholder="Nytt operativt mål…"
                maxLength={120}
                className="min-h-11 w-full flex-1 border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-primary"
              />
              <div className="sm:w-36">
                <CmdButton type="submit">Legg til</CmdButton>
              </div>
            </form>
          </section>
        </div>
      </div>

      {phase !== "live" ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/92 p-4">
          <div className="panel w-full max-w-lg p-6" role="dialog" aria-modal="true" aria-labelledby="gate-title">
            {phase === "boot" ? (
              <>
                <div className="spinner mx-auto" />
                <h2 id="gate-title" className="mt-4 text-center text-xl text-balance text-primary">
                  Booter CORTEX
                </h2>
                <p className="mt-2 text-center text-sm text-muted">{bootStatus}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {BOOT_STEPS.map((step, index) => (
                    <li key={step} className={index < bootStep ? "text-ok" : index === bootStep ? "text-primary" : "text-muted"}>
                      {index < bootStep ? "✓" : index === bootStep ? "›" : "○"} {step}
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  <CmdButton onClick={skipBoot}>Fortsett uten å vente</CmdButton>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs tracking-widest text-muted">CORTEX // KLAR</p>
                <h2 id="gate-title" className="mt-2 text-2xl text-balance text-primary">
                  Velkommen, operatør
                </h2>
                <p className="mt-3 text-sm text-pretty leading-relaxed text-muted">
                  Dashboardet er klart for biometrisk overvåking. Kamera og mikrofon brukes bare når du ber om det, og
                  ansiktsdatabasen lagres lokalt i nettleseren.
                </p>
                <ul className="mt-4 space-y-1 text-sm">
                  <li className={modelOk ? "text-ok" : "text-warn"}>Modeller: {modelOk ? "nominell" : "degradert"}</li>
                  <li className="text-fg">Database: {faces.length} subjekter</li>
                  <li className="text-fg">Trussel: {threat}</li>
                </ul>
                <div className="mt-5">
                  <CmdButton onClick={() => void activate()}>Aktiver dashboard</CmdButton>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {modal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 p-4"
          onClick={() => {
            if (!modal.pending) setModal(null);
          }}
        >
          <div
            className="panel flex max-h-[80vh] w-full max-w-2xl flex-col p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="protocol-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="protocol-title" className="border-b border-border pb-2 text-sm text-primary">
              {modal.title}
            </h2>
            <div
              className={`mt-3 min-h-24 flex-1 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap ${modal.error ? "text-danger" : "text-fg"}`}
            >
              {modal.body}
            </div>
            <button
              ref={closeModalRef}
              type="button"
              className="mt-4 min-h-11 border border-primary text-xs tracking-widest text-primary uppercase hover:bg-primary hover:text-bg disabled:border-border disabled:text-muted"
              disabled={modal.pending}
              onClick={() => setModal(null)}
            >
              Lukk terminal
            </button>
          </div>
        </div>
      ) : null}

      {pendingFace ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/92 p-4">
          <form
            className="panel w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-title"
            onSubmit={savePending}
          >
            <h2 id="name-title" className="text-lg text-accent">
              Nytt subjekt
            </h2>
            <p className="mt-2 text-sm text-muted">Gi subjektet et navn for å legge det i den lokale databasen.</p>
            <label className="sr-only" htmlFor="subject-name">
              Navn
            </label>
            <input
              ref={nameInputRef}
              id="subject-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Navn…"
              maxLength={80}
              className="mt-4 min-h-11 w-full border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-primary"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <CmdButton type="button" onClick={() => setPendingFace(null)}>
                Avbryt
              </CmdButton>
              <CmdButton type="submit" disabled={!name.trim()}>
                Lagre
              </CmdButton>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-3 py-2">
      <p className="text-xs tracking-widest text-muted">{label}</p>
      <p className="truncate text-sm text-fg">{value}</p>
    </div>
  );
}

function PanelTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-sm text-primary">
      {icon}
      <span>{children}</span>
    </h2>
  );
}

function CmdButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 w-full border border-primary px-2 text-center text-xs tracking-wide text-primary uppercase transition-colors duration-200 hover:bg-primary hover:text-bg disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
