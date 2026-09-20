import type { VigilanceCarteApi } from '../db/ovh-api-client';

/**
 * Parsing de la carte de vigilance Météo-France, commun à la synchronisation temps réel
 * (API DPVigilance, GET /cartevigilance/encours) et au backfill depuis l'archive data.gouv.fr
 * (fichiers CDP_CARTE_EXTERNE.json), qui partagent le même format JSON.
 */

interface DomainCouleur {
  domain_id: string;
  max_color_id: number;
}

interface Periode {
  echeance: 'J' | 'J1';
  timelaps?: { domain_ids?: DomainCouleur[] };
}

interface CarteVigilance {
  periods?: Periode[];
  product?: { periods?: Periode[] };
}

export function parseCarteVigilance(brut: string): VigilanceCarteApi[] {
  const json = JSON.parse(brut) as CarteVigilance;
  const periodes = json.periods ?? json.product?.periods ?? [];
  if (periodes.length === 0) throw new Error('Carte de vigilance vide ou format inattendu');

  const carte: VigilanceCarteApi[] = [];
  for (const p of periodes) {
    for (const d of p.timelaps?.domain_ids ?? []) {
      if (!/^\d{2,3}$/.test(d.domain_id)) continue; // écarte les domaines non départementaux (ex: mer, DOM séparés)
      carte.push({ echeance: p.echeance, departement: d.domain_id, couleur: d.max_color_id as 1 | 2 | 3 | 4 });
    }
  }
  if (carte.length === 0) throw new Error('Aucun département exploitable dans la carte de vigilance');
  return carte;
}
