/* Ready-made kiosk designs.
   Each template is plain CSS applied on top of the kiosk page. Admins pick one in
   Settings → Kiosk template, and can copy its CSS into the custom CSS editor for
   full HTML/CSS customisation (custom CSS always wins over the template). */

export const KIOSK_TEMPLATES = [
  {
    id: "classic",
    label: "Classic card",
    description: "The default centred card — calm, neutral and works on any screen size.",
    css: "",
  },
  {
    id: "spotlight",
    label: "Spotlight",
    description: "Dark stage with a glowing gradient halo and an oversized clock. Great for a dim entrance lobby.",
    css: `.kiosk {
  background: radial-gradient(1100px 700px at 50% -10%, #24408a 0%, #0b1020 55%, #05070f 100%);
  color: #eaf0ff;
}
.kiosk-card {
  background: rgba(12, 18, 38, .72);
  border: 1px solid rgba(120, 160, 255, .28);
  border-radius: 26px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, .55), inset 0 1px 0 rgba(255, 255, 255, .06);
  backdrop-filter: blur(8px);
  padding: 2.4rem;
}
.kiosk-logo { max-height: 84px; }
.kiosk-institution {
  font-size: 2.5rem; letter-spacing: .02em;
  background: linear-gradient(90deg, #9fd0ff, #ffffff 45%, #b7a4ff);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.kiosk-clock { font-size: 4.2rem; text-shadow: 0 0 32px rgba(120, 170, 255, .55); }
.kiosk-tabs button { border-radius: 999px; padding: .6rem 1.15rem; color: #dbe6ff; }
.kiosk-tabs button.active { box-shadow: 0 0 0 3px rgba(120, 160, 255, .22); }
.kiosk-input { border-radius: 999px; padding: .95rem 1.2rem; font-size: 1.1rem; }
.kiosk-form button { border-radius: 999px; padding: .95rem 1.6rem; }
.kiosk-footer { opacity: .65; }`,
  },
  {
    id: "campus",
    label: "Campus banner",
    description: "Coloured header band with the logo and university name, white body below.",
    css: `.kiosk { background: #f3f5fb; color: #16213a; padding: 0; align-items: start; }
.kiosk-card {
  width: min(760px, 100%); margin: 0 auto; background: #fff; border: 1px solid #dfe4f2;
  border-radius: 0 0 22px 22px; padding: 0 2rem 2rem; overflow: hidden;
  box-shadow: 0 18px 50px rgba(20, 35, 80, .08);
}
.kiosk-card::before {
  content: ""; display: block; height: 8px; margin: 0 -2rem 0;
  background: linear-gradient(90deg, var(--brand, #4f46e5), #22c1a4);
}
.kiosk-logo { max-height: 96px; margin-top: 1.4rem; }
.kiosk-institution { font-size: 2.1rem; color: #16213a; margin-top: .6rem; }
.kiosk-title, .kiosk-welcome, .kiosk-footer { color: #5a678c; }
.kiosk-clock { font-size: 3.2rem; color: #16213a; font-variant-numeric: tabular-nums; }
.kiosk-tabs button { background: #eef1fa; border: 1px solid #dfe4f2; color: #2b365c; border-radius: 10px; }
.kiosk-tabs button.active { background: var(--brand, #4f46e5); color: #fff; }
.kiosk-input { background: #fff; border: 1px solid #cfd6ea; color: #16213a; border-radius: 10px; }
.result { background: #f7f9ff; border-color: #dfe4f2; }`,
  },
  {
    id: "minimal",
    label: "Minimal white",
    description: "Almost no chrome — huge type on a plain background. Best for fast queues.",
    css: `.kiosk { background: #ffffff; color: #111418; }
.kiosk-card { background: transparent; border: none; box-shadow: none; width: min(720px, 100%); }
.kiosk-logo { max-height: 64px; opacity: .9; }
.kiosk-institution { font-size: 1.6rem; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; color: #111418; }
.kiosk-title { display: none; }
.kiosk-clock { font-size: 5rem; font-weight: 300; letter-spacing: -.02em; color: #111418; }
.kiosk-welcome { font-size: 1.15rem; color: #5b6470; }
.kiosk-tabs button { background: transparent; border: none; border-bottom: 2px solid transparent; border-radius: 0; color: #5b6470; }
.kiosk-tabs button.active { background: transparent; color: #111418; border-bottom-color: #111418; }
.kiosk-input { border: none; border-bottom: 2px solid #111418; border-radius: 0; background: transparent; color: #111418; font-size: 1.3rem; text-align: center; }
.kiosk-form button { background: #111418; color: #fff; border-radius: 4px; }
.result { border-radius: 4px; }
.kiosk-footer { font-size: .8rem; color: #9aa2ad; }`,
  },
  {
    id: "boarding",
    label: "Boarding board",
    description: "Airport-style dark board with monospace type and bright entry/exit banners.",
    css: `.kiosk { background: #0a0c0f; color: #e9f6ec; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
.kiosk-card { background: #10151b; border: 1px solid #26313d; border-radius: 8px; padding: 2rem; }
.kiosk-institution { font-size: 1.9rem; text-transform: uppercase; letter-spacing: .12em; color: #ffd447; }
.kiosk-title { color: #7f8c9b; text-transform: uppercase; letter-spacing: .18em; font-size: .85rem; }
.kiosk-clock { font-size: 4rem; color: #35e07f; font-variant-numeric: tabular-nums; letter-spacing: .06em; }
.kiosk-tabs button { background: #161d26; border: 1px solid #2c3846; color: #cfe0d6; border-radius: 4px; text-transform: uppercase; font-size: .8rem; letter-spacing: .1em; }
.kiosk-tabs button.active { background: #ffd447; color: #10151b; border-color: #ffd447; }
.kiosk-input { background: #0a0c0f; border: 1px solid #2c3846; color: #35e07f; border-radius: 4px; letter-spacing: .12em; }
.kiosk-form button { background: #35e07f; color: #06210f; border-radius: 4px; text-transform: uppercase; letter-spacing: .1em; }
.result { border-radius: 4px; text-transform: uppercase; letter-spacing: .06em; }
.result.entry { background: #06341f; border-color: #35e07f; }
.result.exit { background: #3a2a05; border-color: #ffd447; }
.kiosk-footer { color: #6c7a89; letter-spacing: .08em; }`,
  },
  {
    id: "photo-first",
    label: "Photo first",
    description: "Compact form with a very large student photo and colour-flooded result panel.",
    css: `.kiosk { background: linear-gradient(160deg, #f7f2ec 0%, #eef3f7 100%); color: #21262e; }
.kiosk-card { background: #fff; border: 1px solid #e6e2dc; border-radius: 20px; padding: 1.8rem; box-shadow: 0 16px 40px rgba(60, 50, 40, .10); }
.kiosk-institution { font-size: 1.9rem; }
.kiosk-clock { font-size: 2.2rem; color: #6b7280; font-weight: 600; }
.kiosk-tabs button { background: #f2f4f7; border: 1px solid #e2e6ec; color: #3a424e; border-radius: 999px; }
.kiosk-tabs button.active { background: var(--brand, #4f46e5); color: #fff; }
.kiosk-input { background: #fff; border: 1px solid #d8dde5; color: #21262e; border-radius: 12px; }
.kiosk-result .result { padding: 1.8rem; border-radius: 18px; }
.kiosk-result .result img { width: 190px; height: 190px; border-radius: 18px; box-shadow: 0 10px 26px rgba(0,0,0,.18); }
.kiosk-result .result h2 { font-size: 2rem; margin-top: .7rem; }
.result.entry { background: #e3f8ee; border-color: #17a673; }
.result.exit { background: #fdf1d8; border-color: #d9a441; }
.result.bad { background: #fde9ec; border-color: #dc2f4b; }
.kiosk-footer { color: #8a8378; }`,
  },
  {
    id: "wide-console",
    label: "Wide console",
    description: "Landscape board: institute details on top, big student photo on the left, details in the middle and a round clock on the right.",
    css: `.kiosk { background: #f7f9fc; color: #131722; padding: 1.2rem; }
.kiosk-card {
  width: min(1280px, 100%); background: #fff; border: 2px solid #131722; border-radius: 18px;
  padding: 1.4rem 1.8rem 1.6rem; box-shadow: none; text-align: center;
  display: grid; gap: 1rem 1.4rem;
  grid-template-columns: minmax(200px, 1fr) minmax(240px, 1.4fr) minmax(220px, 1fr);
  grid-template-areas:
    "logo logo logo"
    "head head head"
    "result result clock"
    "tabs tabs clock"
    "form form clock"
    "cam cam clock"
    "foot foot foot";
  align-items: center;
}
.kiosk-logo { grid-area: logo; justify-self: center; max-height: 62px; }
.kiosk-institution { grid-area: head; font-size: 2rem; font-weight: 700; }
.kiosk-title, .kiosk-welcome, .kiosk-name { display: none; }
.kiosk-clock {
  grid-area: clock; justify-self: center; display: grid; place-items: center;
  width: 230px; height: 230px; border: 2px solid #131722; border-radius: 50%;
  font-size: 2.4rem; font-weight: 600; font-variant-numeric: tabular-nums;
}
.kiosk-tabs { grid-area: tabs; justify-content: center; }
.kiosk-tabs button { border: 2px solid #131722; background: #fff; color: #131722; border-radius: 10px; }
.kiosk-tabs button.active { background: #131722; color: #fff; }
.kiosk-form { grid-area: form; justify-content: center; }
.kiosk-input { border: 2px solid #131722; background: #fff; color: #131722; border-radius: 10px; min-width: 320px; }
.kiosk-form button { border-radius: 10px; }
.kiosk-camera { grid-area: cam; }
.kiosk-result { grid-area: result; min-height: 260px; display: grid; }
.kiosk-result:empty { min-height: 0; }
.kiosk-result .result {
  display: grid; grid-template-columns: 240px 1fr; gap: 1.4rem; align-items: center;
  text-align: left; border: 2px solid #131722; background: #fff; border-radius: 14px; padding: 1.1rem;
}
.kiosk-result .result img { width: 240px; height: 300px; object-fit: cover; border: 2px solid #131722; border-radius: 12px; }
.kiosk-result .result h2 { font-size: 1.9rem; margin: 0 0 .35rem; }
.result.entry { border-color: #17a673; }
.result.exit { border-color: #d9a441; }
.result.bad { border-color: #dc2f4b; grid-template-columns: 1fr; text-align: center; }
.kiosk-footer { grid-area: foot; }
@media (max-width: 900px) {
  .kiosk-card { grid-template-columns: 1fr; grid-template-areas: "logo" "head" "clock" "result" "tabs" "form" "cam" "foot"; }
  .kiosk-clock { width: 170px; height: 170px; font-size: 1.8rem; }
  .kiosk-result .result { grid-template-columns: 1fr; text-align: center; justify-items: center; }
}`,
  },
];

export const templateCss = (id) =>
  KIOSK_TEMPLATES.find((t) => t.id === id)?.css ?? "";
