import { prisma } from '../lib/db/prisma';

/**
 * À exécuter chaque nuit à 00:05 (cron système / task scheduler).
 * Ne fait qu'enregistrer une trace pages_jour pour le jour courant : le contenu
 * réel (saint, dictons) est recalculé à la volée par lib/calculs/page-jour.ts
 * à chaque requête — cette tâche sert surtout de traçabilité + point d'accroche
 * pour une future génération plus lourde (résumé, cache pré-chauffé, etc.).
 */
async function main() {
  const aujourdHui = new Date();
  aujourdHui.setHours(0, 0, 0, 0);

  try {
    await prisma.pageJour.upsert({
      where: { date: aujourdHui },
      update: {},
      create: { date: aujourdHui },
    });

    await prisma.syncLog.create({
      data: { tache: 'generation_jour', statut: 'ok', message: `Page générée pour ${aujourdHui.toISOString()}` },
    });

    console.log(`OK — page du jour prête pour ${aujourdHui.toISOString().slice(0, 10)}`);
  } catch (erreur) {
    await prisma.syncLog.create({
      data: { tache: 'generation_jour', statut: 'erreur', message: String(erreur) },
    });
    console.error('Échec génération jour', erreur);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
