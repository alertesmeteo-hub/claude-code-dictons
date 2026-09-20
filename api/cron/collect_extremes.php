<?php
declare(strict_types=1);

/**
 * Collecteur des extremes du jour (Meteo-France DPObs + DPPaquetObs).
 * CLI uniquement : php cron/collect_extremes.php   (cron OVH toutes les heures)
 * ~100 appels espaces de 1,5 s : prevoir ~3 minutes d'execution.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../src/App.php';

if (App::switchOff('collector:extremes')) {
    echo "Collecteur desactive (interrupteur d'urgence)
";
    exit(0);
}

const DPOBS = 'https://public-api.meteofrance.fr/public/DPObs/v1';
const DPPAQUET = 'https://public-api.meteofrance.fr/public/DPPaquetObs/v1';
const PAUSE_US = 1_500_000;

function mfGet(string $url): string
{
    $key = App::env('METEOFRANCE_API_KEY');
    if ($key === '' || $key === 'changeme') throw new RuntimeException('METEOFRANCE_API_KEY manquante');
    $last = '';
    for ($try = 1; $try <= 3; $try++) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_HTTPHEADER => ["apikey: $key"]]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body !== false && $code >= 200 && $code < 300) return $body;
        $last = "HTTP $code";
        if ($code !== 0 && $code !== 429 && $code < 500) break;
        sleep($try * 5);
    }
    throw new RuntimeException($last);
}

function parisDay(string $iso): string
{
    return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('Europe/Paris'))->format('Y-m-d');
}

/** @return array<string,array{name:string,dep:string,alt:float,main:bool}> */
function listStations(): array
{
    $lines = preg_split('/\r?\n/', trim(mfGet(DPOBS . '/liste-stations')));
    $head = explode(';', array_shift($lines));
    $idx = [];
    foreach (['Id_station', 'Nom_usuel', 'Altitude', 'Pack'] as $c) {
        $i = array_search($c, $head, true);
        if ($i === false) throw new RuntimeException('Colonnes inattendues dans liste-stations');
        $idx[$c] = $i;
    }
    $out = [];
    foreach ($lines as $l) {
        $c = explode(';', $l);
        $id = $c[$idx['Id_station']] ?? '';
        $alt = $c[$idx['Altitude']] ?? '';
        if (strlen($id) !== 8 || !is_numeric($alt)) continue;
        $out[$id] = ['name' => mb_substr($c[$idx['Nom_usuel']], 0, 80), 'dep' => substr($id, 0, 2), 'alt' => (float) $alt, 'main' => trim($c[$idx['Pack']] ?? '') === 'RADOME'];
    }
    return $out;
}

function logRun(string $status, string $msg, int $ok, int $total): void
{
    App::db()->prepare('INSERT INTO collector_runs (name,status,message,departments_ok,departments_total,finished_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP())')
        ->execute(['extremes', $status, mb_substr($msg, 0, 255), $ok, $total]);
}

$total = 0; $okDeps = 0;
try {
    $stations = listStations();
    $deps = array_values(array_unique(array_map(fn($s) => $s['dep'], $stations)));
    $deps = array_filter($deps, fn($d) => ctype_digit($d) && (int) $d <= 95);
    sort($deps);
    $total = count($deps);
    $today = parisDay('now');
    $agg = []; // id => [tmax, tmax_at, tmin, tmin_at]

    foreach ($deps as $dep) {
        $variants = $dep === '20' ? ['2A', '2B', '20'] : array_values(array_unique([$dep, ltrim($dep, '0')]));
        $obs = []; $accepted = false;
        foreach ($variants as $v) {
            try {
                $obs = array_merge($obs, json_decode(mfGet(DPPAQUET . '/paquet/horaire?id-departement=' . urlencode($v) . '&format=json'), true, 512, JSON_THROW_ON_ERROR));
                $accepted = true;
                if ($dep !== '20') break;
            } catch (Throwable $e) { /* essaie l'ecriture suivante */ }
            if ($dep === '20') usleep(PAUSE_US);
        }
        if ($accepted) $okDeps++; else fwrite(STDERR, "Departement $dep ignore\n");
        foreach ($obs as $o) {
            $id = $o['geo_id_insee'] ?? '';
            if (!isset($stations[$id]) || !isset($o['validity_time']) || parisDay($o['validity_time']) !== $today) continue;
            $hi = $o['tx'] ?? $o['t'] ?? null;
            $lo = $o['tn'] ?? $o['t'] ?? null;
            $a = &$agg[$id];
            if ($hi !== null) { $v = round($hi - 273.15, 1); if (!isset($a[0]) || $v > $a[0]) { $a[0] = $v; $a[1] = $o['validity_time']; } }
            if ($lo !== null) { $v = round($lo - 273.15, 1); if (!isset($a[2]) || $v < $a[2]) { $a[2] = $v; $a[3] = $o['validity_time']; } }
            unset($a);
        }
        usleep(PAUSE_US);
    }

    if ($total - $okDeps > $total * 0.2) throw new RuntimeException(($total - $okDeps) . "/$total departements en echec");
    if (!$agg) throw new RuntimeException('Aucune observation du jour');

    $utc = fn(?string $iso) => $iso ? (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s') : null;
    $st = App::db()->prepare('INSERT INTO station_daily (day,station_id,name,department,altitude_m,principal,tmax,tmax_at,tmin,tmin_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE name=VALUES(name), altitude_m=VALUES(altitude_m), principal=VALUES(principal), tmax=VALUES(tmax), tmax_at=VALUES(tmax_at), tmin=VALUES(tmin), tmin_at=VALUES(tmin_at), updated_at=UTC_TIMESTAMP()');
    foreach ($agg as $id => $a) {
        $s = $stations[$id];
        $st->execute([$today, $id, $s['name'], $s['dep'], (int) round($s['alt']), (int) $s['main'], $a[0] ?? null, $utc($a[1] ?? null), $a[2] ?? null, $utc($a[3] ?? null)]);
    }
    App::db()->prepare('DELETE FROM station_daily WHERE day < DATE_SUB(?, INTERVAL 7 DAY)')->execute([$today]);
    logRun('ok', count($agg) . ' stations', $okDeps, $total);
    echo count($agg) . " stations, $okDeps/$total departements\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Echec : ' . $e->getMessage() . "\n");
    try { logRun('error', $e->getMessage(), $okDeps, $total); } catch (Throwable) {}
    exit(1);
}
