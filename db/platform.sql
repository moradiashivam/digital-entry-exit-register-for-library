-- Platform (Owner) tables: plans, billing, CRM, settings.
-- Safe to run repeatedly — every statement is IF NOT EXISTS.

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

CREATE TABLE IF NOT EXISTS password_resets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reset_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
  setting_value TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
