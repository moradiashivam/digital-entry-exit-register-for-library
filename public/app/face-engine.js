/**
 * Shared face-recognition engine for the admin console and the kiosk.
 *
 * The old `face-recognition` npm package is a native dlib build (obsolete and
 * painful on Windows), so this app uses face-api.js in the browser instead:
 * the same dlib models (SSD/Tiny detector + 68 landmarks + ResNet descriptor)
 * compiled to JavaScript. Nothing native has to be installed on the library PC.
 *
 * A face is stored as a 128-number descriptor. Matching = euclidean distance;
 * the lower the distance the more similar (0.5–0.6 is the usual threshold).
 */

const DEFAULT_LIB = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js";
export const DEFAULT_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/";

let libPromise = null;
let loadedModelUrl = null;
let modelPromise = null;

/** Loads face-api.js once per page. */
export async function loadFaceApi() {
  if (!libPromise) libPromise = import(/* @vite-ignore */ DEFAULT_LIB).then((m) => m.default ?? m);
  return libPromise;
}

/** Loads the detector / landmark / recognition models (cached by the browser). */
export async function loadModels(modelUrl) {
  const url = String(modelUrl || DEFAULT_MODEL_URL);
  const fa = await loadFaceApi();
  if (loadedModelUrl === url && modelPromise) { await modelPromise; return fa; }
  loadedModelUrl = url;
  modelPromise = Promise.all([
    fa.nets.tinyFaceDetector.loadFromUri(url),
    fa.nets.faceLandmark68Net.loadFromUri(url),
    fa.nets.faceRecognitionNet.loadFromUri(url),
  ]);
  await modelPromise;
  return fa;
}

const options = (fa) => new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });

/** Returns a 128-number descriptor for the single largest face, or null. */
export async function describeFace(input, modelUrl) {
  const fa = await loadModels(modelUrl);
  const result = await fa
    .detectSingleFace(input, options(fa))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  return { descriptor: Array.from(result.descriptor), score: result.detection?.score ?? 0 };
}

/** Loads an image URL into an <img> the models can read (same-origin photos). */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Photo could not be loaded"));
    img.src = src;
  });
}

export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Best match from [{ member_id, descriptor }] or null when nothing is close enough. */
export function bestMatch(descriptor, enrolled, threshold = 0.55) {
  let best = null;
  for (const row of enrolled) {
    const d = distance(descriptor, row.descriptor);
    if (!best || d < best.distance) best = { ...row, distance: d };
  }
  if (!best || best.distance > threshold) return null;
  // Turn the distance into a friendly 0–100 confidence for the log.
  return { ...best, confidence: Math.max(0, Math.min(100, Math.round((1 - best.distance) * 100))) };
}
