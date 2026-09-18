export interface InfosJourAnnee {
  numeroJourAnnee: number;
  joursRestants: number;
  semaineISO: number;
  bissextile: boolean;
}

function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

function joursDansAnnee(annee: number): number {
  return estBissextile(annee) ? 366 : 365;
}

/** Numéro de semaine ISO 8601 (semaine commence le lundi, semaine 1 = celle contenant le premier jeudi de l'année). */
function semaineISO(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const jourSemaine = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jourSemaine);
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7);
}

export function calculerInfosJourAnnee(date: Date): InfosJourAnnee {
  const annee = date.getFullYear();
  const debutAnnee = new Date(annee, 0, 1);
  const numeroJourAnnee = Math.floor((date.getTime() - debutAnnee.getTime()) / 86400000) + 1;
  const total = joursDansAnnee(annee);

  return {
    numeroJourAnnee,
    joursRestants: total - numeroJourAnnee,
    semaineISO: semaineISO(date),
    bissextile: estBissextile(annee),
  };
}
