<?php
declare(strict_types=1);

/**
 * Administration en ligne de commande (validation manuelle des cles).
 *   php cron/admin.php list
 *   php cron/admin.php show <id>
 *   php cron/admin.php approve <id>     cree l'utilisateur et une cle valable 2 ans, l'envoie par email
 *   php cron/admin.php reject <id>
 *   php cron/admin.php revoke <prefixe>
 *   php cron/admin.php suspend <email>
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/Auth.php';

$db = App::db();
$cmd = $argv[1] ?? '';
$arg = $argv[2] ?? '';

function pendingRequest(PDO $db, string $id): array
{
    $st = $db->prepare("SELECT * FROM key_requests WHERE id = ? AND status = 'pending'");
    $st->execute([(int) $id]);
    return $st->fetch() ?: exit("Demande introuvable ou deja traitee.\n");
}

switch ($cmd) {
    case 'list':
        foreach ($db->query("SELECT id, created_at, name, email FROM key_requests WHERE status = 'pending' ORDER BY id") as $r) {
            echo "#{$r['id']}  {$r['created_at']}  {$r['name']} <{$r['email']}>\n";
        }
        break;
    case 'show':
        print_r(pendingRequest($db, $arg));
        break;
    case 'approve':
        $r = pendingRequest($db, $arg);
        $db->beginTransaction();
        $db->prepare('INSERT INTO users (email, created_at) VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE id = id')->execute([$r['email']]);
        $uid = $db->prepare('SELECT id FROM users WHERE email = ?');
        $uid->execute([$r['email']]);
        $k = Auth::generate();
        $db->prepare('INSERT INTO api_keys (user_id, prefix, key_hash, expires_at, created_at)
            VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL 2 YEAR, UTC_TIMESTAMP())')
            ->execute([(int) $uid->fetchColumn(), $k['prefix'], Auth::hash($k['key'])]);
        $db->prepare("UPDATE key_requests SET status = 'approved', decided_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$r['id']]);
        $db->commit();
        $body = "Bonjour,\n\nVotre demande de cle pour l'API Alertes-Meteo est approuvee.\n\nCle API : {$k['key']}\n\n"
            . "Envoyez-la dans l'en-tete X-API-Key. Elle est valable 2 ans et n'est affichee qu'ici : conservez-la.\n"
            . "Documentation : https://api.alertes-meteo.com/docs\n";
        $sent = mail($r['email'], 'Votre cle API Alertes-Meteo', $body,
            "From: no-reply@alertes-meteo.com\r\nContent-Type: text/plain; charset=utf-8");
        echo $sent ? "Approuvee, email envoye.\n" : "Approuvee, mais l'email a echoue. Cle a transmettre manuellement : {$k['key']}\n";
        break;
    case 'reject':
        $r = pendingRequest($db, $arg);
        $db->prepare("UPDATE key_requests SET status = 'rejected', decided_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$r['id']]);
        echo "Rejetee.\n";
        break;
    case 'revoke':
        $st = $db->prepare('UPDATE api_keys SET revoked_at = UTC_TIMESTAMP() WHERE prefix = ? AND revoked_at IS NULL');
        $st->execute([$arg]);
        echo $st->rowCount() . " cle(s) revoquee(s).\n";
        break;
    case 'suspend':
        $st = $db->prepare("UPDATE users SET status = 'suspended' WHERE email = ?");
        $st->execute([strtolower($arg)]);
        echo $st->rowCount() . " compte(s) suspendu(s).\n";
        break;
    default:
        echo "Commandes : list, show <id>, approve <id>, reject <id>, revoke <prefixe>, suspend <email>\n";
}
