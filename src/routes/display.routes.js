/**
 * Kiosk Library Activities & Services — content shown on the kiosk screen when
 * nobody is using it. Two post types:
 *   regular  — always on until switched off
 *   occasion — scheduled with start/end date and start/end time
 * A post can be assigned to selected kiosks; no assignment = every kiosk.
 */
import { Router } from "express";
import { q, one, uuid, localDate, localDateTime } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";
import { requireModule, requireWrite } from "../access.js";
import { saveMedia, deleteMedia } from "../media.js";

const router = Router();
router.use(requireAuth);

const clean = (v, max = 180) => String(v ?? "").trim().slice(0, max);
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const timeOrNull = (v) => {
  const m = String(v || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  return m ? `${m[1]}:${m[2]}:${m[3] || "00"}` : null;
};

/** Active / Scheduled / Expired / Inactive — computed on the app's local clock. */
export function postStatus(post, now = new Date()) {
  if (!Number(post.is_active)) return "Inactive";
  if (post.post_type !== "occasion") return "Active";
  const day = localDate(now);
  const time = localDateTime(now).slice(11);
  if (post.start_date && day < String(post.start_date).slice(0, 10)) return "Scheduled";
  if (post.end_date && day > String(post.end_date).slice(0, 10)) return "Expired";
  if (post.start_time && time < post.start_time) return "Scheduled";
  if (post.end_time && time > post.end_time) return "Expired";
  return "Active";
}

async function decorate(instituteId, rows) {
  if (!rows.length) return [];
  const links = await q(
    `SELECT pd.post_id, pd.kiosk_id, d.device_id, d.name
     FROM kiosk_post_devices pd JOIN kiosk_devices d ON d.id = pd.kiosk_id
     WHERE d.institute_id = ?`,
    [instituteId],
  );
  return rows.map((p) => ({
    ...p,
    status: postStatus(p),
    kiosks: links.filter((l) => l.post_id === p.id).map((l) => ({ id: l.kiosk_id, device_id: l.device_id, name: l.name })),
  }));
}

/** List posts + kiosks + idle-screen settings for the admin module. */
router.get("/posts", withInstitute(isMember), requireModule("kiosks"), async (req, res) => {
  const rows = await q(
    "SELECT * FROM kiosk_posts WHERE institute_id = ? ORDER BY post_type DESC, sort_order ASC, created_at DESC",
    [req.institute.id],
  );
  const devices = await q(
    "SELECT id, device_id, name, location, is_active FROM kiosk_devices WHERE institute_id = ? ORDER BY name",
    [req.institute.id],
  );
  const settings = await one(
    "SELECT display_enabled, display_idle_seconds, display_slide_seconds FROM kiosk_settings WHERE institute_id = ?",
    [req.institute.id],
  );
  res.json({ posts: await decorate(req.institute.id, rows), devices, settings: settings || {} });
});

/** Idle-screen behaviour (switch on/off, seconds before it starts, slide length). */
router.put("/settings", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const patch = {
    display_enabled: req.body?.display_enabled ? 1 : 0,
    display_idle_seconds: Math.min(3600, Math.max(5, Number(req.body?.display_idle_seconds) || 30)),
    display_slide_seconds: Math.min(300, Math.max(3, Number(req.body?.display_slide_seconds) || 10)),
  };
  await q(
    `INSERT INTO kiosk_settings (institute_id, ${Object.keys(patch).join(", ")})
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ${Object.keys(patch).map((k) => `${k} = VALUES(${k})`).join(", ")}`,
    [req.institute.id, ...Object.values(patch)],
  );
  await logAudit(req, req.institute.id, "kiosk.display_settings", "kiosk_settings", req.institute.id, patch);
  res.json({ ok: true, ...patch });
});

async function setKiosks(postId, instituteId, kioskIds) {
  await q("DELETE FROM kiosk_post_devices WHERE post_id = ?", [postId]);
  const ids = Array.isArray(kioskIds) ? kioskIds.filter(Boolean) : [];
  for (const id of ids) {
    const owned = await one("SELECT id FROM kiosk_devices WHERE id = ? AND institute_id = ?", [id, instituteId]);
    if (owned) await q("INSERT IGNORE INTO kiosk_post_devices (post_id, kiosk_id) VALUES (?, ?)", [postId, id]);
  }
}

