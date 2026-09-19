/**
 * Calendrier scolaire officiel : jeu de données ouvert « fr-en-calendrier-scolaire » du ministère de
 * l'Éducation nationale (data.education.gouv.fr, Licence Ouverte). Zones A, B et C (métropole).
 */
export type Zone = 'Zone A' | 'Zone B' | 'Zone C';

export interface Vacances {
  zone: Zone;
  nom: string;
  debut: string; // YYYY-MM-DD (Paris) : premier jour sans cours (samedi)
  reprise: string; // YYYY-MM-DD (Paris) : jour de reprise des cours
}

const API = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records';

const jourParis = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** Années scolaires à charger : celle en cours et la suivante (ex. 2026-2027 et 2027-2028). */
export function anneesScolaires(aujourdhui: string): string[] {
  const [a, m] = aujourdhui.split('-').map(Number);
  const debut = m >= 9 ? a : a - 1;
  return [`${debut}-${debut + 1}`, `${debut + 1}-${debut + 2}`];
}

export async function chargerVacances(aujourdhui: string): Promise<Vacances[]> {
  const annees = anneesScolaires(aujourdhui);
  const where = `zones in ("Zone A","Zone B","Zone C") and annee_scolaire in (${annees.map((a) => `"${a}"`).join(',')})`;
  const url =
    `${API}?limit=100&select=zones,description,population,start_date,end_date` +
    `&group_by=zones,description,population,start_date,end_date&order_by=start_date` +
    `&where=${encodeURIComponent(where)}`;
  const r = await fetch(url, { next: { revalidate: 86400 } });
  if (!r.ok) throw new Error(`data.education.gouv.fr → ${r.status}`);
  const donnees = (await r.json()) as {
    results: { zones: Zone; description: string; population: string; start_date: string; end_date: string }[];
  };

  const vus = new Set<string>();
  const liste: Vacances[] = [];
  for (const e of donnees.results) {
    if (/enseignant/i.test(e.population ?? '')) continue; // dates de reprise des élèves uniquement
    if (/^pont/i.test(e.description)) continue; // ponts traités à part
    const v = { zone: e.zones, nom: e.description, debut: jourParis(e.start_date), reprise: jourParis(e.end_date) };
    const cle = `${v.zone}|${v.nom}|${v.debut}|${v.reprise}`;
    if (!vus.has(cle)) {
      vus.add(cle);
      liste.push(v);
    }
  }
  return liste.sort((a, b) => a.debut.localeCompare(b.debut) || a.zone.localeCompare(b.zone));
}
