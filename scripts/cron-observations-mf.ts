import 'dotenv/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Observations horaires de toutes les stations Météo-France de métropole, au format lu par le plugin
 * WordPress « Cartes Météo en France – METAR / SYNOP » (fichier JSON servi par nginx).
 *
 * Sources (Météo-France, clé API dans METEOFRANCE_API_KEY) :
 *  - DPObs v1 /liste-stations : identifiant, nom, latitude, longitude, altitude ;
 *  - DPPaquetObs v1 /paquet/horaire?id-departement=XX : observations horaires des dernières 24 h de toutes
 *    les stations d'un département (~100 appels par exécution, espacés pour respecter la limite de requêtes).
 * La donnée est horaire : une exécution par heure suffit. Le 6 minutes n'existe que station par station
 * (2 000 appels), au-delà du quota de l'API.
 *
 * Archive (consultée par le module WordPress « Climatologie mensuelle », CORS ouvert) :
 *  - jours/<AAAA-MM-JJ>/<département>.json : relevés horaires du jour UTC par station, cumulés d'une exécution à l'autre
 *    (l'API ne donne que 24 h) ; ligne = [heure UTC ISO, T, Td, HR, dd, ff km/h, rafale km/h, RR1 mm, pmer hPa, vv km, insolation min, Tn, Tx] ;
 *  - jours/<date>/quotidien.json : valeurs quotidiennes par station (tx, tn, rr, insol_h, n = nombre de relevés) ;
 *  - recent/<station>.json : jours conservés d'une station (compléments de la climatologie quotidienne, publiée avec retard).
 *
 * Sortie : OBSERVATIONS_OUT (défaut /var/www/observations/stations.json), écrite de façon atomique.
 */

const DPOBS = 'https://public-api.meteofrance.fr/public/DPObs/v1';
const DPPAQUET = 'https://public-api.meteofrance.fr/public/DPPaquetObs/v1';
const PAUSE_ENTRE_APPELS_MS = 1500;
const SORTIE = process.env.OBSERVATIONS_OUT || '/var/www/observations/stations.json';
const ARCHIVE = path.dirname(SORTIE);
const JOURS_CONSERVES = 36500; // pas horaire : conservé sans limite (copie de sauvegarde dans la base OVH)
const VARIANTES_DEPARTEMENT: Record<string, string[]> = { '20': ['2A', '2B', '20'] };

interface Station { id: string; nom: string; lat: number; lon: number }
interface Observation {
  geo_id_insee: string;
  validity_time: string;
  t: number | null; td: number | null; u: number | null;
  dd: number | null; ff: number | null; fxy: number | null; fxi: number | null;
  pmer: number | null; vv: number | null;
  tn: number | null; tx: number | null; rr1: number | null; insolh: number | null; ray_glo01: number | null; n: number | null;
}

const jourParis = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kelvinEnC = (k: number) => Math.round((k - 273.15) * 10) / 10;
const arrondi = (v: number, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

function cle(): string {
  const c = process.env.METEOFRANCE_API_KEY;
  if (!c) throw new Error('METEOFRANCE_API_KEY manquante');
  return c;
}

async function get(url: string): Promise<string> {
  let dernier = '';
  for (let essai = 1; essai <= 3; essai++) {
    const r = await fetch(url, { headers: { apikey: cle() } });
    const texte = await r.text();
    if (r.ok) return texte;
    dernier = `HTTP ${r.status} ${texte.slice(0, 150)}`;
    if (r.status !== 429 && r.status < 500) break;
    await pause(essai * 5000);
  }
  throw new Error(dernier);
}

async function listerStations(): Promise<Map<string, Station>> {
  const csv = await get(`${DPOBS}/liste-stations`);
  const [entete, ...lignes] = csv.trim().split(/\r?\n/);
  const col = entete.split(';');
  const [iId, iNom, iLat, iLon] = ['Id_station', 'Nom_usuel', 'Latitude', 'Longitude'].map((n) => col.indexOf(n));
  if ([iId, iNom, iLat, iLon].some((i) => i < 0)) throw new Error(`Colonnes inattendues : ${entete}`);
  const out = new Map<string, Station>();
  for (const l of lignes) {
    const c = l.split(';');
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (c[iId]?.length === 8 && Number.isFinite(lat) && Number.isFinite(lon)) out.set(c[iId], { id: c[iId], nom: c[iNom], lat, lon });
  }
  return out;
}

/** Humidité relative (%) depuis température et point de rosée (°C), formule de Magnus. */
const humidite = (t: number, td: number) => Math.round(100 * Math.exp((17.625 * td) / (243.04 + td) - (17.625 * t) / (243.04 + t)));

type Ligne = [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
interface Quotidien { tx: number | null; tn: number | null; rr: number | null; insol_h: number | null; n: number }

function ligne(o: Observation): Ligne {
  const c = (k: number | null) => (k != null ? kelvinEnC(k) : null);
  const raf = o.fxy ?? o.fxi;
  return [
    o.validity_time, c(o.t), c(o.td), o.u != null ? Math.round(o.u) : null, o.dd != null ? Math.round(o.dd) : null,
    o.ff != null ? arrondi(o.ff * 3.6) : null, raf != null ? arrondi(raf * 3.6) : null, o.rr1 != null ? Math.max(0, o.rr1) : null, o.pmer != null ? arrondi(o.pmer / 100) : null,
    o.vv != null ? arrondi(o.vv / 1000) : null, o.insolh, c(o.tn), c(o.tx),
  ];
}

function quotidien(lignes: Ligne[]): Quotidien {
  const nums = (i: number) => lignes.map((l) => l[i]).filter((v): v is number => v != null);
  const haut = [...nums(12), ...nums(1)];
  const bas = [...nums(11), ...nums(1)];
  const pluie = nums(7);
  const soleil = nums(10);
  return {
    tx: haut.length ? Math.max(...haut) : null,
    tn: bas.length ? Math.min(...bas) : null,
    rr: pluie.length ? arrondi(pluie.reduce((a, b) => a + b, 0)) : null,
    insol_h: soleil.length ? arrondi(soleil.reduce((a, b) => a + b, 0) / 60) : null,
    n: lignes.length,
  };
}

const ecrire = (fichier: string, contenu: unknown) => {
  mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.tmp`;
  writeFileSync(tmp, JSON.stringify(contenu));
  renameSync(tmp, fichier);
};


/** Valeurs quotidiennes par jour UTC et station, cumulées pendant l'exécution (petit : une entrée par station et par jour). */
const quotidiensParJour = new Map<string, Record<string, Quotidien>>();

/**
 * Cumule dans l'archive les relevés horaires d'un département (traité au fil de l'eau pour limiter la mémoire) :
 * un fichier par jour UTC, fusionné avec celui déjà présent (l'API ne remonte que ~6 jours).
 */
function archiverDepartement(dep: string, parStation: Map<string, Observation[]>) {
  const parJour = new Map<string, Map<string, Map<string, Ligne>>>(); // date → station → heure → ligne
  for (const [id, obs] of parStation) {
    for (const o of obs) {
      if (o.t == null) continue;
      const jour = o.validity_time.slice(0, 10);
      const d = parJour.get(jour) ?? new Map<string, Map<string, Ligne>>();
      const st = d.get(id) ?? new Map<string, Ligne>();
      st.set(o.validity_time, ligne(o));
      d.set(id, st);
      parJour.set(jour, d);
    }
  }
  for (const [jour, stations] of parJour) {
    const fichier = path.join(ARCHIVE, 'jours', jour, `${dep}.json`);
    const existant: Record<string, Ligne[]> = existsSync(fichier) ? JSON.parse(readFileSync(fichier, 'utf8')) : {};
    const sortie: Record<string, Ligne[]> = {};
    const quoti = quotidiensParJour.get(jour) ?? {};
    for (const id of new Set([...Object.keys(existant), ...stations.keys()])) {
      const m = new Map<string, Ligne>((existant[id] ?? []).map((l) => [l[0], l]));
      for (const [h, l] of stations.get(id) ?? []) m.set(h, l);
      const tri = [...m.values()].sort((a, b) => a[0].localeCompare(b[0]));
      sortie[id] = tri;
      quoti[id] = quotidien(tri);
    }
    ecrire(fichier, sortie);
    quotidiensParJour.set(jour, quoti);
  }
}

/** Écrit les valeurs quotidiennes de chaque jour touché, purge les jours trop anciens et régénère les fichiers « recent » par station. */
function finaliserArchive() {
  for (const [jour, quoti] of quotidiensParJour) {
    const fq = path.join(ARCHIVE, 'jours', jour, 'quotidien.json');
    const ancien: Record<string, Quotidien> = existsSync(fq) ? JSON.parse(readFileSync(fq, 'utf8')) : {};
    ecrire(fq, { ...ancien, ...quoti });
  }
  const racine = path.join(ARCHIVE, 'jours');
  const jours = readdirSync(racine).filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j)).sort();
  for (const j of jours.slice(0, Math.max(0, jours.length - JOURS_CONSERVES))) rmSync(path.join(racine, j), { recursive: true, force: true });
  const recent = new Map<string, Array<{ date: string } & Quotidien>>();
  for (const j of jours.slice(-JOURS_CONSERVES)) {
    const fq = path.join(racine, j, 'quotidien.json');
    if (!existsSync(fq)) continue;
    const q = JSON.parse(readFileSync(fq, 'utf8')) as Record<string, Quotidien>;
    for (const [id, v] of Object.entries(q)) (recent.get(id) ?? recent.set(id, []).get(id)!).push({ date: j, ...v });
  }
  for (const [id, jj] of recent) ecrire(path.join(ARCHIVE, 'recent', `${id}.json`), { num_poste: id, days: jj });
  console.log(`Archive : ${quotidiensParJour.size} jour(s) mis à jour, ${recent.size} stations dans recent/`);
}

/**
 * Temps présent déduit des mesures horaires (les stations automatiques ne transmettent pas de code de temps présent) :
 * pluie (RR1), brouillard / brume (visibilité et humidité), nébulosité (N en octas, sinon ensoleillement de l'heure en plein jour).
 * Renvoie null quand rien ne permet de conclure : la carte affiche alors la seule température.
 */
function tempsPresent(o: Observation): { weather: string | null; clouds: string | null } {
  let weather: string | null = null;
  if (o.rr1 != null && o.rr1 >= 0.2) weather = o.rr1 >= 2 ? 'Averses' : 'Pluie';
  else if (o.vv != null && o.u != null && o.vv < 1000 && o.u >= 90) weather = 'Brouillard';
  else if (o.vv != null && o.u != null && o.vv < 5000 && o.u >= 90) weather = 'Brume';
  let pct: number | null = null;
  if (o.n != null && o.n >= 0 && o.n <= 8) pct = Math.round((o.n / 8) * 100);
  else if (o.insolh != null && o.ray_glo01 != null && o.ray_glo01 >= 300000) pct = Math.round(100 - Math.min(100, (o.insolh / 60) * 100));
  return { weather, clouds: pct != null ? `Nébulosité ${pct} %` : null };
}

/** Ligne de la carte pour une station : dernière observation, tendances 1 h / 24 h, mini et maxi du jour (heure de Paris). */
function ligneCarte(s: Station, liste: Observation[]) {
  const obs = liste.filter((o) => o.t != null).sort((a, b) => Date.parse(b.validity_time) - Date.parse(a.validity_time));
  const der = obs[0];
  if (!der) return null;
  const ts = Date.parse(der.validity_time);
  const plusProche = (cible: number, min: number, max: number) =>
    obs.slice(1).filter((o) => { const a = ts - Date.parse(o.validity_time); return a >= min && a <= max; })
      .sort((a, b) => Math.abs(ts - Date.parse(a.validity_time) - cible) - Math.abs(ts - Date.parse(b.validity_time) - cible))[0];
  const prec = plusProche(3600e3, 1800e3, 8100e3);
  const j24 = plusProche(86400e3, 72000e3, 93600e3);
  const jour = jourParis(der.validity_time);
  const duJour = obs.filter((o) => jourParis(o.validity_time) === jour);
  const bas = duJour.map((o) => kelvinEnC(o.tn ?? o.t!));
  const haut = duJour.map((o) => kelvinEnC(o.tx ?? o.t!));
  const t = kelvinEnC(der.t!);
  const td = der.td != null ? kelvinEnC(der.td) : null;
  const raf = der.fxy ?? der.fxi;
  const tp = tempsPresent(der);
  return {
    source: 'MF', id: s.id, name: s.nom, lat: arrondi(s.lat, 6), lon: arrondi(s.lon, 6), time: der.validity_time,
    temperature: t, dewpoint: td,
    humidity: der.u != null ? Math.round(der.u) : td != null ? humidite(t, td) : null,
    wind_dir: der.dd != null ? Math.round(der.dd) : null,
    wind_kmh: der.ff != null ? arrondi(der.ff * 3.6) : null,
    gust_kmh: raf != null ? arrondi(raf * 3.6) : null,
    pressure: der.pmer != null ? arrondi(der.pmer / 100) : null,
    visibility_km: der.vv != null ? arrondi(der.vv / 1000) : null,
    weather: tp.weather, weather_code: null, flight_cat: null, clouds: tp.clouds, raw: null,
    temp_trend: prec ? arrondi(t - kelvinEnC(prec.t!)) : null,
    temp_trend_24h: j24 ? arrondi(t - kelvinEnC(j24.t!)) : null,
    tmin: bas.length ? Math.min(...bas) : null,
    tmax: haut.length ? Math.max(...haut) : null,
  };
}

async function main() {
  const stations = await listerStations();
  const departements = [...new Set([...stations.keys()].map((id) => id.slice(0, 2)))].filter((p) => /^\d\d$/.test(p) && Number(p) <= 95).sort();
  const lignes: NonNullable<ReturnType<typeof ligneCarte>>[] = [];
  let echecs = 0;

  // Un département à la fois : ~6 jours de relevés par station pèsent lourd, on libère la mémoire entre deux départements.
  for (const dep of departements) {
    const ecritures = VARIANTES_DEPARTEMENT[dep] ?? [dep, dep.replace(/^0/, '')];
    const cumul = dep === '20';
    let accepte = false;
    for (const e of [...new Set(ecritures)]) {
      try {
        const obs = JSON.parse(await get(`${DPPAQUET}/paquet/horaire?id-departement=${e}&format=json`)) as Observation[];
        const parStation = new Map<string, Observation[]>();
        for (const o of obs) {
          if (!stations.has(o.geo_id_insee)) continue;
          const l = parStation.get(o.geo_id_insee) ?? [];
          l.push(o);
          parStation.set(o.geo_id_insee, l);
        }
        archiverDepartement(dep, parStation);
        for (const [id, liste] of parStation) {
          const l = ligneCarte(stations.get(id)!, liste);
          if (l) lignes.push(l);
        }
        accepte = true;
        if (!cumul) break;
      } catch {
        /* écriture suivante */
      }
      await pause(PAUSE_ENTRE_APPELS_MS);
    }
    if (!accepte) { echecs++; console.warn(`Département ${dep} : échec`); }
    await pause(PAUSE_ENTRE_APPELS_MS);
  }

  finaliserArchive();
  if (lignes.length < 500) throw new Error(`Trop peu de stations (${lignes.length}) : fichier existant conservé`);

  mkdirSync(path.dirname(SORTIE), { recursive: true });
  const tmp = `${SORTIE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ generated_at: new Date().toISOString(), count: lignes.length, stations: lignes }));
  renameSync(tmp, SORTIE);
  console.log(`${lignes.length} stations écrites dans ${SORTIE} (${echecs} départements en échec)`);
}


main().catch((e) => { console.error(e); process.exit(1); });
