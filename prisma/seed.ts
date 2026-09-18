import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import saintsAnnee from './seed-data-saints.json';
import dictonsAnnee from './seed-data-dictons.json';

/**
 * Importe le contenu éditorial via l'API OVH (ovh-api/) au lieu d'une connexion MySQL
 * directe, impossible depuis l'extérieur du réseau OVH. Nécessite OVH_API_URL et
 * OVH_API_TOKEN dans .env, et que ovh-api/ soit déjà déployé sur l'hébergement OVH
 * avec les tables créées (voir ovh-api/schema.sql).
 *
 * Saints : 365 jours, flux iCal Nominis — voir prisma/parser-nominis.mjs.
 * Dictons : 365 jours, meteoeu.net — voir prisma/parser-meteoeu.mjs.
 * `verifie: false` par défaut sur les saints : à confirmer depuis l'admin après relecture.
 */
async function main() {
  const { compte: compteSaints } = await ovhApi.saintsImportMasse(saintsAnnee as unknown as Record<string, unknown>[]);
  console.log(`${compteSaints} saints envoyés à l'API.`);

  const { compte: compteDictons } = await ovhApi.dictonsImportMasse(
    (dictonsAnnee as { mois: number; jour: number; texte: string; source: string }[]).map((d) => ({
      texte: d.texte,
      type: 'dicton_meteo',
      mois: d.mois,
      jour: d.jour,
      source: d.source,
    }))
  );
  console.log(`${compteDictons} dictons envoyés à l'API.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
