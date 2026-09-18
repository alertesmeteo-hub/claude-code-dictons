/**
 * Client pour l'API PHP intermédiaire hébergée sur OVH (voir ovh-api/).
 * Remplace un accès direct MySQL/Prisma, impossible depuis l'extérieur du réseau OVH
 * (la base bijouxdealertes n'accepte que les connexions internes à l'hébergement).
 */

const BASE_URL = process.env.OVH_API_URL; // ex: https://alertes-meteo.com/dicton-api
const TOKEN = process.env.OVH_API_TOKEN;

async function appelerApi<T>(route: string, options: RequestInit = {}): Promise<T> {
  if (!BASE_URL || !TOKEN) {
    throw new Error('OVH_API_URL / OVH_API_TOKEN manquants dans les variables d\'environnement');
  }

  const url = `${BASE_URL}/?route=${route}`;
  const reponse = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    cache: 'no-store',
  });

  if (!reponse.ok) {
    const corps = await reponse.text().catch(() => '');
    throw new Error(`API OVH ${route} → ${reponse.status}: ${corps.slice(0, 200)}`);
  }

  return reponse.json();
}

export interface SaintApi {
  id: number;
  mois: number;
  jour: number;
  nom_principal: string;
  presentation_historique: string | null;
  autres_prenoms: string | null;
  patronage: string | null;
  traditions: string | null;
  source: string;
  verifie: 0 | 1;
}

export interface DictonApi {
  id: number;
  texte: string;
  type: string;
  mois: number | null;
  jour: number | null;
  source: string | null;
  actif: 0 | 1;
}

export interface SyncLogApi {
  id: number;
  tache: string;
  statut: 'ok' | 'erreur' | 'partiel';
  message: string | null;
  created_at: string;
}

export interface VilleApi {
  nom: string;
  departement: string | null;
  slug: string;
  latitude: string;
  longitude: string;
}

export interface ExtremeApi {
  type: 'maxi' | 'mini';
  valeur_c: string;
  source: string;
  fetched_at: string;
  nom_commune: string;
  departement: string;
  altitude_m: number;
}

export const ovhApi = {
  jourContenu: (date: string) =>
    appelerApi<{ saint: SaintApi | null; dictons: { texte: string; type: string }[] }>(`jour&date=${date}`),

  saintsListe: () => appelerApi<SaintApi[]>('saints'),

  saintsImportMasse: (saints: Record<string, unknown>[]) =>
    appelerApi<{ ok: true; compte: number }>('saints/bulk', { method: 'POST', body: JSON.stringify({ saints }) }),

  saintEnregistrer: (data: Record<string, unknown>) =>
    appelerApi<{ ok: true }>('saints', { method: 'POST', body: JSON.stringify(data) }),

  dictonsListe: () => appelerApi<DictonApi[]>('dictons'),

  dictonsImportMasse: (dictons: Record<string, unknown>[]) =>
    appelerApi<{ ok: true; compte: number }>('dictons/bulk', { method: 'POST', body: JSON.stringify({ dictons }) }),

  dictonAjouter: (data: Record<string, unknown>) =>
    appelerApi<{ ok: true; id: number }>('dictons', { method: 'POST', body: JSON.stringify(data) }),

  dictonBasculerActif: (id: number) =>
    appelerApi<{ ok: true }>('dictons/toggle', { method: 'POST', body: JSON.stringify({ id }) }),

  villesRecherche: (q: string) => appelerApi<VilleApi[]>(`villes/recherche&q=${encodeURIComponent(q)}`),

  extremesFrance: () => appelerApi<{ date: string; donnees: ExtremeApi[] }>('extremes/france'),

  extremesEnregistrer: (mesures: Record<string, unknown>[]) =>
    appelerApi<{ ok: true; compte: number }>('extremes/france', { method: 'POST', body: JSON.stringify({ mesures }) }),

  syncLogsListe: (limite = 20) => appelerApi<SyncLogApi[]>(`sync-logs&limite=${limite}`),

  syncLogEnregistrer: (tache: string, statut: 'ok' | 'erreur' | 'partiel', message: string) =>
    appelerApi<{ ok: true }>('sync-logs', { method: 'POST', body: JSON.stringify({ tache, statut, message }) }),

  pageJourGenerer: (date: string) =>
    appelerApi<{ ok: true }>('pages-jour', { method: 'POST', body: JSON.stringify({ date }) }),
};
