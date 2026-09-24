import 'dotenv/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Relevés au pas de 6 minutes d'un sous-ensemble de stations Météo-France : le réseau synoptique principal
 * (stations avec identifiant OMM) et tous les postes du département 66.
 *
 * Source (clé API dans METEOFRANCE_API_KEY) : DPObs v1 /station/infrahoraire-6m?id_station=XXXXXXXX, qui ne renvoie que
 * la dernière mesure d'UNE station par appel. L'API n'offre pas d'équivalent « paquet » : le script est donc lancé toutes
 * les 6 minutes et fait un appel par station, espacés pour rester sous la limite de requêtes.
 *
 * Archive (même dossier que cron-observations-mf, servie par nginx avec CORS) :
 *   jours6m/<AAAA-MM-JJ>/<département>.json : { "<station>": [ [heure UTC ISO, T, Td, HR, dd, ff km/h, rafale km/h, RR mm, pmer hPa, vv km, insolation min], … ] }
 * Conservation : JOURS_CONSERVES jours (le pas horaire, lui, reste 120 jours dans jours/).
 */

const DPOBS = 'https://public-api.meteofrance.fr/public/DPObs/v1';
const ARCHIVE = process.env.OBSERVATIONS_DIR || '/var/www/observations';
const JOURS_CONSERVES = 30;
const PAUSE_ENTRE_APPELS_MS = 1300;
const DEPARTEMENTS_COMPLETS = ['66'];

type Ligne = [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];

interface Obs6m {
  geo_id_insee: string;
  validity_time: string;
  t: number | null; td: number | null; u: number | null; dd: number | null; ff: number | null;
  fxi10: number | null; rr_per: number | null; pmer: number | null; vv: number | null; insolh: number | null;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kelvinEnC = (k: number) => Math.round((k - 273.15) * 10) / 10;
const arrondi = (v: number, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

function cle(): string {
  const c = process.env.METEOFRANCE_API_KEY;
  if (!c) throw new Error('METEOFRANCE_API_KEY manquante');
  return c;
}

/** GET avec l'en-tête apikey ; 3 essais sur erreur temporaire (429 / 5xx). Renvoie null pour « pas de donnée » (204/404). */
async function get(url: string): Promise<string | null> {
  let dernier = '';
  for (let essai = 1; essai <= 3; essai++) {
    const r = await fetch(url, { headers: { apikey: cle() } });
    if (r.status === 204 || r.status === 404) return null;
    const texte = await r.text();
    if (r.ok) return texte;
    dernier = `HTTP ${r.status} ${texte.slice(0, 120)}`;
    if (r.status !== 429 && r.status < 500) break;
    await pause(essai * 4000);
  }
  throw new Error(dernier);
}

/** Stations suivies : identifiant OMM ou département complet, parmi celles qui ont des données récentes (fichier de la carte). */
async function stationsSuivies(): Promise<string[]> {
  const csv = await get(`${DPOBS}/liste-stations`);
  if (!csv) throw new Error('liste-stations vide');
  const [entete, ...lignes] = csv.trim().split(/\r?\n/);
  const col = entete.split(';');
  const [iId, iOmm] = [col.indexOf('Id_station'), col.indexOf('Id_omm')];
  if (iId < 0 || iOmm < 0) throw new Error(`Colonnes inattendues : ${entete}`);
  let actives: Set<string> | null = null;
  const carte = path.join(ARCHIVE, 'stations.json');
  if (existsSync(carte)) actives = new Set((JSON.parse(readFileSync(carte, 'utf8')).stations as Array<{ id: string }>).map((s) => s.id));
  const ids = new Set<string>();
  for (const l of lignes) {
    const c = l.split(';');
    const id = c[iId];
    if (!id || id.length !== 8) continue;
    if (actives && !actives.has(id)) continue;
    if (c[iOmm]?.trim() || DEPARTEMENTS_COMPLETS.includes(id.slice(0, 2))) ids.add(id);
  }
  return [...ids].sort();
}

const ecrire = (fichier: string, contenu: unknown) => {
  mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.tmp`;
  writeFileSync(tmp, JSON.stringify(contenu));
  renameSync(tmp, fichier);
};

function ligne(o: Obs6m): Ligne {
  const c = (k: number | null) => (k != null ? kelvinEnC(k) : null);
  return [
    o.validity_time, c(o.t), c(o.td), o.u != null ? Math.round(o.u) : null, o.dd != null ? Math.round(o.dd) : null,
    o.ff != null ? arrondi(o.ff * 3.6) : null, o.fxi10 != null ? arrondi(o.fxi10 * 3.6) : null,
    o.rr_per != null ? Math.max(0, o.rr_per) : null, o.pmer != null ? arrondi(o.pmer / 100) : null,
    o.vv != null ? arrondi(o.vv / 1000) : null, o.insolh,
  ];
}

async function main() {
  const ids = await stationsSuivies();
  const recus = new Map<string, Obs6m[]>();
  let echecs = 0;
  for (const id of ids) {
    try {
      const brut = await get(`${DPOBS}/station/infrahoraire-6m?id_station=${id}&format=json`);
      if (brut) {
        const liste = JSON.parse(brut) as Obs6m[];
        if (liste.length) recus.set(id, liste);
      }
    } catch (e) {
      echecs++;
      if (echecs <= 3) console.warn(`Station ${id} : ${e instanceof Error ? e.message : e}`);
    }
    await pause(PAUSE_ENTRE_APPELS_MS);
  }

  // Regroupement par jour UTC et département, fusion avec les fichiers déjà présents (dédoublonnage par heure).
  const parFichier = new Map<string, Map<string, Ligne[]>>();
  for (const [id, liste] of recus) {
    for (const o of liste) {
      if (o.t == null) continue;
      const cle = `${o.validity_time.slice(0, 10)}/${id.slice(0, 2)}`;
      const m = parFichier.get(cle) ?? new Map<string, Ligne[]>();
      (m.get(id) ?? m.set(id, []).get(id)!).push(ligne(o));
      parFichier.set(cle, m);
    }
  }
  for (const [cle, stations] of parFichier) {
    const fichier = path.join(ARCHIVE, 'jours6m', `${cle}.json`);
    const existant: Record<string, Ligne[]> = existsSync(fichier) ? JSON.parse(readFileSync(fichier, 'utf8')) : {};
    for (const [id, nouvelles] of stations) {
      const m = new Map<string, Ligne>((existant[id] ?? []).map((l) => [l[0], l]));
      for (const l of nouvelles) m.set(l[0], l);
      existant[id] = [...m.values()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    ecrire(fichier, existant);
  }

  const racine = path.join(ARCHIVE, 'jours6m');
  if (existsSync(racine)) {
    const jours = readdirSync(racine).filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j)).sort();
    for (const j of jours.slice(0, Math.max(0, jours.length - JOURS_CONSERVES))) rmSync(path.join(racine, j), { recursive: true, force: true });
  }
  console.log(`${new Date().toISOString()} : ${recus.size}/${ids.length} stations, ${echecs} échec(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
