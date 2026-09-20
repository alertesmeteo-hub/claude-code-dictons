<?php
// FICHIER TEMPORAIRE DE CONTROLE : a supprimer du serveur apres usage.
// Il n'affiche jamais de mot de passe, de cle ni d'adresse de serveur.
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
require __DIR__ . '/src/App.php';

function line(bool $ok, string $label, string $help = ''): void
{
    echo ($ok ? '[OK]   ' : '[ERREUR] ') . $label . ($ok || $help === '' ? '' : "\n         -> $help") . "\n";
}

echo "Controle de l'installation Alertes-Meteo API\n============================================\n\n";

line(version_compare(PHP_VERSION, '8.1.0', '>='), 'PHP ' . PHP_VERSION, 'Choisir PHP 8.1 ou plus dans le manager OVH (Hebergement > Configuration).');
foreach (['pdo_mysql', 'curl', 'mbstring'] as $ext) {
    line(extension_loaded($ext), "Extension $ext", "Extension PHP manquante : $ext.");
}

$envFile = __DIR__ . '/.env';
line(is_file($envFile), 'Fichier .env present a la racine', 'Creer .env a cote de .htaccess (copie de .env.example) et l\'envoyer par FTP. Verifier qu\'il ne s\'appelle pas .env.txt.');

$vars = ['DB_DSN', 'DB_USER', 'DB_PASS', 'IP_SALT', 'ADMIN_TOKEN', 'METEOFRANCE_API_KEY'];
foreach ($vars as $v) {
    $val = App::env($v);
    $filled = $val !== '' && !str_contains($val, 'changeme');
    $extra = '';
    if ($v === 'ADMIN_TOKEN') {
        $filled = strlen($val) >= 32;
        $extra = ' (32 caracteres minimum)';
    }
    line($filled, "Variable $v renseignee$extra", "Renseigner $v dans .env, sans guillemets ni espaces autour du =.");
}

$dsn = App::env('DB_DSN');
line(str_starts_with($dsn, 'mysql:host=') && str_contains($dsn, 'dbname='), 'DB_DSN au bon format', 'Format attendu : mysql:host=ADRESSE;dbname=NOM;charset=utf8mb4');
line(!str_contains($dsn, 'host=localhost') && !str_contains($dsn, 'host=127.0.0.1'), 'DB_DSN n\'utilise pas localhost', 'Chez OVH, utiliser l\'adresse du serveur de base indiquee dans le manager (type xxxx.mysql.db).');

echo "\nConnexion a la base\n-------------------\n";
try {
    $pdo = new PDO($dsn, App::env('DB_USER'), App::env('DB_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    line(true, 'Connexion a la base reussie');
    try {
        $pdo->exec('CREATE TABLE IF NOT EXISTS am_verif (id INT) ENGINE=InnoDB');
        $pdo->exec('DROP TABLE am_verif');
        line(true, 'Droit de creer des tables');
    } catch (PDOException $e) {
        line(false, 'Droit de creer des tables', 'L\'utilisateur de la base n\'a pas le droit CREATE. Verifier les droits dans le manager OVH.');
    }
    $n = (int) $pdo->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()")->fetchColumn();
    echo "         Tables presentes dans la base : $n (les tables se creent au premier appel de l'API)\n";
} catch (PDOException $e) {
    $code = (string) $e->getCode();
    $msg = $e->getMessage();
    $help = match (true) {
        str_contains($msg, '1045') || $code === '1045' => 'Utilisateur ou mot de passe refuse : verifier DB_USER et DB_PASS.',
        str_contains($msg, '1049') || $code === '1049' => 'Nom de base inconnu : verifier dbname= dans DB_DSN.',
        str_contains($msg, '2002') || str_contains($msg, 'getaddrinfo') || str_contains($msg, 'Connection refused') => 'Serveur de base injoignable : verifier host= dans DB_DSN (adresse du manager OVH, pas localhost).',
        str_contains($msg, 'could not find driver') => 'Extension pdo_mysql absente.',
        default => 'Erreur de connexion (code ' . preg_replace('/[^0-9A-Za-z]/', '', $code) . ').',
    };
    line(false, 'Connexion a la base', $help);
}

echo "\nSupprimez ce fichier (verif.php) du serveur des que tout est [OK].\n";
