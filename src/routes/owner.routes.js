import { Router } from "express";
import { q, one, uuid, today } from "../db.js";
import { requireAuth, requireOwner, logAudit } from "../auth.js";
import { encrypt } from "../crypto.js";
import { sendMailWith } from "../mailer.js";
import { runExpiryJob } from "../jobs.js";
import { SEO_KEYS, SEO_PAGES, getSeoSettings, baseUrl, robotsTxt, sitemapXml, seoAudit, pageMeta } from "../seo.js";

const router = Router();
router.use(requireAuth, requireOwner);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const nullable = (v) => (v === undefined || v === "" ? null : v);

/* ------------------------------------------------------------------ *
 * 1. Owner dashboard — platform level aggregates only.                *
 * ------------------------------------------------------------------ */
router.get("/overview", async (req, res) => {
  const window = [7, 15, 30, 60, 90].includes(num(req.query.expiry_days)) ? num(req.query.expiry_days) : 30;

  const [counts] = await q(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'Active' AND subscription_end >= CURDATE()) AS active,
       SUM(status = 'Suspended') AS suspended,
       SUM(status = 'Deactivated') AS deactivated,
       SUM(subscription_end < CURDATE()) AS expired,
       SUM(subscription_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)) AS expiring,
       SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS new_week,
       SUM(YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())) AS new_month
     FROM institutes`,
    [window],
  );

  const [revenue] = await q(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'Success' THEN total_amount END), 0) AS all_time,
       COALESCE(SUM(CASE WHEN status = 'Success' AND YEAR(paid_at) = YEAR(CURDATE())
                          AND MONTH(paid_at) = MONTH(CURDATE()) THEN total_amount END), 0) AS this_month,
       COALESCE(SUM(CASE WHEN status = 'Success' AND paid_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
                          AND paid_at < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN total_amount END), 0) AS last_month,
       COALESCE(SUM(CASE WHEN status = 'Success' AND YEAR(paid_at) = YEAR(CURDATE()) THEN total_amount END), 0) AS this_year,
       COALESCE(SUM(CASE WHEN status = 'Success' AND YEAR(paid_at) = YEAR(CURDATE()) - 1 THEN total_amount END), 0) AS last_year,
       COALESCE(SUM(CASE WHEN status = 'Pending' THEN total_amount END), 0) AS pending_amount,
       SUM(status = 'Pending') AS pending_count,
       SUM(status = 'Pending' AND due_date IS NOT NULL AND due_date < CURDATE()) AS overdue_count,
       COALESCE(SUM(CASE WHEN status = 'Success' THEN tax_amount END), 0) AS tax_collected
     FROM payments`,
  );

  const [leads] = await q(
    `SELECT COUNT(*) AS total,
            SUM(stage = 'Converted') AS converted,
            SUM(stage = 'Lost') AS lost,
            SUM(stage NOT IN ('Converted','Lost')) AS open_leads,
            SUM(follow_up_on IS NOT NULL AND follow_up_on <= CURDATE() AND stage NOT IN ('Converted','Lost')) AS due_followups
     FROM leads`,
  );

  const planMix = await q(
    `SELECT COALESCE(p.name, 'No plan') AS name, COUNT(*) AS count
     FROM institutes i LEFT JOIN plans p ON p.id = i.plan_id
     GROUP BY COALESCE(p.name, 'No plan') ORDER BY count DESC`,
  );

  const signupTrend = await q(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS count
     FROM institutes WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
     GROUP BY month ORDER BY month`,
  );

  const revenueTrend = await q(
    `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, COALESCE(SUM(total_amount), 0) AS amount
     FROM payments WHERE status = 'Success' AND paid_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
     GROUP BY month ORDER BY month`,
  );

  const leadFunnel = await q(
    `SELECT stage AS name, COUNT(*) AS count FROM leads GROUP BY stage`,
  );

  const expiringList = await q(
    `SELECT i.id, i.name, i.contact_email, i.subscription_end, i.status,
            DATEDIFF(i.subscription_end, CURDATE()) AS days_left, p.name AS plan
     FROM institutes i LEFT JOIN plans p ON p.id = i.plan_id
     WHERE i.subscription_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ORDER BY i.subscription_end LIMIT 25`,
    [window],
  );

  const dues = await q(
    `SELECT pay.id, pay.invoice_no, pay.total_amount, pay.due_date, i.name AS institute
     FROM payments pay JOIN institutes i ON i.id = pay.institute_id
     WHERE pay.status = 'Pending' ORDER BY pay.due_date IS NULL, pay.due_date LIMIT 25`,
  );

  res.json({ window, counts, revenue, leads, planMix, signupTrend, revenueTrend, leadFunnel, expiringList, dues });
});

/* ------------------------------------------------------------------ *
 * 2. Plans                                                            *
 * ------------------------------------------------------------------ */
router.get("/plans", async (_req, res) => {
  res.json(await q(
    `SELECT p.*, (SELECT COUNT(*) FROM institutes i WHERE i.plan_id = p.id) AS institutes
     FROM plans p ORDER BY p.is_active DESC, p.price`,
  ));
});

router.post("/plans", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Plan name is required" });
  const id = uuid();
  await q(
    `INSERT INTO plans (id, name, price, billing_cycle, max_students, max_staff, storage_limit_gb, features, is_active)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, name, num(req.body?.price), ["Monthly", "Quarterly", "Yearly"].includes(req.body?.billing_cycle) ? req.body.billing_cycle : "Yearly",
     num(req.body?.max_students), num(req.body?.max_staff), num(req.body?.storage_limit_gb),
     nullable(req.body?.features), req.body?.is_active === false ? 0 : 1],
  );
  await logAudit(req, null, "plan.create", "plans", id, { name });
  res.status(201).json(await one("SELECT * FROM plans WHERE id = ?", [id]));
});

