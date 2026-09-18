import { readFileSync, writeFileSync } from 'node:fs';

// Parse prisma/communes-raw.json (téléchargé depuis l'API Géo officielle, data.gouv.fr/Etalab :
// https://geo.api.gouv.fr/communes?fields=nom,code,codeDepartement,departement,codesPostaux,centre&format=json&geometry=centre)
// et génère prisma/seed-data-villes.json pour la recherche de commune (météo/soleil).

const brut = JSON.parse(readFileSync(new URL('./communes-raw.json', import.meta.url)));

function slugifier(texte) {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const resultat = brut
  .filter((c) => c.centre && c.centre.coordinates)
  .map((c) => ({
    nom: c.nom,
    codePostal: c.codesPostaux?.[0] ?? null,
    departement: c.departement?.nom ?? c.codeDepartement ?? null,
    longitude: c.centre.coordinates[0],
    latitude: c.centre.coordinates[1],
    slug: `${slugifier(c.nom)}-${c.code}`,
  }));

writeFileSync(new URL('./seed-data-villes.json', import.meta.url), JSON.stringify(resultat));
console.log(`${resultat.length} communes extraites.`);
