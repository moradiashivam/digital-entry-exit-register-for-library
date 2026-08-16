const KEY = "ler_theme";

export const getTheme = () => (localStorage.getItem(KEY) === "dark" ? "dark" : "light");

export function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  localStorage.setItem(KEY, theme === "light" ? "light" : "dark");
}

/** Wire a button so library staff can flip between dark and light. */
export function mountThemeToggle(button) {
  const paint = () => {
    button.textContent = getTheme() === "light" ? "Switch to dark mode" : "Switch to light mode";
  };
  applyTheme(getTheme());
  paint();
  button.onclick = () => {
    applyTheme(getTheme() === "light" ? "dark" : "light");
    paint();
  };
}

/* ---------- accent colour ---------- */

const ACCENT_KEY = "ler_accent";

export const ACCENTS = [
  { id: "teal", label: "Library Teal", brand: "#1f7f96", brand2: "#22d3a7" },
  { id: "indigo", label: "Deep Indigo", brand: "#4f8cff", brand2: "#22d3a7" },
  { id: "green", label: "Reading Green", brand: "#1c8a63", brand2: "#3fd39a" },
  { id: "amber", label: "Archive Amber", brand: "#b1701a", brand2: "#e0a83c" },
  { id: "crimson", label: "Crimson Stamp", brand: "#b2453e", brand2: "#e8776c" },
  { id: "graphite", label: "Graphite", brand: "#4a5568", brand2: "#8592ab" },
];

export const getAccent = () =>
  ACCENTS.find((a) => a.id === localStorage.getItem(ACCENT_KEY))?.id ?? "indigo";

export function applyAccent(id) {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[1];
  document.documentElement.style.setProperty("--brand", a.brand);
  document.documentElement.style.setProperty("--brand-2", a.brand2);
  localStorage.setItem(ACCENT_KEY, a.id);
}

/** Apply the saved colour mode + accent. Call once at boot. */
export function initAppearance() {
  applyTheme(getTheme());
  applyAccent(getAccent());
}
