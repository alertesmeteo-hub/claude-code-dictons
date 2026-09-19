export interface JourFerie {
  nom: string;
  date: Date;
}

export interface ProchainJourFerie {
  nom: string;
  date: string; // YYYY-MM-DD
  joursRestants: number; // 0 = c'est aujourd'hui
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
function dimanchePaques(annee: number): Date {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour);
}

function ajouterJours(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** Jours fériés légaux en France métropolitaine pour une année. */
export function joursFeriesAnnee(annee: number): JourFerie[] {
  const paques = dimanchePaques(annee);
  return [
    { nom: "Jour de l'an", date: new Date(annee, 0, 1) },
    { nom: 'Lundi de Pâques', date: ajouterJours(paques, 1) },
    { nom: 'Fête du Travail', date: new Date(annee, 4, 1) },
    { nom: 'Victoire 1945', date: new Date(annee, 4, 8) },
    { nom: 'Ascension', date: ajouterJours(paques, 39) },
    { nom: 'Lundi de Pentecôte', date: ajouterJours(paques, 50) },
    { nom: 'Fête nationale', date: new Date(annee, 6, 14) },
    { nom: 'Assomption', date: new Date(annee, 7, 15) },
    { nom: 'Toussaint', date: new Date(annee, 10, 1) },
    { nom: 'Armistice 1918', date: new Date(annee, 10, 11) },
    { nom: 'Noël', date: new Date(annee, 11, 25) },
  ];
}

function formaterDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Prochain jour férié à partir de `depuis` (inclus : si c'est un jour férié, joursRestants vaut 0). */
export function prochainJourFerie(depuis: Date): ProchainJourFerie {
  const debut = new Date(depuis.getFullYear(), depuis.getMonth(), depuis.getDate());
  const candidats = [...joursFeriesAnnee(debut.getFullYear()), ...joursFeriesAnnee(debut.getFullYear() + 1)];
  const suivant = candidats.find((j) => j.date.getTime() >= debut.getTime())!;
  return {
    nom: suivant.nom,
    date: formaterDate(suivant.date),
    joursRestants: Math.round((suivant.date.getTime() - debut.getTime()) / 86400000),
  };
}
