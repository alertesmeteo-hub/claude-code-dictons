CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  plan VARCHAR(20) NOT NULL DEFAULT 'free',
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE api_keys (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  prefix CHAR(8) NOT NULL UNIQUE,
  key_hash CHAR(64) NOT NULL,
  revoked_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Compteurs agreges : pas de log par requete, pas d'IP, pas de coordonnees (RGPD).
-- bucket : 'm202609201530' (minute), 'd20260920' (jour), 'M202609' (mois)
CREATE TABLE usage_counters (
  key_id INT UNSIGNED NOT NULL,
  bucket CHAR(13) NOT NULL,
  endpoint VARCHAR(40) NOT NULL DEFAULT '*',
  hits INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, bucket, endpoint)
) ENGINE=InnoDB;

CREATE TABLE plans (
  code VARCHAR(20) PRIMARY KEY,
  per_minute INT UNSIGNED NOT NULL,
  per_month INT UNSIGNED NOT NULL
) ENGINE=InnoDB;
INSERT INTO plans VALUES ('free', 30, 10000);

CREATE TABLE signup_throttle (
  ip_hash CHAR(64) NOT NULL,
  day CHAR(8) NOT NULL,
  n INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
) ENGINE=InnoDB;

-- Extremes du jour par station (collecteur cron/collect_extremes.php)
CREATE TABLE station_daily (
  day DATE NOT NULL,
  station_id CHAR(8) NOT NULL,
  name VARCHAR(80) NOT NULL,
  department CHAR(2) NOT NULL,
  altitude_m SMALLINT NOT NULL,
  principal TINYINT(1) NOT NULL,
  tmax DECIMAL(4,1) NULL,
  tmax_at DATETIME NULL,      -- UTC
  tmin DECIMAL(4,1) NULL,
  tmin_at DATETIME NULL,      -- UTC
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (day, station_id),
  KEY idx_alt (day, altitude_m)
) ENGINE=InnoDB;

CREATE TABLE collector_runs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  status ENUM('ok','error') NOT NULL,
  message VARCHAR(255) NOT NULL,
  departments_ok SMALLINT NOT NULL DEFAULT 0,
  departments_total SMALLINT NOT NULL DEFAULT 0,
  finished_at DATETIME NOT NULL,
  KEY idx_name (name, finished_at)
) ENGINE=InnoDB;

-- Demandes de cle : validation manuelle (cron/admin.php)
CREATE TABLE key_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  organization VARCHAR(100) NULL,
  email VARCHAR(190) NOT NULL,
  website VARCHAR(190) NULL,
  usage_description TEXT NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  KEY idx_status (status, created_at)
) ENGINE=InnoDB;

-- Vigilance : instantane unique remplace a chaque nouveau produit (cron/collect_vigilance.php)
CREATE TABLE vigilance_snapshot (
  id TINYINT UNSIGNED PRIMARY KEY,
  product_datetime DATETIME NOT NULL,   -- UTC, date du produit source
  fetched_at DATETIME NOT NULL          -- UTC, derniere verification reussie
) ENGINE=InnoDB;

CREATE TABLE vigilance_items (
  echeance VARCHAR(4) NOT NULL,         -- J, J1
  domain_id VARCHAR(4) NOT NULL,        -- departement (2 car.) ou zone cotiere (departement + 10)
  phenomenon_id TINYINT UNSIGNED NOT NULL,
  color_id TINYINT UNSIGNED NOT NULL,   -- 1 vert, 2 jaune, 3 orange, 4 rouge
  begin_time DATETIME NOT NULL,         -- UTC
  end_time DATETIME NOT NULL,           -- UTC
  KEY idx_domain (domain_id, echeance),
  KEY idx_color (color_id)
) ENGINE=InnoDB;
