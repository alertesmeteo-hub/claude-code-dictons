import { joursFeriesAnnee } from '@/lib/calculs/jours-feries';
import { fetesPopulaires, type FetePopulaire } from '@/lib/calculs/fetes-populaires';
import { evenementsLunaires, type PhasePrincipale } from '@/lib/calculs/lune';
import { instantSaison } from '@/lib/calculs/saisons';

export const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export const PHASES: Record<PhasePrincipale, { emoji: string; libelle: string }> = {
  nouvelle_lune: { emoji: '🌑', libelle: 'Nouvelle lune' },
  premier_quartier: { emoji: '🌓', libelle: 'Premier quartier' },
  pleine_lune: { emoji: '🌕', libelle: 'Pleine lune' },
  dernier_quartier: { emoji: '🌗', libelle: 'Dernier quartier' },
};

/** Introduction propre à chaque mois (faits généraux et stables du calendrier français). */
const PRESENTATION: Record<number, string> = {
  1: "Janvier ouvre l'année avec le jour de l'an. Le solstice d'hiver est passé et les jours rallongent peu à peu.",
  2: "Février est le mois le plus court de l'année : 28 jours, ou 29 les années bissextiles. On y célèbre la Chandeleur le 2 février et la Saint-Valentin le 14.",
  3: "Mars marque l'arrivée du printemps, avec l'équinoxe vers le 20 du mois. Le passage à l'heure d'été a lieu le dernier dimanche de mars.",
  4: "Avril est le mois du poisson d'avril. Selon les années, il accueille Pâques, dont la date varie entre le 22 mars et le 25 avril.",
  5: "Mai est le mois des ponts et des week-ends prolongés : Fête du Travail, Victoire 1945, et souvent Ascension et Pentecôte.",
  6: "Juin voit le solstice d'été vers le 21, jour le plus long de l'année dans l'hémisphère nord, et la Fête de la Musique.",
  7: "Juillet est le mois de la Fête nationale du 14 juillet et du début des vacances d'été.",
  8: "Août est le cœur des vacances d'été en France, avec l'Assomption le 15 août.",
  9: "Septembre rime avec rentrée scolaire et Journées du Patrimoine. L'équinoxe d'automne survient vers le 22 ou 23 du mois.",
  10: "Octobre est le mois des couleurs d'automne. Le passage à l'heure d'hiver a lieu le dernier dimanche du mois, et Halloween est fêté le 31.",
  11: "Novembre commence par la Toussaint le 1er et compte l'Armistice le 11. Les jours deviennent nettement plus courts.",
  12: "Décembre est le mois du solstice d'hiver vers le 21, de Noël le 25 et de la Saint-Sylvestre le 31.",
};

export interface JourCalendrier {
  jour: number;
  cle: string; // YYYY-MM-DD
  ferie: string | null;
  populaires: FetePopulaire[];
  phases: { type: PhasePrincipale; heure: string }[];
}

export interface EvenementMois {
  jour: number;
  emoji: string;
  libelle: string;
  detail?: string;
}

export interface CalendrierMois {
  annee: number;
  mois: number;
  nbJours: number;
  jours: JourCalendrier[];
  /** Semaines (lundi → dimanche) ; null = case vide ; numero = semaine ISO 8601. */
  semaines: { numero: number; cases: (JourCalendrier | null)[] }[];
  feries: { jour: number; nom: string }[];
  evenements: EvenementMois[];
  phasesLune: { jour: number; type: PhasePrincipale; heure: string }[];
  joursOuvres: number;
  presentation: string;
}

/** Numéro de semaine ISO 8601. */
export function semaineIso(annee: number, mois: number, jour: number): number {
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  const n = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - n);
  const debut = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - debut) / 86400000 + 1) / 7);
}

const parisJourHeure = (d: Date) => {
  const p = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return { jour: Number(v('day')), mois: Number(v('month')), heure: `${Number(v('hour')) % 24} h ${v('minute')}` };
};

