import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';

/**
 * À exécuter chaque nuit à 00:05 (cron système / task scheduler).
 * Traçabilité uniquement : le contenu réel (saint, dictons) est recalculé à la volée
 * par lib/calculs/page-jour.ts à chaque requête via l'API OVH.
 */
async function main() {
  const dateAujourdHui = new Date().toISOString().slice(0, 10);

  try {
    await ovhApi.pageJourGenerer(dateAujourdHui);
    await ovhApi.syncLogEnregistrer('generation_jour', 'ok', `Page générée pour ${dateAujourdHui}`);
    console.log(`OK — page du jour prête pour ${dateAujourdHui}`);
  } catch (erreur) {
    await ovhApi.syncLogEnregistrer('generation_jour', 'erreur', String(erreur)).catch(() => {});
    console.error('Échec génération jour', erreur);
    process.exitCode = 1;
  }
}

main();
