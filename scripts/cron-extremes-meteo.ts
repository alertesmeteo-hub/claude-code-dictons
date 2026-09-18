import { prisma } from '../lib/db/prisma';

/**
 * Source : API "Données Publiques d'Observation" de Météo-France (DPObs v2), gratuite.
 * - Compte + souscription (gratuite) requis sur https://portail-api.meteofrance.fr/
 * - Base URL vérifiée : https://public-api.meteofrance.fr/public/DPObs/v1
 * - Endpoints utilisés : /liste-stations-synop (liste + altitude des ~62 stations SYNOP
 *   de métropole) puis /station/horaire?id_station=...&date=... par station.
 * - Authentification : Bearer token. Le portail Météo-France échange généralement la clé
 *   d'application contre un token via https://portail-api.meteofrance.fr/token
 *   (grant_type=client_credentials, Basic Auth avec la clé applicative encodée en base64).
 *   ⚠️ Le détail exact du flux (nom des en-têtes, durée de vie du token) n'a pas pu être
 *   vérifié sans compte connecté sur le portail — à confirmer lors de la création du compte
 *   et à ajuster ici si besoin.
 * - Format des champs de la réponse /station/horaire (ex: nom exact du champ température,
 *   unité °C vs K) n'a pas non plus été vérifié en conditions réelles (nécessite un token
 *   valide) : à ajuster contre une vraie réponse avant mise en production.
 *
 * Sources consultées : https://portail-api.meteofrance.fr/ (page API DonneesPubliquesObservation),
 * https://meteo.data.gouv.fr/ (dataset "Archive Synop OMM").
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
  latitude: number;
  longitude: number;
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
  if (!clePlication) {
    throw new Error('METEOFRANCE_API_KEY manquante dans les variables d\'environnement');
  }

  const reponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${clePlication}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!reponse.ok) {
    throw new Error(`Échec obtention token Météo-France : ${reponse.status}`);
  }

  const donnees = await reponse.json();
  return donnees.access_token;
}

async function listerStationsSynop(token: string): Promise<StationSynop[]> {
  const reponse = await fetch(`${BASE_URL}/liste-stations-synop?format=json`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!reponse.ok) {
    throw new Error(`Échec liste-stations-synop : ${reponse.status}`);
  }

  const donnees = await reponse.json();

  // ⚠️ Mapping des champs à confirmer contre une vraie réponse (noms de champs non vérifiés).
  return (donnees as any[]).map((s) => ({
    id: String(s.id ?? s.id_station),
    nom: s.nom ?? s.name,
    departement: s.departement ?? s.dep ?? '',
    altitude: Number(s.altitude ?? s.alti ?? 0),
    latitude: Number(s.latitude ?? s.lat),
    longitude: Number(s.longitude ?? s.lon),
  }));
}

async function recupererExtremesStation(
  token: string,
  station: StationSynop,
  dateJour: string
): Promise<MesureExtreme[]> {
  const reponse = await fetch(
    `${BASE_URL}/station/horaire?id_station=${station.id}&date=${dateJour}T00:00:00Z&format=json`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!reponse.ok) {
    throw new Error(`Échec station/horaire pour ${station.id} : ${reponse.status}`);
  }

  const observations = await reponse.json();

  // ⚠️ Le champ température exact (ex: "t" en Kelvin selon convention SYNOP habituelle,
  // à convertir en °C : °C = K - 273.15) est à confirmer contre la réponse réelle.
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
      const extremes = await recupererExtremesStation(token, station, dateJour);
      resultats.push(...extremes);
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
      const aujourdHui = new Date();
      aujourdHui.setHours(0, 0, 0, 0);

      for (const d of donnees) {
        const station = await prisma.stationMeteo.upsert({
          where: { codeStation: d.codeStation },
          update: { nomCommune: d.nomCommune, departement: d.departement, altitudeM: d.altitudeM },
          create: {
            codeStation: d.codeStation,
            nomCommune: d.nomCommune,
            departement: d.departement,
            altitudeM: d.altitudeM,
          },
        });

        await prisma.temperatureExtremeJour.upsert({
          where: { uniq_station_date_type: { stationId: station.id, date: aujourdHui, type: d.type } },
          update: { valeurC: d.valeurC, source: d.source, fetchedAt: new Date() },
          create: { stationId: station.id, date: aujourdHui, type: d.type, valeurC: d.valeurC, source: d.source },
        });
      }

      await prisma.syncLog.create({
        data: { tache: 'meteo_extremes', statut: 'ok', message: `${donnees.length} mesures synchronisées` },
      });
      console.log(`OK — ${donnees.length} mesures synchronisées`);
      await prisma.$disconnect();
      return;
    } catch (erreur) {
      derniereErreur = erreur;
      console.error(`Tentative ${tentative}/${MAX_TENTATIVES} échouée`, erreur);
      if (tentative < MAX_TENTATIVES) {
        await new Promise((r) => setTimeout(r, tentative * 5000));
      }
    }
  }

  await prisma.syncLog.create({
    data: { tache: 'meteo_extremes', statut: 'erreur', message: String(derniereErreur) },
  });
  console.error('Échec définitif après', MAX_TENTATIVES, 'tentatives');
  await prisma.$disconnect();
  process.exitCode = 1;
}

main();
