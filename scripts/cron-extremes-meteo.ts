import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';

/**
 * Températures extrêmes du jour en France (stations d'altitude < 500 m).
 *
 * Sources (Météo-France, portail https://portail-api.meteofrance.fr, clé API dans METEOFRANCE_API_KEY) :
 *  - DPObs v1 /liste-stations : CSV des stations (identifiant, nom, latitude, longitude, altitude) ;
 *  - DPPaquetObs v1 /paquet/horaire?id-departement=XX : observations horaires des dernières 24 h de toutes
 *    les stations d'un département. Champs utilisés : geo_id_insee (identifiant station), validity_time,
 *    t / tx / tn (température, maximum et minimum de l'heure, en kelvins).
 * Une exécution = ~100 appels (un par département), espacés pour respecter la limite de requêtes.
 * Écrit via l'API OVH (ovhApi.extremesEnregistrer) : la base n'est joignable que depuis le réseau OVH.
 */

const DPOBS = 'https://public-api.meteofrance.fr/public/DPObs/v1';
const DPPAQUET = 'https://public-api.meteofrance.fr/public/DPPaquetObs/v1';
const ALTITUDE_MAX_M = 500;
const NB_PAR_TYPE = 15; // nombre de stations conservées pour les maxima et pour les minima
const PAUSE_ENTRE_APPELS_MS = 1500;
const MAX_TENTATIVES = 3;
/** Codes à essayer, dans l'ordre, pour les départements dont l'écriture n'est pas évidente. */
const VARIANTES_DEPARTEMENT: Record<string, string[]> = { '20': ['2A', '2B', '20'] };

interface Station {
  id: string;
  nom: string;
  departement: string;
  altitude: number;
  principale: boolean; // réseau principal (Pack RADOME) par opposition au réseau étendu
}

interface Mesure {
  codeStation: string;
  nomCommune: string;
  departement: string;
  altitudeM: number;
  type: 'maxi' | 'mini';
  valeurC: number;
  heureMesure: string; // HH:MM:SS, heure de Paris
  source: string;
}

interface Observation {
  geo_id_insee: string;
  validity_time: string;
  t: number | null;
  tx: number | null;
  tn: number | null;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kelvinEnC = (k: number) => Math.round((k - 273.15) * 10) / 10;

function cle(): string {
  const c = process.env.METEOFRANCE_API_KEY;
  if (!c) throw new Error('METEOFRANCE_API_KEY manquante');
  return c;
}

/** GET avec l'en-tête apikey ; 3 essais sur erreur temporaire (429 / 5xx). */
async function get(url: string): Promise<string> {
  let dernier = '';
  for (let essai = 1; essai <= 3; essai++) {
    const r = await fetch(url, { headers: { apikey: cle() } });
    const texte = await r.text();
    if (r.ok) return texte;
    const detail = texte.match(/<am:description>([^<]*)/)?.[1] ?? texte.slice(0, 150);
    dernier = `HTTP ${r.status} ${detail}`;
    if (r.status !== 429 && r.status < 500) break;
    await pause(essai * 5000);
  }
  throw new Error(dernier);
}

async function listerStations(): Promise<Station[]> {
  const csv = await get(`${DPOBS}/liste-stations`);
  const [entete, ...lignes] = csv.trim().split(/\r?\n/);
  const col = entete.split(';');
  const [iId, iNom, iAlt, iPack] = ['Id_station', 'Nom_usuel', 'Altitude', 'Pack'].map((n) => col.indexOf(n));
  if (iId < 0 || iNom < 0 || iAlt < 0 || iPack < 0) throw new Error(`Colonnes inattendues : ${entete}`);

  return lignes
    .map((l) => l.split(';'))
    .map((c) => ({ id: c[iId], nom: c[iNom], departement: c[iId].slice(0, 2), altitude: Number(c[iAlt]), principale: c[iPack]?.trim() === 'RADOME' }))
    .filter((s) => s.id.length === 8 && Number.isFinite(s.altitude) && s.altitude < ALTITUDE_MAX_M);
}

const jourParis = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const heureParis = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date(iso))
    .replace(/^24/, '00');

type Extreme = { v: number; iso: string };

