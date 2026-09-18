import { readFileSync, writeFileSync } from 'node:fs';

// Parse le fichier iCal Nominis téléchargé (prisma/nominis-raw.ics) et génère
// prisma/seed-data-saints.json : un saint retenu par jour (le premier de la liste
// pour ce jour), avec sa source (URL Nominis officielle) pour traçabilité.
// Source : https://nominis.cef.fr/ical/nominis.php (Conférence des évêques de France).

const brut = readFileSync(new URL('./nominis-raw.ics', import.meta.url), 'utf8');

// Dépliage iCal : une ligne continuée commence par un espace sur la ligne suivante.
const lignes = brut.split(/\r\n|\n|\r/);
const lignesDepliees = [];
for (const ligne of lignes) {
  if (ligne.startsWith(' ') && lignesDepliees.length > 0) {
    lignesDepliees[lignesDepliees.length - 1] += ligne.slice(1);
  } else {
    lignesDepliees.push(ligne);
  }
}

function decoder(texte) {
  return texte
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\n/g, ' ')
    .replace(/\\\\/g, '\\')
    .trim();
}

const evenements = [];
let courant = null;

for (const ligne of lignesDepliees) {
  if (ligne === 'BEGIN:VEVENT') {
    courant = {};
  } else if (ligne === 'END:VEVENT') {
    if (courant) evenements.push(courant);
    courant = null;
  } else if (courant) {
    if (ligne.startsWith('DTSTART')) {
      const valeur = ligne.split(':').pop();
      courant.date = valeur; // YYYYMMDD
    } else if (ligne.startsWith('SUMMARY:')) {
      courant.summary = decoder(ligne.slice('SUMMARY:'.length));
    } else if (ligne.startsWith('DESCRIPTION:')) {
      const desc = decoder(ligne.slice('DESCRIPTION:'.length));
      const match = desc.match(/https:\/\/nominis\.cef\.fr\/contenus\/saint\/\S+\.html/);
      courant.source = match ? match[0] : 'https://nominis.cef.fr/';
    }
  }
}

// Un seul saint retenu par jour (mois/jour), on garde le premier rencontré,
// on ignore les entrées qui ne sont pas des saints individuels (ex: "Epiphanie").
const parJour = new Map();

for (const e of evenements) {
  if (!e.date || !e.summary) continue;
  const mois = Number(e.date.slice(4, 6));
  const jour = Number(e.date.slice(6, 8));
  const cle = `${mois}-${jour}`;
  if (parJour.has(cle)) continue;

  const [nomBrut, descriptionBrute] = e.summary.split(' - ');

  parJour.set(cle, {
    mois,
    jour,
    nomPrincipal: nomBrut.trim(),
    presentationHistorique: descriptionBrute ? descriptionBrute.trim() : null,
    autresPrenoms: null,
    patronage: null,
    traditions: null,
    source: e.source,
    verifie: false, // à basculer manuellement en true depuis l'admin après relecture
  });
}

const resultat = [...parJour.values()].sort((a, b) => a.mois - b.mois || a.jour - b.jour);

writeFileSync(
  new URL('./seed-data-saints.json', import.meta.url),
  JSON.stringify(resultat, null, 2)
);

console.log(`${resultat.length} jours extraits (sur 365/366 attendus).`);
