import { PrismaClient } from '@prisma/client';
import saintsAnnee from './seed-data-saints.json';
import dictonsAnnee from './seed-data-dictons.json';

const prisma = new PrismaClient();

/**
 * Saints : 365 jours importés depuis le flux iCal officiel de Nominis
 * (Conférence des évêques de France) — https://nominis.cef.fr/ical/nominis.php,
 * voir prisma/parser-nominis.mjs pour le script d'extraction.
 * Chaque entrée porte `verifie: false` par défaut et sa source exacte (URL Nominis) :
 * à confirmer/compléter (autres prénoms, patronage, traditions) depuis l'admin,
 * un jour n'est marqué "vérifié" qu'après relecture humaine.
 * Le 29 février n'est pas présent (calendrier généré sur une année non bissextile) :
 * à ajouter manuellement si besoin.
 *
 * Dictons : 365 jours importés depuis meteoeu.net (compilation d'almanach, dictons traditionnels
 * du domaine public) — voir prisma/parser-meteoeu.mjs. Classés `dicton_meteo` par défaut (le site
 * source est spécifiquement dédié aux dictons météo/almanach liés aux saints du jour) : ce
 * classement est une approximation, à affiner au cas par cas depuis l'admin si besoin
 * (certains sont plutôt des dictons paysans/agricoles).
 */
async function main() {
  for (const saint of saintsAnnee as {
    mois: number;
    jour: number;
    nomPrincipal: string;
    presentationHistorique: string | null;
    autresPrenoms: string | null;
    patronage: string | null;
    traditions: string | null;
    source: string;
    verifie: boolean;
  }[]) {
    await prisma.saint.upsert({
      where: { uniq_jour: { mois: saint.mois, jour: saint.jour } },
      update: {},
      create: saint,
    });
  }

  const dictonsExistants = await prisma.dicton.count();
  if (dictonsExistants === 0) {
    for (const d of dictonsAnnee as { mois: number; jour: number; texte: string; source: string }[]) {
      await prisma.dicton.create({
        data: { texte: d.texte, type: 'dicton_meteo', mois: d.mois, jour: d.jour, source: d.source },
      });
    }
  }

  console.log(
    `Seed terminé : ${(saintsAnnee as unknown[]).length} saints (365 jours), ${(dictonsAnnee as unknown[]).length} dictons (365 jours) insérés si la table était vide.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
