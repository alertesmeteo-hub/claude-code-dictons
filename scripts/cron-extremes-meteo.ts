import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';

/**
 * ⚠️ SQUELETTE NON FINALISÉ — voir README.md section "Températures extrêmes".
 *
 * Source réelle vérifiée : API Météo-France DPObs v1 (https://public-api.meteofrance.fr/public/DPObs/v1),
 * gratuite sur inscription à https://portail-api.meteofrance.fr/. Endpoints /liste-stations-synop
 * et /station/horaire confirmés existants. Deux points restent à vérifier avec un compte réel
 * (non vérifiables sans authentification) : l'obtention d'une clé API valide (en-tête apikey), et le nom/unité
 * exact du champ température dans la réponse /station/horaire.
 *
 * Écrit désormais via l'API OVH (ovhApi.extremesEnregistrer) au lieu de Prisma direct,
 * puisque la base n'est joignable que depuis le réseau OVH.
 */

const BASE_URL = 'https://public-api.meteofrance.fr/public/DPObs/v1';
const ALTITUDE_MAX_M = 500;
const MAX_TENTATIVES = 3;

interface StationSynop {
  id: string;
  nom: string;
  departement: string;
  altitude: number;
}

interface MesureExtreme {
  codeStation: string;
  nomCommune: string;
  departement: string;
  altitudeM: number;
  type: 'maxi' | 'mini';
  valeurC: number;
  heureMesure: string;
  source: string;
}

/**
 * Authentification : la passerelle (WSO2) accepte une clé d'API générée sur le portail dans l'en-tête `apikey`
 * (vérifié : elle liste `apikey` parmi les en-têtes autorisés et répond 401 JSON sans clé valide).
 * L'ancien flux OAuth « /token » était rejeté par le pare-feu de Météo-France (page HTML « Request Rejected »).
 * → Sur le portail, créer une application, s'abonner à DPObs, puis générer une « clé API » (et non un jeton OAuth2).
 */
function enTetes(): Record<string, string> {
  const cle = process.env.METEOFRANCE_API_KEY;
  if (!cle) throw new Error('METEOFRANCE_API_KEY manquante');
  return { apikey: cle, Accept: 'application/json' };
}

async function lireJson(reponse: Response, contexte: string): Promise<unknown> {
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`${contexte} : HTTP ${reponse.status} ${texte.slice(0, 150)}`);
  try {
    return JSON.parse(texte);
  } catch {
    throw new Error(`${contexte} : réponse non JSON (${texte.slice(0, 100)})`);
  }
}

async function listerStationsSynop(): Promise<StationSynop[]> {
  const reponse = await fetch(`${BASE_URL}/liste-stations-synop?format=json`, {
    headers: enTetes(),
  });
  const donnees = await lireJson(reponse, 'liste-stations-synop');

  return (donnees as any[]).map((s) => ({
    id: String(s.id ?? s.id_station),
    nom: s.nom ?? s.name,
    departement: s.departement ?? s.dep ?? '',
    altitude: Number(s.altitude ?? s.alti ?? 0),
  }));
}

async function recupererExtremesStation(station: StationSynop, dateJour: string): Promise<MesureExtreme[]> {
  const reponse = await fetch(
    `${BASE_URL}/station/horaire?id_station=${station.id}&date=${dateJour}T00:00:00Z&format=json`,
    { headers: enTetes() }
  );
  const observations = await lireJson(reponse, `station/horaire ${station.id}`);

  const temperatures: { valeurC: number; heure: string }[] = (observations as any[])
    .filter((o) => o.t != null)
    .map((o) => ({ valeurC: Number(o.t) - 273.15, heure: o.reference_time ?? o.date }));

  if (temperatures.length === 0) return [];

  const maxi = temperatures.reduce((a, b) => (b.valeurC > a.valeurC ? b : a));
  const mini = temperatures.reduce((a, b) => (b.valeurC < a.valeurC ? b : a));
  const base = {
    codeStation: station.id,
    nomCommune: station.nom,
    departement: station.departement,
    altitudeM: station.altitude,
    source: 'Météo-France — API DPObs (donnees-publiques)',
  };

  return [
    { ...base, type: 'maxi' as const, valeurC: Math.round(maxi.valeurC * 10) / 10, heureMesure: maxi.heure },
    { ...base, type: 'mini' as const, valeurC: Math.round(mini.valeurC * 10) / 10, heureMesure: mini.heure },
  ];
}

async function recupererDonneesStations(): Promise<MesureExtreme[]> {
  const stations = await listerStationsSynop();
  const stationsBasseAltitude = stations.filter((s) => s.altitude < ALTITUDE_MAX_M);
  const dateJour = new Date().toISOString().slice(0, 10);
  const resultats: MesureExtreme[] = [];

  for (const station of stationsBasseAltitude) {
    try {
      resultats.push(...(await recupererExtremesStation(station, dateJour)));
    } catch (erreur) {
      console.error(`Station ${station.id} ignorée :`, erreur);
    }
  }
  return resultats;
}

async function main() {
  let derniereErreur: unknown = null;

  for (let tentative = 1; tentative <= MAX_TENTATIVES; tentative++) {
    try {
      const donnees = await recupererDonneesStations();
      const { compte } = await ovhApi.extremesEnregistrer(donnees as unknown as Record<string, unknown>[]);
      await ovhApi.syncLogEnregistrer('meteo_extremes', 'ok', `${compte} mesures synchronisées`);
      console.log(`OK — ${compte} mesures synchronisées`);
      return;
    } catch (erreur) {
      derniereErreur = erreur;
      console.error(`Tentative ${tentative}/${MAX_TENTATIVES} échouée`, erreur);
      if (tentative < MAX_TENTATIVES) await new Promise((r) => setTimeout(r, tentative * 5000));
    }
  }

  await ovhApi.syncLogEnregistrer('meteo_extremes', 'erreur', String(derniereErreur)).catch(() => {});
  console.error('Échec définitif après', MAX_TENTATIVES, 'tentatives');
  process.exitCode = 1;
}

main();
