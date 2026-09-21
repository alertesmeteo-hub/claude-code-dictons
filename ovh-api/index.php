<?php
/**
 * API interne dicton-du-jour — à déposer sur l'hébergement mutualisé OVH,
 * au même endroit que le plugin WordPress am-dictionnaire-meteo (accès local à la base,
 * donc jamais bloqué contrairement à une connexion MySQL depuis un serveur externe).
 *
 * Le site Next.js (hébergé où que ce soit) appelle cette API en HTTPS au lieu de se
 * connecter directement à MySQL. Voir README.md racine du projet pour l'architecture.
 *
 * Toutes les routes nécessitent l'en-tête : Authorization: Bearer <DICTON_API_TOKEN>
 */

if (!file_exists(__DIR__ . '/config.php')) {
	http_response_code(500);
	die(json_encode(['erreur' => 'config.php manquant — copier config.example.php et le remplir']));
}
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

function repondre($donnees, $code = 200) {
	http_response_code($code);
	echo json_encode($donnees, JSON_UNESCAPED_UNICODE);
	exit;
}

function verifierToken() {
	// Sur certains hébergements mutualisés (PHP en CGI/FastCGI), l'en-tête Authorization
	// n'arrive pas via getallheaders() : on regarde aussi les variantes $_SERVER en repli.
	$auth = '';
	$headers = function_exists('getallheaders') ? getallheaders() : [];
	if (!empty($headers['Authorization'])) {
		$auth = $headers['Authorization'];
	} elseif (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
		$auth = $_SERVER['HTTP_AUTHORIZATION'];
	} elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
		$auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
	}

	if (!preg_match('/^Bearer\s+(.+)$/', $auth, $m) || !hash_equals(DICTON_API_TOKEN, $m[1])) {
		repondre(['erreur' => 'Non autorisé', 'debug' => $auth === '' ? 'en-tete absent' : 'jeton invalide'], 401);
	}
}
verifierToken();

function getDb() {
	static $mysqli = null;
	if ($mysqli instanceof mysqli) return $mysqli;

	// Depuis PHP 8.1, mysqli lance des exceptions par défaut sur les erreurs ;
	// on repasse en mode "erreur silencieuse" pour garder nos réponses JSON contrôlées.
	mysqli_report(MYSQLI_REPORT_OFF);

	$mysqli = @mysqli_connect(DICTMETEO_DB_HOST, DICTMETEO_DB_USER, DICTMETEO_DB_PASSWORD, DICTMETEO_DB_NAME);
	if (!$mysqli) {
		repondre(['erreur' => 'Connexion base de données impossible : ' . mysqli_connect_error()], 503);
	}
	mysqli_set_charset($mysqli, 'utf8mb4');
	return $mysqli;
}

function corpsJson() {
	$brut = file_get_contents('php://input');
	$donnees = json_decode($brut, true);
	return is_array($donnees) ? $donnees : [];
}

// Table créée automatiquement au premier usage (pas de manipulation phpMyAdmin nécessaire).
function assurerTableFetes($db) {
	$db->query(
		'CREATE TABLE IF NOT EXISTS fetes_jour (
			mois TINYINT NOT NULL,
			jour TINYINT NOT NULL,
			prenoms MEDIUMTEXT NULL,
			autres_fetes MEDIUMTEXT NULL,
			source VARCHAR(255) NULL,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (mois, jour)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
	);
}

// Tables créées automatiquement au premier usage (pas de manipulation phpMyAdmin nécessaire).
function assurerTablesVigilance($db) {
	$db->query(
		"CREATE TABLE IF NOT EXISTS vigilance_carte (
			id INT AUTO_INCREMENT PRIMARY KEY,
			date DATE NOT NULL,
			heure TIME NOT NULL,
			echeance ENUM('J','J1') NOT NULL,
			departement VARCHAR(10) NOT NULL,
			couleur TINYINT NOT NULL,
			fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_date_heure_echeance_dep (date, heure, echeance, departement)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
	);
	$db->query(
		'CREATE TABLE IF NOT EXISTS vigilance_textes (
			id INT AUTO_INCREMENT PRIMARY KEY,
			date DATE NOT NULL,
			heure TIME NOT NULL,
			contenu MEDIUMTEXT NOT NULL,
			fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_date_heure (date, heure)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
	);
}

// Bulletins de vigilance de l'archive officielle (vigilance-public.meteo.fr, 2001+ → ~2022) : un enregistrement par bulletin.
// `masque` = OU binaire des phénomènes (1 vent, 2 pluie-inondation, 4 orages, 8 crues, 16 neige-verglas, 32 canicule,
// 64 grand froid, 128 avalanches, 256 vagues-submersion). Table créée automatiquement au premier appel.
function assurerTableVigilanceBulletins($db) {
	$db->query(
		'CREATE TABLE IF NOT EXISTS vigilance_bulletin (
			id INT AUTO_INCREMENT PRIMARY KEY,
			date DATE NOT NULL,
			heure TIME NOT NULL,
			producteur VARCHAR(20) NOT NULL,
			phenomenes VARCHAR(160) NOT NULL,
			masque SMALLINT UNSIGNED NOT NULL DEFAULT 0,
			bulletin_id INT NOT NULL,
			base VARCHAR(30) NOT NULL,
			fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_base_bulletin (base, bulletin_id),
			KEY idx_date_masque (date, masque)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
	);
}

