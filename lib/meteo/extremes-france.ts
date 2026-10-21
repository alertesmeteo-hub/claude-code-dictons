/**
 * Températures extrêmes du jour en France (stations d'altitude < 500 m), calculées à partir des relevés horaires
 * Météo-France déjà rassemblés par le dépôt harmonie-knmi (aucune clé API nécessaire).
 *
 * Source : branche `observations` de alertesmeteo-hub/harmonie-knmi, fichier cache_classements_temperature_72h.json,
 * mis à jour toutes les heures à partir des paquets horaires DPPaquetObs v2 : { hours: { "<heure UTC>": [{ id, t, tx, tn }] } },
 * en °C. Les noms, altitudes et réseaux des stations viennent de stations-meteo-france.json (liste-stations DPObs).
 *
 * Contrôle de plausibilité : reprise de controle_plausibilite.py (harmonie-knmi), pour écarter les relevés d'un capteur
 * défaillant (0,0 °C en plein après-midi, -8,4 °C pour 22 °C la même heure à La Chiappa, octobre 2026).
 */
import stationsMf from './stations-meteo-france.json';

export const CACHE_HORAIRE_URL =
  'https://raw.githubusercontent.com/alertesmeteo-hub/harmonie-knmi/observations/cache_classements_temperature_72h.json';
export const ALTITUDE_MAX_M = 500;
export const NB_PAR_TYPE = 15; // nombre de stations conservées pour les maxima et pour les minima
/** Au-delà, le fichier source n'est plus mis à jour : mieux vaut un échec visible qu'un classement figé. */
export const FRAICHEUR_MAX_H = 4;

export interface StationMf {
  id: string;
  nom: string;
  altitude: number;
  principale: boolean; // réseau principal (Pack RADOME) par opposition au réseau étendu
}

export interface Mesure {
  codeStation: string;
  nomCommune: string;
  departement: string;
  altitudeM: number;
  type: 'maxi' | 'mini';
  valeurC: number;
  heureMesure: string; // HH:MM:SS, heure de Paris
  source: string;
}

export interface ReleveHoraire {
  id: string;
  t: number | null;
  tx: number | null;
  tn: number | null;
}

export interface CacheHoraire {
  latest_observation_at?: string;
  hours: Record<string, ReleveHoraire[]>;
}

type Extreme = { v: number; iso: string };

export const STATIONS: StationMf[] = stationsMf.stations;

// Seuils de controle_plausibilite.py (QC_VERSION 1).
const BORNES_C: [number, number] = [-60, 60];
const TOLERANCE_C = 0.5;
const ETENDUE_MAX_C = 15;
const SAUT_MAX_C = 15;
const APPUI_C = 6;

/** Contrôle d'une heure : [t, tx, tn] retenus (null si écartés). `precedente` : t retenue une heure plus tôt. */
export function controlerHeure(
  t: number | null,
  tx: number | null,
  tn: number | null,
  precedente: number | null,
): [number | null, number | null, number | null] {
  const borne = (v: number | null) => (v != null && v >= BORNES_C[0] && v <= BORNES_C[1] ? v : null);
  t = borne(t);
  tx = borne(tx);
  tn = borne(tn);
  const rejet: [null, null, null] = [null, null, null];
  if (tx != null && tn != null && (tx < tn - TOLERANCE_C || tx - tn > ETENDUE_MAX_C)) return rejet;
  if (t != null && ((tn != null && t < tn - TOLERANCE_C) || (tx != null && t > tx + TOLERANCE_C))) return rejet;
  if (t != null && precedente != null) {
    if (Math.abs(t - precedente) > SAUT_MAX_C) return rejet;
    if (tn != null && tn < Math.min(t, precedente) - APPUI_C) tn = null;
    if (tx != null && tx > Math.max(t, precedente) + APPUI_C) tx = null;
  }
  return [t, tx, tn];
}

export const jourParis = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export const heureParis = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date(iso))
    .replace(/^24/, '00');

const UNE_HEURE_MS = 3_600_000;

/** Stations partenaires « _SAPC », écartées comme dans tous les classements de harmonie-knmi (is_sapc). */
export const estSapc = (nom: string) => nom.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').includes('SAPC');

/**
 * Plus hautes maximales et plus basses minimales du jour (heure de Paris) : tx et tn horaires (t à défaut) des relevés
 * dont l'heure de validité tombe le jour `aujourdhui` (AAAA-MM-JJ), après contrôle de plausibilité de chaque station.
 */
export function extremesDuJour(cache: CacheHoraire, aujourdhui: string, stations: StationMf[] = STATIONS): Mesure[] {
  const parId = new Map(stations.filter((s) => s.altitude < ALTITUDE_MAX_M && !estSapc(s.nom)).map((s) => [s.id, s]));

  // Chronologie de chaque station, sur tout le fichier : l'heure d'avant minuit sert de référence au contrôle de 00 h.
  const series = new Map<string, { ms: number; iso: string; r: ReleveHoraire }[]>();
  for (const [iso, releves] of Object.entries(cache.hours)) {
    const ms = Date.parse(iso);
    for (const r of releves) {
      if (!parId.has(r.id)) continue;
      const serie = series.get(r.id) ?? [];
      serie.push({ ms, iso, r });
      series.set(r.id, serie);
    }
  }

  const maxi = new Map<string, Extreme>();
  const mini = new Map<string, Extreme>();
  for (const [id, serie] of series) {
    serie.sort((a, b) => a.ms - b.ms);
    let precMs: number | null = null;
    let precT: number | null = null;
    for (const { ms, iso, r } of serie) {
      const ref = precMs != null && ms - precMs === UNE_HEURE_MS ? precT : null;
      const [t, tx, tn] = controlerHeure(r.t, r.tx, r.tn, ref);
      precMs = ms;
      precT = t;
      if (jourParis(iso) !== aujourdhui) continue;
      const haut = tx ?? t;
      const bas = tn ?? t;
      if (haut != null && (!maxi.has(id) || haut > maxi.get(id)!.v)) maxi.set(id, { v: haut, iso });
      if (bas != null && (!mini.has(id) || bas < mini.get(id)!.v)) mini.set(id, { v: bas, iso });
    }
  }

  const versMesure = (id: string, type: 'maxi' | 'mini', e: Extreme): Mesure => {
    const s = parId.get(id)!;
    return {
      codeStation: id,
      nomCommune: s.nom,
      departement: id.slice(0, 2),
      altitudeM: s.altitude,
      type,
      valeurC: Math.round(e.v * 10) / 10,
      heureMesure: heureParis(e.iso),
      // Le libellé « réseau principal » est lu par le site (champ `principale`) pour le paramètre stations="principales".
      source: `Météo-France — DPPaquetObs (${s.principale ? 'réseau principal' : 'réseau étendu'})`,
    };
  };
  // Top N toutes stations + top N des stations du réseau principal (pour que le filtre du plugin reste rempli).
  const selection = (m: Map<string, Extreme>, type: 'maxi' | 'mini') => {
    const tri = [...m].sort((a, b) => (type === 'maxi' ? b[1].v - a[1].v : a[1].v - b[1].v));
    const ids = new Set([
      ...tri.slice(0, NB_PAR_TYPE).map(([id]) => id),
      ...tri.filter(([id]) => parId.get(id)!.principale).slice(0, NB_PAR_TYPE).map(([id]) => id),
    ]);
    return tri.filter(([id]) => ids.has(id)).map(([id, e]) => versMesure(id, type, e));
  };
  return [...selection(maxi, 'maxi'), ...selection(mini, 'mini')];
}
