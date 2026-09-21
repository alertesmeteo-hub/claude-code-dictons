/**
 * Archive officielle de la vigilance (Météo-France) : http://vigilance-public.meteo.fr/
 * Page journalière : vigilanceDate.php?dateVigi=AAAA-MM-JJ — liste les bulletins du jour
 * (heure, producteur, phénomènes) avec un lien direct vers chacun (vigi.php?type=bulletin&id=…&base=…).
 * Couverture : 2001-10-01 → environ 2022 (au-delà, l'archive officielle est vide : voir data.gouv.fr).
 */

import { DEPARTEMENTS_FR, codesDepuisNoms } from './departements-fr';

export const ARCHIVE_BASE = 'http://vigilance-public.meteo.fr';

/** Bits des phénomènes (numérotation officielle 1 à 9 = bit 1 à 9). */
export const PHENOMENES = {
  1: { bit: 1, nom: 'Vent violent' },
  2: { bit: 2, nom: 'Pluie-inondation' },
  3: { bit: 4, nom: 'Orages' },
  4: { bit: 8, nom: 'Crues' },
  5: { bit: 16, nom: 'Neige-verglas' },
  6: { bit: 32, nom: 'Canicule' },
  7: { bit: 64, nom: 'Grand froid' },
  8: { bit: 128, nom: 'Avalanches' },
  9: { bit: 256, nom: 'Vagues-submersion' },
} as const;

export type NumeroPhenomene = keyof typeof PHENOMENES;

export interface BulletinArchive {
  date: string; // AAAA-MM-JJ
  heure: string; // HH:MM:SS
  producteur: string; // CMIRO, CNP, …
  phenomenes: string; // libellé brut de l'archive, ex. « Vent. »
  masque: number; // OU binaire des phénomènes reconnus dans `phenomenes`
  bulletinId: number;
  base: string; // vigilance1a3, vigilance4, …
}

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function decoderEntites(s: string): string {
  return s
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&ecirc;/g, 'ê').replace(/&agrave;/g, 'à')
    .replace(/&ocirc;/g, 'ô').replace(/&ucirc;/g, 'û').replace(/&ccedil;/g, 'ç').replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
}

/** Libellé brut → masque binaire. Les libellés inconnus donnent 0 (le brut est conservé). */
export function masqueDepuisLibelle(libelle: string): number {
  const t = sansAccents(libelle);
  let m = 0;
  if (/\bvent/.test(t)) m |= PHENOMENES[1].bit;
  if (/pluie/.test(t)) m |= PHENOMENES[2].bit;
  if (/orage/.test(t)) m |= PHENOMENES[3].bit;
  if (/\bcrue/.test(t)) m |= PHENOMENES[4].bit;
  if (/neige|verglas/.test(t)) m |= PHENOMENES[5].bit;
  if (/canicule/.test(t)) m |= PHENOMENES[6].bit;
  if (/froid/.test(t)) m |= PHENOMENES[7].bit;
  if (/avalanche/.test(t)) m |= PHENOMENES[8].bit;
  if (/vague|submersion|houle/.test(t)) m |= PHENOMENES[9].bit;
  return m;
}

/** Noms des phénomènes présents dans un masque. */
export function nomsDepuisMasque(masque: number): string[] {
  return Object.values(PHENOMENES).filter((p) => masque & p.bit).map((p) => p.nom);
}

const LIGNE = /<tr>((?:(?!<\/tr>)[\s\S])*?)<\/tr>/g;
const BULLETIN = /type=bulletin&id=(\d+)&base=(\w+)'>(\d{2}:\d{2})<\/a><\/td>\s*<td[^>]*>\s*<a[^>]*>([^<]*)<\/a><\/td>\s*<td[^>]*>\s*<span class='contenu'>([\s\S]*?)<\/span>/;

/** Analyse le HTML d'une page journalière. Fonction pure : aucun appel réseau. */
export function parserPageJour(date: string, html: string): BulletinArchive[] {
  const bulletins: BulletinArchive[] = [];
  for (const ligne of html.matchAll(LIGNE)) {
    const m = ligne[1].match(BULLETIN);
    if (!m) continue;
    const phenomenes = decoderEntites(m[5]).replace(/\s+/g, ' ').trim();
    bulletins.push({
      date,
      heure: `${m[3]}:00`,
      producteur: decoderEntites(m[4]).trim(),
      phenomenes,
      masque: masqueDepuisLibelle(phenomenes),
      bulletinId: Number(m[1]),
      base: m[2],
    });
  }
  return bulletins;
}

/**
 * Cartes d'un jour (heure + niveau max, sans texte) : pour les jours où l'archive n'a pas de bulletin,
 * on les liste comme des « bulletins » sans texte. Base synthétique `carte_<base>` : ne pas confondre
 * les identifiants de cartes avec ceux des bulletins.
 */
export function parserCartesPage(date: string, html: string): BulletinArchive[] {
  const cartes: BulletinArchive[] = [];
  const LIGNE_CARTE =
    /href='vigi\.php\?type=carte&(?:amp;)?id=(\d+)&(?:amp;)?base=(\w+)'>(\d{2}:\d{2})<\/a><\/td><td[^>]*><span class='contenu'>([^<]+)<\/span>/g;
  for (const m of html.matchAll(LIGNE_CARTE)) {
    cartes.push({
      date,
      heure: `${m[3]}:00`,
      producteur: 'Carte',
      phenomenes: `Carte de vigilance — niveau max ${decoderEntites(m[4]).trim().toLowerCase()}`,
      masque: 0,
      bulletinId: Number(m[1]),
      base: `carte_${m[2]}`,
    });
  }
  return cartes;
}

