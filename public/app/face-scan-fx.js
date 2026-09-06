/**
 * Reusable Face ID scanning animation.
 *
 * Pure CSS/SVG overlay (no libraries, no canvas loop) that sits on top of any
 * camera preview and tells the person what is happening:
 *
 *   scanning  → sweeping line + rotating radar ring + pulsing landmark dots
 *   detected  → brackets snap in, ring locks
 *   verifying → ring spins faster, "Verifying…" label
 *   success   → green glow + animated tick
 *   fail      → red shake + cross
 *
 * Usage:
 *   import { attachFaceScan } from "/app/face-scan-fx.js";
 *   const fx = attachFaceScan(videoWrapperElement);
 *   fx.scanning();  fx.detected("Riya Patel"); fx.verifying(); fx.success("Welcome"); fx.fail("Try again");
 *   fx.destroy();
 *
 * The overlay never touches the camera stream or the recognition logic; it is
 * purely visual and is pointer-events:none so it cannot block anything.
 */

const LANDMARKS = [
  [34, 38], [66, 38],            // eyes
  [50, 55],                      // nose
  [40, 70], [60, 70],            // mouth corners
  [22, 30], [78, 30],            // brow outer
  [26, 62], [74, 62],            // cheeks
  [50, 84],                      // chin
];

const TEMPLATE = `
  <div class="fsfx-frame">
    <span class="fsfx-c tl"></span><span class="fsfx-c tr"></span>
    <span class="fsfx-c bl"></span><span class="fsfx-c br"></span>
  </div>
  <div class="fsfx-grid"></div>
  <div class="fsfx-sweep"></div>
  <svg class="fsfx-face" viewBox="0 0 100 100" aria-hidden="true">
    <ellipse class="fsfx-oval" cx="50" cy="52" rx="30" ry="38" />
    <g class="fsfx-marks">${LANDMARKS.map(
      ([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.5" style="animation-delay:${i * 90}ms" />`,
    ).join("")}</g>
  </svg>
  <div class="fsfx-ring"><span></span><span></span></div>
  <svg class="fsfx-mark" viewBox="0 0 52 52" aria-hidden="true">
    <circle class="fsfx-mark-ring" cx="26" cy="26" r="22" />
    <path class="fsfx-tick" d="M15 27 l8 8 l15 -16" />
    <path class="fsfx-cross" d="M17 17 l18 18 M35 17 l-18 18" />
  </svg>
  <p class="fsfx-label"><span class="fsfx-dot"></span><span class="fsfx-text"></span></p>
`;

const STATES = ["idle", "scanning", "detected", "verifying", "success", "fail"];

/**
 * @param {HTMLElement} host element the overlay is drawn inside (position:relative is applied)
 * @param {{compact?: boolean}} [opts]
 */
export function attachFaceScan(host, opts = {}) {
  if (!host) return noop();
  let root = host.querySelector(":scope > .fsfx");
  if (!root) {
    root = document.createElement("div");
    root.className = "fsfx";
    root.setAttribute("aria-live", "polite");
    root.innerHTML = TEMPLATE;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(root);
  }
  if (opts.compact) root.classList.add("fsfx-compact");
  const textEl = root.querySelector(".fsfx-text");
  let resetTimer = null;

  const set = (state, text) => {
    clearTimeout(resetTimer);
    STATES.forEach((s) => root.classList.toggle(`is-${s}`, s === state));
    textEl.textContent = text || "";
    root.hidden = state === "idle";
  };

  return {
    el: root,
    state: (s, t) => set(s, t),
    idle: () => set("idle", ""),
    scanning: (t = "Scanning face…") => set("scanning", t),
    detected: (t = "Face detected") => set("detected", t),
    verifying: (t = "Verifying identity…") => set("verifying", t),
    success(t = "Authenticated") {
      set("success", t);
    },
    fail(t = "Face not recognised — try again", backToScanning = true) {
      set("fail", t);
      if (backToScanning) resetTimer = setTimeout(() => set("scanning", "Scanning face…"), 1800);
    },
    destroy() {
      clearTimeout(resetTimer);
      root.remove();
    },
  };
}

function noop() {
  const f = () => {};
  return { el: null, state: f, idle: f, scanning: f, detected: f, verifying: f, success: f, fail: f, destroy: f };
}
