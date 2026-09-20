<?php
declare(strict_types=1);

/**
 * Collecteur de vigilance : lit le vigilance.json produit par le workflow GitHub existant
 * (aucun appel a Meteo-France depuis l'hebergement). CLI uniquement, cron toutes les 15 min :
 *   php cron/collect_vigilance.php
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

$domains = 0;
try {
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

    // Validation stricte du contrat attendu
    $product = $doc['carte']['product'] ?? null;
    if (($doc['schema_version'] ?? null) !== 2 || !is_array($product['periods'] ?? null) || !isset($doc['carte']['meta']['product_datetime'])) {
        throw new RuntimeException('Structure vigilance.json inattendue');
    }
    $productAt = utc($doc['carte']['meta']['product_datetime']);
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
        logRun('ok', "produit inchange ($productAt UTC)", $domains);
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
    logRun('ok', count($rows) . " lignes ($productAt UTC)", $domains);
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
