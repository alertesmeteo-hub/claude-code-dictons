import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import fetes from './seed-data-fetes.json';

/**
 * Importe « prénoms fêtés » + « autres fêtes du jour » (Nominis, voir prisma/parser-fetes-nominis.mjs)
 * via l'API OVH. Rejouable sans doublon (mise à jour par jour). Usage : npm run seed:fetes
 */
async function main() {
  const liste = fetes as Record<string, unknown>[];
  const TAILLE_LOT = 50;
  let total = 0;
  for (let i = 0; i < liste.length; i += TAILLE_LOT) {
    const { compte } = await ovhApi.fetesImportMasse(liste.slice(i, i + TAILLE_LOT));
    total += compte;
    console.log(`Fêtes : ${total}/${liste.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
