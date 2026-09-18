interface SigneZodiaque {
  nom: string;
  symbole: string;
  debut: [number, number]; // [mois, jour]
  fin: [number, number];
}

// Bornes usuelles du zodiaque occidental (tropical), domaine public.
const SIGNES: SigneZodiaque[] = [
  { nom: 'Capricorne', symbole: '♑', debut: [12, 22], fin: [1, 19] },
  { nom: 'Verseau', symbole: '♒', debut: [1, 20], fin: [2, 18] },
  { nom: 'Poissons', symbole: '♓', debut: [2, 19], fin: [3, 20] },
  { nom: 'Bélier', symbole: '♈', debut: [3, 21], fin: [4, 19] },
  { nom: 'Taureau', symbole: '♉', debut: [4, 20], fin: [5, 20] },
  { nom: 'Gémeaux', symbole: '♊', debut: [5, 21], fin: [6, 20] },
  { nom: 'Cancer', symbole: '♋', debut: [6, 21], fin: [7, 22] },
  { nom: 'Lion', symbole: '♌', debut: [7, 23], fin: [8, 22] },
  { nom: 'Vierge', symbole: '♍', debut: [8, 23], fin: [9, 22] },
  { nom: 'Balance', symbole: '♎', debut: [9, 23], fin: [10, 22] },
  { nom: 'Scorpion', symbole: '♏', debut: [10, 23], fin: [11, 21] },
  { nom: 'Sagittaire', symbole: '♐', debut: [11, 22], fin: [12, 21] },
];

export function signeZodiaque(date: Date): SigneZodiaque {
  const mois = date.getMonth() + 1;
  const jour = date.getDate();

  const trouve = SIGNES.find(({ debut, fin }) => {
    const [moisDebut, jourDebut] = debut;
    const [moisFin, jourFin] = fin;
    if (moisDebut === moisFin) {
      return mois === moisDebut && jour >= jourDebut && jour <= jourFin;
    }
    // signe à cheval sur deux mois (ex: Capricorne 22 déc → 19 janv)
    return (mois === moisDebut && jour >= jourDebut) || (mois === moisFin && jour <= jourFin);
  });

  if (!trouve) throw new Error(`Aucun signe trouvé pour ${date.toISOString()}`);
  return trouve;
}

// Cycle des 12 animaux de l'astrologie chinoise, ancré sur une année de référence connue (2020 = Rat).
const ANIMAUX_CHINOIS = [
  'Rat', 'Buffle', 'Tigre', 'Lapin', 'Dragon', 'Serpent',
  'Cheval', 'Chèvre', 'Singe', 'Coq', 'Chien', 'Cochon',
];
const ANNEE_REFERENCE_RAT = 2020;

/**
 * Approximation par année civile (pas le calendrier lunaire exact : le nouvel an chinois
 * tombe entre fin janvier et mi-février, donc les tout premiers jours de l'année peuvent
 * appartenir au signe précédent). Affiché comme indication, pas comme fait calendaire certifié.
 */
export function signeAstrologieChinoise(date: Date): string {
  const annee = date.getFullYear();
  const index = (((annee - ANNEE_REFERENCE_RAT) % 12) + 12) % 12;
  return ANIMAUX_CHINOIS[index];
}
