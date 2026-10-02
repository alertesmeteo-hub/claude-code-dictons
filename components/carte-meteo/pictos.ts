/** Pictos météo disponibles pour l'édition manuelle de la carte (emoji — pas de dépendance d'icônes). */
export const PICTOS_METEO = [
  '☀️',
  '🌤️',
  '⛅',
  '🌥️',
  '☁️',
  '🌦️',
  '🌧️',
  '⛈️',
  '🌩️',
  '🌨️',
  '❄️',
  '🌫️',
  '💨',
  '🌪️',
  '🌈',
  '🌙',
] as const;

export type PictoMeteo = (typeof PICTOS_METEO)[number];

/**
 * Code météo WMO (renvoyé par Open-Meteo dans `weather_code`) → picto suggéré.
 * Table volontairement groupée par familles (voir https://open-meteo.com/en/docs — WMO Weather interpretation codes).
 */
export function pictoDepuisCodeMeteo(code: number | null | undefined): PictoMeteo {
  if (code == null) return '☀️';
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌦️';
}