router.patch("/plans/:id", async (req, res) => {
  const plan = await one("SELECT * FROM plans WHERE id = ?", [req.params.id]);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  const fields = ["name", "price", "billing_cycle", "max_students", "max_staff", "storage_limit_gb", "features", "is_active"];
  const patch = {};
  for (const f of fields) if (req.body?.[f] !== undefined) patch[f] = f === "is_active" ? (req.body[f] ? 1 : 0) : req.body[f];
  if (!Object.keys(patch).length) return res.json(plan);
  await q(`UPDATE plans SET ${Object.keys(patch).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...Object.values(patch), plan.id]);
  await logAudit(req, null, "plan.update", "plans", plan.id, patch);
  res.json(await one("SELECT * FROM plans WHERE id = ?", [plan.id]));
});

router.delete("/plans/:id", async (req, res) => {
  await q("UPDATE plans SET is_active = 0 WHERE id = ?", [req.params.id]);
  await logAudit(req, null, "plan.retire", "plans", req.params.id, null);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * 3. Tenant (university) management — platform fields only.           *
 * ------------------------------------------------------------------ */
router.get("/tenants", async (req, res) => {
  const where = [];
  const args = [];
  const search = String(req.query.search || "").trim();
  if (search) {
    where.push("(i.name LIKE ? OR i.contact_email LIKE ? OR i.contact_phone LIKE ? OR i.code LIKE ? OR i.slug LIKE ?)");
    args.push(...Array(5).fill(`%${search}%`));
  }
  const status = String(req.query.status || "");
  if (status === "Expired") where.push("i.subscription_end < CURDATE()");
  else if (["Active", "Suspended", "Deactivated"].includes(status)) {
    where.push("i.status = ?");
    args.push(status);
  }
  if (req.query.plan_id) { where.push("i.plan_id = ?"); args.push(req.query.plan_id); }
  if (req.query.created_from) { where.push("DATE(i.created_at) >= ?"); args.push(req.query.created_from); }
  if (req.query.created_to) { where.push("DATE(i.created_at) <= ?"); args.push(req.query.created_to); }
  if (req.query.expiry_from) { where.push("i.subscription_end >= ?"); args.push(req.query.expiry_from); }
  if (req.query.expiry_to) { where.push("i.subscription_end <= ?"); args.push(req.query.expiry_to); }

  const page = Math.max(1, num(req.query.page, 1));
  const size = Math.min(100, Math.max(5, num(req.query.size, 20)));
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM institutes i ${clause}`, args);
  const rows = await q(
    `SELECT i.id, i.name, i.slug, i.code, i.contact_email, i.contact_phone, i.status, i.auto_renew,
            i.subscription_start, i.subscription_end, i.created_at, i.plan_id,
            p.name AS plan, p.price AS plan_price, p.billing_cycle,
            DATEDIFF(i.subscription_end, CURDATE()) AS days_left,
            (SELECT MAX(u.last_login_at) FROM user_roles r JOIN users u ON u.id = r.user_id
              WHERE r.institute_id = i.id) AS last_login,
            (SELECT COALESCE(SUM(total_amount),0) FROM payments pay
              WHERE pay.institute_id = i.id AND pay.status = 'Success') AS paid_total,
            (SELECT COALESCE(SUM(total_amount),0) FROM payments pay
              WHERE pay.institute_id = i.id AND pay.status = 'Pending') AS dues_total
     FROM institutes i LEFT JOIN plans p ON p.id = i.plan_id
     ${clause} ORDER BY i.name LIMIT ${size} OFFSET ${(page - 1) * size}`,
    args,
  );
  res.json({ rows, total, page, size });
});

