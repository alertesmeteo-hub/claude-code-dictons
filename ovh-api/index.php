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
