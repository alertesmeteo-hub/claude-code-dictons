-- À exécuter UNE FOIS dans phpMyAdmin sur la base bijouxdealertes
-- (Manager OVH > Bases de données > bijouxdealertes > "..." > Accéder à phpMyAdmin > onglet SQL)
-- Tables dédiées à dicton-du-jour.alertes-meteo.com, séparées de dictionnaire_termes (plugin météo existant).

CREATE TABLE IF NOT EXISTS saints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mois TINYINT NOT NULL,
  jour TINYINT NOT NULL,
  nom_principal VARCHAR(100) NOT NULL,
  presentation_historique TEXT NULL,
  autres_prenoms VARCHAR(255) NULL,
  patronage TEXT NULL,
  traditions TEXT NULL,
  source VARCHAR(255) NOT NULL,
  verifie TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_jour (mois, jour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dictons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  texte TEXT NOT NULL,
  type ENUM('dicton','proverbe','dicton_meteo','dicton_paysan','adage') NOT NULL,
  mois TINYINT NULL,
  jour TINYINT NULL,
  source VARCHAR(255) NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mois_jour (mois, jour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS villes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(150) NOT NULL,
  code_postal VARCHAR(10) NULL,
  departement VARCHAR(100) NULL,
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  slug VARCHAR(160) NOT NULL UNIQUE,
  INDEX idx_nom (nom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stations_meteo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code_station VARCHAR(20) NOT NULL UNIQUE,
  nom_commune VARCHAR(150) NOT NULL,
  departement VARCHAR(100) NOT NULL,
  altitude_m INT NOT NULL,
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS temperatures_extremes_jour (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  station_id INT NOT NULL,
  type ENUM('maxi','mini') NOT NULL,
  valeur_c DECIMAL(4,1) NOT NULL,
  heure_mesure TIME NULL,
  source VARCHAR(255) NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_station_date_type (station_id, date, type),
  CONSTRAINT fk_temp_station FOREIGN KEY (station_id) REFERENCES stations_meteo(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pages_jour (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  saint_id INT NULL,
  dictons_ids JSON NULL,
  republiee_le TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_page_saint FOREIGN KEY (saint_id) REFERENCES saints(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vigilance_carte (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  heure TIME NOT NULL, -- heure de publication du bulletin (Europe/Paris) : plusieurs bulletins/jour (~6h, 16h, réévaluations)
  echeance ENUM('J','J1') NOT NULL,
  departement VARCHAR(10) NOT NULL,
  couleur TINYINT NOT NULL, -- 1 vert, 2 jaune, 3 orange, 4 rouge
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_date_heure_echeance_dep (date, heure, echeance, departement)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vigilance_textes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  heure TIME NOT NULL,
  contenu MEDIUMTEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_date_heure (date, heure)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sync_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tache VARCHAR(100) NOT NULL,
  statut ENUM('ok','erreur','partiel') NOT NULL,
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tache_date (tache, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
