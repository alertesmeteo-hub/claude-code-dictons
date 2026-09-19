import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import prenomsParJour from './seed-data-prenoms.json';

/**
 * Script ponctuel (à exécuter une seule fois) : complète le champ "autres prénoms fêtés"
 * des saints déjà importés, en s'appuyant sur prisma/seed-data-prenoms.json (source
 * communautaire data.gouv.fr, voir prisma/parser-prenoms.mjs — moins fiable que Nominis,
 * à vérifier/corriger depuis l'admin si besoin).
 * Ne touche à aucun autre champ (nom principal, présentation, source... restent ceux
 * déjà en base, issus de Nominis).
 */
async function main() {
  const saints = await ovhApi.saintsListe();
  const prenomsIndex = new Map((prenomsParJour as { mois: number; jour: number; noms: string[] }[]).map((p) => [`${p.mois}-${p.jour}`, p.noms]));

  let compteMisAJour = 0;

  for (const saint of saints) {
    const noms = prenomsIndex.get(`${saint.mois}-${saint.jour}`);
    if (!noms || noms.length === 0) continue;

    const nomPrincipalCourt = saint.nom_principal.replace(/^Sainte?\s+/, '').trim();
    const autres = noms.filter((n) => n.toLowerCase() !== nomPrincipalCourt.toLowerCase());
    if (autres.length === 0) continue;

    await ovhApi.saintEnregistrer({
      mois: saint.mois,
      jour: saint.jour,
      nomPrincipal: saint.nom_principal,
      presentationHistorique: saint.presentation_historique,
      autresPrenoms: autres.join(', '),
      patronage: saint.patronage,
      traditions: saint.traditions,
      source: saint.source,
      verifie: !!saint.verifie,
    });
    compteMisAJour++;
  }

  console.log(`${compteMisAJour} saints mis à jour avec leurs autres prénoms fêtés.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
