import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Relevés horaires d'une station Météo-France pour des jours passés, à la demande (API DPClim « commande-station/horaire »).
 * Sert le module WordPress « Climatologie mensuelle » quand l'archive du VPS (jours/, jours6m/) ne couvre pas le jour demandé.
 *
 * Flux DPClim : POST/GET commande-station/horaire → numéro de commande → commande/fichier (201 = prêt, 204 = en préparation),
 * CSV séparé par « ; » (décimale « , »), DATE = AAAAMMJJHH en UTC. Résultat mis en cache par station et par jour.
 */

const DPCLIM = 'https://public-api.meteofrance.fr/public/DPClim/v1';
const CACHE_DIR = process.env.OBS_DPCLIM_DIR || '/var/www/observations/dpclim';
const MAX_JOURS = 70;
/** Un jour récent peut encore être complété : on le redemande après ce délai. */
const VALIDITE_RECENT_MS = 3 * 3600e3;
const ATTENTE_MAX_MS = 45000;

/** [heure UTC ISO, T, Td, HR, dd, ff km/h, rafale km/h, RR mm, pmer hPa, vv km, insolation min] : même ordre que l'archive du VPS. */
export type LigneHoraire = [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
export interface Quotidien { tx: number | null; tn: number | null; rr: number | null; insol_h: number | null; n: number }

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const arrondi = (v: number, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

/** CSV DPClim horaire → relevés groupés par jour UTC, avec extrêmes horaires TN / TX pour les valeurs quotidiennes. */
export function analyserCsvHoraire(csv: string): Record<string, { lignes: LigneHoraire[]; tn: (number | null)[]; tx: (number | null)[] }> {
  const [entete, ...corps] = csv.trim().split(/\r?\n/);
  const col = entete.split(';');
  const i = (nom: string) => col.indexOf(nom);
  const [iDate, iRr, iT, iTd, iTn, iTx, iPmer, iFf, iDd, iFxi, iU, iIns, iVv] = ['DATE', 'RR1', 'T', 'TD', 'TN', 'TX', 'PMER', 'FF', 'DD', 'FXI', 'U', 'INS', 'VV'].map(i);
  if (iDate < 0 || iT < 0) throw new Error('Colonnes DPClim inattendues');
  const jours: Record<string, { lignes: LigneHoraire[]; tn: (number | null)[]; tx: (number | null)[] }> = {};
  for (const l of corps) {
    const c = l.split(';');
    const d = c[iDate];
    if (!d || d.length < 10) continue;
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:00:00Z`;
    const jour = iso.slice(0, 10);
    const ff = num(c[iFf]);
    const fxi = num(c[iFxi]);
    const vv = num(c[iVv]);
    const pluie = num(c[iRr]);
    const j = (jours[jour] ??= { lignes: [], tn: [], tx: [] });
    j.lignes.push([
      iso, num(c[iT]), num(c[iTd]), num(c[iU]) != null ? Math.round(num(c[iU])!) : null, num(c[iDd]) != null ? Math.round(num(c[iDd])!) : null,
      ff != null ? arrondi(ff * 3.6) : null, fxi != null ? arrondi(fxi * 3.6) : null, pluie != null ? Math.max(0, pluie) : null,
      num(c[iPmer]), vv != null ? arrondi(vv / 1000) : null, num(c[iIns]),
    ]);
    j.tn.push(num(c[iTn]));
    j.tx.push(num(c[iTx]));
  }
  return jours;
}

export function quotidien(lignes: LigneHoraire[], tn: (number | null)[], tx: (number | null)[]): Quotidien {
  const nums = (a: (number | null)[]) => a.filter((v): v is number => v != null);
  const temps = nums(lignes.map((l) => l[1]));
  const haut = [...nums(tx), ...temps];
  const bas = [...nums(tn), ...temps];
  const pluie = nums(lignes.map((l) => l[7]));
  const soleil = nums(lignes.map((l) => l[10]));
  return {
    tx: haut.length ? Math.max(...haut) : null,
    tn: bas.length ? Math.min(...bas) : null,
    rr: pluie.length ? arrondi(pluie.reduce((a, b) => a + b, 0)) : null,
    insol_h: soleil.length ? arrondi(soleil.reduce((a, b) => a + b, 0) / 60) : null,
    n: lignes.length,
  };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cle(): string {
  const c = process.env.METEOFRANCE_API_KEY;
  if (!c) throw new Error('METEOFRANCE_API_KEY manquante');
  return c;
}

async function commander(station: string, debut: string, fin: string): Promise<string> {
  const url = `${DPCLIM}/commande-station/horaire?id-station=${station}&date-deb-periode=${debut}T00:00:00Z&date-fin-periode=${fin}T23:00:00Z`;
  const r = await fetch(url, { headers: { apikey: cle() } });
  const texte = await r.text();
  if (!r.ok && r.status !== 202) throw new Error(`DPClim commande : HTTP ${r.status} ${texte.slice(0, 120)}`);
  const id = JSON.parse(texte)?.elaboreProduitAvecDemandeResponse?.return;
  if (!id) throw new Error('DPClim : numéro de commande absent');
  const finAttente = Date.now() + ATTENTE_MAX_MS;
  while (Date.now() < finAttente) {
    const f = await fetch(`${DPCLIM}/commande/fichier?id-cmde=${id}`, { headers: { apikey: cle() } });
    if (f.status === 200 || f.status === 201) return f.text();
    if (f.status !== 204 && f.status !== 202) throw new Error(`DPClim fichier : HTTP ${f.status}`);
    await pause(2500);
  }
  throw new Error('DPClim : commande trop longue');
}

const fichierCache = (station: string, jour: string) => path.join(CACHE_DIR, station, `${jour}.json`);

function cacheValide(station: string, jour: string, aujourdhui: string): boolean {
  const f = fichierCache(station, jour);
  if (!existsSync(f)) return false;
  const ancien = (Date.parse(aujourdhui) - Date.parse(jour)) / 86400e3 > 3;
  return ancien || Date.now() - statSync(f).mtimeMs < VALIDITE_RECENT_MS;
}

export function listeJours(debut: string, fin: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(debut); t <= Date.parse(fin); t += 86400e3) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export interface ReponseJours { station: string; jours: Record<string, LigneHoraire[]>; quotidien: Record<string, Quotidien> }

/** Relevés de la station pour les jours demandés (UTC) : cache disque, sinon une seule commande DPClim couvrant les jours manquants. */
export async function relevesStation(station: string, debut: string, fin: string): Promise<ReponseJours> {
  if (!/^\d{8}$/.test(station)) throw new Error('Station invalide');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || debut > fin) throw new Error('Période invalide');
  const aujourdhui = new Date().toISOString().slice(0, 10);
  if (fin > aujourdhui) fin = aujourdhui;
  const jours = listeJours(debut, fin);
  if (jours.length > MAX_JOURS) throw new Error(`Période limitée à ${MAX_JOURS} jours`);

  const manquants = jours.filter((j) => !cacheValide(station, j, aujourdhui));
  if (manquants.length) {
    const csv = await commander(station, manquants[0], manquants[manquants.length - 1]);
    const parJour = analyserCsvHoraire(csv);
    for (const j of listeJours(manquants[0], manquants[manquants.length - 1])) {
      const d = parJour[j];
      mkdirSync(path.join(CACHE_DIR, station), { recursive: true });
      const tmp = `${fichierCache(station, j)}.tmp`;
      writeFileSync(tmp, JSON.stringify(d ? { lignes: d.lignes, quotidien: quotidien(d.lignes, d.tn, d.tx) } : { lignes: [], quotidien: null }));
      renameSync(tmp, fichierCache(station, j));
    }
  }

  const rep: ReponseJours = { station, jours: {}, quotidien: {} };
  for (const j of jours) {
    const f = fichierCache(station, j);
    if (!existsSync(f)) continue;
    const c = JSON.parse(readFileSync(f, 'utf8')) as { lignes: LigneHoraire[]; quotidien: Quotidien | null };
    if (c.lignes.length) {
      rep.jours[j] = c.lignes;
      if (c.quotidien) rep.quotidien[j] = c.quotidien;
    }
  }
  return rep;
}