/** URL officielle d'un bulletin (ouverture directe). */
export const urlBulletin = (b: Pick<BulletinArchive, 'bulletinId' | 'base'>) =>
  `${ARCHIVE_BASE}/vigi.php?type=bulletin&id=${b.bulletinId}&base=${b.base}`;

export const urlPageJour = (date: string) => `${ARCHIVE_BASE}/vigilanceDate.php?dateVigi=${date}`;

// ───────────────────────── Texte intégral d'un bulletin ─────────────────────────


/** Statut d'un département dans un bulletin de suivi. */
export const STATUT_SUIVI = { debut: 1, maintien: 2, fin: 3 } as const;
export type StatutSuivi = (typeof STATUT_SUIVI)[keyof typeof STATUT_SUIVI];

export interface BulletinTexte {
  /** Texte brut intégral (mise en forme d'origine conservée). */
  texte: string;
  /** Niveau maximal cité dans le bulletin (2 jaune, 3 orange, 4 rouge) ou null. */
  niveauMax: 2 | 3 | 4 | null;
  /** Départements cités comme suivis, avec leur statut. */
  departements: { code: string; statut: StatutSuivi }[];
}

/** HTML d'un bulletin (`<pre>` pour la base ancienne, blocs HTML pour la base récente) → texte brut. */
export function texteDepuisHtml(html: string): string {
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  let t = pre
    ? pre[1]
    : html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '');
  t = decoderEntites(t).replace(/\r/g, '');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const NIVEAUX: Record<string, 2 | 3 | 4> = { jaune: 2, orange: 3, rouge: 4 };

/** Couleurs citées sous la forme « Neige-Verglas/Orange » ; renvoie le niveau le plus élevé. */
export function niveauMaxDepuisTexte(texte: string): 2 | 3 | 4 | null {
  let max: 2 | 3 | 4 | null = null;
  for (const m of texte.matchAll(/\b[A-Za-zÀ-ÿ' -]{3,40}\/(Jaune|Orange|Rouge)\b/g)) {
    const n = NIVEAUX[m[1].toLowerCase()];
    if (!max || n > max) max = n;
  }
  return max;
}

const ENTETE_SUIVI = /(D[ée]but|Maintien|Fin) de suivi pour[^:\n]*:/gi;
const STATUT_PAR_MOT: Record<string, StatutSuivi> = { debut: 1, début: 1, maintien: 2, fin: 3 };

/** Codes des départements suivis, par statut. Formats gérés : « Maintien de suivi pour … : Aude (11), … »,
 *  blocs récents « Début / Maintien / Fin de suivi pour : », et l'ancien « Lieux concernés par l'événement : noms ». */
export function departementsDepuisTexte(texte: string): { code: string; statut: StatutSuivi }[] {
  const res = new Map<string, StatutSuivi>();
  const codesDe = (segment: string) => {
    const codes = new Set<string>();
    for (const m of segment.matchAll(/\(\s*(\d{2}|2A|2B)\s*\)/g)) if (m[1] in DEPARTEMENTS_FR) codes.add(m[1]);
    if (/\bAndorre\b/i.test(segment)) codes.add('99');
    return codes;
  };

  const entetes = [...texte.matchAll(ENTETE_SUIVI)];
  entetes.forEach((e, i) => {
    const debut = (e.index ?? 0) + e[0].length;
    const finBrute = i + 1 < entetes.length ? entetes[i + 1].index ?? texte.length : texte.length;
    // Le segment s'arrête au prochain paragraphe titré (Qualification, Description…) ou à la prochaine section.
    let segment = texte.slice(debut, finBrute);
    const coupe = segment.search(/\n\s*\n\s*(Qualification|Description|Faits nouveaux|Situation|Cons[ée]quences|Conseils|Localisation|Evolution)/i);
    if (coupe !== -1) segment = segment.slice(0, coupe);
    const mot = e[1].toLowerCase();
    const statut = STATUT_PAR_MOT[mot] ?? STATUT_PAR_MOT[mot.normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? 2;
    for (const c of codesDe(segment)) if (!res.has(c) || statut < (res.get(c) as number)) res.set(c, statut);
  });

  if (res.size === 0) {
    // Ancien format : « Lieux concernés par l'événement : Cotes d'Armor Finistère Morbihan »
    const lieux = texte.match(/Lieux concern[ée]s par l['’]?[ée]v[ée]nement\s*:\s*([^\n]+)/i);
    if (lieux) for (const c of codesDepuisNoms(lieux[1])) res.set(c, STATUT_PAR_MOT.maintien);
    for (const c of codesDe(lieux?.[1] ?? '')) res.set(c, STATUT_PAR_MOT.maintien);
  }
  return [...res.entries()].map(([code, statut]) => ({ code, statut })).sort((a, b) => a.code.localeCompare(b.code));
}

/** HTML d'un bulletin → texte + niveau + départements. Fonction pure. */
export function parserBulletin(html: string): BulletinTexte {
  const texte = texteDepuisHtml(html);
  return { texte, niveauMax: niveauMaxDepuisTexte(texte), departements: departementsDepuisTexte(texte) };
}
