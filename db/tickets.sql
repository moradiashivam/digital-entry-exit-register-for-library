-- Role-based support ticketing & chat system.
-- Flows:
--   University admin / main librarian -> owner          (kind 'standard')
--   Sub-library user -> main librarian -> owner         (kind 'general')
--   Sub-library user -> main librarian only             (kind 'rights')

CREATE TABLE IF NOT EXISTS tickets (
  id CHAR(36) PRIMARY KEY,
  ticket_no VARCHAR(24) NULL,
  institute_id CHAR(36) NOT NULL,
  created_by CHAR(36) NOT NULL,
  creator_email VARCHAR(190) NULL,
  creator_name VARCHAR(190) NULL,
  creator_role ENUM('admin','librarian','sub') NOT NULL DEFAULT 'sub',
  kind ENUM('standard','general','rights') NOT NULL DEFAULT 'standard',
  subject VARCHAR(200) NOT NULL,
  body TEXT NULL,
  priority ENUM('Low','Normal','High') NOT NULL DEFAULT 'Normal',
  status VARCHAR(40) NOT NULL DEFAULT 'Pending',
  stage ENUM('librarian','owner','closed') NOT NULL DEFAULT 'owner',
  visible_to_owner TINYINT(1) NOT NULL DEFAULT 0,
  librarian_note TEXT NULL,
  librarian_acted_at DATETIME NULL,
  owner_response TEXT NULL,
  owner_responded_at DATETIME NULL,
  auto_accept_at DATETIME NULL,
  accepted_at DATETIME NULL,
  accepted_by VARCHAR(190) NULL,
  acceptance_type ENUM('MANUAL','AUTO_5_DAYS') NULL,
  last_message_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (institute_id),
  INDEX (created_by),
  INDEX (status),
  INDEX (ticket_no),
  INDEX (visible_to_owner)
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  sender_user_id CHAR(36) NULL,
  sender_role VARCHAR(40) NULL,
  sender_name VARCHAR(190) NULL,
  message TEXT NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (ticket_id)
);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  message_id CHAR(36) NULL,
  file_name VARCHAR(200) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size_bytes INT NOT NULL DEFAULT 0,
  url VARCHAR(300) NOT NULL,
  file_path VARCHAR(400) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (ticket_id)
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  actor_email VARCHAR(190) NULL,
  actor_role VARCHAR(40) NULL,
  action VARCHAR(60) NOT NULL,
  old_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (ticket_id)
);
