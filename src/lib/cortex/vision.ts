import type { StoredFace } from "@/lib/cortex/types";

const SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js";
const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

export type FaceBox = { x: number; y: number; width: number; height: number };

export type FaceHit = {
  box: FaceBox;
  descriptor: Float32Array;
  expression: string | null;
};

type RawHit = {
  detection?: { box?: FaceBox };
  descriptor?: Float32Array;
  expressions?: Record<string, number>;
};

type AllTask = Promise<RawHit[]> & {
  withFaceLandmarks: () => AllTask;
  withFaceDescriptors: () => AllTask;
  withFaceExpressions: () => AllTask;
};

type SingleTask = Promise<RawHit | undefined> & {
  withFaceLandmarks: () => SingleTask;
  withFaceDescriptor: () => SingleTask;
};

type Labeled = { label: string };

export type FaceMatcher = {
  findBestMatch: (descriptor: Float32Array) => { label: string; distance: number };
};

export type FaceApi = {
  nets: {
    tinyFaceDetector: { load: (url: string) => Promise<void> };
    faceLandmark68Net: { load: (url: string) => Promise<void> };
    faceRecognitionNet: { load: (url: string) => Promise<void> };
    faceExpressionNet: { load: (url: string) => Promise<void> };
  };
  TinyFaceDetectorOptions: new () => object;
  detectAllFaces: (input: HTMLVideoElement, options: object) => AllTask;
  detectSingleFace: (input: HTMLVideoElement, options: object) => SingleTask;
  euclideanDistance: (a: Float32Array, b: Float32Array) => number;
  LabeledFaceDescriptors: new (label: string, descriptors: Float32Array[]) => Labeled;
  FaceMatcher: new (labeled: Labeled[], distanceThreshold: number) => FaceMatcher;
};

const EXPRESSION_NB: Record<string, string> = {
  neutral: "nøytral",
  happy: "glad",
  sad: "trist",
  angry: "sint",
  fearful: "engstelig",
  disgusted: "avsky",
  surprised: "overrasket",
};

function topExpression(expressions: Record<string, number> | undefined): string | null {
  if (!expressions) return null;
  let best = "";
  let score = 0;
  for (const [name, value] of Object.entries(expressions)) {
    if (value > score) {
      score = value;
      best = name;
    }
  }
  if (score < 0.55 || !best) return null;
  return EXPRESSION_NB[best] ?? best;
}

function normalize(raw: RawHit | undefined): FaceHit | null {
  const box = raw?.detection?.box;
  const descriptor = raw?.descriptor;
  if (!box || !descriptor) return null;
  return { box, descriptor, expression: topExpression(raw?.expressions) };
}

export function loadFaceApi(): Promise<FaceApi> {
  const host = window as Window & { faceapi?: FaceApi };
  if (host.faceapi) return Promise.resolve(host.faceapi);

  return new Promise((resolve, reject) => {
    const done = () => {
      if (host.faceapi) resolve(host.faceapi);
      else reject(new Error("Nevralt bibliotek mangler etter lasting."));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-faceapi="1"]');
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", () => reject(new Error("Kunne ikke laste nevralt bibliotek.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.faceapi = "1";
    script.onload = done;
    script.onerror = () => reject(new Error("Kunne ikke laste nevralt bibliotek."));
    document.head.appendChild(script);
  });
}

export async function loadModels(api: FaceApi, onStep: (step: number) => void) {
  onStep(1);
  await api.nets.tinyFaceDetector.load(MODEL_URL);
  onStep(2);
  await api.nets.faceLandmark68Net.load(MODEL_URL);
  onStep(3);
  await api.nets.faceRecognitionNet.load(MODEL_URL);
  onStep(4);
  await api.nets.faceExpressionNet.load(MODEL_URL);
  onStep(5);
}

export async function detectFaces(api: FaceApi, video: HTMLVideoElement): Promise<FaceHit[]> {
  const options = new api.TinyFaceDetectorOptions();
  const found = await api
    .detectAllFaces(video, options)
    .withFaceLandmarks()
    .withFaceExpressions()
    .withFaceDescriptors();
  return found.map(normalize).filter((hit): hit is FaceHit => hit !== null);
}

export async function detectPrimary(api: FaceApi, video: HTMLVideoElement): Promise<FaceHit | null> {
  const options = new api.TinyFaceDetectorOptions();
  const found = await api.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
  return normalize(found);
}

export function buildMatcher(api: FaceApi, faces: StoredFace[], tolerance: number): FaceMatcher | null {
  const labeled = faces
    .filter((face) => face.descriptors.length > 0)
    .map(
      (face) =>
        new api.LabeledFaceDescriptors(
          face.label,
          face.descriptors.map((descriptor) => Float32Array.from(descriptor)),
        ),
    );
  if (!labeled.length) return null;
  return new api.FaceMatcher(labeled, tolerance);
}

export function containedVideoRect(containerW: number, containerH: number, videoW: number, videoH: number) {
  if (!containerW || !containerH || !videoW || !videoH) {
    return { x: 0, y: 0, w: containerW, h: containerH, scale: 1 };
  }
  const scale = Math.min(containerW / videoW, containerH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h, scale };
}

export type PaintItem = {
  box: FaceBox;
  label: string;
  tone: "known" | "unknown";
};

function token(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function xml(value: string) {
  return value
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u0026lt;")
    .replaceAll(">", "\u0026gt;")
    .replaceAll('"', "\u0026quot;")
    .replaceAll("'", "\u0026apos;");
}

export function paintOverlay(svg: SVGSVGElement, video: HTMLVideoElement, items: PaintItem[]) {
  const width = video.clientWidth;
  const height = video.clientHeight;
  if (!width || !height) return;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  if (!items.length) {
    svg.replaceChildren();
    return;
  }
  const rect = containedVideoRect(width, height, video.videoWidth, video.videoHeight);
  const known = token("--color-primary", "#00e6b8");
  const unknown = token("--color-accent", "#e040fb");
  const ink = token("--color-bg", "#07090d");
  const markup = items
    .map((item) => {
      const color = item.tone === "known" ? known : unknown;
      const x = rect.x + item.box.x * rect.scale;
      const y = rect.y + item.box.y * rect.scale;
      const w = item.box.width * rect.scale;
      const h = item.box.height * rect.scale;
      const labelW = Math.min(Math.max(item.label.length * 7.4 + 12, 64), Math.max(w, 120));
      const labelH = 18;
      const labelY = y > labelH + 4 ? y - labelH : y;
      const label = xml(item.label);
      return [
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2"/>`,
        `<rect x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" width="${labelW.toFixed(1)}" height="${labelH}" fill="${color}"/>`,
        `<text x="${(x + 6).toFixed(1)}" y="${(labelY + 13).toFixed(1)}" fill="${ink}" font-size="13" font-family="Share Tech Mono, ui-monospace, monospace">${label}</text>`,
      ].join("");
    })
    .join("");
  svg.innerHTML = markup;
}

export function captureFrame(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const maxW = 640;
  const scale = Math.min(1, maxW / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const data = canvas.toDataURL("image/jpeg", 0.55);
  const comma = data.indexOf(",");
  return comma >= 0 ? data.slice(comma + 1) : null;
}
