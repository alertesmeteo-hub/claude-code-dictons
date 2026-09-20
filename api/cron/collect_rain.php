<?php
declare(strict_types=1);

/**
 * Collecteur de pluie observee, metropole uniquement (observations_pluie.json de harmonie-knmi).
 * CLI uniquement, cron toutes les 20 min : php cron/collect_rain.php
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/App.php';

function logRun(string $status, string $msg, int $n): void
{
    App::db()->prepare('INSERT INTO collector_runs (name, status, message, departments_ok, departments_total, finished_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())')
        ->execute(['rain', $status, mb_substr($msg, 0, 255), $n, $n]);
}

function utc(string $iso): string
{
    return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

/** Nombre borne, ou NULL si absent ; leve une exception si hors plage physique. */
function mm(mixed $v, float $max, string $label, string $id): ?float
{
    if ($v === null) {
        return null;
    }
    if (!is_numeric($v) || $v < 0 || $v > $max) {
        throw new RuntimeException("Valeur aberrante $label ($id : $v) : donnees rejetees");
    }
    return round((float) $v, 1);
}

function flag(mixed $v): ?int
{
    return $v === null ? null : (int) (bool) $v;
}

$n = 0;
try {
    $url = App::env('RAIN_SOURCE_URL');
    if (!str_starts_with($url, 'https://')) {
        throw new RuntimeException('RAIN_SOURCE_URL manquante ou non HTTPS');
    }
    $raw = false;
    for ($try = 1; $try <= 3 && $raw === false; $try++) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FAILONERROR => true, CURLOPT_ENCODING => '']);
        $raw = curl_exec($ch);
        curl_close($ch);
        if ($raw === false && $try < 3) {
            sleep($try * 5);
        }
    }
    if ($raw === false) {
        throw new RuntimeException('Telechargement impossible');
    }
    $doc = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (($doc['schema_version'] ?? null) !== 5 || ($doc['status'] ?? null) !== 'ok' || ($doc['unit'] ?? null) !== 'mm'
        || !is_array($doc['stations'] ?? null) || !isset($doc['generated_at'])) {
        throw new RuntimeException('Structure observations_pluie.json inattendue');
    }
    $generated = utc($doc['generated_at']);
    if (strtotime($generated . ' UTC') < time() - 6 * 3600) {
        throw new RuntimeException('Fichier source trop ancien (' . $generated . ' UTC)');
    }

    $rows = [];
    foreach ($doc['stations'] as $s) {
        $dep = (string) ($s['department'] ?? '');
        $id = (string) ($s['id'] ?? '');
        if (!preg_match('/^(\d{2}|2[AB])$/', $dep) || ($dep !== '2A' && $dep !== '2B' && ((int) $dep < 1 || (int) $dep > 95))) {
            continue; // metropole uniquement
        }
        if (!preg_match('/^[0-9A-Z]{8}$/', $id)) {
            continue;
        }
        $rows[] = [$id, mb_substr((string) ($s['name'] ?? ''), 0, 80), $dep,
            isset($s['lat']) ? round((float) $s['lat'], 5) : null, isset($s['lon']) ? round((float) $s['lon'], 5) : null,
            isset($s['date']) ? utc($s['date']) : null,
            mm($s['rr1'] ?? null, 200, 'rr1', $id),
            mm($s['rr24'] ?? null, 1000, 'rr24', $id), isset($s['rr24_hours']) ? (int) $s['rr24_hours'] : null, flag($s['rr24_complete'] ?? null),
            mm($s['rr48'] ?? null, 1500, 'rr48', $id), isset($s['rr48_hours']) ? (int) $s['rr48_hours'] : null, flag($s['rr48_complete'] ?? null),
            mm($s['rr72'] ?? null, 2000, 'rr72', $id), isset($s['rr72_hours']) ? (int) $s['rr72_hours'] : null, flag($s['rr72_complete'] ?? null),
            mm($s['rr_month_current'] ?? null, 2500, 'mois', $id), flag($s['rr_month_current_complete'] ?? null),
            mm($s['rr_season_current'] ?? null, 5000, 'saison', $id), flag($s['rr_season_current_complete'] ?? null),
            mm($s['rr_year_current'] ?? null, 9000, 'annee', $id), flag($s['rr_year_current_complete'] ?? null),
            mm($s['rr_month_mean'] ?? null, 1500, 'normale mois', $id), mm($s['rr_year_mean'] ?? null, 6000, 'normale annee', $id)];
    }
    $n = count($rows);
    if ($n < 1000) {
        throw new RuntimeException("Seulement $n stations metropolitaines : donnees jugees incompletes");
    }

    $db = App::db();
    $cur = $db->query('SELECT generated_at FROM rain_snapshot WHERE id = 1')->fetchColumn();
    if ($cur === $generated) {
        $db->exec('UPDATE rain_snapshot SET fetched_at = UTC_TIMESTAMP() WHERE id = 1');
        logRun('ok', "source inchangee ($generated UTC)", $n);
        echo "Source inchangee\n";
        exit(0);
    }
    $db->beginTransaction();
    $db->exec('DELETE FROM rain_stations');
    $ins = $db->prepare('INSERT INTO rain_stations (station_id, name, department, lat, lon, observed_at, rr1, rr24, rr24_hours, rr24_complete,
        rr48, rr48_hours, rr48_complete, rr72, rr72_hours, rr72_complete, rr_month, rr_month_complete, rr_season, rr_season_complete,
        rr_year, rr_year_complete, rr_month_mean, rr_year_mean) VALUES (' . implode(',', array_fill(0, 24, '?')) . ')
        ON DUPLICATE KEY UPDATE name = VALUES(name)');
    foreach ($rows as $r) {
        $ins->execute($r);
    }
    $db->prepare('INSERT INTO rain_snapshot (id, generated_at, latest_observation_at, stations, fetched_at) VALUES (1, ?, ?, ?, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE generated_at = VALUES(generated_at), latest_observation_at = VALUES(latest_observation_at), stations = VALUES(stations), fetched_at = UTC_TIMESTAMP()')
        ->execute([$generated, isset($doc['latest_observation_at']) ? utc($doc['latest_observation_at']) : null, $n]);
    $db->commit();
    logRun('ok', "$n stations ($generated UTC)", $n);
    echo "$n stations\n";
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, 'Echec : ' . $e->getMessage() . "\n");
    try {
        logRun('error', $e->getMessage(), $n);
    } catch (Throwable) {
    }
    exit(1);
}
