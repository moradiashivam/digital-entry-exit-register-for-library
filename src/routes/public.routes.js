import { Router } from "express";
import { q, one, uuid } from "../db.js";
import { kioskEnabled } from "../auth.js";

const router = Router();

/** Kiosk branding + enabled input methods for one university (by kiosk link). */
router.get("/kiosk/:slug", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  const inst = await one("SELECT id, name, slug, status, subscription_start, subscription_end FROM institutes WHERE slug = ?", [req.params.slug]);
  if (!inst) return res.status(404).json({ error: "Unknown kiosk link" });
  const settings = await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [inst.id]);
  res.json({
    institute: { id: inst.id, name: inst.name, slug: inst.slug },
    subscription_active: kioskEnabled(inst),
    kiosk_disabled_reason: kioskEnabled(inst)
      ? null
      : (inst.status && inst.status !== "Active" ? "suspended" : "expired"),
    settings: settings ?? { institution_name: inst.name },
  });
});

async function recordFailure(instituteId, deviceId, code, reason, method) {
  await q(
    `INSERT INTO failed_scan_logs (id, institute_id, device_id, attempted_code, reason, method)
     VALUES (?,?,?,?,?,?)`,
    [uuid(), instituteId, deviceId || "kiosk-1", code || null, reason, method || "Palm"],
  );
}

/**
 * Scan endpoint used by both the browser kiosk and the C++ palm bridge.
 * External callers (bridge) must send the shared secret in `x-kiosk-key`.
 * Body: { institute, method, member_code | rfid_uid | template_id, device_id, confidence }
 */
router.post("/scan-event", async (req, res) => {
  const body = req.body || {};
  const slug = String(body.institute || "").trim();
  const method = ["Palm", "RFID", "Manual"].includes(body.method) ? body.method : "Palm";
  const deviceId = String(body.device_id || "kiosk-1");

  const inst = await one("SELECT * FROM institutes WHERE slug = ?", [slug]);
  if (!inst) return res.status(404).json({ status: "rejected", message: "Unknown kiosk link" });

  // Browser kiosk pages on this server are trusted; anything else needs the key.
  const sameOrigin = (req.headers.origin || "").includes(req.headers.host || "\u0000") ||
    (req.headers.referer || "").includes(req.headers.host || "\u0000");
  if (!sameOrigin) {
    const secret = await one("SELECT kiosk_key FROM institute_secrets WHERE institute_id = ?", [inst.id]);
    if (!secret || req.headers["x-kiosk-key"] !== secret.kiosk_key) {
      return res.status(401).json({ status: "rejected", message: "Kiosk not provisioned" });
    }
  }

  if (!kioskEnabled(inst)) {
    const suspended = (inst.status || "Active") !== "Active";
    const reason = suspended ? `Institute ${inst.status}` : "Subscription expired";
    await recordFailure(inst.id, deviceId, slug, reason, method);
    return res.status(403).json({
      status: "rejected",
      reason: suspended ? "institute_suspended" : "subscription_expired",
      message: suspended
        ? "Kiosk disabled — this university's account is suspended. Contact the administrator."
        : "Subscription expired — contact the administrator",
    });
  }

  let member = null;
  if (body.template_id) {
    member = await one(
      `SELECT m.* FROM palm_templates p JOIN members m ON m.id = p.member_id
       WHERE p.id = ? AND p.institute_id = ?`, [body.template_id, inst.id]);
  } else if (body.member_id) {
    member = await one("SELECT * FROM members WHERE id = ? AND institute_id = ?", [body.member_id, inst.id]);
  } else if (body.rfid_uid) {
    member = await one("SELECT * FROM members WHERE rfid_uid = ? AND institute_id = ?", [String(body.rfid_uid).trim(), inst.id]);
  } else if (body.member_code) {
    member = await one("SELECT * FROM members WHERE member_code = ? AND institute_id = ?", [String(body.member_code).trim(), inst.id]);
  }

  const attempted = body.member_code || body.rfid_uid || body.template_id || null;
  if (!member) {
    await recordFailure(inst.id, deviceId, attempted, "No matching member", method);
    return res.status(404).json({ status: "rejected", message: "No matching member found" });
  }
  if (member.status !== "Active") {
    await recordFailure(inst.id, deviceId, member.member_code, `Member ${member.status}`, method);
    return res.status(403).json({
      status: "rejected",
      reason: "membership_expired",
      member_name: member.full_name,
      member_code: member.member_code,
      valid_to: member.valid_to,
      message: `Membership expired — kindly renew your membership (status: ${member.status.toLowerCase()})`,
    });
  }
  const day = new Date().toISOString().slice(0, 10);
  const validFrom = String(member.valid_from).slice(0, 10);
  const validTo = String(member.valid_to).slice(0, 10);
  if (validFrom > day || validTo < day) {
    await recordFailure(inst.id, deviceId, member.member_code, "Membership not valid today", method);
    return res.status(403).json({
      status: "rejected",
      reason: validTo < day ? "membership_expired" : "membership_not_started",
      member_name: member.full_name,
      member_code: member.member_code,
      valid_to: member.valid_to,
      message: validTo < day
        ? "Membership expired — kindly renew your membership"
        : `Membership starts on ${validFrom} — kindly contact the library desk`,
    });
  }

  const last = await one(
    `SELECT action FROM entry_exit_logs WHERE member_id = ? AND occurred_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
     ORDER BY occurred_at DESC LIMIT 1`, [member.id]);
  const action = last?.action === "Entry" ? "Exit" : "Entry";

  await q(
    `INSERT INTO entry_exit_logs (id, institute_id, member_id, action, method, device_id, matched_confidence)
     VALUES (?,?,?,?,?,?,?)`,
    [uuid(), inst.id, member.id, action, method, deviceId,
     body.confidence != null ? Number(body.confidence) : null],
  );

  res.json({
    status: "ok",
    action,
    member: {
      id: member.id,
      member_code: member.member_code,
      full_name: member.full_name,
      photo_url: member.photo_url,
    },
    occurred_at: new Date().toISOString(),
  });
});

