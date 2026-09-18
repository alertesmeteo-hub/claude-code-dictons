export interface PrevisionsMeteo {
  temperatureActuelle: number;
  temperatureMax: number;
  temperatureMin: number;
  codeConditions: number;
  vitesseVent: number;
  precipitationsMm: number;
  miseAJour: string;
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Open-Meteo : gratuit, sans clé API, licence CC BY 4.0.
 * Appelé uniquement côté serveur (route API interne) pour ne jamais exposer d'éventuelle
 * config sensible et pour pouvoir mettre en cache les réponses.
 */
export async function recupererPrevisionsMeteo(
  latitude: number,
  longitude: number
): Promise<PrevisionsMeteo> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'temperature_2m,weather_code,wind_speed_10m,precipitation',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'Europe/Paris',
  });

  const reponse = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
    next: { revalidate: 900 }, // cache ISR 15 min
  });

  if (!reponse.ok) {
    throw new Error(`Open-Meteo a répondu ${reponse.status}`);
  }

  const donnees = await reponse.json();

  return {
    temperatureActuelle: donnees.current.temperature_2m,
    temperatureMax: donnees.daily.temperature_2m_max[0],
    temperatureMin: donnees.daily.temperature_2m_min[0],
    codeConditions: donnees.current.weather_code,
    vitesseVent: donnees.current.wind_speed_10m,
    precipitationsMm: donnees.current.precipitation,
    miseAJour: donnees.current.time,
  };
}
