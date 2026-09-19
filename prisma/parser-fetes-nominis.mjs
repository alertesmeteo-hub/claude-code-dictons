import { writeFileSync } from 'node:fs';

// Récupère, pour chaque jour de l'année, les blocs officiels de Nominis (Conférence des évêques
// de France) : « Bonne fête ! » (prénoms fêtés) et « Autres fêtes du jour » (autres saints).
// Génère prisma/seed-data-fetes.json. Requêtes espacées (pause) pour ne pas surcharger le site.
// Usage : node prisma/parser-fetes-nominis.mjs

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const JOURS_PAR_MOIS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const PAUSE_MS = 400;

const ENTITES = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', ccedil: 'ç', icirc: 'î', iuml: 'ï',
  ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü', oelig: 'œ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', hellip: '…',
};

function decoder(texte) {
  return texte
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, nom) => ENTITES[nom] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const texteBrut = (html) => decoder(html.replace(/<[^>]+>/g, ' '));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function recupererPage(jour, mois) {
  const url = `https://nominis.cef.fr/contenus/fetes/${jour}/${mois}//${jour}-${encodeURIComponent(MOIS[mois - 1])}-.html`;
  for (let tentative = 1; tentative <= 3; tentative++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'dicton-du-jour/1.0 (import ponctuel, alertes.meteo@gmail.com)' } });
      if (r.ok) return { url, html: await r.text() };
    } catch {
      /* nouvelle tentative */
    }
    await pause(1000 * tentative);
  }
  return { url, html: null };
}

function extraire(html, url) {
  const debutPrenoms = html.indexOf('Bonne f');
  const debutAutres = html.indexOf('Autres fêtes du jour');
  if (debutPrenoms === -1 && debutAutres === -1) return null;

  // Certains jours (fêtes du Seigneur) n'ont pas de bloc « Bonne fête ! » : liste de prénoms vide.
  const blocPrenoms = debutPrenoms === -1 ? '' : html.slice(debutPrenoms, debutAutres > debutPrenoms ? debutAutres : debutPrenoms + 6000);
  const prenoms = [...blocPrenoms.matchAll(/<a[^>]*href="\/contenus\/prenom\/\d+\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => texteBrut(m[1]))
    .filter(Boolean);

  const autresFetes = [];
  if (debutAutres !== -1) {
    const fin = html.indexOf('</div></div>', debutAutres);
    const bloc = html.slice(debutAutres, fin === -1 ? undefined : fin + 12);
    for (const m of bloc.matchAll(/<a[^>]*href="(\/contenus\/saint\/\d+\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const nom = texteBrut((m[2].match(/<h5[^>]*>([\s\S]*?)<\/h5>/) ?? [])[1] ?? '');
      const description = texteBrut((m[2].match(/<p[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? '');
      if (nom) autresFetes.push({ nom, description: description || null, url: `https://nominis.cef.fr${m[1]}` });
    }
  }

  return { prenoms: [...new Set(prenoms)], autresFetes, source: url };
}

const resultat = [];
const echecs = [];

for (let mois = 1; mois <= 12; mois++) {
  for (let jour = 1; jour <= JOURS_PAR_MOIS[mois - 1]; jour++) {
    const { url, html } = await recupererPage(jour, mois);
    const donnees = html ? extraire(html, url) : null;
    if (donnees) resultat.push({ mois, jour, ...donnees });
    else echecs.push(`${jour}/${mois}`);
    await pause(PAUSE_MS);
  }
  console.log(`${MOIS[mois - 1]} : ${resultat.filter((r) => r.mois === mois).length}/${JOURS_PAR_MOIS[mois - 1]} jours`);
}

writeFileSync(new URL('./seed-data-fetes.json', import.meta.url), JSON.stringify(resultat));
console.log(`${resultat.length} jours extraits.${echecs.length ? ` Échecs : ${echecs.join(', ')}` : ''}`);
