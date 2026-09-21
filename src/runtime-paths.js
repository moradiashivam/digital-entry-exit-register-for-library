/**
 * Path roots that also work inside the packaged Windows .exe.
 *
 * Packaged (pkg) the app files live in a read-only snapshot inside the exe,
 * so anything the app WRITES (.env, photos, uploads, ticket attachments,
 * backups) must live next to the exe file instead.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Directory of the calling module. Inside the bundled exe `import.meta.url`
 * is empty, so fall back to CommonJS `__dirname` when it exists.
 */
export const moduleDir = (metaUrl) =>
  typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(metaUrl));

const here = moduleDir(import.meta.url);

/** True when running inside the packaged single-file executable. */
export const IS_EXE = typeof process.pkg !== "undefined";

/** Read-only application files (project folder in dev, exe snapshot when packaged). */
export const APP_ROOT = path.join(here, "..");

/** Writable folder: next to the .exe when packaged, same as APP_ROOT in dev. */
export const DATA_ROOT = IS_EXE ? path.dirname(process.execPath) : APP_ROOT;