router.get("/tenants/:id", async (req, res) => {
  const tenant = await one(
    `SELECT i.*, p.name AS plan, p.price AS plan_price, p.billing_cycle
     FROM institutes i LEFT JOIN plans p ON p.id = i.plan_id WHERE i.id = ?`,
    [req.params.id],
  );
  if (!tenant) return res.status(404).json({ error: "University not found" });
  res.json({
    tenant,
    history: await q(
      `SELECT h.*, p.name AS plan FROM subscription_history h LEFT JOIN plans p ON p.id = h.plan_id
       WHERE h.institute_id = ? ORDER BY h.created_at DESC LIMIT 50`,
      [tenant.id],
    ),
    payments: await q(
      "SELECT * FROM payments WHERE institute_id = ? ORDER BY created_at DESC LIMIT 50",
      [tenant.id],
    ),
    admins: await q(
      `SELECT u.email, u.full_name, u.status, u.last_login_at, r.role
       FROM user_roles r JOIN users u ON u.id = r.user_id WHERE r.institute_id = ?`,
      [tenant.id],
    ),
  });
});

router.patch("/tenants/:id/status", async (req, res) => {
  const status = req.body?.status;
  if (!["Active", "Suspended", "Deactivated"].includes(status)) {
    return res.status(400).json({ error: "Status must be Active, Suspended or Deactivated" });
  }
  const tenant = await one("SELECT id, name FROM institutes WHERE id = ?", [req.params.id]);
  if (!tenant) return res.status(404).json({ error: "University not found" });
  await q("UPDATE institutes SET status = ? WHERE id = ?", [status, tenant.id]);
  await q(
    `INSERT INTO subscription_history (id, institute_id, action, changed_by, note)
     VALUES (?,?,?,?,?)`,
    [uuid(), tenant.id, `status.${status.toLowerCase()}`, req.user.email, nullable(req.body?.reason)],
  );
  await logAudit(req, tenant.id, "institute.status", "institutes", tenant.id, { status });
  res.json({ ok: true, status });
});

