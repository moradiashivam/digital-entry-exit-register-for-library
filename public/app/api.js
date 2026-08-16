const TOKEN_KEY = "ler_token";
const INST_KEY = "ler_institute";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(INST_KEY);
};

export const getInstitute = () => localStorage.getItem(INST_KEY);
export const setInstitute = (id) => localStorage.setItem(INST_KEY, id);

/** Fetch wrapper that adds the bearer token and active university. */
export async function api(url, { method = "GET", body, institute } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const inst = institute ?? getInstitute();
  if (inst) headers["x-institute-id"] = inst;

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && !url.includes("/auth/login")) {
    clearToken();
    location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export function toast(message, isError = false) {
  const el = document.createElement("div");
  el.className = `toast${isError ? " err" : ""}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtDate = (v) => (v ? String(v).replace("T", " ").slice(0, 16) : "—");

/** Download an array of objects as a CSV file. */
export function downloadCsv(filename, rows) {
  if (!rows.length) return toast("Nothing to export", true);
  const cols = Object.keys(rows[0]);
  const csv = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