// Couleur max du jour par département et phénomène (Météo-France : 1 vent, 2 pluie-inondation, 3 orages, 4 crues,
// 5 neige-verglas, 6 canicule, 7 grand froid, 8 avalanches, 9 vagues-submersion), pour les jours récents (data.gouv).
function assurerTablePhenomenesJour($db) {
	$db->query(
		'CREATE TABLE IF NOT EXISTS vigilance_phenomene_jour (
			date DATE NOT NULL,
			departement VARCHAR(10) NOT NULL,
			phenomene TINYINT NOT NULL,
			couleur TINYINT NOT NULL,
			PRIMARY KEY (date, departement, phenomene),
			KEY idx_phenomene_date (phenomene, date)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
	);
}

// Texte intégral des bulletins (compressé : environ 3 fois moins de place) et départements suivis, avec leur statut
// (1 début de suivi, 2 maintien, 3 fin). Tables créées automatiquement au premier appel.
function assurerTablesVigilanceTextes($db) {
	assurerTableVigilanceBulletins($db);
	$db->query(
		'CREATE TABLE IF NOT EXISTS vigilance_bulletin_texte (
			base VARCHAR(30) NOT NULL,
			bulletin_id INT NOT NULL,
			contenu MEDIUMBLOB NOT NULL,
			niveau_max TINYINT NULL,
			fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (base, bulletin_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
	);
	$db->query(
		'CREATE TABLE IF NOT EXISTS vigilance_bulletin_dept (
			base VARCHAR(30) NOT NULL,
			bulletin_id INT NOT NULL,
			departement VARCHAR(3) NOT NULL,
			statut TINYINT NOT NULL,
			PRIMARY KEY (base, bulletin_id, departement),
			KEY idx_departement (departement)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
	);
}

$route = $_GET['route'] ?? '';
$methode = $_SERVER['REQUEST_METHOD'];
$db = getDb();

switch ("$methode:$route") {

	// ---- Contenu du jour (saint + dictons datés, fallback génériques) ----
	case 'GET:jour':
		$date = $_GET['date'] ?? '';
		if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) repondre(['erreur' => 'date invalide'], 400);
		[$y, $mois, $jour] = array_map('intval', explode('-', $date));

		$stmt = $db->prepare('SELECT * FROM saints WHERE mois = ? AND jour = ? LIMIT 1');
		$stmt->bind_param('ii', $mois, $jour);
		$stmt->execute();
		$saint = $stmt->get_result()->fetch_assoc();

		$stmt = $db->prepare('SELECT texte, type FROM dictons WHERE mois = ? AND jour = ? AND actif = 1');
		$stmt->bind_param('ii', $mois, $jour);
		$stmt->execute();
		$dictons = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

		if (empty($dictons)) {
			$res = $db->query('SELECT texte, type FROM dictons WHERE mois IS NULL AND jour IS NULL AND actif = 1 LIMIT 5');
			$dictons = $res->fetch_all(MYSQLI_ASSOC);
		}

		assurerTableFetes($db);
		$stmt = $db->prepare('SELECT prenoms, autres_fetes FROM fetes_jour WHERE mois = ? AND jour = ? LIMIT 1');
		$stmt->bind_param('ii', $mois, $jour);
		$stmt->execute();
		$fete = $stmt->get_result()->fetch_assoc();
		if ($fete) {
			$fete = [
				'prenoms' => json_decode($fete['prenoms'] ?? '[]', true) ?: [],
				'autresFetes' => json_decode($fete['autres_fetes'] ?? '[]', true) ?: [],
			];
		}

		repondre(['saint' => $saint ?: null, 'dictons' => $dictons, 'fete' => $fete ?: null]);

	case 'POST:fetes/bulk':
		assurerTableFetes($db);
		$d = corpsJson();
		$stmt = $db->prepare(
			'INSERT INTO fetes_jour (mois, jour, prenoms, autres_fetes, source) VALUES (?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE prenoms=VALUES(prenoms), autres_fetes=VALUES(autres_fetes), source=VALUES(source)'
		);
		$compte = 0;
		foreach (($d['fetes'] ?? []) as $f) {
			$prenoms = json_encode($f['prenoms'] ?? [], JSON_UNESCAPED_UNICODE);
			$autres = json_encode($f['autresFetes'] ?? [], JSON_UNESCAPED_UNICODE);
			$stmt->bind_param('iisss', $f['mois'], $f['jour'], $prenoms, $autres, $f['source']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// ---- Saints (admin) ----
	case 'GET:saints':
		$res = $db->query('SELECT * FROM saints ORDER BY mois, jour');
		repondre($res->fetch_all(MYSQLI_ASSOC));

	case 'POST:saints':
		$d = corpsJson();
		foreach (['mois', 'jour', 'nomPrincipal', 'source'] as $champ) {
			if (empty($d[$champ]) && $d[$champ] !== '0') repondre(['erreur' => "champ requis: $champ"], 400);
		}
		$stmt = $db->prepare(
			'INSERT INTO saints (mois, jour, nom_principal, presentation_historique, autres_prenoms, patronage, traditions, source, verifie)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE nom_principal=VALUES(nom_principal), presentation_historique=VALUES(presentation_historique),
			 autres_prenoms=VALUES(autres_prenoms), patronage=VALUES(patronage), traditions=VALUES(traditions),
			 source=VALUES(source), verifie=VALUES(verifie)'
		);
		$verifie = !empty($d['verifie']) ? 1 : 0;
		$stmt->bind_param(
			'iissssssi',
			$d['mois'], $d['jour'], $d['nomPrincipal'], $d['presentationHistorique'], $d['autresPrenoms'],
			$d['patronage'], $d['traditions'], $d['source'], $verifie
		);
		$stmt->execute();
		repondre(['ok' => true]);

	// ---- Dictons (admin) ----
	case 'GET:dictons':
		$res = $db->query('SELECT * FROM dictons ORDER BY id DESC');
		repondre($res->fetch_all(MYSQLI_ASSOC));

	case 'POST:dictons':
		$d = corpsJson();
		if (empty($d['texte']) || empty($d['type'])) repondre(['erreur' => 'texte et type requis'], 400);
		$mois = $d['mois'] !== '' && isset($d['mois']) ? (int)$d['mois'] : null;
		$jour = $d['jour'] !== '' && isset($d['jour']) ? (int)$d['jour'] : null;
		$stmt = $db->prepare('INSERT INTO dictons (texte, type, mois, jour, source) VALUES (?, ?, ?, ?, ?)');
		$stmt->bind_param('ssiis', $d['texte'], $d['type'], $mois, $jour, $d['source']);
		$stmt->execute();
		repondre(['ok' => true, 'id' => $db->insert_id]);

	case 'POST:dictons/toggle':
		$d = corpsJson();
		if (empty($d['id'])) repondre(['erreur' => 'id requis'], 400);
		$stmt = $db->prepare('UPDATE dictons SET actif = NOT actif WHERE id = ?');
		$stmt->bind_param('i', $d['id']);
		$stmt->execute();
		repondre(['ok' => true]);

	// ---- Import en masse (seed initial uniquement) ----
	case 'POST:saints/bulk':
		$d = corpsJson();
		$liste = $d['saints'] ?? [];
		$stmt = $db->prepare(
			'INSERT INTO saints (mois, jour, nom_principal, presentation_historique, autres_prenoms, patronage, traditions, source, verifie)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE nom_principal=nom_principal' // ne pas écraser si déjà présent
		);
		$compte = 0;
		foreach ($liste as $s) {
			$verifie = !empty($s['verifie']) ? 1 : 0;
			$stmt->bind_param(
				'iissssssi',
				$s['mois'], $s['jour'], $s['nomPrincipal'], $s['presentationHistorique'], $s['autresPrenoms'],
				$s['patronage'], $s['traditions'], $s['source'], $verifie
			);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	case 'POST:dictons/bulk':
		$d = corpsJson();
		$liste = $d['dictons'] ?? [];
		$existe = $db->prepare('SELECT id FROM dictons WHERE texte = ? AND mois <=> ? AND jour <=> ? LIMIT 1');
		$stmt = $db->prepare('INSERT INTO dictons (texte, type, mois, jour, source) VALUES (?, ?, ?, ?, ?)');
		$compte = 0;
		foreach ($liste as $item) {
			$mois = isset($item['mois']) ? (int)$item['mois'] : null;
			$jour = isset($item['jour']) ? (int)$item['jour'] : null;
			$existe->bind_param('sii', $item['texte'], $mois, $jour);
			$existe->execute();
			if ($existe->get_result()->num_rows > 0) continue; // déjà présent : import rejouable sans doublon
			$stmt->bind_param('ssiis', $item['texte'], $item['type'], $mois, $jour, $item['source']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	case 'POST:dictons/dedupe':
		$db->query(
			'DELETE d1 FROM dictons d1 INNER JOIN dictons d2
			 ON d1.texte = d2.texte AND d1.mois <=> d2.mois AND d1.jour <=> d2.jour AND d1.id > d2.id'
		);
		repondre(['ok' => true, 'supprimes' => $db->affected_rows]);

	case 'POST:villes/bulk':
		$d = corpsJson();
		$liste = $d['villes'] ?? [];
		$stmt = $db->prepare(
			'INSERT INTO villes (nom, code_postal, departement, latitude, longitude, slug)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE nom=nom'
		);
		$compte = 0;
		foreach ($liste as $v) {
			$stmt->bind_param('sssdds', $v['nom'], $v['codePostal'], $v['departement'], $v['latitude'], $v['longitude'], $v['slug']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// ---- Villes (recherche) ----
	case 'GET:villes/recherche':
		$q = $_GET['q'] ?? '';
		if (strlen($q) < 2) repondre([]);
		$like = $q . '%';
		$stmt = $db->prepare('SELECT nom, departement, slug, latitude, longitude FROM villes WHERE nom LIKE ? LIMIT 10');
		$stmt->bind_param('s', $like);
		$stmt->execute();
		repondre($stmt->get_result()->fetch_all(MYSQLI_ASSOC));

	// ---- Températures extrêmes ----
	case 'GET:extremes/france':
		$aujourdHui = date('Y-m-d');
		$stmt = $db->prepare(
			'SELECT t.type, t.valeur_c, t.source, t.fetched_at, s.nom_commune, s.departement, s.altitude_m
			 FROM temperatures_extremes_jour t JOIN stations_meteo s ON s.id = t.station_id
			 WHERE t.date = ? ORDER BY t.type ASC, t.valeur_c DESC'
		);
		$stmt->bind_param('s', $aujourdHui);
		$stmt->execute();
		repondre(['date' => $aujourdHui, 'donnees' => $stmt->get_result()->fetch_all(MYSQLI_ASSOC)]);

	case 'POST:extremes/france':
		$d = corpsJson();
		$mesures = $d['mesures'] ?? [];
		$aujourdHui = date('Y-m-d');
		$compte = 0;
		foreach ($mesures as $m) {
			$stmt = $db->prepare(
				'INSERT INTO stations_meteo (code_station, nom_commune, departement, altitude_m)
				 VALUES (?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE nom_commune=VALUES(nom_commune), departement=VALUES(departement), altitude_m=VALUES(altitude_m)'
			);
			$stmt->bind_param('sssi', $m['codeStation'], $m['nomCommune'], $m['departement'], $m['altitudeM']);
			$stmt->execute();

			$stationId = $db->query("SELECT id FROM stations_meteo WHERE code_station = '" . $db->real_escape_string($m['codeStation']) . "'")->fetch_assoc()['id'];

			$stmt = $db->prepare(
				'INSERT INTO temperatures_extremes_jour (date, station_id, type, valeur_c, heure_mesure, source)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE valeur_c=VALUES(valeur_c), heure_mesure=VALUES(heure_mesure), source=VALUES(source), fetched_at=CURRENT_TIMESTAMP'
			);
			$stmt->bind_param('sisdss', $aujourdHui, $stationId, $m['type'], $m['valeurC'], $m['heureMesure'], $m['source']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// ---- Vigilance météo (carte par département + texte de synthèse national) ----
	// Un jour peut compter plusieurs bulletins (~6h, 16h, réévaluations) : identifiés par (date, heure).
	case 'GET:vigilance/france':
		assurerTablesVigilance($db);
		$aujourdHui = date('Y-m-d');
		$stmt = $db->prepare('SELECT heure, echeance, departement, couleur FROM vigilance_carte WHERE date = ? ORDER BY heure ASC, echeance ASC, departement ASC');
		$stmt->bind_param('s', $aujourdHui);
		$stmt->execute();
		$carte = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

		$stmt = $db->prepare('SELECT heure, contenu, fetched_at FROM vigilance_textes WHERE date = ? ORDER BY heure ASC');
		$stmt->bind_param('s', $aujourdHui);
		$stmt->execute();
		$textes = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

		repondre(['date' => $aujourdHui, 'carte' => $carte, 'textes' => $textes]);

	case 'POST:vigilance/france':
		assurerTablesVigilance($db);
		$d = corpsJson();
		if (empty($d['date']) || empty($d['heure'])) repondre(['erreur' => 'date et heure requises'], 400);
		$compte = 0;
		$stmt = $db->prepare(
			'INSERT INTO vigilance_carte (date, heure, echeance, departement, couleur) VALUES (?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE couleur=VALUES(couleur), fetched_at=CURRENT_TIMESTAMP'
		);
		foreach (($d['carte'] ?? []) as $c) {
			$stmt->bind_param('ssssi', $d['date'], $d['heure'], $c['echeance'], $c['departement'], $c['couleur']);
			$stmt->execute();
			$compte++;
		}
		if (!empty($d['texte'])) {
			$stmt = $db->prepare(
				'INSERT INTO vigilance_textes (date, heure, contenu) VALUES (?, ?, ?)
				 ON DUPLICATE KEY UPDATE contenu=VALUES(contenu), fetched_at=CURRENT_TIMESTAMP'
			);
			$stmt->bind_param('sss', $d['date'], $d['heure'], $d['texte']);
			$stmt->execute();
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// ---- Vigilance historique nationale (2001+, sans détail département — voir backfill-vigilance-national.ts) ----
	case 'GET:vigilance/national':
		$annee = (int)($_GET['annee'] ?? 0);
		$mois = (int)($_GET['mois'] ?? 0);
		if ($annee < 2001 || $mois < 1 || $mois > 12) repondre(['erreur' => 'annee et mois requis (mois valide)'], 400);
		$debut = sprintf('%04d-%02d-01', $annee, $mois);
		$stmt = $db->prepare('SELECT date, couleur, commentaire FROM vigilance_national_jour WHERE date >= ? AND date < DATE_ADD(?, INTERVAL 1 MONTH) ORDER BY date ASC');
		$stmt->bind_param('ss', $debut, $debut);
		$stmt->execute();
		repondre($stmt->get_result()->fetch_all(MYSQLI_ASSOC));

	case 'POST:vigilance/national':
		$db->query(
			'CREATE TABLE IF NOT EXISTS vigilance_national_jour (
				date DATE NOT NULL PRIMARY KEY,
				couleur TINYINT NOT NULL,
				commentaire VARCHAR(255) NULL,
				fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
		);
		$d = corpsJson();
		$compte = 0;
		$stmt = $db->prepare(
			'INSERT INTO vigilance_national_jour (date, couleur, commentaire) VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE couleur=VALUES(couleur), commentaire=VALUES(commentaire), fetched_at=CURRENT_TIMESTAMP'
		);
		foreach (($d['jours'] ?? []) as $j) {
			$stmt->bind_param('sis', $j['date'], $j['couleur'], $j['commentaire']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// ---- Vigilance historique par département (2001+, source tierce vigiscript.fr — voir backfill-vigilance-departement.ts) ----
	case 'GET:vigilance/departement-historique':
		$departement = $_GET['departement'] ?? '';
		$annee = (int)($_GET['annee'] ?? 0);
		$mois = (int)($_GET['mois'] ?? 0);
		if (!preg_match('/^(\d{2}|2A|2B)$/', $departement) || $annee < 2001 || $mois < 1 || $mois > 12) {
			repondre(['erreur' => 'departement, annee et mois requis (departement/mois valides)'], 400);
		}
		$debut = sprintf('%04d-%02d-01', $annee, $mois);
		$stmt = $db->prepare(
			'SELECT date, couleur FROM vigilance_departement_jour
			 WHERE departement = ? AND date >= ? AND date < DATE_ADD(?, INTERVAL 1 MONTH) ORDER BY date ASC'
		);
		$stmt->bind_param('sss', $departement, $debut, $debut);
		$stmt->execute();
		repondre($stmt->get_result()->fetch_all(MYSQLI_ASSOC));

	case 'POST:vigilance/departement-historique':
		$db->query(
			'CREATE TABLE IF NOT EXISTS vigilance_departement_jour (
				date DATE NOT NULL,
				departement VARCHAR(10) NOT NULL,
				couleur TINYINT NOT NULL,
				fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (date, departement)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
		);
		$d = corpsJson();
		$compte = 0;
		$stmt = $db->prepare(
			'INSERT INTO vigilance_departement_jour (date, departement, couleur) VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE couleur=VALUES(couleur), fetched_at=CURRENT_TIMESTAMP'
		);
		foreach (($d['jours'] ?? []) as $j) {
			$stmt->bind_param('ssi', $j['date'], $j['departement'], $j['couleur']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// ---- Bulletins de l'archive officielle + recherche avancée (voir backfill-vigilance-bulletins.ts) ----
	case 'POST:vigilance/bulletins':
		assurerTableVigilanceBulletins($db);
		$d = corpsJson();
		$compte = 0;
		$stmt = $db->prepare(
			'INSERT INTO vigilance_bulletin (date, heure, producteur, phenomenes, masque, bulletin_id, base) VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE date=VALUES(date), heure=VALUES(heure), producteur=VALUES(producteur),
			   phenomenes=VALUES(phenomenes), masque=VALUES(masque), fetched_at=CURRENT_TIMESTAMP'
		);
		foreach (($d['bulletins'] ?? []) as $b) {
			$stmt->bind_param('ssssiis', $b['date'], $b['heure'], $b['producteur'], $b['phenomenes'], $b['masque'], $b['bulletinId'], $b['base']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	case 'GET:vigilance/bulletins-jour':
		assurerTableVigilanceBulletins($db);
		$date = $_GET['date'] ?? '';
		if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) repondre(['erreur' => 'date requise (AAAA-MM-JJ)'], 400);
		$stmt = $db->prepare(
			'SELECT date, heure, producteur, phenomenes, masque, bulletin_id AS bulletinId, base
			 FROM vigilance_bulletin WHERE date = ? ORDER BY heure ASC, id ASC'
		);
		$stmt->bind_param('s', $date);
		$stmt->execute();
		$liste = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

		// Bulletins récents (data.gouv / API Météo-France, 2022+) : un bulletin par heure de carte.
		// Identifiant synthétique base « carte », id = AAAAMMJJHHMMSS.
		assurerTablesVigilance($db);
		$stmt = $db->prepare(
			"SELECT heure, MAX(couleur) AS couleurMax, SUM(couleur >= 3) AS nbAlertes
			 FROM vigilance_carte WHERE date = ? AND echeance = 'J' GROUP BY heure ORDER BY heure ASC"
		);
		$stmt->bind_param('s', $date);
		$stmt->execute();
		foreach ($stmt->get_result()->fetch_all(MYSQLI_ASSOC) as $c) {
			$nomsCouleur = [1 => 'vert', 2 => 'jaune', 3 => 'orange', 4 => 'rouge'];
			$liste[] = [
				'date' => $date,
				'heure' => $c['heure'],
				'producteur' => 'Carte',
				'phenomenes' => 'Carte de vigilance — niveau max ' . ($nomsCouleur[(int)$c['couleurMax']] ?? '') . ((int)$c['nbAlertes'] > 0 ? ' (' . (int)$c['nbAlertes'] . ' départements en orange/rouge)' : ''),
				'masque' => 0,
				'bulletinId' => (int)(str_replace('-', '', $date) . str_replace(':', '', $c['heure'])),
				'base' => 'carte',
			];
		}
		repondre($liste);

	// Couleur maximale du jour pour chaque département (toutes époques : archive 2001+ et jours récents), pour la carte de France.
	case 'GET:vigilance/departements-jour':
		$date = $_GET['date'] ?? '';
		if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) repondre(['erreur' => 'date requise (AAAA-MM-JJ)'], 400);
		$db->query(
			'CREATE TABLE IF NOT EXISTS vigilance_departement_jour (
				date DATE NOT NULL,
				departement VARCHAR(10) NOT NULL,
				couleur TINYINT NOT NULL,
				fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (date, departement)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
		);
		$stmt = $db->prepare('SELECT departement AS code, couleur FROM vigilance_departement_jour WHERE date = ? ORDER BY departement');
		$stmt->bind_param('s', $date);
		$stmt->execute();
		repondre($stmt->get_result()->fetch_all(MYSQLI_ASSOC));

	// Couleur maximale du jour par département et phénomène (1 à 9), jaune ou plus, pour les bulletins récents (2022+).
	case 'POST:vigilance/phenomene-jour':
		assurerTablePhenomenesJour($db);
		$d = corpsJson();
		$compte = 0;
		$stmt = $db->prepare(
			'INSERT INTO vigilance_phenomene_jour (date, departement, phenomene, couleur) VALUES (?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE couleur=VALUES(couleur)'
		);
		foreach (($d['jours'] ?? []) as $j) {
			$stmt->bind_param('ssii', $j['date'], $j['departement'], $j['phenomene'], $j['couleur']);
			$stmt->execute();
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// Jours de la période dont la couleur nationale correspond, éventuellement restreints à un phénomène (1 à 9).
	// couleur : '' = orange et rouge ; 2 jaune, 3 orange, 4 rouge (exact). Plafond : 5000 jours par réponse.
	case 'GET:vigilance/recherche':
		assurerTableVigilanceBulletins($db);
		$debut = $_GET['debut'] ?? '';
		$fin = $_GET['fin'] ?? '';
		if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $debut) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fin) || $debut > $fin) {
			repondre(['erreur' => 'debut et fin requis (AAAA-MM-JJ, debut <= fin)'], 400);
		}
		$couleur = $_GET['couleur'] ?? '';
		if ($couleur !== '' && !in_array($couleur, ['2', '3', '4'], true)) repondre(['erreur' => 'couleur invalide'], 400);
		$phenomene = $_GET['phenomene'] ?? '';
		if ($phenomene !== '' && !preg_match('/^[1-9]$/', $phenomene)) repondre(['erreur' => 'phenomene invalide (1 a 9)'], 400);
		$departement = $_GET['departement'] ?? '';
		if ($departement !== '' && !preg_match('/^(\d{2}|2A|2B)$/', $departement)) repondre(['erreur' => 'departement invalide'], 400);
		$bitPhenomene = $phenomene === '' ? 0 : (1 << ((int)$phenomene - 1)); // filtre appliqué après fusion des sources (archive + jours récents)
		if ($departement === '') {
			// France entière : couleur nationale du jour + bulletins du jour.
			$filtreCouleur = $couleur === '' ? 'n.couleur >= 3' : 'n.couleur = ' . (int)$couleur;
			$sql = "SELECT n.date, n.couleur, COALESCE(BIT_OR(b.masque), 0) AS masque, COUNT(b.id) AS nbBulletins
				FROM vigilance_national_jour n LEFT JOIN vigilance_bulletin b ON b.date = n.date
				WHERE n.date BETWEEN ? AND ? AND $filtreCouleur
				GROUP BY n.date, n.couleur ORDER BY n.date ASC";
			$stmt = $db->prepare($sql);
			$stmt->bind_param('ss', $debut, $fin);
		} else {
			// Un département : couleur du département + bulletins qui le citent (nécessite l'import des textes).
			assurerTablesVigilanceTextes($db);
			$filtreCouleur = $couleur === '' ? 'dj.couleur >= 3' : 'dj.couleur = ' . (int)$couleur;
			$sql = "SELECT dj.date, dj.couleur, COALESCE(BIT_OR(b.masque), 0) AS masque, COUNT(DISTINCT b.id) AS nbBulletins
				FROM vigilance_departement_jour dj
				LEFT JOIN vigilance_bulletin_dept d ON d.departement = dj.departement
				LEFT JOIN vigilance_bulletin b ON b.base = d.base AND b.bulletin_id = d.bulletin_id AND b.date = dj.date
				WHERE dj.departement = ? AND dj.date BETWEEN ? AND ? AND $filtreCouleur
				GROUP BY dj.date, dj.couleur ORDER BY dj.date ASC";
			$stmt = $db->prepare($sql);
			$stmt->bind_param('sss', $departement, $debut, $fin);
		}
		$stmt->execute();
		$lignes = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
		// Jours récents (data.gouv, 2022+) : phénomènes en jaune ou plus, fusionnés avec ceux de l'archive officielle.
		assurerTablePhenomenesJour($db);
		$seuil = $couleur === '2' ? 2 : 3;
		$filtreDepPh = $departement === '' ? '' : ' AND departement = ?';
		$stmt = $db->prepare(
			"SELECT date, BIT_OR(1 << (phenomene - 1)) AS m FROM vigilance_phenomene_jour
			 WHERE date BETWEEN ? AND ? AND couleur >= $seuil$filtreDepPh GROUP BY date"
		);
		if ($departement === '') $stmt->bind_param('ss', $debut, $fin);
		else $stmt->bind_param('sss', $debut, $fin, $departement);
		$stmt->execute();
		$masqueRecent = [];
		foreach ($stmt->get_result()->fetch_all(MYSQLI_ASSOC) as $r) $masqueRecent[$r['date']] = (int)$r['m'];
		foreach ($lignes as &$l) $l['masque'] = (int)$l['masque'] | ($masqueRecent[$l['date']] ?? 0);
		unset($l);
		if ($bitPhenomene > 0) {
			$lignes = array_values(array_filter($lignes, function ($l) use ($bitPhenomene) { return ($l['masque'] & $bitPhenomene) > 0; }));
		}
		$tronque = count($lignes) > 5000;
		if ($tronque) $lignes = array_slice($lignes, 0, 5000);

		// Bulletins récents (cartes data.gouv, 2022+) : un bulletin par heure de carte, comptés en plus de l'archive officielle.
		if ($lignes) {
			assurerTablesVigilance($db);
			$filtreDep = $departement === '' ? '' : ' AND departement = ?';
			$stmt = $db->prepare(
				"SELECT date, COUNT(DISTINCT heure) AS n FROM vigilance_carte
				 WHERE date BETWEEN ? AND ? AND echeance = 'J'$filtreDep GROUP BY date"
			);
			if ($departement === '') $stmt->bind_param('ss', $debut, $fin);
			else $stmt->bind_param('sss', $debut, $fin, $departement);
			$stmt->execute();
			$parJour = [];
			foreach ($stmt->get_result()->fetch_all(MYSQLI_ASSOC) as $r) $parJour[$r['date']] = (int)$r['n'];
			foreach ($lignes as &$l) $l['nbBulletins'] = (int)$l['nbBulletins'] + ($parJour[$l['date']] ?? 0);
			unset($l);
		}
		repondre(['jours' => $lignes, 'tronque' => $tronque]);

	// Bulletins listés mais dont le texte n'a pas encore été récupéré (reprise possible de l'import).
	case 'GET:vigilance/bulletins-a-recuperer':
		assurerTablesVigilanceTextes($db);
		$limite = max(1, min((int)($_GET['limite'] ?? 200), 1000));
		$res = $db->query(
			"SELECT b.base, b.bulletin_id AS bulletinId FROM vigilance_bulletin b
			 LEFT JOIN vigilance_bulletin_texte t ON t.base = b.base AND t.bulletin_id = b.bulletin_id
			 WHERE t.bulletin_id IS NULL AND b.base NOT LIKE 'carte%' ORDER BY b.date ASC, b.id ASC LIMIT $limite"
		);
		$reste = $db->query(
			'SELECT COUNT(*) AS n FROM vigilance_bulletin b
			 LEFT JOIN vigilance_bulletin_texte t ON t.base = b.base AND t.bulletin_id = b.bulletin_id WHERE t.bulletin_id IS NULL AND b.base NOT LIKE \'carte%\''
		)->fetch_assoc();
		repondre(['bulletins' => $res->fetch_all(MYSQLI_ASSOC), 'restant' => (int)$reste['n']]);

	case 'POST:vigilance/bulletins-textes':
		assurerTablesVigilanceTextes($db);
		$d = corpsJson();
		$compte = 0;
		$texteStmt = $db->prepare(
			'INSERT INTO vigilance_bulletin_texte (base, bulletin_id, contenu, niveau_max) VALUES (?, ?, COMPRESS(?), ?)
			 ON DUPLICATE KEY UPDATE contenu=VALUES(contenu), niveau_max=VALUES(niveau_max), fetched_at=CURRENT_TIMESTAMP'
		);
		$supprStmt = $db->prepare('DELETE FROM vigilance_bulletin_dept WHERE base = ? AND bulletin_id = ?');
		$deptStmt = $db->prepare(
			'INSERT INTO vigilance_bulletin_dept (base, bulletin_id, departement, statut) VALUES (?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE statut=VALUES(statut)'
		);
		foreach (($d['textes'] ?? []) as $t) {
			$niveau = isset($t['niveauMax']) ? (int)$t['niveauMax'] : null;
			$texteStmt->bind_param('sisi', $t['base'], $t['bulletinId'], $t['texte'], $niveau);
			$texteStmt->execute();
			$supprStmt->bind_param('si', $t['base'], $t['bulletinId']);
			$supprStmt->execute();
			foreach (($t['departements'] ?? []) as $dep) {
				if (!preg_match('/^(\d{2}|2A|2B)$/', (string)$dep['code'])) continue;
				$deptStmt->bind_param('sisi', $t['base'], $t['bulletinId'], $dep['code'], $dep['statut']);
				$deptStmt->execute();
			}
			$compte++;
		}
		repondre(['ok' => true, 'compte' => $compte]);

	// Un bulletin complet (texte décompressé + départements suivis) pour l'afficher sur le site.
	case 'GET:vigilance/bulletin':
		assurerTablesVigilanceTextes($db);
		$base = $_GET['base'] ?? '';
		$id = (int)($_GET['id'] ?? 0);
		if (!preg_match('/^\w{1,30}$/', $base) || $id < 1) repondre(['erreur' => 'base et id requis'], 400);
		if ($base === 'carte') {
			// Bulletin récent : id = AAAAMMJJHHMMSS, contenu = couleurs par département de cette carte.
			assurerTablesVigilance($db);
			$s = sprintf('%014d', $id);
			$date = substr($s, 0, 4) . '-' . substr($s, 4, 2) . '-' . substr($s, 6, 2);
			$heure = substr($s, 8, 2) . ':' . substr($s, 10, 2) . ':' . substr($s, 12, 2);
			$stmt = $db->prepare("SELECT departement AS code, couleur FROM vigilance_carte WHERE date = ? AND heure = ? AND echeance = 'J' ORDER BY departement");
			$stmt->bind_param('ss', $date, $heure);
			$stmt->execute();
			$carte = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
			if (!$carte) repondre(['erreur' => 'bulletin inconnu'], 404);
			repondre([
				'date' => $date, 'heure' => $heure, 'producteur' => 'Carte', 'phenomenes' => 'Carte de vigilance',
				'masque' => 0, 'texte' => null, 'niveauMax' => (int)max(array_column($carte, 'couleur')),
				'departements' => [], 'carte' => $carte,
			]);
		}
		$stmt = $db->prepare(
			'SELECT b.date, b.heure, b.producteur, b.phenomenes, b.masque, UNCOMPRESS(t.contenu) AS texte, t.niveau_max AS niveauMax
			 FROM vigilance_bulletin b LEFT JOIN vigilance_bulletin_texte t ON t.base = b.base AND t.bulletin_id = b.bulletin_id
			 WHERE b.base = ? AND b.bulletin_id = ?'
		);
		$stmt->bind_param('si', $base, $id);
		$stmt->execute();
		$b = $stmt->get_result()->fetch_assoc();
		if (!$b) repondre(['erreur' => 'bulletin inconnu'], 404);
		$stmt = $db->prepare('SELECT departement AS code, statut FROM vigilance_bulletin_dept WHERE base = ? AND bulletin_id = ? ORDER BY departement');
		$stmt->bind_param('si', $base, $id);
		$stmt->execute();
		$b['departements'] = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
		repondre($b);

	// ---- Journal des tâches ----
	case 'GET:sync-logs':
		$limite = min((int)($_GET['limite'] ?? 20), 200);
		$res = $db->query("SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT $limite");
		repondre($res->fetch_all(MYSQLI_ASSOC));

	case 'POST:sync-logs':
		$d = corpsJson();
		$stmt = $db->prepare('INSERT INTO sync_logs (tache, statut, message) VALUES (?, ?, ?)');
		$stmt->bind_param('sss', $d['tache'], $d['statut'], $d['message']);
		$stmt->execute();
		repondre(['ok' => true]);

	// ---- Génération page du jour (traçabilité) ----
	case 'POST:pages-jour':
		$d = corpsJson();
		if (empty($d['date'])) repondre(['erreur' => 'date requise'], 400);
		$stmt = $db->prepare('INSERT INTO pages_jour (date) VALUES (?) ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP');
		$stmt->bind_param('s', $d['date']);
		$stmt->execute();
		repondre(['ok' => true]);

	default:
		repondre(['erreur' => 'route inconnue'], 404);
}
