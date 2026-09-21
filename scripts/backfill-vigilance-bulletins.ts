import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import type { VigilanceBulletinApi } from '../lib/db/ovh-api-client';
import { parserCartesPage, parserPageJour, urlPageJour } from '../lib/meteo/vigilance-archive';

/**
 * Import ponctuel (à lancer manuellement, pas planifié) des BULLETINS de l'archive officielle de vigilance
 * Météo-France (http://vigilance-public.meteo.fr/), qui remonte au 1er octobre 2001.
 *
 * Source : GET vigilanceDate.php?dateVigi=AAAA-MM-JJ — une page par jour, listant chaque bulletin (heure,
 * producteur, phénomènes) avec un lien direct vers son texte. Un seul appel par jour (~7 800 jours pour
 * 2001-10 → 2022-12, soit environ une heure). Au-delà de 2022 environ, l'archive officielle est vide :
 * le détail récent vient de data.gouv.fr (voir backfill-vigilance.ts).
 *
 * Alimente la table vigilance_bulletin (créée automatiquement par l'API), utilisée par la recherche avancée
 * du site vigilance-meteo (filtre par phénomène + lien vers le bulletin officiel).
 *
 * Usage :
 *   npm run backfill:vigilance-bulletins -- --depuis=2001-10-01 --jusqu-a=2022-12-31
 * Rejouable sans risque (écritures idempotentes sur (base, bulletin_id)).
 */

const PAUSE_ENTRE_APPELS_MS = 250;
const LOT_MAX = 150; // bulletins par envoi à l'API OVH

function argument(nom: string, defaut: string): string {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : defaut;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function* joursEntre(depuis: string, jusquA: string): Generator<string> {
  const fin = Date.parse(`${jusquA}T00:00:00Z`);
  for (let t = Date.parse(`${depuis}T00:00:00Z`); t <= fin; t += 86_400_000) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

async function pageDuJour(date: string): Promise<string> {
  const r = await fetch(urlPageJour(date));
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${urlPageJour(date)}`);
  // La page est en ISO-8859-1 (accents parfois en entités HTML).
  return new TextDecoder('latin1').decode(await r.arrayBuffer());
}

async function avecReprises<T>(fn: () => Promise<T>, essais = 3): Promise<T> {
  let derniere: unknown;
  for (let i = 1; i <= essais; i++) {
    try {
      return await fn();
    } catch (e) {
      derniere = e;
      await pause(1000 * i);
    }
  }
  throw derniere;
}

async function main() {
  const depuis = argument('depuis', '2001-10-01');
  const jusquA = argument('jusqu-a', '2022-12-31');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depuis) || !/^\d{4}-\d{2}-\d{2}$/.test(jusquA)) {
    throw new Error('Format attendu : --depuis=AAAA-MM-JJ --jusqu-a=AAAA-MM-JJ');
  }

  console.log(`Backfill des bulletins de vigilance du ${depuis} au ${jusquA}…`);
  let jours = 0;
  let joursAvecBulletins = 0;
  let bulletins = 0;
  let echecs = 0;
  let lot: VigilanceBulletinApi[] = [];

  const vider = async () => {
    if (lot.length === 0) return;
    await avecReprises(() => ovhApi.vigilanceBulletinsEnregistrer(lot));
    lot = [];
  };

  for (const date of joursEntre(depuis, jusquA)) {
    try {
      const html = await avecReprises(() => pageDuJour(date));
      let trouves = parserPageJour(date, html);
      // Jour sans bulletin mais avec des cartes : on les liste (heure + niveau), sans texte.
      if (trouves.length === 0) trouves = parserCartesPage(date, html);
      jours++;
      if (trouves.length > 0) {
        joursAvecBulletins++;
        bulletins += trouves.length;
        lot.push(...trouves);
        if (lot.length >= LOT_MAX) await vider();
      }
    } catch (e) {
      echecs++;
      console.error(`${date} en échec :`, e instanceof Error ? e.message : e);
    }
    if (jours % 200 === 0 && jours > 0) {
      console.log(`… ${date} (${jours} jours, ${joursAvecBulletins} avec bulletins, ${bulletins} bulletins, ${echecs} échecs)`);
    }
    await pause(PAUSE_ENTRE_APPELS_MS);
  }
  await vider();

  const resume = `${jours} jours parcourus, ${joursAvecBulletins} avec bulletins, ${bulletins} bulletins importés, ${echecs} échecs`;
  console.log(`Terminé — ${resume}`);
  await ovhApi.syncLogEnregistrer('meteo_vigilance_bulletins_backfill', echecs > 0 ? 'partiel' : 'ok', resume).catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