function dernierDimanche(annee: number, mois: number): number {
  const dernier = new Date(Date.UTC(annee, mois, 0));
  return dernier.getUTCDate() - dernier.getUTCDay();
}

export function construireCalendrierMois(annee: number, mois: number): CalendrierMois {
  const nbJours = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  const feries = joursFeriesAnnee(annee)
    .filter((f) => f.date.getMonth() + 1 === mois)
    .map((f) => ({ jour: f.date.getDate(), nom: f.nom }))
    .sort((a, b) => a.jour - b.jour);

  const lunaires = evenementsLunaires(new Date(Date.UTC(annee, mois - 1, 1) - 86400000), new Date(Date.UTC(annee, mois, 1, 23)))
    .map((e) => ({ type: e.type, ...parisJourHeure(e.instant) }))
    .filter((e) => e.mois === mois);

  const jours: JourCalendrier[] = [];
  for (let j = 1; j <= nbJours; j++) {
    jours.push({
      jour: j,
      cle: `${annee}-${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}`,
      ferie: feries.find((f) => f.jour === j)?.nom ?? null,
      populaires: fetesPopulaires(annee, mois, j),
      phases: lunaires.filter((e) => e.jour === j).map((e) => ({ type: e.type, heure: e.heure })),
    });
  }

  const decalage = (new Date(Date.UTC(annee, mois - 1, 1)).getUTCDay() + 6) % 7; // lundi = 0
  const semaines: CalendrierMois['semaines'] = [];
  let cases: (JourCalendrier | null)[] = Array(decalage).fill(null);
  let premierJourSemaine = 1;
  for (const j of jours) {
    cases.push(j);
    if (cases.length === 7) {
      semaines.push({ numero: semaineIso(annee, mois, premierJourSemaine), cases });
      cases = [];
      premierJourSemaine = j.jour + 1;
    }
  }
  if (cases.length > 0) {
    while (cases.length < 7) cases.push(null);
    semaines.push({ numero: semaineIso(annee, mois, premierJourSemaine), cases });
  }

  const evenements: EvenementMois[] = [];
  for (const f of feries) evenements.push({ jour: f.jour, emoji: '🇫🇷', libelle: f.nom, detail: 'jour férié' });
  for (const j of jours) for (const p of j.populaires) evenements.push({ jour: j.jour, emoji: p.emoji, libelle: p.nom });
  const indiceSaison = ({ 3: 0, 6: 1, 9: 2, 12: 3 } as Record<number, 0 | 1 | 2 | 3>)[mois];
  if (indiceSaison !== undefined) {
    const { jour, heure } = parisJourHeure(instantSaison(annee, indiceSaison));
    evenements.push({
      jour,
      emoji: '🍃',
      libelle: [
        'Équinoxe de printemps (début du printemps)',
        "Solstice d'été (début de l'été)",
        "Équinoxe d'automne (début de l'automne)",
        "Solstice d'hiver (début de l'hiver)",
      ][indiceSaison],
      detail: `à ${heure}`,
    });
  }
  if (mois === 3) evenements.push({ jour: dernierDimanche(annee, 3), emoji: '🕑', libelle: "Passage à l'heure d'été", detail: '2 h → 3 h' });
  if (mois === 10) evenements.push({ jour: dernierDimanche(annee, 10), emoji: '🕒', libelle: "Passage à l'heure d'hiver", detail: '3 h → 2 h' });
  evenements.sort((a, b) => a.jour - b.jour);

  let joursOuvres = 0;
  for (const j of jours) {
    const dow = new Date(Date.UTC(annee, mois - 1, j.jour)).getUTCDay();
    if (dow !== 0 && dow !== 6 && !j.ferie) joursOuvres++;
  }

  return {
    annee, mois, nbJours, jours, semaines, feries, evenements,
    phasesLune: lunaires.map((e) => ({ jour: e.jour, type: e.type, heure: e.heure })),
    joursOuvres,
    presentation: PRESENTATION[mois],
  };
}
