import { evenementsLunaires } from '@/lib/calculs/lune';

export interface FetePopulaire {
  emoji: string;
  nom: string;
  regle: string;
}

type Regle = (annee: number) => { mois: number; jour: number }[];

const fixe = (mois: number, jour: number): Regle => () => [{ mois, jour }];

/** n-ième (n>=1) ou dernier (n=-1) jour de semaine (0=dimanche) d'un mois. */
function jourSemaine(annee: number, mois: number, semaine: number, n: number): number {
  if (n > 0) {
    const premier = new Date(Date.UTC(annee, mois - 1, 1)).getUTCDay();
    return 1 + ((semaine - premier + 7) % 7) + (n - 1) * 7;
  }
  const dernier = new Date(Date.UTC(annee, mois, 0));
  return dernier.getUTCDate() - ((dernier.getUTCDay() - semaine + 7) % 7);
}

const nieme = (mois: number, semaine: number, n: number): Regle => (a) => [{ mois, jour: jourSemaine(a, mois, semaine, n) }];

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher) + 49 jours = Pentecôte. */
function pentecote(annee: number): Date {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(annee, mois - 1, jour + 49));
}

/** Fête des Mères : dernier dimanche de mai, reportée au 1er dimanche de juin si c'est la Pentecôte. */
const fetesMeres: Regle = (a) => {
  const p = pentecote(a);
  const j = jourSemaine(a, 5, 0, -1);
  return p.getUTCMonth() === 4 && p.getUTCDate() === j ? [{ mois: 6, jour: jourSemaine(a, 6, 0, 1) }] : [{ mois: 5, jour: j }];
};

/** Nouvel An chinois : nouvelle lune tombant entre le 21 janvier et le 20 février (date en heure de Chine). */
const nouvelAnChinois: Regle = (a) => {
  const nl = evenementsLunaires(new Date(Date.UTC(a, 0, 15)), new Date(Date.UTC(a, 1, 25))).filter(
    (e) => e.type === 'nouvelle_lune'
  );
  for (const e of nl) {
    const [y, m, j] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(e.instant).split('-').map(Number);
    if ((m === 1 && j >= 21) || (m === 2 && j <= 20)) return [{ mois: m, jour: j }];
  }
  return [];
};

/** 3e week-end de septembre : 3e samedi et dimanche suivant. */
const patrimoine: Regle = (a) => {
  const s = jourSemaine(a, 9, 6, 3);
  return [{ mois: 9, jour: s }, { mois: 9, jour: s + 1 }];
};

const FETES: (FetePopulaire & { quand: Regle })[] = [
  { emoji: '💝', nom: 'Saint-Valentin', regle: '14 février', quand: fixe(2, 14) },
  { emoji: '💐', nom: 'Fête des Mères', regle: 'Dernier dim. de mai', quand: fetesMeres },
  { emoji: '👔', nom: 'Fête des Pères', regle: '3e dim. de juin', quand: nieme(6, 0, 3) },
  { emoji: '🎃', nom: 'Halloween', regle: '31 octobre', quand: fixe(10, 31) },
  { emoji: '🎅', nom: 'Saint-Nicolas', regle: '6 décembre', quand: fixe(12, 6) },
  { emoji: '👵', nom: 'Fête des Grands-Mères', regle: '1er dim. de mars', quand: nieme(3, 0, 1) },
  { emoji: '👴', nom: 'Fête des Grands-Pères', regle: "1er dim. d'octobre", quand: nieme(10, 0, 1) },
  { emoji: '♀️', nom: 'Journée des droits des femmes', regle: '8 mars', quand: fixe(3, 8) },
  { emoji: '🍀', nom: 'Saint-Patrick', regle: '17 mars', quand: fixe(3, 17) },
  { emoji: '🐟', nom: '1er avril', regle: '1er avril', quand: fixe(4, 1) },
  { emoji: '🎵', nom: 'Fête de la Musique', regle: '21 juin', quand: fixe(6, 21) },
  { emoji: '🏛️', nom: 'Journées du Patrimoine', regle: '3e week-end de sept.', quand: patrimoine },
  { emoji: '🏘️', nom: 'Fête des Voisins', regle: 'Dernier ven. de mai', quand: nieme(5, 5, -1) },
  { emoji: '🌹', nom: 'Fête des Belles-Mères', regle: '1er dim. de juin', quand: nieme(6, 0, 1) },
  { emoji: '🐉', nom: 'Nouvel An Chinois', regle: 'Janvier-février', quand: nouvelAnChinois },
  { emoji: '💼', nom: 'Fête des Secrétaires', regle: "Dernier mer. d'avril", quand: nieme(4, 3, -1) },
];

/** Fêtes populaires tombant le jour donné (la liste est vide la plupart du temps). */
export function fetesPopulaires(annee: number, mois: number, jour: number): FetePopulaire[] {
  return FETES.filter((f) => f.quand(annee).some((q) => q.mois === mois && q.jour === jour)).map(
    ({ emoji, nom, regle }) => ({ emoji, nom, regle })
  );
}