/** Renew / upgrade / downgrade a subscription. */
router.post("/tenants/:id/subscription", async (req, res) => {
  const tenant = await one("SELECT * FROM institutes WHERE id = ?", [req.params.id]);
  if (!tenant) return res.status(404).json({ error: "University not found" });
  const planId = nullable(req.body?.plan_id);
  const plan = planId ? await one("SELECT * FROM plans WHERE id = ?", [planId]) : null;
  if (planId && !plan) return res.status(400).json({ error: "Plan not found" });

  const start = req.body?.subscription_start || tenant.subscription_start;
  let end = req.body?.subscription_end;
  if (!end) {
    const base = new Date(`${tenant.subscription_end >= today() ? tenant.subscription_end : today()}T00:00:00`);
    const months = plan?.billing_cycle === "Monthly" ? 1 : plan?.billing_cycle === "Quarterly" ? 3 : 12;
    base.setMonth(base.getMonth() + months);
    end = base.toISOString().slice(0, 10);
  }
  if (end <= start) return res.status(400).json({ error: "End date must be after the start date" });

  await q(
    `UPDATE institutes SET plan_id = ?, subscription_start = ?, subscription_end = ?, auto_renew = ?,
            status = CASE WHEN status = 'Deactivated' THEN status ELSE 'Active' END
     WHERE id = ?`,
    [planId ?? tenant.plan_id, start, end, req.body?.auto_renew ? 1 : 0, tenant.id],
  );
  await q(
    `INSERT INTO subscription_history (id, institute_id, plan_id, action, old_end_date, new_end_date, changed_by, note)
     VALUES (?,?,?,?,?,?,?,?)`,
    [uuid(), tenant.id, planId ?? tenant.plan_id, req.body?.action || "renew",
     tenant.subscription_end, end, req.user.email, nullable(req.body?.note)],
  );
  await logAudit(req, tenant.id, "institute.subscription", "institutes", tenant.id, { plan: plan?.name, end });
  res.json(await one("SELECT * FROM institutes WHERE id = ?", [tenant.id]));
});

/* ------------------------------------------------------------------ *
 * 4. Payments, invoices and accounting                                *
 * ------------------------------------------------------------------ */
const nextInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const [{ n }] = await q(
    "SELECT COUNT(*) + 1 AS n FROM payments WHERE invoice_no LIKE ?",
    [`INV-${year}-%`],
  );
  return `INV-${year}-${String(n).padStart(4, "0")}`;
};

