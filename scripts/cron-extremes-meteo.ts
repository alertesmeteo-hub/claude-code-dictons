import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';

/**
 * ⚠️ SQUELETTE NON FINALISÉ — voir README.md section "Températures extrêmes".
 *
 * Source réelle vérifiée : API Météo-France DPObs v1 (https://public-api.meteofrance.fr/public/DPObs/v1),
 * gratuite sur inscription à https://portail-api.meteofrance.fr/. Endpoints /liste-stations-synop
 * et /station/horaire confirmés existants. Deux points restent à vérifier avec un compte réel
 * (non vérifiables sans authentification) : le flux exact d'échange clé→token, et le nom/unité
 * exact du champ température dans la réponse /station/horaire.
 *
 * Écrit désormais via l'API OVH (ovhApi.extremesEnregistrer) au lieu de Prisma direct,
 * puisque la base n'est joignable que depuis le réseau OVH.
 */

const BASE_URL = 'https://public-api.meteofrance.fr/public/DPObs/v1';
const TOKEN_URL = 'https://portail-api.meteofrance.fr/token';
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

async function obtenirToken(): Promise<string> {
  const clePlication = process.env.METEOFRANCE_API_KEY;
  if (!clePlication) throw new Error('METEOFRANCE_API_KEY manquante');

  const reponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${clePlication}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!reponse.ok) throw new Error(`Échec obtention token Météo-France : ${reponse.status}`);
  const donnees = await reponse.json();
  return donnees.access_token;
}

async function listerStationsSynop(token: string): Promise<StationSynop[]> {
  const reponse = await fetch(`${BASE_URL}/liste-stations-synop?format=json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!reponse.ok) throw new Error(`Échec liste-stations-synop : ${reponse.status}`);
  const donnees = await reponse.json();

  return (donnees as any[]).map((s) => ({
    id: String(s.id ?? s.id_station),
    nom: s.nom ?? s.name,
    departement: s.departement ?? s.dep ?? '',
    altitude: Number(s.altitude ?? s.alti ?? 0),
  }));
}

async function recupererExtremesStation(token: string, station: StationSynop, dateJour: string): Promise<MesureExtreme[]> {
  const reponse = await fetch(
    `${BASE_URL}/station/horaire?id_station=${station.id}&date=${dateJour}T00:00:00Z&format=json`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!reponse.ok) throw new Error(`Échec station/horaire pour ${station.id} : ${reponse.status}`);
  const observations = await reponse.json();

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
  const token = await obtenirToken();
  const stations = await listerStationsSynop(token);
  const stationsBasseAltitude = stations.filter((s) => s.altitude < ALTITUDE_MAX_M);
  const dateJour = new Date().toISOString().slice(0, 10);
  const resultats: MesureExtreme[] = [];

  for (const station of stationsBasseAltitude) {
    try {
      resultats.push(...(await recupererExtremesStation(token, station, dateJour)));
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
