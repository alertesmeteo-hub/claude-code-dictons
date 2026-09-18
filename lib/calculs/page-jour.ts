import { ovhApi } from '@/lib/db/ovh-api-client';
import { calculerInfosJourAnnee } from '@/lib/calculs/jour-annee';
import { signeZodiaque, signeAstrologieChinoise } from '@/lib/calculs/zodiaque';
import { convertirEnCalendrierRepublicain } from '@/lib/calculs/calendrier-republicain';

export interface ContenuJour {
  date: string; // YYYY-MM-DD
  infosJourAnnee: ReturnType<typeof calculerInfosJourAnnee>;
  zodiaque: ReturnType<typeof signeZodiaque>;
  astrologieChinoise: string;
  calendrierRepublicain: ReturnType<typeof convertirEnCalendrierRepublicain>;
  saint: {
    nomPrincipal: string;
    presentationHistorique: string | null;
    autresPrenoms: string | null;
    patronage: string | null;
    traditions: string | null;
  } | null;
  dictons: { texte: string; type: string }[];
}

/**
 * Assemble le contenu déterministe (calculé localement) + éditorial (via l'API OVH,
 * seul point d'accès à la base MySQL bijouxdealertes depuis l'extérieur du réseau OVH).
 * Ne fait AUCUN appel météo (géré séparément côté client via /api/v1/meteo).
 */
export async function construireContenuJour(date: Date): Promise<ContenuJour> {
  const dateStr = date.toISOString().slice(0, 10);
  const { saint, dictons } = await ovhApi.jourContenu(dateStr);

  return {
    date: dateStr,
    infosJourAnnee: calculerInfosJourAnnee(date),
    zodiaque: signeZodiaque(date),
    astrologieChinoise: signeAstrologieChinoise(date),
    calendrierRepublicain: convertirEnCalendrierRepublicain(date),
    saint: saint
      ? {
          nomPrincipal: saint.nom_principal,
          presentationHistorique: saint.presentation_historique,
          autresPrenoms: saint.autres_prenoms,
          patronage: saint.patronage,
          traditions: saint.traditions,
        }
      : null,
    dictons,
  };
}
