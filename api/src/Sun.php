<?php
declare(strict_types=1);

/** Calcul solaire local (algorithme NOAA), sans API tierce. */
final class Sun
{
    private static function rad(float $d): float { return $d * M_PI / 180; }
    private static function deg(float $r): float { return $r * 180 / M_PI; }

    /** @return array<string,string|int|null> */
    public static function compute(float $lat, float $lon, string $date, string $tz): array
    {
        $zone = new DateTimeZone($tz);
        $midnight = new DateTimeImmutable($date . ' 00:00:00', new DateTimeZone('UTC'));
        $jd = ($midnight->getTimestamp() + 43200) / 86400 + 2440587.5;
        $t = ($jd - 2451545.0) / 36525.0;

        $l0 = fmod(280.46646 + $t * (36000.76983 + $t * 0.0003032), 360);
        $m = 357.52911 + $t * (35999.05029 - 0.0001537 * $t);
        $e = 0.016708634 - $t * (0.000042037 + 0.0000001267 * $t);
        $mr = self::rad($m);
        $c = sin($mr) * (1.914602 - $t * (0.004817 + 0.000014 * $t))
            + sin(2 * $mr) * (0.019993 - 0.000101 * $t) + sin(3 * $mr) * 0.000289;
        $om = 125.04 - 1934.136 * $t;
        $app = $l0 + $c - 0.00569 - 0.00478 * sin(self::rad($om));
        $obl = 23 + (26 + (21.448 - $t * (46.815 + $t * (0.00059 - $t * 0.001813))) / 60) / 60
            + 0.00256 * cos(self::rad($om));
        $decl = self::deg(asin(sin(self::rad($obl)) * sin(self::rad($app))));
        $y = tan(self::rad($obl / 2)) ** 2;
        $l0r = self::rad($l0);
        $eq = 4 * self::deg($y * sin(2 * $l0r) - 2 * $e * sin($mr)
            + 4 * $e * $y * sin($mr) * cos(2 * $l0r) - 0.5 * $y * $y * sin(4 * $l0r)
            - 1.25 * $e * $e * sin(2 * $mr));

        $noonMin = 720 - 4 * $lon - $eq;
        $at = static fn(float $min): string =>
            $midnight->modify(sprintf('%+d seconds', (int) round($min * 60)))->setTimezone($zone)->format('c');

        $ha = function (float $zenith) use ($lat, $decl): ?float {
            $x = cos(self::rad($zenith)) / (cos(self::rad($lat)) * cos(self::rad($decl)))
                - tan(self::rad($lat)) * tan(self::rad($decl));
            return ($x < -1 || $x > 1) ? null : self::deg(acos($x));
        };

        $out = ['date' => $date, 'timezone' => $tz, 'solar_noon' => $at($noonMin)];
        foreach (['sunrise' => [90.833, -1], 'sunset' => [90.833, 1], 'dawn' => [96.0, -1], 'dusk' => [96.0, 1]] as $k => [$z, $s]) {
            $h = $ha($z);
            $out[$k] = $h === null ? null : $at($noonMin + $s * 4 * $h);
        }
        $h = $ha(90.833);
        $polarDay = $lat * $decl > 0;
        $out['day_length_seconds'] = $h === null ? ($polarDay ? 86400 : 0) : (int) round(8 * $h * 60);
        $out['polar'] = $h === null ? ($polarDay ? 'day' : 'night') : null;
        return $out;
    }
}
