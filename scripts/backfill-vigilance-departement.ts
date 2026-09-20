import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import type { VigilanceDepartementJourApi } from '../lib/db/ovh-api-client';

/**
 * Import ponctuel (à lancer manuellement, pas planifié) de l'historique de vigilance PAR DÉPARTEMENT
 * depuis 2001, via le site tiers vigiscript.fr (« Calendrier des vigilances météo »), qui reconstitue
 * l'archive officielle Météo-France par département — contrairement à vigilance-public.meteo.fr
 * (officiel mais national uniquement, voir backfill-vigilance-national.ts) et data.gouv.fr (officiel,
 * détail département, mais seulement depuis fin 2022, voir backfill-vigilance.ts).
 *
 * Source : GET https://www.vigiscript.fr/Ancien_bulletin/affichage_calendrier.php
 *   ?department=XX&phenomenon=&year=AAAA&month=MM&ajax=month-colors  (en-tête Accept: application/json)
 * Réponse JSON : { "month": "AAAA-MM", "daysColors": { "AAAA-MM-JJ": 1-4, ... } }
 * Vérifié en conditions réelles : couvre au moins octobre 2001 → aujourd'hui, département 01 et 2A testés.
 *
 * Site tiers (pas Météo-France officiel) : les valeurs ne sont pas garanties identiques à la source
 * officielle, mais servent de meilleure approximation disponible du détail département pour cette période
 * (l'officiel n'existe que sous forme d'images GIF avant fin 2022 — voir README).
 *
 * Volumétrie : ~95 départements × ~300 mois (2001-2026) = ~28 500 appels. Prévoir plusieurs heures,
 * à lancer en arrière-plan (nohup).
 *
 * Usage :
 *   npm run backfill:vigilance-departement -- --depuis=2001-10 --jusqu-a=2022-10
 */

const BASE = 'https://www.vigiscript.fr/Ancien_bulletin/affichage_calendrier.php';
const PAUSE_ENTRE_APPELS_MS = 250;
// Départements métropolitains : 01-19, 2A, 2B, 21-95 (pas de code 20 ; outre-mer non couvert ici).
const DEPARTEMENTS = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')),
  '2A',
  '2B',
  ...Array.from({ length: 75 }, (_, i) => String(i + 21).padStart(2, '0')),
];

function argument(nom: string, defaut: string): string {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : defaut;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return r.text();
}

interface ReponseMois {
  month: string;
  daysColors: Record<string, number>;
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

async function joursDuMois(departement: string, moisAnnee: string): Promise<VigilanceDepartementJourApi[]> {
  const [annee, mois] = moisAnnee.split('-');
  const url = `${BASE}?department=${departement}&phenomenon=&year=${annee}&month=${mois}&ajax=month-colors`;
  const brut = await get(url);
  const json = JSON.parse(brut) as ReponseMois;
  return Object.entries(json.daysColors ?? {})
    .filter(([, c]) => c >= 1 && c <= 4)
    .map(([date, couleur]) => ({ date, departement, couleur: couleur as 1 | 2 | 3 | 4 }));
}

async function main() {
  const maintenant = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .replace('/', '-');
  const depuis = argument('depuis', '2001-10');
  const jusquA = argument('jusqu-a', maintenant);
  const mois = [...moisEntre(depuis, jusquA)];

  console.log(`Backfill vigilance département du ${depuis} au ${jusquA} — ${DEPARTEMENTS.length} départements × ${mois.length} mois = ${DEPARTEMENTS.length * mois.length} appels…`);
  let appelsTraites = 0;
  let joursImportes = 0;
  let echecs = 0;

  for (const departement of DEPARTEMENTS) {
    for (const moisAnnee of mois) {
      try {
        const jours = await joursDuMois(departement, moisAnnee);
        if (jours.length > 0) {
          const { compte } = await ovhApi.vigilanceDepartementHistoriqueEnregistrer(jours);
          joursImportes += compte;
        }
      } catch (e) {
        echecs++;
        console.error(`${departement} ${moisAnnee} en échec :`, e instanceof Error ? e.message : e);
      }
      appelsTraites++;
      if (appelsTraites % 200 === 0) {
        console.log(`… ${departement} ${moisAnnee} (${appelsTraites}/${DEPARTEMENTS.length * mois.length} appels, ${joursImportes} jours importés, ${echecs} échecs)`);
      }
      await pause(PAUSE_ENTRE_APPELS_MS);
    }
  }

  const resume = `${appelsTraites} appels, ${joursImportes} jours importés, ${echecs} échecs`;
  console.log(`Terminé — ${resume}`);
  await ovhApi.syncLogEnregistrer('meteo_vigilance_departement_backfill', echecs > 0 ? 'partiel' : 'ok', resume).catch(() => {});
}

main();
