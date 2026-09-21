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
 *
 * Accuracy rules used here (they matter far more than the threshold alone):
 *  - the accurate SSD MobileNet detector is preferred over the tiny detector,
 *  - a face that is too small, off-centre, tilted or low-confidence is refused
 *    instead of being matched badly,
 *  - a match is only accepted when the runner-up is clearly further away, so
 *    two similar-looking people can never be swapped silently.
 */

const DEFAULT_LIB = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js";
export const DEFAULT_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/";

/** Minimum detector confidence for a capture to be used at all. */
export const MIN_SCORE = 0.6;
/** The face must fill at least this share of the shorter image side. */
export const MIN_FACE_RATIO = 0.18;
/** The best match must beat the runner-up by at least this distance. */
export const MIN_MARGIN = 0.06;

let libPromise = null;
let loadedModelUrl = null;
let modelPromise = null;
let accurate = false;

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
  modelPromise = (async () => {
    await Promise.all([
      fa.nets.faceLandmark68Net.loadFromUri(url),
      fa.nets.faceRecognitionNet.loadFromUri(url),
    ]);
    // Prefer the accurate detector; fall back to the tiny one if it is missing.
    try {
      await fa.nets.ssdMobilenetv1.loadFromUri(url);
      accurate = true;
    } catch {
      accurate = false;
      await fa.nets.tinyFaceDetector.loadFromUri(url);
    }
  })();
  await modelPromise;
  return fa;
}

const options = (fa) =>
  accurate
    ? new fa.SsdMobilenetv1Options({ minConfidence: MIN_SCORE, maxResults: 5 })
    : new fa.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: MIN_SCORE });

const sizeOf = (input) => ({
  w: input.videoWidth || input.naturalWidth || input.width || 0,
  h: input.videoHeight || input.naturalHeight || input.height || 0,
});

/** Rough left/right symmetry of the eyes — filters out strongly turned heads. */
function frontality(landmarks) {
  try {
    const nose = landmarks.getNose()[3];
    const l = landmarks.getLeftEye();
    const r = landmarks.getRightEye();
    const mid = (pts) => pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const dl = Math.abs(nose.x - mid(l));
    const dr = Math.abs(mid(r) - nose.x);
    const max = Math.max(dl, dr) || 1;
    return Math.min(dl, dr) / max; // 1 = perfectly straight, 0 = full profile
  } catch {
    return 1;
  }
}

/**
 * Returns { descriptor, score, ratio, frontality } for the single largest face,
 * or null when nothing usable is in front of the camera.
 * `reasons` explains a refusal so the page can tell the person what to change.
 */
export async function describeFace(input, modelUrl) {
  const fa = await loadModels(modelUrl);
  const results = await fa
    .detectAllFaces(input, options(fa))
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (!results.length) return null;

  const area = (r) => r.detection.box.width * r.detection.box.height;
  const sorted = [...results].sort((a, b) => area(b) - area(a));
  // Two people in the frame at once is a common cause of a wrong entry.
  if (sorted.length > 1 && area(sorted[1]) > area(sorted[0]) * 0.6) {
    return { reason: "More than one face in view — only one person at a time" };
  }

  const best = sorted[0];
  const { w, h } = sizeOf(input);
  const shorter = Math.min(w || best.detection.box.width, h || best.detection.box.height) || 1;
  const ratio = best.detection.box.height / shorter;
  const score = best.detection.score ?? 0;
  const front = frontality(best.landmarks);

  if (score < MIN_SCORE) return { reason: "Face unclear — improve the lighting" };
  if (ratio < MIN_FACE_RATIO) return { reason: "Move closer to the camera" };
  if (front < 0.45) return { reason: "Look straight at the camera" };

  return { descriptor: Array.from(best.descriptor), score, ratio, frontality: front };
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

/** Average of several descriptors (multi-sample enrolment), re-normalised. */
export function averageDescriptors(list) {
  if (!list.length) return null;
  const out = new Array(128).fill(0);
  for (const d of list) for (let i = 0; i < 128; i += 1) out[i] += d[i];
  return out.map((v) => v / list.length);
}

/**
 * Best match from [{ member_id, descriptor }] or null when nothing is close
 * enough — or when the runner-up is almost as close (ambiguous = refuse).
 */
export function bestMatch(descriptor, enrolled, threshold = 0.55, margin = MIN_MARGIN) {
  let best = null;
  let second = null;
  for (const row of enrolled) {
    const d = distance(descriptor, row.descriptor);
    if (!best || d < best.distance) { second = best; best = { ...row, distance: d }; }
    else if (!second || d < second.distance) second = { ...row, distance: d };
  }
  if (!best || best.distance > threshold) return null;
  // A different person whose distance is nearly the same means we cannot tell
  // them apart with confidence — better no entry than the wrong entry.
  if (second && second.member_id !== best.member_id && second.distance - best.distance < margin) {
    return { ambiguous: true, distance: best.distance };
  }
  // Turn the distance into a friendly 0–100 confidence for the log.
  return { ...best, confidence: Math.max(0, Math.min(100, Math.round((1 - best.distance) * 100))) };
}
