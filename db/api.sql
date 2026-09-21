-- Developer API: keys issued by a university admin, and the request log.
-- The full key is never stored — only its SHA-256 hash and a short prefix
-- so the admin can recognise a key in the list.

CREATE TABLE IF NOT EXISTS api_keys (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(24) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  scopes TEXT NULL,
  allow_pii TINYINT(1) NOT NULL DEFAULT 0,
  rate_limit_per_min INT NOT NULL DEFAULT 120,
  status ENUM('Active','Revoked') NOT NULL DEFAULT 'Active',
  expires_at DATE NULL,
  allowed_ips TEXT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  last_used_at DATETIME NULL,
  created_by VARCHAR(200) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  UNIQUE KEY uq_api_key_hash (key_hash),
  KEY idx_api_key_inst (institute_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS api_request_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NULL,
  api_key_id CHAR(36) NULL,
  key_prefix VARCHAR(24) NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL,
  status_code INT NOT NULL DEFAULT 200,
  duration_ms INT NOT NULL DEFAULT 0,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_api_log_inst (institute_id, created_at),
  KEY idx_api_log_key (api_key_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
