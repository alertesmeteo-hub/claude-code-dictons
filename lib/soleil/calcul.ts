export interface HeuresSoleil {
  leverUTC: Date | null;
  coucherUTC: Date | null;
  dureeJourMinutes: number | null;
  /** true si le soleil ne se lève pas ou ne se couche pas ce jour-là à cette latitude (cas polaire) */
  casPolaire: boolean;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Algorithme NOAA simplifié (formules publiques de calcul de lever/coucher du soleil).
 * Précision de l'ordre de la minute, suffisante pour un affichage grand public.
 * Référence : NOAA Solar Calculator (domaine public).
 */
export function calculerLeverCoucher(date: Date, latitude: number, longitude: number): HeuresSoleil {
  const jourJulien = dateVersJourJulien(date);
  const n = jourJulien - 2451545.0 + 0.0008;

  const centreSoleil = (357.5291 + 0.98560028 * n) % 360;
  const centreRad = centreSoleil * DEG_TO_RAD;

  const equationCentre =
    1.9148 * Math.sin(centreRad) + 0.02 * Math.sin(2 * centreRad) + 0.0003 * Math.sin(3 * centreRad);

  const longitudeEcliptique = (centreSoleil + 102.9372 + equationCentre + 180) % 360;
  const longEclipRad = longitudeEcliptique * DEG_TO_RAD;

  const declinaison = Math.asin(Math.sin(longEclipRad) * Math.sin(23.4397 * DEG_TO_RAD));

  const latRad = latitude * DEG_TO_RAD;
  const cosAngleHoraire =
    (Math.sin(-0.83 * DEG_TO_RAD) - Math.sin(latRad) * Math.sin(declinaison)) /
    (Math.cos(latRad) * Math.cos(declinaison));

  if (cosAngleHoraire > 1 || cosAngleHoraire < -1) {
    return { leverUTC: null, coucherUTC: null, dureeJourMinutes: null, casPolaire: true };
  }

  const angleHoraire = Math.acos(cosAngleHoraire) * RAD_TO_DEG;

  const jourJulienTransit =
    2451545.0 + 0.0009 + Math.round(n - longitude / 360) - longitude / 360 + longitude / 360;
  const nApprox = Math.round(n - longitude / 360);
  const jJTransit = 2451545.0 + nApprox + longitude / 360 + 0.0053 * Math.sin(centreRad) -
    0.0069 * Math.sin(2 * longEclipRad);

  const jJLever = jJTransit - angleHoraire / 360;
  const jJCoucher = jJTransit + angleHoraire / 360;

  const leverUTC = jourJulienVersDate(jJLever);
  const coucherUTC = jourJulienVersDate(jJCoucher);
  const dureeJourMinutes = Math.round((coucherUTC.getTime() - leverUTC.getTime()) / 60000);

  return { leverUTC, coucherUTC, dureeJourMinutes, casPolaire: false };
}

function dateVersJourJulien(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function jourJulienVersDate(jj: number): Date {
  return new Date((jj - 2440587.5) * 86400000);
}

/** Formate une Date UTC en heure locale HH h MM pour un fuseau donné (IANA tz). */
export function formaterHeureLocale(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: fuseau,
  })
    .format(date)
    .replace(':', ' h ');
}