/** Public marketing site content (owner-customisable branding + HTML/CSS). */
router.get("/site", async (_req, res) => {
  const rows = await q(
    "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key LIKE 'site\\_%' OR setting_key = 'platform_name'",
  );
  const s = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  res.json({
    brand: s.site_brand || s.platform_name || "Library Entry & Exit Register",
    tagline: s.site_tagline || "",
    contact_email: s.site_contact_email || "",
    contact_phone: s.site_contact_phone || "",
    contact_address: s.site_contact_address || "",
    custom_enabled: s.site_custom_enabled === "1",
    home_html: s.site_home_html || "",
    home_css: s.site_home_css || "",
    contact_html: s.site_contact_html || "",
    contact_css: s.site_contact_css || "",
  });
});

/** Contact form on the public site -> a Website lead in the owner CRM. */
const contactHits = new Map();
router.post("/contact", async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 200);
  const email = String(b.email || "").trim().slice(0, 200);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "University name and a valid email are required" });
  }

  // Light rate limit: 5 enquiries per IP per hour.
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const hits = (contactHits.get(ip) || []).filter((t) => now - t < 3600000);
  if (hits.length >= 5) return res.status(429).json({ error: "Too many enquiries — please email us instead" });
  hits.push(now);
  contactHits.set(ip, hits);

  const notes = [
    b.size ? `Approx. members: ${String(b.size).slice(0, 60)}` : null,
    b.message ? String(b.message).slice(0, 2000) : null,
  ].filter(Boolean).join("\n");

  const id = uuid();
  await q(
    `INSERT INTO leads (id, name, contact_person, phone, email, city, source, stage, notes)
     VALUES (?,?,?,?,?,?, 'Website', 'New', ?)`,
    [id, name, String(b.contact_person || "").slice(0, 150) || null, String(b.phone || "").slice(0, 40) || null,
     email, String(b.city || "").slice(0, 120) || null, notes || null],
  );
  await q(
    `INSERT INTO lead_activities (id, lead_id, activity_type, note, created_by) VALUES (?,?,?,?,?)`,
    [uuid(), id, "note", `Website contact form enquiry from ${email}`, "website"],
  );
  res.status(201).json({ ok: true });
});

export default router;
