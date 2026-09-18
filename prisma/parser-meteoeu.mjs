import { readFileSync, writeFileSync } from 'node:fs';

// Parse les 12 pages HTML téléchargées depuis meteoeu.net (prisma/meteoeu-raw/*.html)
// et génère prisma/seed-data-dictons.json : un dicton = une ligne, avec mois/jour associés.
// Source : https://www.meteoeu.net/dictons-<mois>.htm (dictons traditionnels du domaine public,
// compilation d'almanach). Pages encodées en ISO-8859-1 (Latin-1), structure HTML non homogène
// d'un mois à l'autre (certains mois utilisent <br>, d'autres des <p> par ligne) : on convertit
// donc tout en texte ligne-par-ligne avant de repérer les en-têtes de jour.

const MOIS_INDEX = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const ENTITES = { '&amp;': '&', '&nbsp;': ' ', '&eacute;': 'é', '&egrave;': 'è', '&ecirc;': 'ê' };

function decoderEntites(texte) {
  return Object.entries(ENTITES).reduce((t, [code, car]) => t.split(code).join(car), texte);
}

function htmlVersLignes(html) {
  const texteAvecSauts = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return decoderEntites(texteAvecSauts)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const NOM_MOIS_REGEX = /(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÿ]+)\s*:\s*$/i;

const dossier = new URL('./meteoeu-raw/', import.meta.url);
const resultat = [];

for (const [nomFichier, mois] of Object.entries(MOIS_INDEX)) {
  const html = readFileSync(new URL(`${nomFichier}.html`, dossier), 'latin1');
  const lignes = htmlVersLignes(html);

  let jourCourant = null;
  for (const ligne of lignes) {
    const entete = ligne.match(NOM_MOIS_REGEX);
    // On ne retient l'en-tête que si le mot après le nombre est bien le nom du mois
    // (ou son abréviation la plus courante), pour éviter les faux positifs dans le texte des dictons.
    if (entete && entete[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(nomFichier.slice(0, 3))) {
      jourCourant = Number(entete[1]);
      continue;
    }
    if (jourCourant === null) continue;
    if (ligne.length < 4 || /^(Accueil|Contact|©|Tous les dictons)/i.test(ligne)) continue;

    resultat.push({
      mois,
      jour: jourCourant,
      texte: ligne,
      source: `https://www.meteoeu.net/dictons-${nomFichier}.htm`,
    });
  }
}

writeFileSync(new URL('./seed-data-dictons.json', import.meta.url), JSON.stringify(resultat, null, 2));

const joursDistincts = new Set(resultat.map((d) => `${d.mois}-${d.jour}`)).size;
console.log(`${resultat.length} dictons extraits sur ${joursDistincts} jours distincts (sur 365/366 attendus).`);
