-- Master Setting: sublibraries, sublibrary users and their scoped permissions.
-- Executed on every boot (CREATE TABLE IF NOT EXISTS), so upgrades are automatic.

CREATE TABLE IF NOT EXISTS sublibraries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(40) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sublibrary (institute_id, name),
  CONSTRAINT fk_sublib_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per (user, university): the permission envelope of a sublibrary user.
CREATE TABLE IF NOT EXISTS user_access (
  user_id CHAR(36) NOT NULL,
  institute_id CHAR(36) NOT NULL,
  viewer_only TINYINT(1) NOT NULL DEFAULT 0,
  allow_bulk_upload TINYINT(1) NOT NULL DEFAULT 0,
  allow_export TINYINT(1) NOT NULL DEFAULT 0,
  modules TEXT NULL,                       -- JSON array of module keys
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, institute_id),
  CONSTRAINT fk_uaccess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uaccess_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_sublibraries (
  user_id CHAR(36) NOT NULL,
  institute_id CHAR(36) NOT NULL,
  sublibrary_id CHAR(36) NOT NULL,
  PRIMARY KEY (user_id, sublibrary_id),
  CONSTRAINT fk_usublib_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_usublib_lib FOREIGN KEY (sublibrary_id) REFERENCES sublibraries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_locations (
  user_id CHAR(36) NOT NULL,
  institute_id CHAR(36) NOT NULL,
  location VARCHAR(120) NOT NULL,
  PRIMARY KEY (user_id, institute_id, location),
  CONSTRAINT fk_uloc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uloc_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_kiosks (
  user_id CHAR(36) NOT NULL,
  institute_id CHAR(36) NOT NULL,
  kiosk_id CHAR(36) NOT NULL,
  PRIMARY KEY (user_id, kiosk_id),
  CONSTRAINT fk_ukiosk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ukiosk_dev FOREIGN KEY (kiosk_id) REFERENCES kiosk_devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Calendar overrides: holidays, closed days or custom timings for one date.
CREATE TABLE IF NOT EXISTS library_special_days (
  institute_id CHAR(36) NOT NULL,
  day DATE NOT NULL,
  is_closed TINYINT(1) NOT NULL DEFAULT 1,
  open_time TIME NOT NULL DEFAULT '09:00:00',
  close_time TIME NOT NULL DEFAULT '18:00:00',
  auto_exit TINYINT(1) NOT NULL DEFAULT 1,
  reason VARCHAR(160) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (institute_id, day),
  CONSTRAINT fk_specialday_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- PDF export branding: optional header / footer used only by report PDF exports.
CREATE TABLE IF NOT EXISTS pdf_branding (
  institute_id CHAR(36) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  header_type ENUM('none','html','image') NOT NULL DEFAULT 'none',
  header_content LONGTEXT NULL,
  header_height_mm INT NOT NULL DEFAULT 25,
  footer_type ENUM('none','html','image') NOT NULL DEFAULT 'none',
  footer_content LONGTEXT NULL,
  footer_height_mm INT NOT NULL DEFAULT 18,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (institute_id),
  CONSTRAINT fk_pdfbrand_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
