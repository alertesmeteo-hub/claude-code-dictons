import { readFileSync, writeFileSync } from 'node:fs';

// Parse prisma/fetes-raw.json (dataset communautaire data.gouv.fr "Les saints et fêtes du
// calendrier", licence ouverte — PAS une source officielle comme Nominis, à prendre avec
// plus de précaution) pour extraire, jour par jour, la liste de TOUS les noms fêtés
// (utile pour remplir "autres prénoms fêtés", absent du flux Nominis utilisé pour les saints).

const brut = JSON.parse(readFileSync(new URL('./fetes-raw.json', import.meta.url)));

function nettoyerNom(nom) {
  return nom
    .replace(/^Ste?-/, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim();
}

const resultat = [];

for (const [mois, jours] of Object.entries(brut)) {
  for (const [jour, noms] of Object.entries(jours)) {
    const nettoyes = noms.map(nettoyerNom).filter(Boolean);
    if (nettoyes.length > 0) {
      resultat.push({ mois: Number(mois), jour: Number(jour), noms: nettoyes });
    }
  }
}

writeFileSync(new URL('./seed-data-prenoms.json', import.meta.url), JSON.stringify(resultat));
console.log(`${resultat.length} jours avec liste de prénoms extraits.`);
