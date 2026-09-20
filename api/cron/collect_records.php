<?php
declare(strict_types=1);

/**
 * Collecteur des records de temperature CALCULES (live.json du depot harmonie-knmi).
 * CLI uniquement, cron toutes les 30 min : php cron/collect_records.php
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/App.php';

if (App::switchOff('collector:records')) {
    echo "Collecteur desactive (interrupteur d'urgence)
";
    exit(0);
}

function logRun(string $status, string $msg, int $ok, int $total): void
{
    App::db()->prepare('INSERT INTO collector_runs (name, status, message, departments_ok, departments_total, finished_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())')
        ->execute(['records', $status, mb_substr($msg, 0, 255), $ok, $total]);
}

function utc(string $iso): string
{
    return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

$depOk = 0;
$depTotal = 0;
try {
    $url = App::env('RECORDS_SOURCE_URL');
    if (!str_starts_with($url, 'https://')) {
        throw new RuntimeException('RECORDS_SOURCE_URL manquante ou non HTTPS');
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

    if (($doc['schema_version'] ?? null) !== 1 || ($doc['status'] ?? null) !== 'ok' || !isset($doc['day']['events'], $doc['day']['date'], $doc['generated_at'])) {
        throw new RuntimeException('Structure live.json inattendue');
    }
    $depOk = (int) ($doc['coverage_departments'] ?? 0);
    $depTotal = (int) ($doc['coverage_target'] ?? 0);
    $generated = utc($doc['generated_at']);
    if (strtotime($generated . ' UTC') < time() - 6 * 3600) {
        throw new RuntimeException('Fichier source trop ancien (' . $generated . ' UTC)');
    }

    $rows = [];
    foreach (['heat', 'cold', 'tropical'] as $kind) {
        foreach ($doc['day']['events'][$kind] ?? [] as $e) {
            $v = $e['value'] ?? null;
            // Garde-fou : une valeur hors plage physique (ex. kelvins) invalide tout le lot
            if (!is_numeric($v) || $v < -60 || $v > 60) {
                throw new RuntimeException("Valeur aberrante ({$e['id']} : $v) : donnees rejetees");
            }
            $flags = $e['flags'] ?? [];
            if (!$flags || !preg_match('/^[0-9A-Z]{8}$/', (string) ($e['id'] ?? ''))) {
                continue; // seuls les vrais records ; les quasi-records sont ignores
            }
            $rows[] = [$kind, $e['id'], mb_substr((string) $e['name'], 0, 80), substr((string) ($e['department_code'] ?? ''), 0, 2),
                isset($e['region']) ? mb_substr((string) $e['region'], 0, 60) : null, isset($e['altitude']) ? (int) round((float) $e['altitude']) : null,
                round((float) $v, 1), (int) in_array('absolute', $flags, true), (int) in_array('monthly', $flags, true),
                (int) in_array('fortnight', $flags, true), (int) in_array('daily', $flags, true),
                json_encode($e['records'] ?? new stdClass(), JSON_UNESCAPED_UNICODE)];
        }
    }
    if ($depTotal < 1 || $depOk < $depTotal * 0.8) {
        throw new RuntimeException("Couverture insuffisante ($depOk/$depTotal departements)");
    }

    $db = App::db();
    $cur = $db->query('SELECT generated_at FROM records_snapshot WHERE id = 1')->fetchColumn();
    if ($cur === $generated) {
        $db->exec('UPDATE records_snapshot SET fetched_at = UTC_TIMESTAMP() WHERE id = 1');
        logRun('ok', "source inchangee ($generated UTC)", $depOk, $depTotal);
        echo "Source inchangee\n";
        exit(0);
    }
    $db->beginTransaction();
    $db->exec('DELETE FROM records_events');
    $ins = $db->prepare('INSERT INTO records_events (kind, station_id, name, department, region, altitude_m, value, is_absolute, is_monthly, is_fortnight, is_daily, refs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
    foreach ($rows as $r) {
        $ins->execute($r);
    }
    $db->prepare('INSERT INTO records_snapshot (id, day, generated_at, latest_observation_at, departments_ok, departments_total, fetched_at)
        VALUES (1, ?, ?, ?, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE day = VALUES(day), generated_at = VALUES(generated_at),
        latest_observation_at = VALUES(latest_observation_at), departments_ok = VALUES(departments_ok), departments_total = VALUES(departments_total), fetched_at = UTC_TIMESTAMP()')
        ->execute([$doc['day']['date'], $generated, isset($doc['latest_observation_at']) ? utc($doc['latest_observation_at']) : null, $depOk, $depTotal]);
    $db->commit();
    logRun('ok', count($rows) . " records ($generated UTC)", $depOk, $depTotal);
    echo count($rows) . " records, couverture $depOk/$depTotal\n";
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, 'Echec : ' . $e->getMessage() . "\n");
    try {
        logRun('error', $e->getMessage(), $depOk, $depTotal);
    } catch (Throwable) {
    }
    exit(1);
}
