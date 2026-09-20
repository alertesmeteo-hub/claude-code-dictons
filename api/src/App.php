<?php
declare(strict_types=1);

final class App
{
    private static ?PDO $pdo = null;

    public static function env(string $k): string
    {
        static $env = null;
        if ($env === null) {
            $env = [];
            $f = __DIR__ . '/../.env';
            if (is_file($f)) {
                foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $l) {
                    if ($l[0] !== '#' && str_contains($l, '=')) {
                        [$a, $b] = explode('=', $l, 2);
                        $env[trim($a)] = trim($b);
                    }
                }
            }
        }
        return $env[$k] ?? (getenv($k) ?: '');
    }

    public static function db(): PDO
    {
        if (self::$pdo === null) {
            $pdo = new PDO(self::env('DB_DSN'), self::env('DB_USER'), self::env('DB_PASS'), [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            self::ensureSchema($pdo);
            self::$pdo = $pdo;
        }
        return self::$pdo;
    }

    /**
     * Cree les tables manquantes au premier appel (aucun SQL a coller dans phpMyAdmin).
     * schema.sql est idempotent (CREATE TABLE IF NOT EXISTS) ; il est rejoue quand son contenu change.
     * Limite : ne gere pas les ALTER sur des tables existantes.
     */
    private static function ensureSchema(PDO $pdo): void
    {
        $file = __DIR__ . '/../schema.sql';
        $sql = is_file($file) ? (string) file_get_contents($file) : '';
        if ($sql === '') {
            return;
        }
        $hash = md5($sql);
        $pdo->exec('CREATE TABLE IF NOT EXISTS am_schema_meta (id TINYINT UNSIGNED PRIMARY KEY, hash CHAR(32) NOT NULL) ENGINE=InnoDB');
        if ($pdo->query('SELECT hash FROM am_schema_meta WHERE id = 1')->fetchColumn() === $hash) {
            return;
        }
        $clean = preg_replace('/--[^\n]*/', '', $sql);
        foreach (array_filter(array_map('trim', explode(';', $clean))) as $stmt) {
            $pdo->exec($stmt);
        }
        $pdo->prepare('INSERT INTO am_schema_meta (id, hash) VALUES (1, ?) ON DUPLICATE KEY UPDATE hash = VALUES(hash)')->execute([$hash]);
    }

    /** Vrai si l'interrupteur d'urgence de ce nom est actif. */
    public static function switchOff(string $name): bool
    {
        $st = self::db()->prepare('SELECT 1 FROM am_kill_switch WHERE name = ? AND disabled = 1');
        $st->execute([$name]);
        return (bool) $st->fetchColumn();
    }

    public static function json(int $status, array $body, array $headers = []): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Headers: X-API-Key, X-Admin-Token, Content-Type');
        header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
        foreach ($headers as $k => $v) {
            header("$k: $v");
        }
        if ($status !== 204) {
            echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        exit;
    }

    public static function error(int $status, string $code, string $message, array $headers = []): never
    {
        self::json($status, ['error' => ['code' => $code, 'message' => $message]], $headers);
    }

    public static function ok(array $data, array $meta = []): never
    {
        $meta += ['version' => 'v1', 'units' => 'metric', 'generated_at' => gmdate('c')];
        // Attribution a afficher par les sites qui reutilisent les donnees (lien vers Alertes-Meteo.com)
        $fromMeteoFrance = str_contains((string) ($meta['source'] ?? ''), 'Meteo-France');
        $meta['attribution'] = [
            'text' => $fromMeteoFrance ? 'Source : Météo-France, données retraitées par Alertes-Meteo.com' : 'Données fournies par Alertes-Meteo.com',
            'url' => 'https://www.alertes-meteo.com',
        ];
        self::json(200, ['data' => $data, 'meta' => $meta]);
    }
}
