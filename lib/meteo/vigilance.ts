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

export interface PhenomeneCarte {
  echeance: 'J' | 'J1';
  departement: string;
  /** Numéro Météo-France : 1 vent, 2 pluie-inondation, 3 orages, 4 crues, 5 neige-verglas, 6 canicule, 7 grand froid, 8 avalanches, 9 vagues-submersion. */
  phenomene: number;
  couleur: 1 | 2 | 3 | 4;
}

interface PhenomeneItem {
  phenomenon_id: string;
  phenomenon_max_color_id: number;
}

/** Couleur maximale de chaque phénomène par département, pour chaque échéance (même fichier que parseCarteVigilance). */
export function parsePhenomenesCarte(brut: string): PhenomeneCarte[] {
  const json = JSON.parse(brut) as { periods?: unknown[]; product?: { periods?: unknown[] } };
  const periodes = (json.periods ?? json.product?.periods ?? []) as {
    echeance: 'J' | 'J1';
    timelaps?: { domain_ids?: (DomainCouleur & { phenomenon_items?: PhenomeneItem[] })[] };
  }[];
  const out: PhenomeneCarte[] = [];
  for (const p of periodes) {
    for (const d of p.timelaps?.domain_ids ?? []) {
      if (!/^\d{2,3}$/.test(d.domain_id)) continue;
      for (const ph of d.phenomenon_items ?? []) {
        const numero = Number(ph.phenomenon_id);
        if (numero >= 1 && numero <= 9) out.push({ echeance: p.echeance, departement: d.domain_id, phenomene: numero, couleur: ph.phenomenon_max_color_id as 1 | 2 | 3 | 4 });
      }
    }
  }
  return out;
}