router.get("/payments", async (req, res) => {
  const where = [];
  const args = [];
  if (req.query.institute_id) { where.push("pay.institute_id = ?"); args.push(req.query.institute_id); }
  if (req.query.status) { where.push("pay.status = ?"); args.push(req.query.status); }
  if (req.query.mode) { where.push("pay.payment_mode = ?"); args.push(req.query.mode); }
  if (req.query.from) { where.push("DATE(COALESCE(pay.paid_at, pay.created_at)) >= ?"); args.push(req.query.from); }
  if (req.query.to) { where.push("DATE(COALESCE(pay.paid_at, pay.created_at)) <= ?"); args.push(req.query.to); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await q(
    `SELECT pay.*, i.name AS institute, i.code AS institute_code, i.contact_email
     FROM payments pay JOIN institutes i ON i.id = pay.institute_id
     ${clause} ORDER BY COALESCE(pay.paid_at, pay.created_at) DESC LIMIT 500`,
    args,
  );
  const [totals] = await q(
    `SELECT COALESCE(SUM(CASE WHEN pay.status='Success' THEN pay.total_amount END),0) AS collected,
            COALESCE(SUM(CASE WHEN pay.status='Success' THEN pay.tax_amount END),0) AS tax,
            COALESCE(SUM(CASE WHEN pay.status='Pending' THEN pay.total_amount END),0) AS pending,
            COALESCE(SUM(CASE WHEN pay.status='Refunded' THEN pay.total_amount END),0) AS refunded
     FROM payments pay ${clause}`,
    args,
  );
  res.json({ rows, totals });
});

router.post("/payments", async (req, res) => {
  const institute = await one("SELECT id, name FROM institutes WHERE id = ?", [req.body?.institute_id]);
  if (!institute) return res.status(400).json({ error: "Choose a university" });
  const amount = num(req.body?.amount);
  const tax = num(req.body?.tax_amount);
  if (amount <= 0) return res.status(400).json({ error: "Amount must be greater than zero" });
  const status = ["Pending", "Success", "Failed", "Refunded"].includes(req.body?.status) ? req.body.status : "Success";
  const id = uuid();
  const invoiceNo = String(req.body?.invoice_no || "").trim() || (await nextInvoiceNo());
  await q(
    `INSERT INTO payments (id, institute_id, invoice_no, description, amount, tax_amount, total_amount,
       payment_mode, gateway_txn_id, status, due_date, paid_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, institute.id, invoiceNo, nullable(req.body?.description), amount, tax, amount + tax,
     ["Online", "Bank Transfer", "Cheque", "Cash", "UPI"].includes(req.body?.payment_mode) ? req.body.payment_mode : "Online",
     nullable(req.body?.gateway_txn_id), status, nullable(req.body?.due_date),
     status === "Success" ? (req.body?.paid_at || new Date().toISOString().slice(0, 19).replace("T", " ")) : null,
     req.user.email],
  );
  await logAudit(req, institute.id, "payment.create", "payments", id, { invoiceNo, amount: amount + tax, status });
  res.status(201).json(await one("SELECT * FROM payments WHERE id = ?", [id]));
});

router.patch("/payments/:id", async (req, res) => {
  const pay = await one("SELECT * FROM payments WHERE id = ?", [req.params.id]);
  if (!pay) return res.status(404).json({ error: "Payment not found" });
  if (pay.status === "Void") return res.status(400).json({ error: "Voided payments cannot be edited" });
  const status = req.body?.status;
  if (!["Pending", "Success", "Failed", "Refunded"].includes(status)) {
    return res.status(400).json({ error: "Invalid payment status" });
  }
  await q("UPDATE payments SET status = ?, paid_at = ? WHERE id = ?", [
    status,
    status === "Success" ? (pay.paid_at || new Date().toISOString().slice(0, 19).replace("T", " ")) : pay.paid_at,
    pay.id,
  ]);
  await logAudit(req, pay.institute_id, "payment.status", "payments", pay.id, { from: pay.status, to: status });
  res.json(await one("SELECT * FROM payments WHERE id = ?", [pay.id]));
});

/** Payments are never deleted — they are voided with a reason (audit safe). */
router.post("/payments/:id/void", async (req, res) => {
  const pay = await one("SELECT * FROM payments WHERE id = ?", [req.params.id]);
  if (!pay) return res.status(404).json({ error: "Payment not found" });
  await q("UPDATE payments SET status = 'Void', voided_at = NOW(), void_reason = ? WHERE id = ?", [
    String(req.body?.reason || "Voided by owner").slice(0, 255), pay.id,
  ]);
  await logAudit(req, pay.institute_id, "payment.void", "payments", pay.id, { reason: req.body?.reason });
  res.json({ ok: true });
});

router.get("/accounting/summary", async (req, res) => {
  const group = req.query.group === "day" ? "%Y-%m-%d" : req.query.group === "year" ? "%Y" : "%Y-%m";
  const from = req.query.from || "2000-01-01";
  const to = req.query.to || today();
  res.json({
    periods: await q(
      `SELECT DATE_FORMAT(paid_at, ?) AS period,
              COUNT(*) AS payments,
              COALESCE(SUM(amount),0) AS net,
              COALESCE(SUM(tax_amount),0) AS tax,
              COALESCE(SUM(total_amount),0) AS gross
       FROM payments WHERE status = 'Success' AND DATE(paid_at) BETWEEN ? AND ?
       GROUP BY period ORDER BY period DESC`,
      [group, from, to],
    ),
    outstanding: await q(
      `SELECT i.name AS institute, pay.invoice_no, pay.total_amount, pay.due_date,
              DATEDIFF(CURDATE(), pay.due_date) AS days_overdue
       FROM payments pay JOIN institutes i ON i.id = pay.institute_id
       WHERE pay.status = 'Pending' ORDER BY pay.due_date IS NULL, pay.due_date`,
    ),
    refunds: await q(
      `SELECT i.name AS institute, pay.invoice_no, pay.total_amount, pay.status, pay.void_reason,
              COALESCE(pay.voided_at, pay.updated_at) AS at
       FROM payments pay JOIN institutes i ON i.id = pay.institute_id
       WHERE pay.status IN ('Refunded','Void') ORDER BY at DESC`,
    ),
  });
});

/* ------------------------------------------------------------------ *
 * 5. Lead management (CRM)                                            *
 * ------------------------------------------------------------------ */
router.get("/leads", async (req, res) => {
  const where = [];
  const args = [];
  if (req.query.stage) { where.push("l.stage = ?"); args.push(req.query.stage); }
  if (req.query.source) { where.push("l.source = ?"); args.push(req.query.source); }
  if (req.query.assigned_to) { where.push("l.assigned_to = ?"); args.push(req.query.assigned_to); }
  if (req.query.search) {
    where.push("(l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.contact_person LIKE ?)");
    args.push(...Array(4).fill(`%${req.query.search}%`));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  res.json({
    rows: await q(
      `SELECT l.*, i.name AS converted_institute FROM leads l
       LEFT JOIN institutes i ON i.id = l.institute_id
       ${clause} ORDER BY l.updated_at DESC LIMIT 500`,
      args,
    ),
    byStage: await q("SELECT stage AS name, COUNT(*) AS count FROM leads GROUP BY stage"),
    bySource: await q("SELECT source AS name, COUNT(*) AS count FROM leads GROUP BY source"),
    byOwner: await q(
      `SELECT COALESCE(NULLIF(assigned_to, ''), 'Unassigned') AS name, COUNT(*) AS count,
              SUM(stage = 'Converted') AS converted
       FROM leads GROUP BY COALESCE(NULLIF(assigned_to, ''), 'Unassigned')`,
    ),
  });
});

router.post("/leads", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Lead name is required" });
  const id = uuid();
  await q(
    `INSERT INTO leads (id, name, contact_person, phone, email, city, source, stage, assigned_to, follow_up_on, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, nullable(req.body?.contact_person), nullable(req.body?.phone), nullable(req.body?.email),
     nullable(req.body?.city), req.body?.source || "Website", req.body?.stage || "New",
     nullable(req.body?.assigned_to), nullable(req.body?.follow_up_on), nullable(req.body?.notes)],
  );
  await q(`INSERT INTO lead_activities (id, lead_id, activity_type, note, created_by) VALUES (?,?,?,?,?)`,
    [uuid(), id, "created", `Lead created (${req.body?.source || "Website"})`, req.user.email]);
  await logAudit(req, null, "lead.create", "leads", id, { name });
  res.status(201).json(await one("SELECT * FROM leads WHERE id = ?", [id]));
});

router.patch("/leads/:id", async (req, res) => {
  const lead = await one("SELECT * FROM leads WHERE id = ?", [req.params.id]);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const fields = ["name", "contact_person", "phone", "email", "city", "source", "stage", "assigned_to", "follow_up_on", "notes"];
  const patch = {};
  for (const f of fields) if (req.body?.[f] !== undefined) patch[f] = nullable(req.body[f]);
  if (!Object.keys(patch).length) return res.json(lead);
  await q(`UPDATE leads SET ${Object.keys(patch).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...Object.values(patch), lead.id]);
  if (patch.stage && patch.stage !== lead.stage) {
    await q(`INSERT INTO lead_activities (id, lead_id, activity_type, note, created_by) VALUES (?,?,?,?,?)`,
      [uuid(), lead.id, "stage", `${lead.stage} → ${patch.stage}`, req.user.email]);
  }
  await logAudit(req, null, "lead.update", "leads", lead.id, patch);
  res.json(await one("SELECT * FROM leads WHERE id = ?", [lead.id]));
});

router.get("/leads/:id/activities", async (req, res) => {
  res.json(await q("SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC", [req.params.id]));
});

router.post("/leads/:id/activities", async (req, res) => {
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "Write a short note" });
  await q(`INSERT INTO lead_activities (id, lead_id, activity_type, note, created_by) VALUES (?,?,?,?,?)`,
    [uuid(), req.params.id, req.body?.activity_type || "note", note, req.user.email]);
  if (req.body?.follow_up_on !== undefined) {
    await q("UPDATE leads SET follow_up_on = ? WHERE id = ?", [nullable(req.body.follow_up_on), req.params.id]);
  }
  res.status(201).json({ ok: true });
});

/** Link a lead to the university it became, so source-wise ROI is traceable. */
router.post("/leads/:id/convert", async (req, res) => {
  const lead = await one("SELECT * FROM leads WHERE id = ?", [req.params.id]);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const inst = await one("SELECT id, name FROM institutes WHERE id = ?", [req.body?.institute_id]);
  if (!inst) return res.status(400).json({ error: "Choose the university this lead became" });
  await q("UPDATE leads SET stage = 'Converted', institute_id = ? WHERE id = ?", [inst.id, lead.id]);
  await q("UPDATE institutes SET lead_id = ? WHERE id = ?", [lead.id, inst.id]);
  await q(`INSERT INTO lead_activities (id, lead_id, activity_type, note, created_by) VALUES (?,?,?,?,?)`,
    [uuid(), lead.id, "converted", `Converted to ${inst.name}`, req.user.email]);
  await logAudit(req, inst.id, "lead.convert", "leads", lead.id, { institute: inst.name });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * 5b. SEO — search engine visibility for the public marketing site.   *
 * ------------------------------------------------------------------ */
router.get("/seo", async (req, res) => {
  const settings = await getSeoSettings();
  const base = baseUrl(settings, req);
  res.json({
    settings,
    base,
    pages: Object.entries(SEO_PAGES).map(([key, p]) => ({
      key, label: p.label, path: p.path, url: base + p.path, ...pageMeta(key, settings),
    })),
    robots: robotsTxt(settings, base),
    sitemap: sitemapXml(settings, base),
    audit: seoAudit(settings, base),
  });
});

/* ------------------------------------------------------------------ *
 * 6. Platform settings, SMTP and the expiry job                       *
 * ------------------------------------------------------------------ */
router.get("/settings", async (_req, res) => {
  const rows = await q("SELECT setting_key, setting_value FROM platform_settings");
  const smtp = await q(
    `SELECT id, label, host, port, username, encryption_type, from_name, from_email, reply_to,
            is_default, is_fallback, (password_encrypted IS NOT NULL) AS has_password
     FROM smtp_settings WHERE institute_id IS NULL ORDER BY is_default DESC`,
  );
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])), smtp });
});

router.put("/settings", async (req, res) => {
  const allowed = ["grace_days", "company_name", "company_address", "gst_number", "currency", "invoice_footer",
    "platform_name", "site_brand", "site_tagline", "site_contact_email", "site_contact_phone",
    "site_contact_address", "site_custom_enabled", "site_home_html", "site_home_css",
    "site_contact_html", "site_contact_css", ...SEO_KEYS];
  for (const key of allowed) {
    if (req.body?.[key] === undefined) continue;
    await q(
      `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?,?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, String(req.body[key])],
    );
  }
  await logAudit(req, null, "platform.settings", "platform_settings", null, req.body);
  res.json({ ok: true });
});

