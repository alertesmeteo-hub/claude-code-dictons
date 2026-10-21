import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import {
  CACHE_HORAIRE_URL,
  FRAICHEUR_MAX_H,
  extremesDuJour,
  jourParis,
  type CacheHoraire,
  type Mesure,
} from '../lib/meteo/extremes-france';

/**
 * Températures extrêmes du jour en France (stations d'altitude < 500 m).
 *
 * Lit les relevés horaires Météo-France déjà rassemblés par harmonie-knmi (voir lib/meteo/extremes-france.ts) :
 * plus de clé API ni d'appel par département. L'ancienne version interrogeait DPObs et DPPaquetObs avec
 * METEOFRANCE_API_KEY, une clé qui n'était pas abonnée à ces API (HTTP 403 à chaque passage depuis septembre 2026).
 * Écrit via l'API OVH (ovhApi.extremesEnregistrer) : la base n'est joignable que depuis le réseau OVH.
 */

const MAX_TENTATIVES = 3;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chargerCache(): Promise<CacheHoraire> {
  const r = await fetch(`${process.env.EXTREMES_CACHE_URL ?? CACHE_HORAIRE_URL}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`Relevés horaires indisponibles : HTTP ${r.status}`);
  const cache = (await r.json()) as CacheHoraire;
  const derniere = cache.latest_observation_at ?? Object.keys(cache.hours).sort().at(-1);
  if (!derniere) throw new Error('Relevés horaires vides');
  const ageH = (Date.now() - Date.parse(derniere)) / 3_600_000;
  if (ageH > FRAICHEUR_MAX_H) throw new Error(`Relevés horaires périmés : dernière heure ${derniere} (${ageH.toFixed(1)} h)`);
  return cache;
}

async function calculer(): Promise<Mesure[]> {
  const cache = await chargerCache();
  const donnees = extremesDuJour(cache, jourParis(new Date().toISOString()));
  if (!donnees.some((m) => m.type === 'maxi')) throw new Error('Aucune observation du jour trouvée');
  return donnees;
}

async function main() {
  let derniereErreur: unknown = null;

  for (let tentative = 1; tentative <= MAX_TENTATIVES; tentative++) {
    try {
      const donnees = await calculer();
      const { compte } = await ovhApi.extremesEnregistrer(donnees as unknown as Record<string, unknown>[]);
      await ovhApi.syncLogEnregistrer('meteo_extremes', 'ok', `${compte} mesures synchronisées`);
      console.log(`OK — ${compte} mesures synchronisées`);
      const chaud = donnees.find((m) => m.type === 'maxi')!;
      const froid = donnees.find((m) => m.type === 'mini')!;
      console.log(`Maxi : ${chaud.nomCommune} ${chaud.valeurC} °C — Mini : ${froid.nomCommune} ${froid.valeurC} °C`);
      return;
    } catch (erreur) {
      derniereErreur = erreur;
      console.error(`Tentative ${tentative}/${MAX_TENTATIVES} échouée`, erreur instanceof Error ? erreur.message : erreur);
      if (tentative < MAX_TENTATIVES) await pause(tentative * 5000);
    }
  }

  await ovhApi.syncLogEnregistrer('meteo_extremes', 'erreur', String(derniereErreur)).catch(() => {});
  console.error('Échec définitif après', MAX_TENTATIVES, 'tentatives');
  process.exitCode = 1;
}

main();
