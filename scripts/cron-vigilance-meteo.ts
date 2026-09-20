import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import type { VigilanceCarteApi } from '../lib/db/ovh-api-client';
import { parseCarteVigilance } from '../lib/meteo/vigilance';

/**
 * Archivage quotidien du bulletin de vigilance Météo-France.
 *
 * Source (Météo-France, portail https://portail-api.meteofrance.fr, clé API dans METEOFRANCE_API_KEY,
 * souscription à l'API « DonneesPubliquesVigilance ») :
 *  - GET /cartevigilance/encours : carte JSON, couleur maximale par département (1 vert → 4 rouge),
 *    pour les échéances J et J+1 (structure : product.periods[].timelaps.domain_ids[]).
 *  - GET /textesvigilance/encours (sans le paramètre domain, qui renvoie 404 « no matching blob ») :
 *    bulletin de synthèse national en JSON (product.text_bloc_items[]…). Archivé tel quel, sans être
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

const jourParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const heureParis = () =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date())
    .replace(/^24/, '00');

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

async function carteDuJour(): Promise<VigilanceCarteApi[]> {
  const brut = await get(`${DPVIGILANCE}/cartevigilance/encours`);
  return parseCarteVigilance(brut);
}

async function texteDuJour(): Promise<string | null> {
  try {
    // Sans paramètre `domain` : renvoie le JSON de synthèse nationale (avec domain=FRA, l'API répond 404
    // « no matching blob », vérifié en conditions réelles).
    return await get(`${DPVIGILANCE}/textesvigilance/encours`);
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
      const { compte } = await ovhApi.vigilanceEnregistrer(jourParis(), heureParis(), carte, texte);
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
