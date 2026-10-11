/**
 * Prévisions météo des dictons : calculées par Alertes Météo avec ses propres modèles (AROME et ARPEGE de Météo-France, ICON du DWD,
 * CEP de l'ECMWF) et lues sur son API. Remplace Open-Meteo, dont l'API gratuite est réservée à un usage non commercial.
 * Appelé uniquement côté serveur (routes API internes) : le navigateur ne contacte jamais le service.
 */
const URL_PAR_DEFAUT = 'https://app.alertes-meteo.com';

function urlApi(): string {
  return (process.env.ALERTES_METEO_API_URL || URL_PAR_DEFAUT).replace(/\/+$/, '');
}

export class MeteoHorsZoneErreur extends Error {}

export interface PrevisionsMeteo {
  temperatureActuelle: number;
  temperatureMax: number;
  temperatureMin: number;
  codeConditions: number;
  vitesseVent: number;
  precipitationsMm: number;
  miseAJour: string;
}

/** Réponse de GET /api/point-meteo d'Alertes Météo (seulement les champs lus ici). */
export interface ReponsePointMeteo {
  actuel: { heure: string; temperature: number; code: number; vent: number | null; precipitation: number } | null;
  jours: { date: string; mini: number | null; maxi: number | null; code: number | null; partiel: boolean }[];
}

/**
 * Convertit la réponse du point en prévisions du jour. La minimale et la maximale du jour partiel (les premières heures d'un run ne
 * sont pas connues) sont élargies à la température du moment, pour ne jamais afficher un maximum plus bas que la température actuelle.
 */
export function convertirPointMeteo(r: ReponsePointMeteo): PrevisionsMeteo {
  const actuel = r.actuel;
  const jour = r.jours[0];
  if (!actuel || !jour || jour.mini === null || jour.maxi === null) throw new Error('Réponse météo incomplète');
  return {
    temperatureActuelle: actuel.temperature,
    temperatureMax: Math.max(jour.maxi, actuel.temperature),
    temperatureMin: Math.min(jour.mini, actuel.temperature),
    codeConditions: actuel.code,
    vitesseVent: actuel.vent ?? 0,
    precipitationsMm: actuel.precipitation,
    miseAJour: actuel.heure,
  };
}

export async function recupererPrevisionsMeteo(latitude: number, longitude: number): Promise<PrevisionsMeteo> {
  const params = new URLSearchParams({ lat: latitude.toFixed(2), lon: longitude.toFixed(2) });
  const reponse = await fetch(`${urlApi()}/api/point-meteo?${params.toString()}`, {
    next: { revalidate: 900 }, // cache ISR 15 min
    signal: AbortSignal.timeout(25_000),
  });
  if (reponse.status === 404) throw new MeteoHorsZoneErreur('Point hors de la France métropolitaine');
  if (!reponse.ok) throw new Error(`Alertes Météo a répondu ${reponse.status}`);
  return convertirPointMeteo((await reponse.json()) as ReponsePointMeteo);
}
