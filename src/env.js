/**
 * Loads .env explicitly from the data root (next to the .exe when packaged),
 * then from the current working directory as a fallback for any missing keys.
 * Import this instead of "dotenv/config".
 */
import dotenv from "dotenv";
import path from "node:path";
import { DATA_ROOT } from "./runtime-paths.js";

dotenv.config({ path: path.join(DATA_ROOT, ".env") });
dotenv.config();
