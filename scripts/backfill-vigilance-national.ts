import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import type { VigilanceNationalJourApi } from '../lib/db/ovh-api-client';

/**
 * Import ponctuel (à lancer manuellement, pas planifié) de l'historique national de vigilance
 * Météo-France depuis les archives officielles de vigilance-public.meteo.fr, qui remontent au
 * 1er octobre 2001 (date de création du dispositif).
 *
 * Contrairement à backfill-vigilance.ts (détail par département, depuis fin 2022 via data.gouv.fr),
 * cette source ne fournit que la couleur maximale NATIONALE par jour — le détail par département
 * n'existe, pour cette période, que sous forme d'images (cartes GIF) : l'extraire demanderait de la
 * reconnaissance d'image, hors scope ici.
 *
 * Source : GET http://vigilance-public.meteo.fr/tableaux_mensuels.php?start_date=AAAA-MM
 * Réponse JSON : { "1": {"date":"AAAA-MM-01","couleur":1-4,"comment":"..."}, "2": {...}, ... }
 * Un seul appel par mois (~250 appels pour couvrir 2001-2022), au lieu d'un par jour.
 *
 * Usage :
 *   npm run backfill:vigilance-national -- --depuis=2001-10 --jusqu-a=2022-10
 * Par défaut : depuis=2001-10 (premier mois du dispositif), jusqu'à=le mois courant (Paris).
 * Rejouable sans risque (écritures idempotentes, ON DUPLICATE KEY UPDATE côté ovh-api/).
 */

const BASE = 'http://vigilance-public.meteo.fr';
const PAUSE_ENTRE_APPELS_MS = 300;

function argument(nom: string, defaut: string): string {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : defaut;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return r.text();
}

interface JourBrut {
  date: string;
  couleur: number;
  comment: string;
}

function* moisEntre(depuis: string, jusquA: string): Generator<string> {
  let [annee, mois] = depuis.split('-').map(Number);
  const [anneeFin, moisFin] = jusquA.split('-').map(Number);
  while (annee < anneeFin || (annee === anneeFin && mois <= moisFin)) {
    yield `${annee}-${String(mois).padStart(2, '0')}`;
    mois++;
    if (mois > 12) {
      mois = 1;
      annee++;
    }
  }
}

async function joursDuMois(moisAnnee: string): Promise<VigilanceNationalJourApi[]> {
  const brut = await get(`${BASE}/tableaux_mensuels.php?start_date=${moisAnnee}`);
  const json = JSON.parse(brut) as Record<string, JourBrut>;
  return Object.values(json)
    .filter((j) => j.couleur >= 1 && j.couleur <= 4)
    .map((j) => ({ date: j.date, couleur: j.couleur as 1 | 2 | 3 | 4, commentaire: j.comment?.trim() || null }));
}

async function main() {
  const maintenant = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .replace('/', '-');
  const depuis = argument('depuis', '2001-10');
  const jusquA = argument('jusqu-a', maintenant);

  console.log(`Backfill vigilance national du ${depuis} au ${jusquA}…`);
  let moisTraites = 0;
  let joursImportes = 0;
  let echecs = 0;

  for (const moisAnnee of moisEntre(depuis, jusquA)) {
    try {
      const jours = await joursDuMois(moisAnnee);
      if (jours.length > 0) {
        const { compte } = await ovhApi.vigilanceNationalEnregistrer(jours);
        joursImportes += compte;
      }
      moisTraites++;
      if (moisTraites % 12 === 0) console.log(`… ${moisAnnee} (${moisTraites} mois traités, ${joursImportes} jours importés)`);
    } catch (e) {
      echecs++;
      console.error(`${moisAnnee} en échec :`, e instanceof Error ? e.message : e);
    }
    await pause(PAUSE_ENTRE_APPELS_MS);
  }

  const resume = `${moisTraites} mois traités, ${joursImportes} jours importés, ${echecs} échecs`;
  console.log(`Terminé — ${resume}`);
  await ovhApi.syncLogEnregistrer('meteo_vigilance_national_backfill', echecs > 0 ? 'partiel' : 'ok', resume).catch(() => {});
}

main();
