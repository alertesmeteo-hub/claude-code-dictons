import { prisma } from '@/lib/db/prisma';
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
 * Assemble le contenu déterministe + éditorial d'une date donnée.
 * Ne fait AUCUN appel météo (géré séparément côté client via /api/v1/meteo,
 * car dépendant de la géoloc du visiteur, pas de la date seule).
 */
export async function construireContenuJour(date: Date): Promise<ContenuJour> {
  const mois = date.getMonth() + 1;
  const jour = date.getDate();

  const [saint, dictonsDuJour, dictonsGeneriques] = await Promise.all([
    prisma.saint.findUnique({ where: { uniq_jour: { mois, jour } } }),
    prisma.dicton.findMany({ where: { mois, jour, actif: true } }),
    prisma.dicton.findMany({ where: { mois: null, jour: null, actif: true }, take: 5 }),
  ]);

  const dictonsRetenus = dictonsDuJour.length > 0 ? dictonsDuJour : dictonsGeneriques;

  return {
    date: date.toISOString().slice(0, 10),
    infosJourAnnee: calculerInfosJourAnnee(date),
    zodiaque: signeZodiaque(date),
    astrologieChinoise: signeAstrologieChinoise(date),
    calendrierRepublicain: convertirEnCalendrierRepublicain(date),
    saint: saint
      ? {
          nomPrincipal: saint.nomPrincipal,
          presentationHistorique: saint.presentationHistorique,
          autresPrenoms: saint.autresPrenoms,
          patronage: saint.patronage,
          traditions: saint.traditions,
        }
      : null,
    dictons: dictonsRetenus.map((d) => ({ texte: d.texte, type: d.type })),
  };
}
