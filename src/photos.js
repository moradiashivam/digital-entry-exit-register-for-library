import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** public/photos/<institute-folder>/<member_code>.jpg */
export const PHOTO_ROOT = path.join(__dirname, "..", "public", "photos");

const safe = (v, fallback = "unknown") => {
  const s = String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
};

export const instituteFolder = (inst) => safe(inst?.slug || inst?.name || inst?.id);

/**
 * Save a base64 / data-URL image as <member_code>.jpg inside the university folder.
 * Returns the public URL to store in members.photo_url.
 */
export async function savePhoto(inst, memberCode, dataUrl) {
  const raw = String(dataUrl || "");
  const base64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("Empty image file");
  if (buffer.length > 5 * 1024 * 1024) throw new Error("Image is larger than 5 MB");

  const folder = instituteFolder(inst);
  const dir = path.join(PHOTO_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });
  const file = `${safe(memberCode, "member")}.jpg`;
  await fs.writeFile(path.join(dir, file), buffer);
  return `/photos/${folder}/${file}`;
}

export async function deletePhoto(inst, memberCode) {
  const file = path.join(PHOTO_ROOT, instituteFolder(inst), `${safe(memberCode, "member")}.jpg`);
  await fs.rm(file, { force: true });
}
