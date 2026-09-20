import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import type { VigilanceCarteApi } from '../lib/db/ovh-api-client';

/**
 * Archivage quotidien du bulletin de vigilance Météo-France.
 *
 * Source (Météo-France, portail https://portail-api.meteofrance.fr, clé API dans METEOFRANCE_API_KEY,
 * souscription à l'API « DonneesPubliquesVigilance ») :
 *  - GET /cartevigilance/encours : carte JSON, couleur maximale par département (1 vert → 4 rouge),
 *    pour les échéances J et J+1 (structure : product.periods[].timelaps.domain_ids[]).
 *  - GET /textesvigilance/encours?domain=FRA : bulletin de synthèse national. Le format exact renvoyé par
 *    l'API n'est pas garanti (texte brut, XML ou JSON selon versions) : conservé tel quel, sans être
 *    interprété — l'objectif ici est l'archivage, pas l'affichage.
 * Écrit via l'API OVH (ovhApi.vigilanceEnregistrer) : la base n'est joignable que depuis le réseau OVH.
 */

const DPVIGILANCE = 'https://public-api.meteofrance.fr/public/DPVigilance/v1';
const MAX_TENTATIVES = 3;

function cle(): string {
  const c = process.env.METEOFRANCE_API_KEY;
  if (!c) throw new Error('METEOFRANCE_API_KEY manquante');
  return c;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

interface DomainCouleur {
  domain_id: string;
  max_color_id: number;
}

interface Periode {
  echeance: 'J' | 'J1';
  timelaps?: { domain_ids?: DomainCouleur[] };
}

interface CarteVigilance {
  periods?: Periode[];
  product?: { periods?: Periode[] };
}

async function carteDuJour(): Promise<VigilanceCarteApi[]> {
  const brut = await get(`${DPVIGILANCE}/cartevigilance/encours`);
  const json = JSON.parse(brut) as CarteVigilance;
  const periodes = json.periods ?? json.product?.periods ?? [];
  if (periodes.length === 0) throw new Error('Carte de vigilance vide ou format inattendu');

  const carte: VigilanceCarteApi[] = [];
  for (const p of periodes) {
    for (const d of p.timelaps?.domain_ids ?? []) {
      if (!/^\d{2,3}$/.test(d.domain_id)) continue; // écarte les domaines non départementaux (ex: mer, DOM séparés)
      carte.push({ echeance: p.echeance, departement: d.domain_id, couleur: d.max_color_id as 1 | 2 | 3 | 4 });
    }
  }
  if (carte.length === 0) throw new Error('Aucun département exploitable dans la carte de vigilance');
  return carte;
}

async function texteDuJour(): Promise<string | null> {
  try {
    return await get(`${DPVIGILANCE}/textesvigilance/encours?domain=FRA`);
  } catch (e) {
    // Le texte de synthèse est un complément : son indisponibilité ne doit pas empêcher l'archivage de la carte.
    console.error('Texte de vigilance indisponible :', e instanceof Error ? e.message : e);
    return null;
  }
}

async function main() {
  let derniereErreur: unknown = null;

  for (let tentative = 1; tentative <= MAX_TENTATIVES; tentative++) {
    try {
      const [carte, texte] = await Promise.all([carteDuJour(), texteDuJour()]);
      const { compte } = await ovhApi.vigilanceEnregistrer(carte, texte);
      await ovhApi.syncLogEnregistrer('meteo_vigilance', 'ok', `${compte} entrées de carte synchronisées${texte ? ' + texte' : ' (sans texte)'}`);
      console.log(`OK — ${compte} entrées de carte synchronisées${texte ? ' + texte de synthèse' : ' (texte indisponible)'}`);
      const pire = carte.reduce((m, c) => Math.max(m, c.couleur), 1);
      console.log(`Couleur maximale du jour : ${pire}`);
      return;
    } catch (erreur) {
      derniereErreur = erreur;
      console.error(`Tentative ${tentative}/${MAX_TENTATIVES} échouée`, erreur instanceof Error ? erreur.message : erreur);
      if (tentative < MAX_TENTATIVES) await pause(tentative * 5000);
    }
  }

  await ovhApi.syncLogEnregistrer('meteo_vigilance', 'erreur', String(derniereErreur)).catch(() => {});
  console.error('Échec définitif après', MAX_TENTATIVES, 'tentatives');
  process.exitCode = 1;
}

main();
