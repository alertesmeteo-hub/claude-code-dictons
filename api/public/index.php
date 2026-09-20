<?php
declare(strict_types=1);

require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/Auth.php';
require __DIR__ . '/../src/Sun.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/', '/') ?: '/';
if ($method === 'OPTIONS') {
    App::json(204, []);
}

try {
    if ($path === '/v1/health') {
        App::ok(['status' => 'ok']);
    }

    if ($path === '/v1/status' && $method === 'GET') {
        $limits = ['extremes' => 3 * 3600, 'vigilance' => 45 * 60, 'records' => 3 * 3600]; // age max avant de considerer une source en retard
        $st = App::db()->prepare("SELECT status, message, finished_at FROM collector_runs WHERE name = ? ORDER BY finished_at DESC LIMIT 1");
        $sources = [];
        foreach ($limits as $name => $max) {
            $st->execute([$name]);
            $last = $st->fetch();
            $okAt = App::db()->prepare("SELECT MAX(finished_at) FROM collector_runs WHERE name = ? AND status = 'ok'");
            $okAt->execute([$name]);
            $ok = $okAt->fetchColumn();
            $age = $ok ? time() - strtotime($ok . ' UTC') : null;
            $sources[$name] = [
                'last_success_at' => $ok ? gmdate('c', strtotime($ok . ' UTC')) : null,
                'last_run_status' => $last['status'] ?? null,
                'stale' => $age === null || $age > $max,
            ];
        }
        $degraded = in_array(true, array_column($sources, 'stale'), true);
        App::ok(['status' => $degraded ? 'degraded' : 'ok', 'sources' => $sources]);
    }

    if ($path === '/v1/records' && $method === 'GET') {
        Auth::guard('records');
        $kind = $_GET['kind'] ?? null;
        if ($kind !== null && !in_array($kind, ['heat', 'cold', 'tropical'], true)) {
            App::error(422, 'invalid_kind', 'kind : heat, cold ou tropical.');
        }
        $scope = $_GET['scope'] ?? null;
        if ($scope !== null && !in_array($scope, ['absolute', 'monthly', 'fortnight', 'daily'], true)) {
            App::error(422, 'invalid_scope', 'scope : absolute, monthly, fortnight ou daily.');
        }
        $dep = $_GET['department'] ?? null;
        if ($dep !== null && !preg_match('/^(\d{2}|2[AB])$/', (string) $dep)) {
            App::error(422, 'invalid_department', 'department : code sur 2 caracteres (ex. 30, 2A).');
        }
        $limit = filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 200]]);
        $offset = filter_input(INPUT_GET, 'offset', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 100000]]);
        if ((isset($_GET['limit']) && !$limit) || (isset($_GET['offset']) && $offset === false)) {
            App::error(422, 'invalid_pagination', 'limit : 1 a 200 ; offset : entier >= 0.');
        }
        $limit = $limit ?: 50;
        $offset = $offset ?: 0;

        $db = App::db();
        $snap = $db->query('SELECT day, generated_at, latest_observation_at, departments_ok, departments_total, fetched_at FROM records_snapshot WHERE id = 1')->fetch();
        if (!$snap) {
            App::error(503, 'no_data', 'Aucune donnee de records disponible.');
        }
        $where = '1 = 1';
        $args = [];
        if ($kind !== null) { $where .= ' AND kind = ?'; $args[] = $kind; }
        if ($scope !== null) { $where .= ' AND is_' . $scope . ' = 1'; }
        if ($dep !== null) { $where .= ' AND department = ?'; $args[] = $dep; }
        $count = $db->prepare("SELECT COUNT(*) FROM records_events WHERE $where");
        $count->execute($args);
        $total = (int) $count->fetchColumn();
        $st = $db->prepare("SELECT * FROM records_events WHERE $where ORDER BY kind, CASE WHEN kind = 'cold' THEN value ELSE -value END, station_id LIMIT $limit OFFSET $offset");
        $st->execute($args);
        $items = [];
        foreach ($st->fetchAll() as $r) {
            $scopes = array_values(array_filter(['absolute', 'monthly', 'fortnight', 'daily'], fn($s) => $r['is_' . $s]));
            $items[] = ['kind' => $r['kind'], 'station_id' => $r['station_id'], 'name' => $r['name'], 'department' => $r['department'],
                'region' => $r['region'], 'altitude_m' => $r['altitude_m'] === null ? null : (int) $r['altitude_m'],
                'temperature_c' => (float) $r['value'], 'scopes_beaten' => $scopes, 'previous_records' => json_decode($r['refs'], true)];
        }
        $age = time() - strtotime($snap['generated_at'] . ' UTC');
        App::ok(['day' => $snap['day'], 'total' => $total, 'limit' => $limit, 'offset' => $offset, 'items' => $items], [
            'source' => 'Meteo-France (observations DPPaquetObs et historiques climatologiques), records calcules par Alertes-Meteo',
            'record_type' => 'computed_from_station_history',
            'official' => false,
            'provisional' => true,
            'generated_at' => gmdate('c', strtotime($snap['generated_at'] . ' UTC')),
            'latest_observation_at' => $snap['latest_observation_at'] ? gmdate('c', strtotime($snap['latest_observation_at'] . ' UTC')) : null,
            'updated_at' => gmdate('c', strtotime($snap['fetched_at'] . ' UTC')),
            'stale' => $age > 3 * 3600,
            'coverage' => ['departments_ok' => (int) $snap['departments_ok'], 'departments_total' => (int) $snap['departments_total'],
                'complete' => $snap['departments_ok'] === $snap['departments_total']],
            'filters' => ['kind' => $kind, 'scope' => $scope, 'department' => $dep],
            'notice' => 'Records du jour calcules sur l\'historique de chaque station ; valeurs provisoires, non officielles. Ne pas presenter comme records de France.',
        ]);
    }

    if ($path === '/v1/keys/requests' && $method === 'POST') {
        $in = json_decode(file_get_contents('php://input'), true) ?: [];
        $accepted = static fn() => App::json(202, ['data' => ['status' => 'pending'],
            'meta' => ['notice' => 'Demande recue. La cle sera envoyee par email apres validation manuelle.']]);
        if (!empty($in['hp'])) {
            $accepted(); // champ leurre rempli : robot, meme reponse sans rien enregistrer
        }
        $email = strtolower(trim((string) ($in['email'] ?? '')));
        $name = trim((string) ($in['name'] ?? ''));
        $usage = trim((string) ($in['usage'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            App::error(422, 'invalid_email', 'Email invalide.');
        }
        if ($name === '' || mb_strlen($name) > 100) {
            App::error(422, 'invalid_name', 'Nom requis (100 caracteres max).');
        }
        if (mb_strlen($usage) < 20 || mb_strlen($usage) > 2000) {
            App::error(422, 'invalid_usage', 'Decrivez votre utilisation (20 a 2000 caracteres).');
        }
        if (empty($in['consent'])) {
            App::error(422, 'consent_required', 'Vous devez accepter que ces informations servent uniquement a traiter votre demande.');
        }
        $org = mb_substr(trim((string) ($in['organization'] ?? '')), 0, 100);
        $site = trim((string) ($in['website'] ?? ''));
        if ($site !== '' && (!filter_var($site, FILTER_VALIDATE_URL) || strlen($site) > 190)) {
            App::error(422, 'invalid_website', 'URL du site invalide.');
        }
        $db = App::db();
        $ipHash = hash('sha256', App::env('IP_SALT') . ($_SERVER['REMOTE_ADDR'] ?? ''));
        $day = gmdate('Ymd');
        $db->prepare('INSERT INTO signup_throttle (ip_hash, day, n) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE n = n + 1')->execute([$ipHash, $day]);
        $n = $db->prepare('SELECT n FROM signup_throttle WHERE ip_hash = ? AND day = ?');
        $n->execute([$ipHash, $day]);
        if ((int) $n->fetchColumn() > 5) {
            App::error(429, 'too_many_requests', 'Trop de demandes aujourd\'hui.');
        }
        $db->prepare('INSERT INTO key_requests (name, organization, email, website, usage_description, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())')
            ->execute([$name, $org ?: null, $email, $site ?: null, $usage]);
        $accepted();
    }

    if ($path === '/v1/keys' && $method === 'DELETE') {
        $id = Auth::guard('keys');
        App::db()->prepare('UPDATE api_keys SET revoked_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$id]);
        App::ok(['revoked' => true]);
    }

    if ($path === '/v1/usage' && $method === 'GET') {
        $id = Auth::guard('usage');
        $st = App::db()->prepare("SELECT bucket, endpoint, hits FROM usage_counters WHERE key_id = ? AND (bucket LIKE 'd%' OR bucket = ?) ORDER BY bucket DESC LIMIT 200");
        $st->execute([$id, 'M' . gmdate('Ym')]);
        App::ok(['counters' => $st->fetchAll()]);
    }

    if ($path === '/v1/sun' && $method === 'GET') {
        Auth::guard('sun');
        $lat = filter_input(INPUT_GET, 'lat', FILTER_VALIDATE_FLOAT);
        $lon = filter_input(INPUT_GET, 'lon', FILTER_VALIDATE_FLOAT);
        if ($lat === false || $lat === null || $lat < -90 || $lat > 90) {
            App::error(422, 'invalid_lat', 'lat doit etre entre -90 et 90.');
        }
        if ($lon === false || $lon === null || $lon < -180 || $lon > 180) {
            App::error(422, 'invalid_lon', 'lon doit etre entre -180 et 180.');
        }
        $date = $_GET['date'] ?? gmdate('Y-m-d');
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', (string) $date);
        if (!$d || $d->format('Y-m-d') !== $date) {
            App::error(422, 'invalid_date', 'date au format YYYY-MM-DD.');
        }
        $tz = $_GET['tz'] ?? 'Europe/Paris';
        if (!in_array($tz, DateTimeZone::listIdentifiers(), true)) {
            App::error(422, 'invalid_tz', 'Fuseau IANA inconnu.');
        }
        App::ok(Sun::compute($lat, $lon, $date, $tz), ['source' => 'Calcul local (algorithme NOAA)', 'stale' => false]);
    }

    if ($path === '/v1/extremes/france' && $method === 'GET') {
        Auth::guard('extremes');
        $altMax = null;
        if (isset($_GET['altitude_max'])) {
            $altMax = filter_input(INPUT_GET, 'altitude_max', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 5000]]);
            if ($altMax === false || $altMax === null) {
                App::error(422, 'invalid_altitude_max', 'altitude_max : entier entre 0 et 5000 (metres).');
            }
        }
        $network = $_GET['stations'] ?? 'toutes';
        if (!in_array($network, ['toutes', 'principales'], true)) {
            App::error(422, 'invalid_stations', 'stations : toutes ou principales.');
        }
        $db = App::db();
        $day = (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->format('Y-m-d');
        $where = 'day = ? AND updated_at > UTC_TIMESTAMP() - INTERVAL 12 HOUR';
        $args = [$day];
        if ($altMax !== null) { $where .= ' AND altitude_m <= ?'; $args[] = $altMax; }
        if ($network === 'principales') { $where .= ' AND principal = 1'; }

        $pick = function (string $col, string $atCol, string $order) use ($db, $where, $args): ?array {
            $st = $db->prepare("SELECT station_id, name, department, altitude_m, $col AS v, $atCol AS at FROM station_daily
                WHERE $where AND $col IS NOT NULL ORDER BY $col $order LIMIT 1");
            $st->execute($args);
            $r = $st->fetch();
            return $r ? ['temperature_c' => (float) $r['v'], 'station_id' => $r['station_id'], 'name' => $r['name'], 'department' => $r['department'],
                'altitude_m' => (int) $r['altitude_m'], 'observed_at' => gmdate('c', strtotime($r['at'] . ' UTC'))] : null;
        };
        $max = $pick('tmax', 'tmax_at', 'DESC');
        if ($max === null) {
            App::error(503, 'no_fresh_data', 'Aucune donnee recente pour ce filtre.');
        }
        $cnt = $db->prepare("SELECT COUNT(*) n, MAX(updated_at) u FROM station_daily WHERE $where");
        $cnt->execute($args);
        $c = $cnt->fetch();
        $run = $db->query("SELECT departments_ok, departments_total, finished_at FROM collector_runs WHERE name='extremes' AND status='ok' ORDER BY finished_at DESC LIMIT 1")->fetch();
        $updated = gmdate('c', strtotime($c['u'] . ' UTC'));
        $complete = $run && $run['departments_ok'] === $run['departments_total'];
        App::ok(['day' => $day, 'max' => $max, 'min' => $pick('tmin', 'tmin_at', 'ASC')], [
            'source' => 'Meteo-France, observations horaires (DPObs, DPPaquetObs), retraitees par Alertes-Meteo',
            'updated_at' => $updated,
            'stale' => time() - strtotime($c['u'] . ' UTC') > 3 * 3600,
            'filters' => ['altitude_max' => $altMax, 'stations' => $network],
            'coverage' => ['stations_considered' => (int) $c['n'], 'departments_ok' => (int) ($run['departments_ok'] ?? 0),
                'departments_total' => (int) ($run['departments_total'] ?? 0), 'complete' => $complete],
            'notice' => 'Extremes du jour parmi les stations collectees, pas des records officiels. Donnees non validees.',
        ]);
    }

    if ($path === '/v1/vigilance' && $method === 'GET') {
        Auth::guard('vigilance');
        $domain = $_GET['domain'] ?? null;
        if ($domain !== null && !preg_match('/^(\d{2}|2[AB])(10)?$/', (string) $domain)) {
            App::error(422, 'invalid_domain', 'domain : code departement (ex. 30, 2A) ou zone cotiere (ex. 3010).');
        }
        $ech = $_GET['echeance'] ?? null;
        if ($ech !== null && !in_array($ech, ['J', 'J1'], true)) {
            App::error(422, 'invalid_echeance', 'echeance : J (aujourd\'hui) ou J1 (demain).');
        }
        $minLevel = filter_input(INPUT_GET, 'min_level', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 4]]);
        if (isset($_GET['min_level']) && !$minLevel) {
            App::error(422, 'invalid_min_level', 'min_level : 1 (vert) a 4 (rouge).');
        }
        $minLevel = $minLevel ?: 2;

        $db = App::db();
        $snap = $db->query('SELECT product_datetime, fetched_at FROM vigilance_snapshot WHERE id = 1')->fetch();
        if (!$snap) {
            App::error(503, 'no_data', 'Aucune donnee de vigilance disponible.');
        }
        $sql = 'SELECT echeance, domain_id, phenomenon_id, color_id, begin_time, end_time FROM vigilance_items WHERE color_id >= ?';
        $args = [$minLevel];
        if ($domain !== null) {
            $sql .= strlen((string) $domain) === 4 ? ' AND domain_id = ?' : ' AND domain_id IN (?, ?)';
            $args[] = $domain;
            if (strlen((string) $domain) === 2) {
                $args[] = $domain . '10';
            }
        }
        if ($ech !== null) {
            $sql .= ' AND echeance = ?';
            $args[] = $ech;
        }
        $st = $db->prepare($sql . ' ORDER BY echeance, domain_id, phenomenon_id, begin_time');
        $st->execute($args);
        $phen = [1 => 'vent violent', 2 => 'pluie-inondation', 3 => 'orages', 4 => 'crues', 5 => 'neige-verglas', 6 => 'canicule', 7 => 'grand froid', 8 => 'avalanches', 9 => 'vagues-submersion'];
        $col = [1 => 'vert', 2 => 'jaune', 3 => 'orange', 4 => 'rouge'];
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $iso = static fn(string $t): string => gmdate('c', strtotime($t . ' UTC'));
            $d = &$out[$r['echeance']][$r['domain_id']];
            $d['domain_id'] = $r['domain_id'];
            $d['max_level'] = max($d['max_level'] ?? 0, (int) $r['color_id']);
            $d['phenomena'][] = ['phenomenon_id' => (int) $r['phenomenon_id'], 'phenomenon' => $phen[(int) $r['phenomenon_id']] ?? null,
                'level' => (int) $r['color_id'], 'color' => $col[(int) $r['color_id']], 'begin' => $iso($r['begin_time']), 'end' => $iso($r['end_time'])];
            unset($d);
        }
        $periods = [];
        foreach ($out as $e => $doms) {
            $periods[] = ['echeance' => $e, 'domains' => array_values($doms)];
        }
        $age = time() - strtotime($snap['fetched_at'] . ' UTC');
        App::ok(['periods' => $periods], [
            'source' => 'Meteo-France, produit DPVigilance, retraite par Alertes-Meteo',
            'product_at' => gmdate('c', strtotime($snap['product_datetime'] . ' UTC')),
            'updated_at' => gmdate('c', strtotime($snap['fetched_at'] . ' UTC')),
            'stale' => $age > 45 * 60,
            'filters' => ['domain' => $domain, 'echeance' => $ech, 'min_level' => $minLevel],
            'notice' => 'Service non officiel, a titre informatif. Reference : vigilance.meteofrance.fr.',
        ]);
    }

    App::error(404, 'not_found', 'Endpoint inconnu.');
} catch (PDOException $e) {
    error_log('DB: ' . $e->getMessage());
    App::error(503, 'service_unavailable', 'Service temporairement indisponible.');
}
