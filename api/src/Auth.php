<?php
declare(strict_types=1);

/** Cles au format am_<prefix8>_<secret32>. Seul le hash SHA-256 est stocke. */
final class Auth
{
    /** @return array{key:string,prefix:string} */
    public static function generate(): array
    {
        $prefix = bin2hex(random_bytes(4));
        return ['prefix' => $prefix, 'key' => "am_{$prefix}_" . bin2hex(random_bytes(16))];
    }

    public static function hash(string $key): string
    {
        return hash('sha256', $key);
    }

    /** Valide la cle, applique les quotas, incremente les compteurs. Retourne l'id de cle. */
    public static function guard(string $endpoint): int
    {
        $key = $_SERVER['HTTP_X_API_KEY'] ?? '';
        if (!preg_match('/^am_([0-9a-f]{8})_[0-9a-f]{32}$/', $key, $m)) {
            App::error(401, 'missing_or_invalid_key', 'En-tete X-API-Key absent ou invalide.');
        }
        $st = App::db()->prepare('SELECT k.id, k.key_hash, k.revoked_at, k.expires_at, u.status, p.per_minute, p.per_month
            FROM api_keys k JOIN users u ON u.id = k.user_id JOIN plans p ON p.code = u.plan WHERE k.prefix = ?');
        $st->execute([$m[1]]);
        $row = $st->fetch();
        if (!$row || !hash_equals($row['key_hash'], self::hash($key)) || $row['revoked_at'] !== null) {
            App::error(401, 'missing_or_invalid_key', 'Cle inconnue ou revoquee.');
        }
        if (strtotime($row['expires_at'] . ' UTC') < time()) {
            App::error(401, 'key_expired', 'Cle expiree : faites une nouvelle demande.');
        }
        if ($row['status'] !== 'active') {
            App::error(403, 'account_suspended', 'Compte suspendu.');
        }
        if (in_array($endpoint, Admin::ENDPOINTS, true) && App::switchOff($endpoint)) {
            App::error(503, 'endpoint_disabled', 'Endpoint temporairement desactive.');
        }

        $id = (int) $row['id'];
        $min = 'm' . gmdate('YmdHi');
        $month = 'M' . gmdate('Ym');
        $q = App::db()->prepare('SELECT bucket, SUM(hits) AS h FROM usage_counters WHERE key_id = ? AND bucket IN (?, ?) GROUP BY bucket');
        $q->execute([$id, $min, $month]);
        $used = array_column($q->fetchAll(), 'h', 'bucket');
        $usedMin = (int) ($used[$min] ?? 0);
        $usedMonth = (int) ($used[$month] ?? 0);
        $hdr = [
            'X-RateLimit-Limit-Minute' => (string) $row['per_minute'],
            'X-RateLimit-Remaining-Minute' => (string) max(0, $row['per_minute'] - $usedMin - 1),
            'X-RateLimit-Limit-Month' => (string) $row['per_month'],
            'X-RateLimit-Remaining-Month' => (string) max(0, $row['per_month'] - $usedMonth - 1),
        ];
        if ($usedMin >= $row['per_minute']) {
            App::error(429, 'rate_limited', 'Quota par minute depasse.', $hdr + ['Retry-After' => '60']);
        }
        if ($usedMonth >= $row['per_month']) {
            App::error(429, 'quota_exceeded', 'Quota mensuel depasse.', $hdr);
        }
        foreach ($hdr as $k => $v) {
            header("$k: $v");
        }

        // minute et mois comptent toutes les requetes ; jour detaille par endpoint
        $ins = App::db()->prepare('INSERT INTO usage_counters (key_id, bucket, endpoint, hits) VALUES (?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE hits = hits + 1');
        $ins->execute([$id, $min, '*']);
        $ins->execute([$id, $month, '*']);
        $ins->execute([$id, 'd' . gmdate('Ymd'), $endpoint]);
        return $id;
    }
}
