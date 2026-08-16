import crypto from "node:crypto";

/**
 * AES-256-GCM helpers used to keep SMTP passwords encrypted at rest.
 * The key comes from ENCRYPTION_KEY (any string) — never store it in the DB.
 */
const key = crypto
  .createHash("sha256")
  .update(String(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-only-encryption-key"))
  .digest();

export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(payload) {
  if (!payload) return "";
  try {
    const [iv, tag, data] = String(payload).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("hex");