const smtpBody = (body, existing) => ({
  label: String(body?.label || existing?.label || "Primary").slice(0, 80),
  host: String(body?.host || "").trim(),
  port: num(body?.port, 587),
  username: nullable(body?.username),
  encryption_type: ["none", "tls", "ssl"].includes(body?.encryption_type) ? body.encryption_type : "tls",
  from_name: String(body?.from_name || "Library Register").slice(0, 120),
  from_email: String(body?.from_email || "").trim(),
  reply_to: nullable(body?.reply_to),
  is_fallback: body?.is_fallback ? 1 : 0,
});

router.put("/smtp", async (req, res) => {
  const existing = req.body?.id ? await one("SELECT * FROM smtp_settings WHERE id = ?", [req.body.id]) : null;
  const cfg = smtpBody(req.body, existing);
  if (!cfg.host || !cfg.from_email) return res.status(400).json({ error: "SMTP host and From email are required" });
  const password = req.body?.password ? encrypt(req.body.password) : existing?.password_encrypted ?? null;
  const id = existing?.id || uuid();

  if (existing) {
    await q(
      `UPDATE smtp_settings SET label=?, host=?, port=?, username=?, password_encrypted=?, encryption_type=?,
              from_name=?, from_email=?, reply_to=?, is_fallback=? WHERE id = ?`,
      [cfg.label, cfg.host, cfg.port, cfg.username, password, cfg.encryption_type,
       cfg.from_name, cfg.from_email, cfg.reply_to, cfg.is_fallback, id],
    );
  } else {
    await q(
      `INSERT INTO smtp_settings (id, label, host, port, username, password_encrypted, encryption_type,
         from_name, from_email, reply_to, is_default, is_fallback)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, cfg.label, cfg.host, cfg.port, cfg.username, password, cfg.encryption_type,
       cfg.from_name, cfg.from_email, cfg.reply_to, cfg.is_fallback ? 0 : 1, cfg.is_fallback],
    );
  }
  if (!cfg.is_fallback) {
    await q("UPDATE smtp_settings SET is_default = (id = ?) WHERE institute_id IS NULL AND is_fallback = 0", [id]);
  }
  await logAudit(req, null, "platform.smtp", "smtp_settings", id, { host: cfg.host, from: cfg.from_email });
  res.json({ ok: true, id });
});

router.delete("/smtp/:id", async (req, res) => {
  await q("DELETE FROM smtp_settings WHERE id = ?", [req.params.id]);
  await logAudit(req, null, "platform.smtp_delete", "smtp_settings", req.params.id, null);
  res.json({ ok: true });
});

router.post("/smtp/test", async (req, res) => {
  const to = String(req.body?.to || req.user.email).trim();
  const existing = req.body?.id ? await one("SELECT * FROM smtp_settings WHERE id = ?", [req.body.id]) : null;
  const cfg = { ...smtpBody(req.body, existing), password_encrypted: req.body?.password ? encrypt(req.body.password) : existing?.password_encrypted };
  if (!cfg.host || !cfg.from_email) return res.status(400).json({ error: "Fill in the SMTP host and From email first" });
  try {
    await sendMailWith(cfg, {
      to,
      subject: "SMTP test — Library Entry & Exit Register",
      text: `This is a test email sent from your platform SMTP profile "${cfg.label}". If you received it, password resets and reminders will work.`,
    });
    res.json({ ok: true, to });
  } catch (e) {
    res.status(400).json({ error: `Test email failed: ${e.message}` });
  }
});

router.post("/jobs/expiry", async (req, res) => {
  const result = await runExpiryJob();
  await logAudit(req, null, "platform.expiry_job", null, null, result);
  res.json(result);
});

/** Owner-level audit trail (platform actions only). */
router.get("/audit", async (_req, res) => {
  res.json(await q(
    `SELECT a.*, i.name AS institute FROM audit_logs a LEFT JOIN institutes i ON i.id = a.institute_id
     ORDER BY a.created_at DESC LIMIT 300`,
  ));
});

export default router;