async function extremesDuJour(): Promise<Mesure[]> {
  const stations = await listerStations();
  const parId = new Map(stations.map((s) => [s.id, s]));
  // Métropole : départements 01-95. Les stations corses ont le préfixe 20 (2A et 2B) : le code accepté par
  // l'API n'est pas documenté, on essaie plusieurs écritures (voir VARIANTES_DEPARTEMENT).
  const prefixes = [...new Set(stations.map((s) => s.departement))].filter((p) => /^\d\d$/.test(p) && Number(p) <= 95);
  const departements = prefixes.sort();

  const aujourdhui = jourParis(new Date().toISOString());
  const maxi = new Map<string, Extreme>();
  const mini = new Map<string, Extreme>();
  let echecs = 0;

  for (const dep of departements) {
    try {
      // Selon les départements, l'API attend « 01 » ou « 1 » : on s'arrête à la première écriture acceptée.
      // Corse (20) : 2A et 2B sont deux départements distincts, on cumule toutes les écritures acceptées.
      const ecritures = [...new Set(VARIANTES_DEPARTEMENT[dep] ?? [dep, dep.replace(/^0/, '')])];
      const cumul = dep === '20';
      const obs: Observation[] = [];
      let erreurDep: unknown = null;
      let accepte = false;
      for (const ecriture of ecritures) {
        try {
          const brut = await get(`${DPPAQUET}/paquet/horaire?id-departement=${ecriture}&format=json`);
          obs.push(...(JSON.parse(brut) as Observation[]));
          accepte = true;
          if (cumul) console.log(`Corse : code « ${ecriture} » accepté`);
          else break;
        } catch (e) {
          erreurDep = e;
        }
        if (cumul) await pause(PAUSE_ENTRE_APPELS_MS);
      }
      if (!accepte) throw erreurDep;
      for (const o of obs) {
        if (!parId.has(o.geo_id_insee) || jourParis(o.validity_time) !== aujourdhui) continue;
        const haut = o.tx ?? o.t;
        const bas = o.tn ?? o.t;
        if (haut != null && (!maxi.has(o.geo_id_insee) || kelvinEnC(haut) > maxi.get(o.geo_id_insee)!.v)) {
          maxi.set(o.geo_id_insee, { v: kelvinEnC(haut), iso: o.validity_time });
        }
        if (bas != null && (!mini.has(o.geo_id_insee) || kelvinEnC(bas) < mini.get(o.geo_id_insee)!.v)) {
          mini.set(o.geo_id_insee, { v: kelvinEnC(bas), iso: o.validity_time });
        }
      }
    } catch (e) {
      echecs++;
      console.error(`Département ${dep} ignoré :`, e instanceof Error ? e.message : e);
    }
    await pause(PAUSE_ENTRE_APPELS_MS);
  }

  if (echecs > departements.length * 0.2) throw new Error(`${echecs}/${departements.length} départements en échec`);
  if (maxi.size === 0) throw new Error('Aucune observation du jour trouvée');

  const versMesure = (id: string, type: 'maxi' | 'mini', e: Extreme): Mesure => {
    const s = parId.get(id)!;
    return {
      codeStation: id,
      nomCommune: s.nom,
      departement: s.departement,
      altitudeM: Math.round(s.altitude),
      type,
      valeurC: e.v,
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
  const hauts = selection(maxi, 'maxi');
  const bas = selection(mini, 'mini');
  console.log(`${maxi.size} stations exploitées sur ${departements.length} départements (${echecs} en échec)`);
  return [...hauts, ...bas];
}

async function main() {
  let derniereErreur: unknown = null;

  for (let tentative = 1; tentative <= MAX_TENTATIVES; tentative++) {
    try {
      const donnees = await extremesDuJour();
      const { compte } = await ovhApi.extremesEnregistrer(donnees as unknown as Record<string, unknown>[]);
      await ovhApi.syncLogEnregistrer('meteo_extremes', 'ok', `${compte} mesures synchronisées`);
      console.log(`OK — ${compte} mesures synchronisées`);
      const chaud = donnees.find((m) => m.type === 'maxi')!;
      const froid = donnees.find((m) => m.type === 'mini')!;
      console.log(`Maxi : ${chaud.nomCommune} ${chaud.valeurC} °C — Mini : ${froid.nomCommune} ${froid.valeurC} °C`);
      return;
    } catch (erreur) {
      derniereErreur = erreur;
      console.error(`Tentative ${tentative}/${MAX_TENTATIVES} échouée`, erreur instanceof Error ? erreur.message : erreur);
      if (tentative < MAX_TENTATIVES) await pause(tentative * 5000);
    }
  }

  await ovhApi.syncLogEnregistrer('meteo_extremes', 'erreur', String(derniereErreur)).catch(() => {});
  console.error('Échec définitif après', MAX_TENTATIVES, 'tentatives');
  process.exitCode = 1;
}

main();
