-- University Access Control
--   * Owner layer  : geographical restriction (country / state / city)
--   * Admin layer  : IP address restriction (single IPs, ranges, CIDR)
-- A university with no row here is completely unrestricted, so existing
-- installations keep working exactly as before.

CREATE TABLE IF NOT EXISTS institute_access_control (
  institute_id CHAR(36) PRIMARY KEY,
  geo_enabled TINYINT(1) NOT NULL DEFAULT 0,
  geo_countries TEXT NULL,
  geo_states TEXT NULL,
  geo_cities TEXT NULL,
  geo_note VARCHAR(255) NULL,
  geo_allow_private TINYINT(1) NOT NULL DEFAULT 1,
  geo_fail_open TINYINT(1) NOT NULL DEFAULT 1,
  ip_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ip_mode VARCHAR(20) NOT NULL DEFAULT 'all',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS institute_ip_rules (
  id CHAR(36) PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  label VARCHAR(120) NULL,
  value VARCHAR(120) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ip_rules_inst (institute_id)
);
