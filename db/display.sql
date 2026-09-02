-- Kiosk Library Activities & Services display (idle screen content).
-- Executed on every boot (CREATE TABLE IF NOT EXISTS), so upgrades are automatic.

CREATE TABLE IF NOT EXISTS kiosk_posts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institute_id CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body TEXT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'General',
  post_type ENUM('regular','occasion') NOT NULL DEFAULT 'regular',
  media_type ENUM('none','image','video') NOT NULL DEFAULT 'none',
  media_url VARCHAR(400) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_kioskpost_inst (institute_id, post_type, is_active),
  CONSTRAINT fk_kioskpost_inst FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- No rows for a post = the post is shown on every kiosk of the university.
CREATE TABLE IF NOT EXISTS kiosk_post_devices (
  post_id CHAR(36) NOT NULL,
  kiosk_id CHAR(36) NOT NULL,
  PRIMARY KEY (post_id, kiosk_id),
  CONSTRAINT fk_kioskpostdev_post FOREIGN KEY (post_id) REFERENCES kiosk_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_kioskpostdev_dev FOREIGN KEY (kiosk_id) REFERENCES kiosk_devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
