<?php
declare(strict_types=1);

/**
 * Administration en ligne de commande (meme logique que /v1/admin/*).
 *   php cron/admin.php list
 *   php cron/admin.php show <id>
 *   php cron/admin.php approve <id>     cree la cle (2 ans) et l'envoie par email
 *   php cron/admin.php reject <id>
 *   php cron/admin.php revoke <prefixe>
 *   php cron/admin.php suspend <email>
 *   php cron/admin.php switch <nom> on|off [motif]   nom : sun, rain... ou collector:<nom>
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/Auth.php';
require __DIR__ . '/../src/Admin.php';

$cmd = $argv[1] ?? '';
$arg = $argv[2] ?? '';

switch ($cmd) {
    case 'list':
        foreach (Admin::pending() as $r) {
            echo "#{$r['id']}  {$r['created_at']}  {$r['name']} <{$r['email']}>\n";
        }
        break;
    case 'show':
        foreach (Admin::pending() as $r) {
            if ((string) $r['id'] === $arg) {
                print_r($r);
            }
        }
        break;
    case 'approve':
        $r = Admin::approve((int) $arg);
        if (!$r) {
            exit("Demande introuvable ou deja traitee.\n");
        }
        echo $r['emailed'] ? "Approuvee, email envoye.\n" : "Approuvee, mais l'email a echoue. Cle a transmettre manuellement : {$r['key']}\n";
        break;
    case 'reject':
        echo Admin::reject((int) $arg) ? "Rejetee.\n" : "Demande introuvable ou deja traitee.\n";
        break;
    case 'revoke':
        echo Admin::revoke($arg) . " cle(s) revoquee(s).\n";
        break;
    case 'suspend':
        echo Admin::setAccountStatus($arg, 'suspended') . " compte(s) suspendu(s).\n";
        break;
    case 'switch':
        $state = $argv[3] ?? '';
        if (!Admin::validSwitch($arg) || !in_array($state, ['on', 'off'], true)) {
            exit("Usage : switch <nom> on|off [motif]. Noms : " . implode(', ', Admin::ENDPOINTS) . ', collector:<' . implode('|', Admin::COLLECTORS) . ">\n");
        }
        Admin::setSwitch($arg, $state === 'off', $argv[4] ?? null);
        echo "$arg : " . ($state === 'off' ? 'desactive' : 'actif') . "\n";
        break;
    default:
        echo "Commandes : list, show <id>, approve <id>, reject <id>, revoke <prefixe>, suspend <email>, switch <nom> on|off [motif]\n";
}
