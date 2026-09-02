import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { instituteFolder } from "./photos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** public/uploads/<institute-folder>/<uuid>.<ext> — kiosk display media. */
export const MEDIA_ROOT = path.join(__dirname, "..", "public", "uploads");

const EXT = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
};

const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 60) * 1024 * 1024;

/** Save a data-URL (image or video) and return its public URL. */
export async function saveMedia(inst, dataUrl) {
  const raw = String(dataUrl || "");
  const match = raw.match(/^data:([\w/+.-]+);base64,/i);
  if (!match) throw new Error("Unsupported file — upload an image or a video");
  const mime = match[1].toLowerCase();
  const ext = EXT[mime];
  if (!ext) throw new Error(`Unsupported file type: ${mime}`);

  const buffer = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64");
  if (!buffer.length) throw new Error("Empty file");
  if (buffer.length > MAX_BYTES) throw new Error(`File is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);

  const folder = instituteFolder(inst);
  const dir = path.join(MEDIA_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, file), buffer);
  return { url: `/uploads/${folder}/${file}`, kind: mime.startsWith("video/") ? "video" : "image" };
}

/** Remove a previously saved file; never throws. */
export async function deleteMedia(url) {
  const clean = String(url || "");
  if (!clean.startsWith("/uploads/")) return;
  const target = path.join(MEDIA_ROOT, clean.replace("/uploads/", ""));
  if (!target.startsWith(MEDIA_ROOT)) return;
  await fs.rm(target, { force: true }).catch(() => {});
}
