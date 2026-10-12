/**
 * Projection simple (équirectangulaire, corrigée de la latitude moyenne) d'un point lat/lon vers
 * des coordonnées x/y dans le `viewBox` SVG de la carte de France. Suffisant pour positionner des
 * marqueurs (pas pour un usage cartographique précis).
 */

export const EMPRISE_FRANCE = { lonMin: -5.2, lonMax: 9.6, latMin: 41.2, latMax: 51.2 };
const LATITUDE_MOYENNE_RAD = ((EMPRISE_FRANCE.latMin + EMPRISE_FRANCE.latMax) / 2) * (Math.PI / 180);

export interface TailleCarte {
  largeur: number;
  hauteur: number;
}

export function projeter(lat: number, lon: number, taille: TailleCarte): { x: number; y: number } {
  const { lonMin, lonMax, latMin, latMax } = EMPRISE_FRANCE;
  const xRatio = (lon - lonMin) * Math.cos(LATITUDE_MOYENNE_RAD);
  const xRatioMax = (lonMax - lonMin) * Math.cos(LATITUDE_MOYENNE_RAD);
  const x = (xRatio / xRatioMax) * taille.largeur;
  const y = (1 - (lat - latMin) / (latMax - latMin)) * taille.hauteur;
  return { x, y };
}

/** Seuil de latitude séparant « Nord » et « Sud » pour les moyennes régionales affichées sur la carte. */
export const LATITUDE_SEUIL_NORD_SUD = 46;

export function moyenne(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  return Math.round((valeurs.reduce((a, b) => a + b, 0) / valeurs.length) * 10) / 10;
}
