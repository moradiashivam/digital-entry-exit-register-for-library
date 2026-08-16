-- ============================================================
-- Library Entry & Exit Register — Consolidated MySQL 8 schema
-- Multi-tenant (Owner + University Admin + Kiosk) in one file.
-- Fresh install:  mysql -u root -p < db/database.sql
--   (or let scripts/setup-db.js apply it via npm run setup)
-- Safe to re-run — every statement is CREATE TABLE IF NOT EXISTS.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. Tenancy
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institutes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  code VARCHAR(40) NULL,
  name VARCHAR(200) NOT NULL,
  contact_email VARCHAR(200) NULL,
  contact_phone VARCHAR(40) NULL,
  address TEXT NULL,
  plan_id CHAR(36) NULL,
  status ENUM('Active','Suspended','Deactivated') NOT NULL DEFAULT 'Active',
  auto_renew TINYINT(1) NOT NULL DEFAULT 0,
  lead_id CHAR(36) NULL,
  subscription_start DATE NOT NULL,
  subscription_end DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS institute_secrets (
  institute_id CHAR(36) NOT NULL PRIMARY KEY,
  kiosk_key CHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_secret_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 2. Users & roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  full_name VARCHAR(200) NOT NULL DEFAULT '',
  status ENUM('Active','Disabled') NOT NULL DEFAULT 'Active',
  is_platform_owner TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  institute_id CHAR(36) NULL,
  role ENUM('super_admin','librarian','report_viewer') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (user_id, institute_id, role),
  CONSTRAINT fk_role_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_resets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reset_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 3. Master data (per institute)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_course (institute_id, name),
  CONSTRAINT fk_course_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS departments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_department (institute_id, name),
  CONSTRAINT fk_dept_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS academic_years (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  name VARCHAR(60) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_year (institute_id, name),
  CONSTRAINT fk_year_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 4. Members & biometrics
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  member_code VARCHAR(60) NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  course_id CHAR(36) NULL,
  department_id CHAR(36) NULL,
  academic_year_id CHAR(36) NULL,
  gender ENUM('Male','Female','Other') NOT NULL DEFAULT 'Other',
  mobile VARCHAR(10) NOT NULL,
  email VARCHAR(200) NOT NULL,
  photo_url TEXT NULL,
  rfid_uid VARCHAR(64) NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  status ENUM('Active','Inactive','Expired','Blocked') NOT NULL DEFAULT 'Active',
  source ENUM('manual','excel_import','sip2_sync') NOT NULL DEFAULT 'manual',
  external_ref VARCHAR(120) NULL,
  consent_given TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_member_code (institute_id, member_code),
  UNIQUE KEY uq_member_rfid (institute_id, rfid_uid),
  KEY idx_member_name (institute_id, full_name),
  CONSTRAINT fk_member_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE,
  CONSTRAINT fk_member_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  CONSTRAINT fk_member_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_member_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS palm_templates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  member_id CHAR(36) NOT NULL,
  hand_type ENUM('Left','Right') NOT NULL DEFAULT 'Right',
  template_hash TEXT NOT NULL,
  quality_score INT NULL,
  device_id VARCHAR(80) NULL,
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_palm_member (member_id),
  CONSTRAINT fk_palm_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE,
  CONSTRAINT fk_palm_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 5. Entry / exit logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entry_exit_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  member_id CHAR(36) NOT NULL,
  action ENUM('Entry','Exit') NOT NULL,
  method VARCHAR(20) NOT NULL DEFAULT 'Palm',
  device_id VARCHAR(80) NOT NULL DEFAULT 'kiosk-1',
  matched_confidence DECIMAL(5,2) NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_log_time (institute_id, occurred_at),
  KEY idx_log_member (member_id, occurred_at),
  CONSTRAINT fk_log_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE,
  CONSTRAINT fk_log_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS failed_scan_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  device_id VARCHAR(80) NOT NULL DEFAULT 'kiosk-1',
  attempted_code VARCHAR(120) NULL,
  reason VARCHAR(200) NOT NULL,
  method VARCHAR(20) NOT NULL DEFAULT 'Palm',
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_failed_time (institute_id, occurred_at),
  CONSTRAINT fk_failed_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 6. Audit & import logs (append-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NULL,
  admin_id CHAR(36) NULL,
  admin_email VARCHAR(200) NULL,
  action VARCHAR(120) NOT NULL,
  target_table VARCHAR(80) NULL,
  target_id VARCHAR(80) NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_time (institute_id, created_at),
  CONSTRAINT fk_audit_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bulk_import_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NULL,
  admin_id CHAR(36) NULL,
  admin_email VARCHAR(200) NULL,
  file_name VARCHAR(255) NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_import_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 7. Kiosk settings & branding
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kiosk_settings (
  institute_id CHAR(36) NOT NULL PRIMARY KEY,
  institution_name VARCHAR(200) NOT NULL DEFAULT 'University Library',
  kiosk_title VARCHAR(200) NOT NULL DEFAULT 'Library Entry Kiosk',
  logo_url TEXT NULL,
  welcome_message VARCHAR(255) NOT NULL DEFAULT 'Place your palm on the scanner',
  entry_label VARCHAR(60) NOT NULL DEFAULT 'Entry',
  exit_label VARCHAR(60) NOT NULL DEFAULT 'Exit',
  footer_note VARCHAR(255) NOT NULL DEFAULT 'Failed attempts are logged for review at the admin desk.',
  allow_palm TINYINT(1) NOT NULL DEFAULT 1,
  allow_rfid TINYINT(1) NOT NULL DEFAULT 1,
  allow_manual TINYINT(1) NOT NULL DEFAULT 1,
  show_photo TINYINT(1) NOT NULL DEFAULT 1,
  show_clock TINYINT(1) NOT NULL DEFAULT 1,
  result_seconds INT NOT NULL DEFAULT 7,
  theme ENUM('dark','light') NOT NULL DEFAULT 'light',
  custom_css TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_kiosk_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 8. Platform owner — plans, billing, CRM, SMTP
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  billing_cycle ENUM('Monthly','Quarterly','Yearly') NOT NULL DEFAULT 'Yearly',
  max_students INT NOT NULL DEFAULT 0,
  max_staff INT NOT NULL DEFAULT 0,
  storage_limit_gb INT NOT NULL DEFAULT 0,
  features TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_history (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NULL,
  action VARCHAR(40) NOT NULL,
  old_end_date DATE NULL,
  new_end_date DATE NULL,
  changed_by VARCHAR(200) NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_subhist_inst (institute_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  invoice_no VARCHAR(40) NOT NULL UNIQUE,
  description VARCHAR(200) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_mode ENUM('Online','Bank Transfer','Cheque','Cash','UPI') NOT NULL DEFAULT 'Online',
  gateway_txn_id VARCHAR(120) NULL,
  status ENUM('Pending','Success','Failed','Refunded','Void') NOT NULL DEFAULT 'Pending',
  due_date DATE NULL,
  paid_at DATETIME NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(255) NULL,
  created_by VARCHAR(200) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pay_inst (institute_id, created_at),
  KEY idx_pay_status (status, paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leads (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(150) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(200) NULL,
  city VARCHAR(120) NULL,
  source ENUM('Website','Referral','Cold Call','Social Media','Event','Other') NOT NULL DEFAULT 'Website',
  stage ENUM('New','Contacted','Demo Scheduled','Negotiation','Converted','Lost') NOT NULL DEFAULT 'New',
  assigned_to VARCHAR(200) NULL,
  follow_up_on DATE NULL,
  notes TEXT NULL,
  institute_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lead_stage (stage, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lead_activities (
  id CHAR(36) NOT NULL PRIMARY KEY,
  lead_id CHAR(36) NOT NULL,
  activity_type VARCHAR(60) NOT NULL DEFAULT 'note',
  note TEXT NULL,
  created_by VARCHAR(200) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_leadact (lead_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS smtp_settings (
  id CHAR(36) NOT NULL PRIMARY KEY,
  label VARCHAR(80) NOT NULL DEFAULT 'Primary',
  host VARCHAR(200) NOT NULL,
  port INT NOT NULL DEFAULT 587,
  username VARCHAR(200) NULL,
  password_encrypted TEXT NULL,
  encryption_type ENUM('none','tls','ssl') NOT NULL DEFAULT 'tls',
  from_name VARCHAR(120) NOT NULL DEFAULT 'Library Register',
  from_email VARCHAR(200) NOT NULL,
  reply_to VARCHAR(200) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 1,
  is_fallback TINYINT(1) NOT NULL DEFAULT 0,
  institute_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
  setting_value TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- 9. Default platform settings
-- ------------------------------------------------------------
INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES
  ('grace_days', '5'),
  ('default_theme', 'light'),
  ('platform_name', 'Library Entry & Exit Register');
