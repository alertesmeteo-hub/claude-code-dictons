export type PhasePrincipale = 'nouvelle_lune' | 'premier_quartier' | 'pleine_lune' | 'dernier_quartier';

export interface EvenementLunaire {
  type: PhasePrincipale;
  instant: Date;
}

const LIBELLES: Record<PhasePrincipale, string> = {
  nouvelle_lune: 'Nouvelle lune',
  premier_quartier: 'Premier quartier',
  pleine_lune: 'Pleine lune',
  dernier_quartier: 'Dernier quartier',
};

const DELTA_T_SECONDES = 69; // TT - UTC vers 2026 (écart de quelques secondes sans effet à la minute près)
const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/**
 * Instant d'une phase principale de la Lune (Meeus, « Astronomical Algorithms », ch. 49,
 * termes principaux). Précision de l'ordre de quelques minutes, suffisante pour l'affichage.
 * k entier = nouvelle lune, +0.25 premier quartier, +0.5 pleine lune, +0.75 dernier quartier.
 */
function instantPhase(k: number): Date {
  const T = k / 1236.85;
  const jde =
    2451550.09766 + 29.530588861 * k + 0.00015437 * T ** 2 - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T ** 2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T ** 2 - 0.00000011 * T ** 3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T ** 2 + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T ** 2 - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T ** 2 + 0.00000215 * T ** 3;

  const quart = Math.round((k % 1) * 4 + 4) % 4; // 0 nouvelle, 1 PQ, 2 pleine, 3 DQ
  let correction: number;

  if (quart === 0 || quart === 2) {
    const nouvelle = quart === 0;
    correction =
      (nouvelle ? -0.4072 : -0.40614) * sin(Mp) +
      (nouvelle ? 0.17241 : 0.17302) * E * sin(M) +
      (nouvelle ? 0.01608 : 0.01614) * sin(2 * Mp) +
      (nouvelle ? 0.01039 : 0.01043) * sin(2 * F) +
      (nouvelle ? 0.00739 : 0.00734) * E * sin(Mp - M) +
      (nouvelle ? -0.00514 : -0.00515) * E * sin(Mp + M) +
      (nouvelle ? 0.00208 : 0.00209) * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) -
      0.00057 * sin(Mp + 2 * F) +
      0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) +
      0.00042 * E * sin(M + 2 * F) +
      0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) -
      0.00017 * sin(O);
  } else {
    correction =
      -0.62801 * sin(Mp) +
      0.17172 * E * sin(M) -
      0.01183 * E * sin(Mp + M) +
      0.00862 * sin(2 * Mp) +
      0.00804 * sin(2 * F) +
      0.00454 * E * sin(Mp - M) +
      0.00204 * E * E * sin(2 * M) -
      0.0018 * sin(Mp - 2 * F) -
      0.0007 * sin(Mp + 2 * F) -
      0.0004 * sin(3 * Mp) -
      0.00034 * E * sin(2 * Mp - M) +
      0.00032 * E * sin(M + 2 * F) +
      0.00032 * E * sin(M - 2 * F) -
      0.00028 * E * E * sin(Mp + 2 * M) +
      0.00027 * E * sin(2 * Mp + M) -
      0.00017 * sin(O);
    const W =
      0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
    correction += quart === 1 ? W : -W;
  }

  const jd = jde + correction;
  return new Date((jd - 2440587.5) * 86400000 - DELTA_T_SECONDES * 1000);
}

const TYPES: PhasePrincipale[] = ['nouvelle_lune', 'premier_quartier', 'pleine_lune', 'dernier_quartier'];

/** Phases principales comprises entre deux instants, dans l'ordre chronologique. */
export function evenementsLunaires(debut: Date, fin: Date): EvenementLunaire[] {
  const anneeDecimale = 2000 + (debut.getTime() - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000);
  const kDepart = Math.floor((anneeDecimale - 2000) * 12.3685) - 1;
  const resultat: EvenementLunaire[] = [];
  for (let i = 0; i < 4 * 30; i++) {
    const k = kDepart + i * 0.25;
    const instant = instantPhase(k);
    if (instant > fin) break;
    if (instant >= debut) resultat.push({ type: TYPES[i % 4], instant });
  }
  return resultat;
}

export interface CycleLunaire {
  phase: string;
  prochaine: { libelle: string; instant: string };
  prochainePleineLune: string;
  prochaineNouvelleLune: string;
}

const jourParis = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Cycle lunaire pour un jour donné (référence : midi, heure de Paris). */
export function cycleLunaire(annee: number, mois: number, jour: number): CycleLunaire {
  const reference = new Date(Date.UTC(annee, mois - 1, jour, 11)); // ~ midi à Paris
  const evenements = evenementsLunaires(new Date(reference.getTime() - 40 * 86400000), new Date(reference.getTime() + 60 * 86400000));
  const passes = evenements.filter((e) => e.instant <= reference);
  const futurs = evenements.filter((e) => e.instant > reference);
  const dernier = passes[passes.length - 1];

  let phase: string;
  if (jourParis(dernier.instant) === jourParis(reference)) {
    phase = LIBELLES[dernier.type];
  } else {
    phase = {
      nouvelle_lune: 'Lune croissante (premier croissant)',
      premier_quartier: 'Lune gibbeuse croissante',
      pleine_lune: 'Lune gibbeuse décroissante',
      dernier_quartier: 'Lune décroissante (dernier croissant)',
    }[dernier.type];
  }

  return {
    phase,
    prochaine: { libelle: LIBELLES[futurs[0].type], instant: futurs[0].instant.toISOString() },
    prochainePleineLune: futurs.find((e) => e.type === 'pleine_lune')!.instant.toISOString(),
    prochaineNouvelleLune: futurs.find((e) => e.type === 'nouvelle_lune')!.instant.toISOString(),
  };
}
