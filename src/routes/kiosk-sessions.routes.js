/**
 * Admin side of kiosk device approval.
 *
 * Sublibrary admins/librarians see and manage only the kiosks they are mapped
 * to (module + kiosk access rules of Master Setting). The university
 * administrator has no kiosk restriction, so they see and override every
 * sublibrary's devices.
 */
import { Router } from "express";
import { q, one, localDateTime } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";
import { requireModule, requireWrite, kioskScope } from "../access.js";
import { DEFAULT_DAYS, logSessionEvent } from "../kiosk-session.js";

const router = Router();
router.use(requireAuth);

const days = (v) => Math.min(365, Math.max(1, Number(v) || DEFAULT_DAYS));

const inScope = (access, session) => {
  if (!access || access.admin || access.kiosks === null) return true;
  return access.kiosks.includes(session.device_id);
};

async function loadSession(req, res) {
  const row = await one("SELECT * FROM kiosk_sessions WHERE id = ? AND institute_id = ?",
    [req.params.id, req.institute.id]);
  if (!row) { res.status(404).json({ error: "Kiosk device not found" }); return null; }
  if (!inScope(req.access, row)) {
    res.status(403).json({ error: "This kiosk belongs to another library" });
    return null;
  }
  return row;
}

/** Every registered kiosk device of this university (scoped for sublibrary users). */
router.get("/", withInstitute(isMember), requireModule("kiosks"), async (req, res) => {
  const scope = kioskScope(req.access, "s.device_id");
  const rows = await q(
    `SELECT s.*, k.name AS kiosk_name, k.location AS kiosk_location, l.name AS sublibrary_name
       FROM kiosk_sessions s
       LEFT JOIN kiosk_devices k ON k.id = s.kiosk_id
       LEFT JOIN sublibraries l ON l.id = k.sublibrary_id
      WHERE s.institute_id = ?${scope.sql}
      ORDER BY (s.status = 'pending') DESC, s.requested_at DESC`,
    [req.institute.id, ...scope.params],
  );
  res.json({
    default_days: DEFAULT_DAYS,
    now: localDateTime(),
    can_manage: !req.access?.viewer_only,
    sessions: rows,
  });
});

/** Approval / extension / revoke history. */
router.get("/events", withInstitute(isMember), requireModule("kiosks"), async (req, res) => {
  const rows = await q(
    `SELECT e.*, s.device_id, s.label FROM kiosk_session_events e
       LEFT JOIN kiosk_sessions s ON s.id = e.session_id
      WHERE e.institute_id = ? ORDER BY e.created_at DESC LIMIT 300`,
    [req.institute.id],
  );
  res.json(rows.filter((r) => inScope(req.access, { device_id: r.device_id })));
});

const setStatus = (action) => async (req, res) => {
  const row = await loadSession(req, res);
  if (!row) return;
  const n = days(req.body?.days);
  if (action === "revoked") {
    await q("UPDATE kiosk_sessions SET status = 'revoked', expires_at = NULL WHERE id = ?", [row.id]);
  } else {
    const base = action === "extended" && row.expires_at && new Date(row.expires_at) > new Date()
      ? new Date(row.expires_at)
      : new Date();
    const until = localDateTime(new Date(base.getTime() + n * 864e5));
    await q(
      `UPDATE kiosk_sessions SET status = 'approved', expires_at = ?, approved_at = ?, approved_by = ?, approved_email = ?
        WHERE id = ?`,
      [until, localDateTime(), req.user.id, req.user.email, row.id],
    );
  }
  await logSessionEvent(req.institute.id, row.id, action, req.user, action === "revoked" ? null : n, row.label);
  await logAudit(req, req.institute.id, `kiosk_device_${action}`, "kiosk_sessions", row.id,
    { device_id: row.device_id, days: action === "revoked" ? null : n });
  res.json({ ok: true });
};

router.post("/:id/approve", withInstitute(), requireModule("kiosks"), requireWrite, setStatus("approved"));
router.post("/:id/extend", withInstitute(), requireModule("kiosks"), requireWrite, setStatus("extended"));
router.post("/:id/revoke", withInstitute(), requireModule("kiosks"), requireWrite, setStatus("revoked"));

router.delete("/:id", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const row = await loadSession(req, res);
  if (!row) return;
  await q("DELETE FROM kiosk_sessions WHERE id = ?", [row.id]);
  await logAudit(req, req.institute.id, "kiosk_device_removed", "kiosk_sessions", row.id, { device_id: row.device_id });
  res.json({ ok: true });
});

export default router;
