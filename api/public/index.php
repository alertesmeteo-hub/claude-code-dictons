<?php
declare(strict_types=1);

require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/Auth.php';
require __DIR__ . '/../src/Sun.php';
require __DIR__ . '/../src/Admin.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/', '/') ?: '/';
if ($method === 'OPTIONS') {
    App::json(204, []);
}

try {
    if ($path === '/v1/health') {
        App::ok(['status' => 'ok']);
    }

    if (str_starts_with($path, '/v1/admin/')) {
        Admin::guard();
        $in = json_decode(file_get_contents('php://input'), true) ?: [];
        if ($path === '/v1/admin/overview' && $method === 'GET') {
            App::ok(Admin::overview());
        }
        if ($path === '/v1/admin/requests' && $method === 'GET') {
            App::ok(['requests' => Admin::pending()]);
        }
        if ($path === '/v1/admin/keys' && $method === 'GET') {
            App::ok(['keys' => Admin::keys()]);
        }
        if (preg_match('#^/v1/admin/requests/(\d+)/(approve|reject)$#', $path, $m) && $method === 'POST') {
            if ($m[2] === 'approve') {
                $r = Admin::approve((int) $m[1]);
                $r ? App::ok($r['emailed'] ? ['email' => $r['email'], 'emailed' => true] : ['email' => $r['email'], 'emailed' => false, 'key' => $r['key']])
                   : App::error(404, 'not_found', 'Demande introuvable ou deja traitee.');
            }
            Admin::reject((int) $m[1]) ? App::ok(['rejected' => true]) : App::error(404, 'not_found', 'Demande introuvable ou deja traitee.');
        }
        if (preg_match('#^/v1/admin/keys/([0-9a-f]{8})/revoke$#', $path, $m) && $method === 'POST') {
            App::ok(['revoked' => Admin::revoke($m[1])]);
        }
        if ($path === '/v1/admin/accounts' && $method === 'POST') {
            $email = strtolower(trim((string) ($in['email'] ?? '')));
            $status = (string) ($in['status'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !in_array($status, ['active', 'suspended'], true)) {
                App::error(422, 'invalid_input', 'email valide et status active|suspended requis.');
            }
            App::ok(['updated' => Admin::setAccountStatus($email, $status)]);
        }
        if ($path === '/v1/admin/switches' && $method === 'POST') {
            $name = (string) ($in['name'] ?? '');
            if (!Admin::validSwitch($name) || !isset($in['disabled'])) {
                App::error(422, 'invalid_input', 'name inconnu ou disabled manquant.');
            }
            Admin::setSwitch($name, (bool) $in['disabled'], isset($in['reason']) ? mb_substr((string) $in['reason'], 0, 190) : null);
            App::ok(['name' => $name, 'disabled' => (bool) $in['disabled']]);
        }
        App::error(404, 'not_found', 'Endpoint admin inconnu.');
    }

    if ($path === '/v1/status' && $method === 'GET') {
        $limits = ['extremes' => 3 * 3600, 'vigilance' => 45 * 60, 'records' => 3 * 3600, 'rain' => 90 * 60]; // age max avant de considerer une source en retard
        $st = App::db()->prepare("SELECT status, message, finished_at FROM am_collector_runs WHERE name = ? ORDER BY finished_at DESC LIMIT 1");
        $sources = [];
        foreach ($limits as $name => $max) {
            $st->execute([$name]);
            $last = $st->fetch();
            $okAt = App::db()->prepare("SELECT MAX(finished_at) FROM am_collector_runs WHERE name = ? AND status = 'ok'");
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
        $snap = $db->query('SELECT day, generated_at, latest_observation_at, departments_ok, departments_total, fetched_at FROM am_records_snapshot WHERE id = 1')->fetch();
        if (!$snap) {
            App::error(503, 'no_data', 'Aucune donnee de records disponible.');
        }
        $where = '1 = 1';
        $args = [];
        if ($kind !== null) { $where .= ' AND kind = ?'; $args[] = $kind; }
        if ($scope !== null) { $where .= ' AND is_' . $scope . ' = 1'; }
        if ($dep !== null) { $where .= ' AND department = ?'; $args[] = $dep; }
        $count = $db->prepare("SELECT COUNT(*) FROM am_records_events WHERE $where");
        $count->execute($args);
        $total = (int) $count->fetchColumn();
        $st = $db->prepare("SELECT * FROM am_records_events WHERE $where ORDER BY kind, CASE WHEN kind = 'cold' THEN value ELSE -value END, station_id LIMIT $limit OFFSET $offset");
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

    if ($path === '/v1/rain' && $method === 'GET') {
        Auth::guard('rain');
        // metrique => [colonne, colonne de completude ou null]
        $metrics = ['rr1' => ['rr1', null], 'rr24' => ['rr24', 'rr24_complete'], 'rr48' => ['rr48', 'rr48_complete'], 'rr72' => ['rr72', 'rr72_complete'],
            'month' => ['rr_month', 'rr_month_complete'], 'season' => ['rr_season', 'rr_season_complete'], 'year' => ['rr_year', 'rr_year_complete']];
        $sort = $_GET['sort'] ?? 'rr24';
        if (!isset($metrics[$sort])) {
            App::error(422, 'invalid_sort', 'sort : rr1, rr24, rr48, rr72, month, season ou year.');
        }
        $dep = $_GET['department'] ?? null;
        if ($dep !== null && !preg_match('/^(\d{2}|2[AB])$/', (string) $dep)) {
            App::error(422, 'invalid_department', 'department : code sur 2 caracteres (ex. 30, 2A).');
        }
        $station = $_GET['station'] ?? null;
        if ($station !== null && !preg_match('/^[0-9A-Z]{8}$/', (string) $station)) {
            App::error(422, 'invalid_station', 'station : identifiant de 8 caracteres.');
        }
        $completeOnly = ($_GET['complete_only'] ?? '0') === '1';
        $limit = filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 200]]);
        $offset = filter_input(INPUT_GET, 'offset', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 100000]]);
        if ((isset($_GET['limit']) && !$limit) || (isset($_GET['offset']) && $offset === false)) {
            App::error(422, 'invalid_pagination', 'limit : 1 a 200 ; offset : entier >= 0.');
        }
        $limit = $limit ?: 50;
        $offset = $offset ?: 0;

        $db = App::db();
        $snap = $db->query('SELECT generated_at, latest_observation_at, stations, fetched_at FROM am_rain_snapshot WHERE id = 1')->fetch();
        if (!$snap) {
            App::error(503, 'no_data', 'Aucune donnee de pluie disponible.');
        }
        [$col, $completeCol] = $metrics[$sort];
        $where = "$col IS NOT NULL";
        $args = [];
        if ($dep !== null) { $where .= ' AND department = ?'; $args[] = $dep; }
        if ($station !== null) { $where .= ' AND station_id = ?'; $args[] = $station; }
        if ($completeOnly && $completeCol !== null) { $where .= " AND $completeCol = 1"; }
        $count = $db->prepare("SELECT COUNT(*) FROM am_rain_stations WHERE $where");
        $count->execute($args);
        $total = (int) $count->fetchColumn();
        $st = $db->prepare("SELECT * FROM am_rain_stations WHERE $where ORDER BY $col DESC, station_id LIMIT $limit OFFSET $offset");
        $st->execute($args);
        $f = static fn($v) => $v === null ? null : (float) $v;
        $b = static fn($v) => $v === null ? null : (bool) $v;
        $i = static fn($v) => $v === null ? null : (int) $v;
        $items = [];
        foreach ($st->fetchAll() as $r) {
            $items[] = ['station_id' => $r['station_id'], 'name' => $r['name'], 'department' => $r['department'], 'lat' => $f($r['lat']), 'lon' => $f($r['lon']),
                'observed_at' => $r['observed_at'] ? gmdate('c', strtotime($r['observed_at'] . ' UTC')) : null,
                'rain_mm' => [
                    'last_hour' => $f($r['rr1']),
                    'last_24h' => ['value' => $f($r['rr24']), 'hours_covered' => $i($r['rr24_hours']), 'complete' => $b($r['rr24_complete'])],
                    'last_48h' => ['value' => $f($r['rr48']), 'hours_covered' => $i($r['rr48_hours']), 'complete' => $b($r['rr48_complete'])],
                    'last_72h' => ['value' => $f($r['rr72']), 'hours_covered' => $i($r['rr72_hours']), 'complete' => $b($r['rr72_complete'])],
                    'month' => ['value' => $f($r['rr_month']), 'complete' => $b($r['rr_month_complete'])],
                    'season' => ['value' => $f($r['rr_season']), 'complete' => $b($r['rr_season_complete'])],
                    'year' => ['value' => $f($r['rr_year']), 'complete' => $b($r['rr_year_complete'])],
                ],
                'normals_1991_2020_mm' => ['month' => $f($r['rr_month_mean']), 'year' => $f($r['rr_year_mean'])]];
        }
        $age = time() - strtotime($snap['generated_at'] . ' UTC');
        App::ok(['total' => $total, 'limit' => $limit, 'offset' => $offset, 'items' => $items], [
            'source' => 'Meteo-France, Package Observations V2 et donnees climatologiques quotidiennes, cumuls calcules par Alertes-Meteo',
            'generated_at' => gmdate('c', strtotime($snap['generated_at'] . ' UTC')),
            'latest_observation_at' => $snap['latest_observation_at'] ? gmdate('c', strtotime($snap['latest_observation_at'] . ' UTC')) : null,
            'updated_at' => gmdate('c', strtotime($snap['fetched_at'] . ' UTC')),
            'stale' => $age > 90 * 60,
            'scope' => 'metropole',
            'stations_in_dataset' => (int) $snap['stations'],
            'filters' => ['sort' => $sort, 'department' => $dep, 'station' => $station, 'complete_only' => $completeOnly],
            'notice' => 'Cumuls provisoires, non valides climatologiquement. Un cumul avec complete=false porte sur moins d\'heures que la periode annoncee : ne pas le presenter comme un cumul complet.',
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
        $db->prepare('INSERT INTO am_signup_throttle (ip_hash, day, n) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE n = n + 1')->execute([$ipHash, $day]);
        $n = $db->prepare('SELECT n FROM am_signup_throttle WHERE ip_hash = ? AND day = ?');
        $n->execute([$ipHash, $day]);
        if ((int) $n->fetchColumn() > 5) {
            App::error(429, 'too_many_requests', 'Trop de demandes aujourd\'hui.');
        }
        $db->prepare('INSERT INTO am_key_requests (name, organization, email, website, usage_description, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())')
            ->execute([$name, $org ?: null, $email, $site ?: null, $usage]);
        $accepted();
    }

    if ($path === '/v1/keys' && $method === 'DELETE') {
        $id = Auth::guard('keys');
        App::db()->prepare('UPDATE am_api_keys SET revoked_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$id]);
        App::ok(['revoked' => true]);
    }

    if ($path === '/v1/usage' && $method === 'GET') {
        $id = Auth::guard('usage');
        $db = App::db();
        $k = $db->prepare('SELECT k.prefix, k.expires_at, u.plan, p.per_minute, p.per_month
            FROM am_api_keys k JOIN am_users u ON u.id = k.user_id JOIN am_plans p ON p.code = u.plan WHERE k.id = ?');
        $k->execute([$id]);
        $key = $k->fetch();
        $used = $db->prepare("SELECT bucket, hits FROM am_usage_counters WHERE key_id = ? AND endpoint = '*' AND bucket IN (?, ?)");
        $used->execute([$id, 'm' . gmdate('YmdHi'), 'M' . gmdate('Ym')]);
        $u = array_column($used->fetchAll(), 'hits', 'bucket');
        $since = 'd' . gmdate('Ymd', time() - 29 * 86400);
        $d = $db->prepare("SELECT bucket, endpoint, hits FROM am_usage_counters WHERE key_id = ? AND bucket LIKE 'd%' AND bucket >= ? ORDER BY bucket DESC LIMIT 500");
        $d->execute([$id, $since]);
        $days = [];
        foreach ($d->fetchAll() as $r) {
            $day = substr($r['bucket'], 1, 4) . '-' . substr($r['bucket'], 5, 2) . '-' . substr($r['bucket'], 7, 2);
            $days[$day]['day'] = $day;
            $days[$day]['total'] = ($days[$day]['total'] ?? 0) + (int) $r['hits'];
            $days[$day]['endpoints'][$r['endpoint']] = (int) $r['hits'];
        }
        App::ok([
            'key_prefix' => $key['prefix'],
            'plan' => $key['plan'],
            'expires_at' => gmdate('c', strtotime($key['expires_at'] . ' UTC')),
            'limits' => ['per_minute' => (int) $key['per_minute'], 'per_month' => (int) $key['per_month']],
            'used' => ['minute' => (int) ($u['m' . gmdate('YmdHi')] ?? 0), 'month' => (int) ($u['M' . gmdate('Ym')] ?? 0)],
            'days' => array_values($days),
        ]);
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
            $st = $db->prepare("SELECT station_id, name, department, altitude_m, $col AS v, $atCol AS at FROM am_station_daily
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
        $cnt = $db->prepare("SELECT COUNT(*) n, MAX(updated_at) u FROM am_station_daily WHERE $where");
        $cnt->execute($args);
        $c = $cnt->fetch();
        $run = $db->query("SELECT departments_ok, departments_total, finished_at FROM am_collector_runs WHERE name='extremes' AND status='ok' ORDER BY finished_at DESC LIMIT 1")->fetch();
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
        $snap = $db->query('SELECT product_datetime, fetched_at FROM am_vigilance_snapshot WHERE id = 1')->fetch();
        if (!$snap) {
            App::error(503, 'no_data', 'Aucune donnee de vigilance disponible.');
        }
        $sql = 'SELECT echeance, domain_id, phenomenon_id, color_id, begin_time, end_time FROM am_vigilance_items WHERE color_id >= ?';
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
