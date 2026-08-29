-- Library Entry & Exit Register — MySQL 8 schema
-- Multi-tenant: every operational row carries institute_id.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS institutes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  contact_email VARCHAR(200) NULL,
  contact_phone VARCHAR(40) NULL,
  address TEXT NULL,
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

CREATE TABLE IF NOT EXISTS members (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  member_code VARCHAR(60) NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  course_id CHAR(36) NULL,
  department_id CHAR(36) NULL,
  academic_year_id CHAR(36) NULL,
  gender ENUM('Male','Female','Other') NOT NULL DEFAULT 'Other',
  designation VARCHAR(60) NOT NULL DEFAULT 'Student',
  mobile VARCHAR(10) NULL,
  email VARCHAR(200) NULL,
  photo_url TEXT NULL,
  rfid_uid VARCHAR(64) NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  status ENUM('Active','Inactive','Expired','Blocked') NOT NULL DEFAULT 'Active',
  source ENUM('manual','excel_import','sip2_sync') NOT NULL DEFAULT 'manual',
  external_ref VARCHAR(120) NULL,
  consent_given TINYINT(1) NOT NULL DEFAULT 0,
  import_batch_id CHAR(36) NULL,
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
  KEY idx_log_action_time (institute_id, action, occurred_at),
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
  duplicate_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_import_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  allow_barcode TINYINT(1) NOT NULL DEFAULT 1,
  show_photo TINYINT(1) NOT NULL DEFAULT 1,
  show_clock TINYINT(1) NOT NULL DEFAULT 1,
  result_seconds INT NOT NULL DEFAULT 7,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  theme ENUM('dark','light') NOT NULL DEFAULT 'light',
  custom_css TEXT NULL,
  kiosk_template VARCHAR(40) NOT NULL DEFAULT 'classic',
  allow_face TINYINT(1) NOT NULL DEFAULT 0,
  face_threshold DECIMAL(4,2) NOT NULL DEFAULT 0.55,
  face_model_url VARCHAR(255) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_kiosk_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Named kiosks / terminals of one university. device_id is what the kiosk sends
-- with every scan; name is the friendly label shown in reports and on screen.
CREATE TABLE IF NOT EXISTS kiosk_devices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  device_id VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  location VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kiosk_device (institute_id, device_id),
  CONSTRAINT fk_kioskdev_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



-- Facial recognition: one 128-number descriptor per member (face-api.js / dlib).
CREATE TABLE IF NOT EXISTS face_templates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  member_id CHAR(36) NOT NULL,
  descriptor TEXT NOT NULL,
  source ENUM('photo','camera') NOT NULL DEFAULT 'photo',
  quality DECIMAL(5,3) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_face_member (member_id),
  KEY idx_face_inst (institute_id),
  CONSTRAINT fk_face_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE,
  CONSTRAINT fk_face_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS library_hours (
  institute_id CHAR(36) NOT NULL,
  weekday TINYINT NOT NULL,               -- 0 = Sunday … 6 = Saturday
  is_closed TINYINT(1) NOT NULL DEFAULT 0,
  open_time TIME NOT NULL DEFAULT '09:00:00',
  close_time TIME NOT NULL DEFAULT '18:00:00',
  auto_exit TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (institute_id, weekday),
  CONSTRAINT fk_hours_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
