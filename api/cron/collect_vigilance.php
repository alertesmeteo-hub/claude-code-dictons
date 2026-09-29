<?php
declare(strict_types=1);

/**
 * Collecteur de vigilance. CLI uniquement, cron toutes les heures :
 *   php cron/collect_vigilance.php
 *
 * Source principale : API Meteo-France DPVigilance (cartevigilance/encours), cle METEOFRANCE_API_KEY du .env.
 * Repli : vigilance.json produit par le workflow GitHub (VIGILANCE_SOURCE_URL), utilise si la cle est absente
 * ou si l'appel Meteo-France echoue. La source retenue est indiquee dans am_collector_runs.message.
 * Le repli GitHub depend des crons `schedule` de GitHub, qui ne s'executent qu'en partie (quelques fois par jour).
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/App.php';

if (App::switchOff('collector:vigilance')) {
    echo "Collecteur desactive (interrupteur d'urgence)
";
    exit(0);
}

function logRun(string $status, string $msg, int $domains): void
{
    App::db()->prepare('INSERT INTO am_collector_runs (name, status, message, departments_ok, departments_total, finished_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())')
        ->execute(['vigilance', $status, mb_substr($msg, 0, 255), $domains, $domains]);
}

function utc(string $iso): string
{
    return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

/** Carte brute depuis l'API Meteo-France (meme appel que scripts/cron-vigilance-meteo.ts). */
function fetchMeteoFrance(): array
{
    $key = App::env('METEOFRANCE_API_KEY');
    if ($key === '') {
        throw new RuntimeException('METEOFRANCE_API_KEY vide');
    }
    $ch = curl_init('https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['apikey: ' . $key, 'Accept: application/json'],
    ]);
    $raw = false;
    $code = 0;
    $err = '';
    for ($try = 1; $try <= 3; $try++) {
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        if ($raw !== false && $code === 200) {
            break;
        }
        if ($code !== 429 && $code < 500 && $code !== 0) {
            break; // 401/403/404 : reessayer ne sert a rien
        }
        if ($try < 3) {
            sleep($try * 5);
        }
    }
    curl_close($ch);
    if ($raw === false || $code !== 200) {
        throw new RuntimeException('HTTP ' . $code . ($err !== '' ? ' ' . $err : ''));
    }
    $doc = json_decode($raw, true);
    if (!is_array($doc)) {
        throw new RuntimeException('reponse non JSON');
    }
    return $doc;
}

/** Carte depuis le vigilance.json publie par le workflow GitHub (schema_version 2, cle `carte`). */
function fetchGithub(): array
{
    $url = App::env('VIGILANCE_SOURCE_URL');
    if (!str_starts_with($url, 'https://')) {
        throw new RuntimeException('VIGILANCE_SOURCE_URL manquante ou non HTTPS');
    }
    $raw = false;
    for ($try = 1; $try <= 3 && $raw === false; $try++) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FAILONERROR => true]);
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
    if (($doc['schema_version'] ?? null) !== 2 || !is_array($doc['carte'] ?? null)) {
        throw new RuntimeException('Structure vigilance.json inattendue');
    }
    return $doc['carte'];
}

$domains = 0;
try {
    $source = 'Meteo-France';
    $repli = null;
    try {
        $carte = fetchMeteoFrance();
    } catch (Throwable $e) {
        $repli = $e->getMessage();
        fwrite(STDERR, "Meteo-France indisponible ($repli), repli GitHub\n");
        $carte = fetchGithub();
        $source = 'repli GitHub (' . $repli . ')';
    }

    // Validation stricte du contrat attendu
    $product = $carte['product'] ?? null;
    $productIso = $carte['meta']['product_datetime'] ?? ($product['update_time'] ?? null);
    if (!is_array($product['periods'] ?? null) || !is_string($productIso)) {
        throw new RuntimeException('Structure de la carte de vigilance inattendue');
    }
    $productAt = utc($productIso);
    if (strtotime($productAt . ' UTC') < time() - 3 * 86400) {
        throw new RuntimeException('Produit source trop ancien (' . $productAt . ' UTC)');
    }

    $rows = [];
    $seen = [];
    foreach ($product['periods'] as $p) {
        $ech = (string) ($p['echeance'] ?? '');
        foreach ($p['timelaps']['domain_ids'] ?? [] as $d) {
            $dom = (string) ($d['domain_id'] ?? '');
            if (!preg_match('/^(\d{2}|2[AB])(10)?$/', $dom) || !preg_match('/^J\d?$/', $ech)) {
                continue;
            }
            $seen[$dom] = true;
            foreach ($d['phenomenon_items'] ?? [] as $ph) {
                foreach ($ph['timelaps_items'] ?? [] as $t) {
                    $color = (int) ($t['color_id'] ?? 0);
                    if ($color < 1 || $color > 4 || !isset($t['begin_time'], $t['end_time'])) {
                        continue;
                    }
                    $rows[] = [$ech, $dom, (int) $ph['phenomenon_id'], $color, utc($t['begin_time']), utc($t['end_time'])];
                }
            }
        }
    }
    $domains = count($seen);
    if ($domains < 90) { // metropole : ~96 departements
        throw new RuntimeException("Seulement $domains domaines : donnees jugees incompletes");
    }

    $db = App::db();
    $cur = $db->query('SELECT product_datetime FROM am_vigilance_snapshot WHERE id = 1')->fetchColumn();
    if ($cur === $productAt) {
        $db->exec('UPDATE am_vigilance_snapshot SET fetched_at = UTC_TIMESTAMP() WHERE id = 1');
        logRun('ok', "produit inchange ($productAt UTC) - source : $source", $domains);
        echo "Produit inchange\n";
        exit(0);
    }
    $db->beginTransaction();
    $db->exec('DELETE FROM am_vigilance_items');
    $ins = $db->prepare('INSERT INTO am_vigilance_items (echeance, domain_id, phenomenon_id, color_id, begin_time, end_time) VALUES (?, ?, ?, ?, ?, ?)');
    foreach ($rows as $r) {
        $ins->execute($r);
    }
    $db->prepare('INSERT INTO am_vigilance_snapshot (id, product_datetime, fetched_at) VALUES (1, ?, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE product_datetime = VALUES(product_datetime), fetched_at = UTC_TIMESTAMP()')->execute([$productAt]);
    $db->commit();
    logRun('ok', count($rows) . " lignes ($productAt UTC) - source : $source", $domains);
    echo count($rows) . " lignes, $domains domaines\n";
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, 'Echec : ' . $e->getMessage() . "\n");
    try {
        logRun('error', $e->getMessage(), $domains);
    } catch (Throwable) {
    }
    exit(1);
}
