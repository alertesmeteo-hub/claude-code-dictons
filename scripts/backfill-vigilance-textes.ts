import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import type { VigilanceBulletinTexteApi } from '../lib/db/ovh-api-client';
import { ARCHIVE_BASE, parserBulletin } from '../lib/meteo/vigilance-archive';

/**
 * Import ponctuel (à lancer manuellement, pas planifié) du TEXTE INTÉGRAL des bulletins de vigilance listés
 * par backfill-vigilance-bulletins.ts, avec les départements suivis et le niveau maximal cité.
 *
 * Source : GET vigi.php?type=bulletin&id=…&base=… sur http://vigilance-public.meteo.fr/ (un appel par bulletin).
 * Reprise automatique : l'API renvoie les bulletins dont le texte manque encore ; on peut donc interrompre
 * et relancer sans rien perdre (écritures idempotentes).
 *
 * Usage :
 *   npm run backfill:vigilance-textes
 *   npm run backfill:vigilance-textes -- --max=500      # test sur 500 bulletins
 */

const PAUSE_ENTRE_APPELS_MS = 250;
const LOT = 100; // bulletins récupérés puis envoyés ensemble à l'API OVH

function argument(nom: string, defaut: string): string {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : defaut;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function texteHtml(base: string, id: number): Promise<string> {
  const url = `${ARCHIVE_BASE}/vigi.php?type=bulletin&id=${id}&base=${base}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  // ISO-8859-1 (charset annoncé par le serveur).
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
  const max = Number(argument('max', '0')) || Infinity;
  const { restant } = await ovhApi.vigilanceBulletinsARecuperer(1);
  console.log(`Bulletins dont le texte reste à récupérer : ${restant}${Number.isFinite(max) ? ` (limité à ${max})` : ''}`);

  let traites = 0;
  let echecs = 0;
  const ignores = new Set<string>(); // bulletins en échec cette session, pour ne pas boucler dessus

  while (traites + echecs < max) {
    const { bulletins } = await ovhApi.vigilanceBulletinsARecuperer(LOT + ignores.size);
    const aFaire = bulletins.filter((b) => !ignores.has(`${b.base}:${b.bulletinId}`)).slice(0, LOT);
    if (aFaire.length === 0) break;

    const lot: VigilanceBulletinTexteApi[] = [];
    for (const b of aFaire) {
      if (traites + echecs >= max) break;
      try {
        const html = await avecReprises(() => texteHtml(b.base, b.bulletinId));
        const p = parserBulletin(html);
        if (p.texte.length < 40) throw new Error('texte vide ou trop court');
        lot.push({ base: b.base, bulletinId: b.bulletinId, texte: p.texte, niveauMax: p.niveauMax, departements: p.departements });
        traites++;
      } catch (e) {
        echecs++;
        ignores.add(`${b.base}:${b.bulletinId}`);
        console.error(`${b.base}#${b.bulletinId} en échec :`, e instanceof Error ? e.message : e);
      }
      await pause(PAUSE_ENTRE_APPELS_MS);
    }
    if (lot.length > 0) await avecReprises(() => ovhApi.vigilanceBulletinsTextesEnregistrer(lot));
    console.log(`… ${traites} textes récupérés, ${echecs} échecs`);
  }

  const resume = `${traites} textes de bulletins importés, ${echecs} échecs`;
  console.log(`Terminé — ${resume}`);
  await ovhApi.syncLogEnregistrer('meteo_vigilance_textes_backfill', echecs > 0 ? 'partiel' : 'ok', resume).catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
