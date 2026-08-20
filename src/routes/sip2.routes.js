import { Router } from "express";
import { q, one } from "../db.js";
import { requireAuth, withInstitute, logAudit } from "../auth.js";
import { encrypt } from "../crypto.js";
import { DEFAULT_FIELD_MAP, SIP2_DEFAULTS, patronInformation, maskId, isTlsHandshakeFailure } from "../sip2.js";

const router = Router();
router.use(requireAuth);

const TEXTS = [
  "lms_vendor", "host", "institution_id", "location_code", "sip_username",
  "allowed_terminals", "encoding", "delimiter_char",
];
const NUMS = ["port", "timeout_ms", "retry_count", "retry_delay_ms"];
const BOOLS = [
  "enabled", "use_ssl", "checksum_required", "auto_create_members",
  "fallback_to_local", "log_transactions", "mask_patron_id_in_logs",
];

/** Row shown in the admin UI — passwords are never returned, only a "set" flag. */
function present(row, instituteName) {
  if (!row) {
    return {
      ...SIP2_DEFAULTS,
      enabled: 0,
      lms_vendor: "Koha",
      host: "",
      delimiter_char: SIP2_DEFAULTS.delimiter,
      institution_id: "",
      location_code: "",
      sip_username: "",
      allowed_terminals: "",
      auto_create_members: 1,
      fallback_to_local: 1,
      log_transactions: 1,
      mask_patron_id_in_logs: 1,
      field_map: DEFAULT_FIELD_MAP,
      has_sip_password: false,
      has_terminal_password: false,
      institute_name: instituteName,
    };
  }
  const { sip_password_encrypted, terminal_password_encrypted, field_map, ...rest } = row;
  let map = field_map;
  if (typeof map === "string") { try { map = JSON.parse(map); } catch { map = null; } }
  return {
    ...rest,
    field_map: { ...DEFAULT_FIELD_MAP, ...(map || {}) },
    has_sip_password: !!sip_password_encrypted,
    has_terminal_password: !!terminal_password_encrypted,
    institute_name: instituteName,
  };
}

router.get("/", withInstitute(), async (req, res) => {
  const row = await one("SELECT * FROM sip2_settings WHERE institute_id = ?", [req.institute.id]);
  res.json(present(row, req.institute.name));
});

router.put("/", withInstitute(), async (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const f of TEXTS) if (b[f] !== undefined) patch[f] = String(b[f]).trim() || null;
  for (const f of NUMS) if (b[f] !== undefined) patch[f] = Number(b[f]) || SIP2_DEFAULTS[f] || 0;
  for (const f of BOOLS) if (b[f] !== undefined) patch[f] = b[f] ? 1 : 0;
  if (b.field_map && typeof b.field_map === "object") {
    patch.field_map = JSON.stringify({ ...DEFAULT_FIELD_MAP, ...b.field_map });
  }
  // Passwords: blank means "keep current"; ${VAULT:KEY} pointers are stored as-is (encrypted).
  if (b.sip_password) patch.sip_password_encrypted = encrypt(String(b.sip_password));
  if (b.terminal_password) patch.terminal_password_encrypted = encrypt(String(b.terminal_password));
  if (b.sip_password === "") patch.sip_password_encrypted = null;
  if (b.terminal_password === "") patch.terminal_password_encrypted = null;

  const keys = Object.keys(patch);
  if (keys.length) {
    await q(
      `INSERT INTO sip2_settings (institute_id, ${keys.join(", ")})
       VALUES (?, ${keys.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${keys.map((k) => `${k} = VALUES(${k})`).join(", ")}`,
      [req.institute.id, ...Object.values(patch)],
    );
  }
  await logAudit(req, req.institute.id, "sip2.settings_update", "sip2_settings", req.institute.id, {
    ...patch, sip_password_encrypted: undefined, terminal_password_encrypted: undefined,
  });
  res.json(present(await one("SELECT * FROM sip2_settings WHERE institute_id = ?", [req.institute.id]), req.institute.name));
});

/** Live test against the university's LMS sandbox / production SIP2 endpoint. */
router.post("/test", withInstitute(), async (req, res) => {
  const row = await one("SELECT * FROM sip2_settings WHERE institute_id = ?", [req.institute.id]);
  if (!row?.host) return res.status(400).json({ error: "Save the SIP2 host first" });
  const card = String(req.body?.card_id || "").trim();
  if (!card) return res.status(400).json({ error: "Enter a test card / barcode" });
  try {
    const result = await patronInformation(row, card);
    await q("UPDATE sip2_settings SET last_test_at = NOW(), last_test_ok = 1, last_test_message = ? WHERE institute_id = ?",
      [`${result.granted ? "Granted" : "Denied"} — ${result.name || "no name returned"}`, req.institute.id]);
    await logAudit(req, req.institute.id, "sip2.test", "sip2_settings", req.institute.id,
      { card: row.mask_patron_id_in_logs ? maskId(card) : card, granted: result.granted });
    res.json(result);
  } catch (e) {
    let error = e;
    if (Number(row.use_ssl) && isTlsHandshakeFailure(e)) {
      try {
        await patronInformation({ ...row, use_ssl: 0, retry_count: 1 }, card);
        error = new Error("Connected without SSL/TLS. Uncheck ‘Use SSL/TLS’, save the settings, then test again.");
      } catch {
        // Keep the original TLS guidance when plain TCP does not complete a SIP2 exchange.
      }
    }
    await q("UPDATE sip2_settings SET last_test_at = NOW(), last_test_ok = 0, last_test_message = ? WHERE institute_id = ?",
      [String(error.message).slice(0, 250), req.institute.id]);
    res.status(502).json({ error: error.message });
  }
});

export default router;
