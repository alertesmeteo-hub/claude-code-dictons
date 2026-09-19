export type NomSaison = 'printemps' | 'été' | 'automne' | 'hiver';

const A = [485, 203, 199, 182, 156, 136, 77, 74, 70, 58, 52, 50, 45, 44, 29, 18, 17, 16, 14, 12, 12, 12, 9, 8];
const B = [324.96, 337.23, 342.08, 27.85, 73.14, 171.52, 222.54, 296.72, 243.58, 119.81, 297.17, 21.02, 247.54, 325.15, 60.93, 155.12, 288.79, 198.04, 199.76, 95.39, 287.11, 320.81, 227.73, 15.45];
const C = [1934.136, 32964.467, 20.186, 445267.112, 45036.886, 22518.443, 65928.934, 3034.906, 9037.513, 33718.147, 150.678, 2281.226, 29929.562, 31555.956, 4443.417, 67555.328, 4562.452, 62894.029, 31436.921, 14577.848, 31931.756, 34777.259, 1222.114, 16859.074];
const RAD = Math.PI / 180;

/** Équinoxes et solstices (Meeus, « Astronomical Algorithms », ch. 27). Précision de quelques minutes. */
function instantSaison(annee: number, indice: 0 | 1 | 2 | 3): Date {
  const Y = (annee - 2000) / 1000;
  const jde0 = [
    2451623.80984 + 365242.37404 * Y + 0.05169 * Y ** 2 - 0.00411 * Y ** 3 - 0.00057 * Y ** 4,
    2451716.56767 + 365241.62603 * Y + 0.00325 * Y ** 2 + 0.00888 * Y ** 3 - 0.0003 * Y ** 4,
    2451810.21715 + 365242.01767 * Y - 0.11575 * Y ** 2 + 0.00337 * Y ** 3 + 0.00078 * Y ** 4,
    2451900.05952 + 365242.74049 * Y - 0.06223 * Y ** 2 - 0.00823 * Y ** 3 + 0.00032 * Y ** 4,
  ][indice];
  const T = (jde0 - 2451545) / 36525;
  const W = 35999.373 * T - 2.47;
  const dl = 1 + 0.0334 * Math.cos(W * RAD) + 0.0007 * Math.cos(2 * W * RAD);
  let S = 0;
  for (let i = 0; i < A.length; i++) S += A[i] * Math.cos((B[i] + C[i] * T) * RAD);
  const jde = jde0 + (0.00001 * S) / dl;
  return new Date((jde - 2440587.5) * 86400000 - 69000); // TT -> UTC
}

const NOMS: NomSaison[] = ['printemps', 'été', 'automne', 'hiver'];

export interface Saison {
  nom: NomSaison;
  debut: string; // ISO
}

/** Saison astronomique (calendrier) en cours et suivante. */
export function saisonsAstronomiques(instant: Date): { actuelle: Saison; prochaine: Saison } {
  const annee = instant.getUTCFullYear();
  const liste: Saison[] = [];
  for (const a of [annee - 1, annee, annee + 1]) {
    for (let i = 0 as 0 | 1 | 2 | 3; i < 4; i = (i + 1) as 0 | 1 | 2 | 3) {
      liste.push({ nom: NOMS[i], debut: instantSaison(a, i).toISOString() });
      if (i === 3) break;
    }
  }
  const t = instant.getTime();
  const idx = liste.findLastIndex((s) => new Date(s.debut).getTime() <= t);
  return { actuelle: liste[idx], prochaine: liste[idx + 1] };
}

const DEBUT_METEO: { mois: number; nom: NomSaison }[] = [
  { mois: 3, nom: 'printemps' },
  { mois: 6, nom: 'été' },
  { mois: 9, nom: 'automne' },
  { mois: 12, nom: 'hiver' },
];

/** Saison météorologique : printemps 1er mars, été 1er juin, automne 1er septembre, hiver 1er décembre. */
export function saisonsMeteo(annee: number, mois: number, jour: number): {
  actuelle: NomSaison;
  prochaine: { nom: NomSaison; date: string; joursRestants: number };
} {
  let i = DEBUT_METEO.findLastIndex((s) => s.mois <= mois);
  if (i === -1) i = 3;
  const suivant = DEBUT_METEO[(i + 1) % 4];
  const anneeSuivante = suivant.mois > mois ? annee : annee + 1;
  const ref = Date.UTC(annee, mois - 1, jour);
  const cible = Date.UTC(anneeSuivante, suivant.mois - 1, 1);
  return {
    actuelle: DEBUT_METEO[i].nom,
    prochaine: {
      nom: suivant.nom,
      date: `${anneeSuivante}-${String(suivant.mois).padStart(2, '0')}-01`,
      joursRestants: Math.round((cible - ref) / 86400000),
    },
  };
}
