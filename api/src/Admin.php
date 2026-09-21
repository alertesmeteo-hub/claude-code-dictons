<?php
declare(strict_types=1);

/** Operations d'administration, partagees par /v1/admin/* et cron/admin.php. */
final class Admin
{
    public const ENDPOINTS = ['sun', 'extremes', 'vigilance', 'records', 'rain'];
    public const COLLECTORS = ['extremes', 'vigilance', 'records', 'rain'];

    /** Authentifie l'appel admin (jeton dans X-Admin-Token) ; bloque apres 10 echecs par heure et par IP. */
    public static function guard(): void
    {
        $token = App::env('ADMIN_TOKEN');
        if (strlen($token) < 32) {
            App::error(503, 'admin_disabled', 'Administration desactivee : ADMIN_TOKEN absent ou trop court.');
        }
        $db = App::db();
        $ip = hash('sha256', App::env('IP_SALT') . ($_SERVER['REMOTE_ADDR'] ?? ''));
        $hour = gmdate('YmdH');
        $n = $db->prepare('SELECT n FROM am_admin_failures WHERE ip_hash = ? AND hour = ?');
        $n->execute([$ip, $hour]);
        if ((int) $n->fetchColumn() >= 10) {
            App::error(429, 'too_many_attempts', 'Trop de tentatives. Reessayez plus tard.', ['Retry-After' => '3600']);
        }
        $given = (string) ($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
        if (!hash_equals($token, $given)) {
            $db->prepare('INSERT INTO am_admin_failures (ip_hash, hour, n) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE n = n + 1')->execute([$ip, $hour]);
            $db->prepare('DELETE FROM am_admin_failures WHERE hour < ?')->execute([gmdate('YmdH', time() - 86400)]);
            App::error(401, 'invalid_admin_token', 'Jeton administrateur invalide.');
        }
    }

    public static function overview(): array
    {
        $db = App::db();
        $month = gmdate('Ym');
        $one = static fn(string $sql, array $a = []) => (function () use ($db, $sql, $a) { $s = $db->prepare($sql); $s->execute($a); return $s->fetchColumn(); })();
        $perEndpoint = $db->prepare("SELECT endpoint, SUM(hits) AS hits FROM am_usage_counters WHERE bucket LIKE ? GROUP BY endpoint ORDER BY hits DESC");
        $perEndpoint->execute(['d' . $month . '%']);
        $collectors = [];
        foreach (self::COLLECTORS as $name) {
            $last = $db->prepare('SELECT status, message, finished_at FROM am_collector_runs WHERE name = ? ORDER BY finished_at DESC LIMIT 1');
            $last->execute([$name]);
            $ok = $one("SELECT MAX(finished_at) FROM am_collector_runs WHERE name = ? AND status = 'ok'", [$name]);
            $collectors[] = ['name' => $name, 'last_run' => $last->fetch() ?: null, 'last_success_at' => $ok ?: null];
        }
        return [
            'users' => (int) $one('SELECT COUNT(*) FROM am_users'),
            'active_keys' => (int) $one('SELECT COUNT(*) FROM am_api_keys WHERE revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()'),
            'pending_requests' => (int) $one("SELECT COUNT(*) FROM am_key_requests WHERE status = 'pending'"),
            'requests_this_month' => (int) $one("SELECT COALESCE(SUM(hits), 0) FROM am_usage_counters WHERE endpoint = '*' AND bucket = ?", ['M' . $month]),
            'endpoints_this_month' => $perEndpoint->fetchAll(),
            'collectors' => $collectors,
            'switches' => $db->query('SELECT name, disabled, reason, updated_at FROM am_kill_switch ORDER BY name')->fetchAll(),
        ];
    }

    public static function pending(): array
    {
        return App::db()->query("SELECT id, created_at, name, organization, email, website, usage_description FROM am_key_requests WHERE status = 'pending' ORDER BY id LIMIT 200")->fetchAll();
    }

    public static function keys(): array
    {
        $st = App::db()->prepare("SELECT k.prefix, u.email, u.plan, u.status AS account_status, k.created_at, k.expires_at, k.revoked_at,
            (SELECT COALESCE(SUM(c.hits), 0) FROM am_usage_counters c WHERE c.key_id = k.id AND c.endpoint = '*' AND c.bucket = ?) AS month_hits
            FROM am_api_keys k JOIN am_users u ON u.id = k.user_id ORDER BY k.id DESC LIMIT 200");
        $st->execute(['M' . gmdate('Ym')]);
        return $st->fetchAll();
    }

    /** @return array{email:string,key:string,emailed:bool}|null */
    public static function approve(int $id): ?array
    {
        $db = App::db();
        $st = $db->prepare("SELECT * FROM am_key_requests WHERE id = ? AND status = 'pending'");
        $st->execute([$id]);
        $r = $st->fetch();
        if (!$r) {
            return null;
        }
        $db->beginTransaction();
        $db->prepare('INSERT INTO am_users (email, created_at) VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE id = id')->execute([$r['email']]);
        $uid = $db->prepare('SELECT id FROM am_users WHERE email = ?');
        $uid->execute([$r['email']]);
        $k = Auth::generate();
        $db->prepare('INSERT INTO am_api_keys (user_id, prefix, key_hash, expires_at, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL 2 YEAR, UTC_TIMESTAMP())')
            ->execute([(int) $uid->fetchColumn(), $k['prefix'], Auth::hash($k['key'])]);
        $db->prepare("UPDATE am_key_requests SET status = 'approved', decided_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$id]);
        $db->commit();
        $body = "Bonjour,\n\nVotre demande de cle pour l'API Alertes-Meteo est approuvee.\n\nCle API : {$k['key']}\n\n"
            . "Envoyez-la dans l'en-tete X-API-Key. Elle est valable 2 ans et n'est affichee qu'ici : conservez-la.\n"
            . "Documentation : https://api.alertes-meteo.com/docs\n";
        $sent = mail($r['email'], 'Votre cle API Alertes-Meteo', $body, "From: no-reply@alertes-meteo.com\r\nContent-Type: text/plain; charset=utf-8");
        return ['email' => $r['email'], 'key' => $k['key'], 'emailed' => $sent];
    }

    public static function reject(int $id): bool
    {
        $st = App::db()->prepare("UPDATE am_key_requests SET status = 'rejected', decided_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'");
        $st->execute([$id]);
        return $st->rowCount() > 0;
    }

    public static function revoke(string $prefix): int
    {
        $st = App::db()->prepare('UPDATE am_api_keys SET revoked_at = UTC_TIMESTAMP() WHERE prefix = ? AND revoked_at IS NULL');
        $st->execute([$prefix]);
        return $st->rowCount();
    }

    public static function setAccountStatus(string $email, string $status): int
    {
        $st = App::db()->prepare('UPDATE am_users SET status = ? WHERE email = ?');
        $st->execute([$status, strtolower($email)]);
        return $st->rowCount();
    }

    public static function setSwitch(string $name, bool $disabled, ?string $reason): void
    {
        App::db()->prepare('INSERT INTO am_kill_switch (name, disabled, reason, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE disabled = VALUES(disabled), reason = VALUES(reason), updated_at = UTC_TIMESTAMP()')
            ->execute([$name, (int) $disabled, $reason]);
    }

    /** Noms d'interrupteurs autorises : endpoints et collecteurs connus. */
    public static function validSwitch(string $name): bool
    {
        if (in_array($name, self::ENDPOINTS, true)) {
            return true;
        }
        return str_starts_with($name, 'collector:') && in_array(substr($name, 10), self::COLLECTORS, true);
    }
}
