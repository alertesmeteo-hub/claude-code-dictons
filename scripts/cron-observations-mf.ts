import 'dotenv/config';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
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
 * Sortie : OBSERVATIONS_OUT (défaut /var/www/observations/stations.json), écrite de façon atomique.
 */

const DPOBS = 'https://public-api.meteofrance.fr/public/DPObs/v1';
const DPPAQUET = 'https://public-api.meteofrance.fr/public/DPPaquetObs/v1';
const PAUSE_ENTRE_APPELS_MS = 1500;
const SORTIE = process.env.OBSERVATIONS_OUT || '/var/www/observations/stations.json';
const VARIANTES_DEPARTEMENT: Record<string, string[]> = { '20': ['2A', '2B', '20'] };

interface Station { id: string; nom: string; lat: number; lon: number }
interface Observation {
  geo_id_insee: string;
  validity_time: string;
  t: number | null; td: number | null; u: number | null;
  dd: number | null; ff: number | null; fxy: number | null; fxi: number | null;
  pmer: number | null; vv: number | null;
  tn: number | null; tx: number | null;
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

async function main() {
  const stations = await listerStations();
  const departements = [...new Set([...stations.keys()].map((id) => id.slice(0, 2)))].filter((p) => /^\d\d$/.test(p) && Number(p) <= 95).sort();
  const parStation = new Map<string, Observation[]>();
  let echecs = 0;

  for (const dep of departements) {
    const ecritures = VARIANTES_DEPARTEMENT[dep] ?? [dep, dep.replace(/^0/, '')];
    const cumul = dep === '20';
    let accepte = false;
    for (const e of [...new Set(ecritures)]) {
      try {
        const obs = JSON.parse(await get(`${DPPAQUET}/paquet/horaire?id-departement=${e}&format=json`)) as Observation[];
        for (const o of obs) {
          if (!stations.has(o.geo_id_insee)) continue;
          const l = parStation.get(o.geo_id_insee) ?? [];
          l.push(o);
          parStation.set(o.geo_id_insee, l);
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

  const lignes = [];
  for (const [id, liste] of parStation) {
    const obs = liste.filter((o) => o.t != null).sort((a, b) => Date.parse(b.validity_time) - Date.parse(a.validity_time));
    const der = obs[0];
    if (!der) continue;
    const ts = Date.parse(der.validity_time);
    // Tendance : observation la plus proche d'1 h plus tôt (entre 30 min et 2 h 15).
    const prec = obs.slice(1).filter((o) => { const a = ts - Date.parse(o.validity_time); return a >= 1800e3 && a <= 8100e3; })
      .sort((a, b) => Math.abs(ts - Date.parse(a.validity_time) - 3600e3) - Math.abs(ts - Date.parse(b.validity_time) - 3600e3))[0];
    // Variation sur ~24 h : observation la plus proche d'il y a 24 h (entre 20 h et 26 h).
    const j24 = obs.slice(1).filter((o) => { const a = ts - Date.parse(o.validity_time); return a >= 72000e3 && a <= 93600e3; })
      .sort((a, b) => Math.abs(ts - Date.parse(a.validity_time) - 86400e3) - Math.abs(ts - Date.parse(b.validity_time) - 86400e3))[0];
    // Mini / maxi du jour (heure de Paris) : extrêmes horaires tn / tx, à défaut la température.
    const jour = jourParis(der.validity_time);
    const duJour = obs.filter((o) => jourParis(o.validity_time) === jour);
    const bas = duJour.map((o) => kelvinEnC(o.tn ?? o.t!));
    const haut = duJour.map((o) => kelvinEnC(o.tx ?? o.t!));
    const t = kelvinEnC(der.t!);
    const td = der.td != null ? kelvinEnC(der.td) : null;
    const s = stations.get(id)!;
    const raf = der.fxy ?? der.fxi;
    lignes.push({
      source: 'MF', id, name: s.nom, lat: arrondi(s.lat, 6), lon: arrondi(s.lon, 6), time: der.validity_time,
      temperature: t, dewpoint: td,
      humidity: der.u != null ? Math.round(der.u) : td != null ? humidite(t, td) : null,
      wind_dir: der.dd != null ? Math.round(der.dd) : null,
      wind_kmh: der.ff != null ? arrondi(der.ff * 3.6) : null,
      gust_kmh: raf != null ? arrondi(raf * 3.6) : null,
      pressure: der.pmer != null ? arrondi(der.pmer / 100) : null,
      visibility_km: der.vv != null ? arrondi(der.vv / 1000) : null,
      weather: null, weather_code: null, flight_cat: null, clouds: null, raw: null,
      temp_trend: prec ? arrondi(t - kelvinEnC(prec.t!)) : null,
      temp_trend_24h: j24 ? arrondi(t - kelvinEnC(j24.t!)) : null,
      tmin: bas.length ? Math.min(...bas) : null,
      tmax: haut.length ? Math.max(...haut) : null,
    });
  }
  if (lignes.length < 500) throw new Error(`Trop peu de stations (${lignes.length}) : fichier existant conservé`);

  mkdirSync(path.dirname(SORTIE), { recursive: true });
  const tmp = `${SORTIE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ generated_at: new Date().toISOString(), count: lignes.length, stations: lignes }));
  renameSync(tmp, SORTIE);
  console.log(`${lignes.length} stations écrites dans ${SORTIE} (${echecs} départements en échec)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
