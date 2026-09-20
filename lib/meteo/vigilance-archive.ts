/**
 * Archive officielle de la vigilance (Météo-France) : http://vigilance-public.meteo.fr/
 * Page journalière : vigilanceDate.php?dateVigi=AAAA-MM-JJ — liste les bulletins du jour
 * (heure, producteur, phénomènes) avec un lien direct vers chacun (vigi.php?type=bulletin&id=…&base=…).
 * Couverture : 2001-10-01 → environ 2022 (au-delà, l'archive officielle est vide : voir data.gouv.fr).
 */

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

/** URL officielle d'un bulletin (ouverture directe). */
export const urlBulletin = (b: Pick<BulletinArchive, 'bulletinId' | 'base'>) =>
  `${ARCHIVE_BASE}/vigi.php?type=bulletin&id=${b.bulletinId}&base=${b.base}`;

export const urlPageJour = (date: string) => `${ARCHIVE_BASE}/vigilanceDate.php?dateVigi=${date}`;
