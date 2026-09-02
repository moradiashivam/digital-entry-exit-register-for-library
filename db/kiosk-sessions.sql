-- Admin-approved kiosk devices.
-- A browser opening the kiosk link gets a cookie token. The token starts as
-- "pending" and can scan only after an admin approves it; approval lasts a
-- configurable number of days (45 by default) and can be extended or revoked.

CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  kiosk_id CHAR(36) NULL,
  device_id VARCHAR(80) NOT NULL,
  token CHAR(48) NOT NULL,
  code VARCHAR(12) NOT NULL,
  status ENUM('pending','approved','revoked') NOT NULL DEFAULT 'pending',
  label VARCHAR(160) NULL,
  user_agent VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  approved_by CHAR(36) NULL,
  approved_email VARCHAR(190) NULL,
  expires_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kiosk_session_token (token),
  KEY idx_kiosk_session_inst (institute_id, status),
  CONSTRAINT fk_ksess_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ksess_dev FOREIGN KEY (kiosk_id) REFERENCES kiosk_devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Who approved / extended / revoked which kiosk device, and when.
CREATE TABLE IF NOT EXISTS kiosk_session_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  action ENUM('requested','approved','extended','revoked','blocked') NOT NULL,
  admin_id CHAR(36) NULL,
  admin_email VARCHAR(190) NULL,
  days INT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ksess_ev (institute_id, created_at),
  CONSTRAINT fk_ksessev_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