async function readBody(req) {
  const body = req.body || {};
  const post = {
    title: clean(body.title),
    body: String(body.body ?? "").slice(0, 4000),
    category: clean(body.category, 60) || "General",
    post_type: body.post_type === "occasion" ? "occasion" : "regular",
    is_active: body.is_active === undefined || body.is_active ? 1 : 0,
    sort_order: Math.max(0, Math.min(9999, Number(body.sort_order) || 0)),
    start_date: null, end_date: null, start_time: null, end_time: null,
    media_type: "none", media_url: null,
  };
  if (!post.title) throw new Error("Enter a title for the post");
  if (post.post_type === "occasion") {
    post.start_date = dateOrNull(body.start_date);
    post.end_date = dateOrNull(body.end_date);
    post.start_time = timeOrNull(body.start_time);
    post.end_time = timeOrNull(body.end_time);
    if (!post.start_date || !post.end_date) throw new Error("Occasion posts need a start date and an end date");
    if (post.end_date < post.start_date) throw new Error("End date cannot be before the start date");
  }
  if (body.media_data) {
    const saved = await saveMedia(req.institute, body.media_data);
    post.media_url = saved.url;
    post.media_type = saved.kind;
  } else if (body.media_url) {
    post.media_url = clean(body.media_url, 400);
    post.media_type = body.media_type === "video" ? "video" : "image";
  }
  return post;
}

router.post("/posts", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const post = await readBody(req);
  const id = uuid();
  const cols = Object.keys(post);
  await q(
    `INSERT INTO kiosk_posts (id, institute_id, ${cols.join(", ")})
     VALUES (?, ?, ${cols.map(() => "?").join(", ")})`,
    [id, req.institute.id, ...cols.map((c) => post[c])],
  );
  await setKiosks(id, req.institute.id, req.body?.kiosk_ids);
  await logAudit(req, req.institute.id, "kiosk.post_create", "kiosk_posts", id, { title: post.title });
  res.json({ ok: true, id });
});

router.put("/posts/:id", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const existing = await one("SELECT * FROM kiosk_posts WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!existing) return res.status(404).json({ error: "Post not found" });
  const post = await readBody(req);
  if (!post.media_url && existing.media_url && !req.body?.remove_media) {
    post.media_url = existing.media_url;
    post.media_type = existing.media_type;
  }
  if (existing.media_url && post.media_url !== existing.media_url) await deleteMedia(existing.media_url);
  await q(
    `UPDATE kiosk_posts SET ${Object.keys(post).map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND institute_id = ?`,
    [...Object.values(post), req.params.id, req.institute.id],
  );
  await setKiosks(req.params.id, req.institute.id, req.body?.kiosk_ids);
  await logAudit(req, req.institute.id, "kiosk.post_update", "kiosk_posts", req.params.id, { title: post.title });
  res.json({ ok: true });
});

/** Quick Active / Inactive switch from the list. */
router.patch("/posts/:id/active", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const result = await q(
    "UPDATE kiosk_posts SET is_active = ? WHERE id = ? AND institute_id = ?",
    [req.body?.is_active ? 1 : 0, req.params.id, req.institute.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Post not found" });
  await logAudit(req, req.institute.id, "kiosk.post_toggle", "kiosk_posts", req.params.id, { is_active: !!req.body?.is_active });
  res.json({ ok: true });
});

router.delete("/posts/:id", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const existing = await one("SELECT * FROM kiosk_posts WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!existing) return res.status(404).json({ error: "Post not found" });
  await q("DELETE FROM kiosk_posts WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (existing.media_url) await deleteMedia(existing.media_url);
  await logAudit(req, req.institute.id, "kiosk.post_delete", "kiosk_posts", req.params.id, { title: existing.title });
  res.json({ ok: true });
});

export default router;

/**
 * Posts one kiosk should show right now, highest priority first:
 * 1. only content assigned to this kiosk (or to every kiosk)
 * 2. scheduled occasion posts that are running now
 * 3. regular daily posts
 */
export async function activePostsFor(instituteId, deviceId) {
  const rows = await q(
    `SELECT p.* FROM kiosk_posts p
     WHERE p.institute_id = ? AND p.is_active = 1
       AND (NOT EXISTS (SELECT 1 FROM kiosk_post_devices x WHERE x.post_id = p.id)
            OR EXISTS (SELECT 1 FROM kiosk_post_devices x
                        JOIN kiosk_devices d ON d.id = x.kiosk_id
                       WHERE x.post_id = p.id AND d.institute_id = p.institute_id AND d.device_id = ?))
     ORDER BY p.sort_order ASC, p.created_at DESC`,
    [instituteId, String(deviceId || "kiosk-1")],
  );
  const live = rows.filter((p) => postStatus(p) === "Active");
  const occasions = live.filter((p) => p.post_type === "occasion");
  const chosen = occasions.length ? occasions : live.filter((p) => p.post_type === "regular");
  return chosen.map((p) => ({
    id: p.id,
    title: p.title,
    body: p.body,
    category: p.category,
    post_type: p.post_type,
    media_type: p.media_type,
    media_url: p.media_url,
  }));
}
