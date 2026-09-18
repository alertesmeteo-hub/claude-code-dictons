import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import saintsAnnee from './seed-data-saints.json';
import dictonsAnnee from './seed-data-dictons.json';
import villesFrance from './seed-data-villes.json';

/**
 * Importe le contenu éditorial via l'API OVH (ovh-api/) au lieu d'une connexion MySQL
 * directe, impossible depuis l'extérieur du réseau OVH. Nécessite OVH_API_URL et
 * OVH_API_TOKEN dans .env, et que ovh-api/ soit déjà déployé sur l'hébergement OVH
 * avec les tables créées (voir ovh-api/schema.sql).
 *
 * Saints : 365 jours, flux iCal Nominis — voir prisma/parser-nominis.mjs.
 * Dictons : 365 jours, meteoeu.net — voir prisma/parser-meteoeu.mjs.
 * Villes : 34969 communes, API Géo officielle (data.gouv.fr/Etalab) — voir prisma/parser-villes.mjs.
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

  const villes = villesFrance as Record<string, unknown>[];
  const TAILLE_LOT = 2000;
  let totalVilles = 0;
  for (let i = 0; i < villes.length; i += TAILLE_LOT) {
    const lot = villes.slice(i, i + TAILLE_LOT);
    const { compte } = await ovhApi.villesImportMasse(lot);
    totalVilles += compte;
    console.log(`Villes : ${totalVilles}/${villes.length} envoyées...`);
  }
  console.log(`${totalVilles} communes envoyées à l'API.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
