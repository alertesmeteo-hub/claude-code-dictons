<?php
// php -d zend.assertions=1 tests/sun_test.php
require __DIR__ . '/../src/Sun.php';

$r = Sun::compute(48.8566, 2.3522, '2026-06-21', 'Europe/Paris');
echo json_encode($r, JSON_PRETTY_PRINT), "\n";
// Paris, solstice d'ete : jour d'environ 16 h, lever vers 05:48 (UTC+2)
assert($r['day_length_seconds'] > 57000 && $r['day_length_seconds'] < 58500);
assert(str_contains($r['sunrise'], 'T05:4') || str_contains($r['sunrise'], 'T05:5'));
assert(str_ends_with($r['sunrise'], '+02:00'));
$p = Sun::compute(78.0, 15.0, '2026-06-21', 'UTC');
assert($p['polar'] === 'day' && $p['sunrise'] === null);
echo "OK\n";
