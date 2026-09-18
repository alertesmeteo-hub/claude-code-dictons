const MOIS_REPUBLICAINS = [
  'Vendémiaire', 'Brumaire', 'Frimaire', 'Nivôse', 'Pluviôse', 'Ventôse',
  'Germinal', 'Floréal', 'Prairial', 'Messidor', 'Thermidor', 'Fructidor',
];

const JOURS_SANS_CULOTTIDES = [
  'de la Vertu', 'du Génie', 'du Travail', 'de l\'Opinion', 'des Récompenses', 'de la Révolution',
];

export interface DateRepublicaine {
  jour: number;
  mois: string | null; // null si jour complémentaire (sans-culottide)
  annee: number; // en chiffres romains non géré ici, on renvoie l'entier
  libelle: string;
  estSansCulottide: boolean;
}

/**
 * Conversion grégorien → calendrier républicain français, calée sur le 22 septembre
 * comme 1er Vendémiaire (règle usuelle simplifiée, dite "méthode Romme continue").
 * ⚠️ Le calendrier révolutionnaire officiel calait le nouvel an sur l'équinoxe d'automne réel,
 * qui peut tomber le 22, 23 ou parfois le 21 septembre selon l'année : cette implémentation
 * est une approximation couramment utilisée par les convertisseurs, PAS une reconstitution
 * astronomique exacte. À signaler comme tel si affiché comme donnée "officielle".
 */
export function convertirEnCalendrierRepublicain(date: Date): DateRepublicaine {
  const anneeGreg = date.getFullYear();
  const debutAnneeRep = new Date(anneeGreg, 8, 22); // 22 septembre

  let anneeRepublicaine = anneeGreg - 1791; // an I = 1792-1793
  let debut = debutAnneeRep;
  if (date < debutAnneeRep) {
    anneeRepublicaine -= 1;
    debut = new Date(anneeGreg - 1, 8, 22);
  }

  const joursEcoules = Math.floor((date.getTime() - debut.getTime()) / 86400000);

  if (joursEcoules < 360) {
    const moisIndex = Math.floor(joursEcoules / 30);
    const jourMois = (joursEcoules % 30) + 1;
    return {
      jour: jourMois,
      mois: MOIS_REPUBLICAINS[moisIndex],
      annee: anneeRepublicaine,
      libelle: `${jourMois} ${MOIS_REPUBLICAINS[moisIndex]} An ${anneeRepublicaine}`,
      estSansCulottide: false,
    };
  }

  const indexComplementaire = joursEcoules - 360;
  const libelleJour = JOURS_SANS_CULOTTIDES[indexComplementaire] ?? 'jour complémentaire';
  return {
    jour: indexComplementaire + 1,
    mois: null,
    annee: anneeRepublicaine,
    libelle: `Jour ${libelleJour} — An ${anneeRepublicaine}`,
    estSansCulottide: true,
  };
}
