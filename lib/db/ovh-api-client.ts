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

export interface VigilanceCarteApi {
  echeance: 'J' | 'J1';
  departement: string;
  couleur: 1 | 2 | 3 | 4;
}

export interface VigilanceCarteLigneApi extends VigilanceCarteApi {
  heure: string;
}

export interface VigilanceTexteApi {
  heure: string;
  contenu: string;
  fetched_at: string;
}

export interface VigilanceNationalJourApi {
  date: string;
  couleur: 1 | 2 | 3 | 4;
  commentaire: string | null;
}

export interface VigilanceDepartementJourApi {
  date: string;
  departement: string;
  couleur: 1 | 2 | 3 | 4;
}

export interface VigilancePhenomeneJourApi {
  date: string;
  departement: string;
  phenomene: number;
  couleur: 2 | 3 | 4;
}

export interface VigilanceBulletinApi {
  date: string;
  heure: string;
  producteur: string;
  phenomenes: string;
  masque: number;
  bulletinId: number;
  base: string;
}

export interface VigilanceRechercheJourApi {
  date: string;
  couleur: number;
  masque: number;
  nbBulletins: number;
}

export interface VigilanceBulletinTexteApi {
  base: string;
  bulletinId: number;
  texte: string;
  niveauMax: 2 | 3 | 4 | null;
  /** statut : 1 début de suivi, 2 maintien, 3 fin. */
  departements: { code: string; statut: 1 | 2 | 3 }[];
}

export interface VigilanceBulletinCompletApi {
  date: string;
  heure: string;
  producteur: string;
  phenomenes: string;
  masque: number;
  texte: string | null;
  niveauMax: number | null;
  departements: { code: string; statut: number }[];
}

export interface VigilanceRechercheParams {
  debut: string;
  fin: string;
  /** '' = France entière ; sinon code département (01…95, 2A, 2B). */
  departement?: string;
  /** '' = orange et rouge ; '2' jaune, '3' orange, '4' rouge. */
  couleur?: '' | '2' | '3' | '4';
  /** '' = tous ; '1' à '9' = un phénomène. */
  phenomene?: string;
}

export interface FeteJourApi {
  prenoms: string[];
  autresFetes: { nom: string; description: string | null; url: string }[];
}

export const ovhApi = {
  jourContenu: (date: string) =>
    appelerApi<{ saint: SaintApi | null; dictons: { texte: string; type: string }[]; fete: FeteJourApi | null }>(
      `jour&date=${date}`
    ),

  fetesImportMasse: (fetes: Record<string, unknown>[]) =>
    appelerApi<{ ok: true; compte: number }>('fetes/bulk', { method: 'POST', body: JSON.stringify({ fetes }) }),

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

  villesImportMasse: (villes: Record<string, unknown>[]) =>
    appelerApi<{ ok: true; compte: number }>('villes/bulk', { method: 'POST', body: JSON.stringify({ villes }) }),

  extremesFrance: () => appelerApi<{ date: string; donnees: ExtremeApi[] }>('extremes/france'),

  extremesEnregistrer: (mesures: Record<string, unknown>[]) =>
    appelerApi<{ ok: true; compte: number }>('extremes/france', { method: 'POST', body: JSON.stringify({ mesures }) }),

  vigilanceFrance: () =>
    appelerApi<{ date: string; carte: VigilanceCarteLigneApi[]; textes: VigilanceTexteApi[] }>('vigilance/france'),

  vigilanceEnregistrer: (date: string, heure: string, carte: VigilanceCarteApi[], texte: string | null) =>
    appelerApi<{ ok: true; compte: number }>('vigilance/france', {
      method: 'POST',
      body: JSON.stringify({ date, heure, carte, texte }),
    }),

  vigilanceNationalEnregistrer: (jours: VigilanceNationalJourApi[]) =>
    appelerApi<{ ok: true; compte: number }>('vigilance/national', { method: 'POST', body: JSON.stringify({ jours }) }),

  vigilancePhenomenesJourEnregistrer: (jours: VigilancePhenomeneJourApi[]) =>
    appelerApi<{ ok: true; compte: number }>('vigilance/phenomene-jour', { method: 'POST', body: JSON.stringify({ jours }) }),

  vigilanceNationalMois: (annee: number, mois: number) =>
    appelerApi<VigilanceNationalJourApi[]>(`vigilance/national&annee=${annee}&mois=${mois}`),

  vigilanceDepartementHistoriqueEnregistrer: (jours: VigilanceDepartementJourApi[]) =>
    appelerApi<{ ok: true; compte: number }>('vigilance/departement-historique', {
      method: 'POST',
      body: JSON.stringify({ jours }),
    }),

  vigilanceDepartementMois: (departement: string, annee: number, mois: number) =>
    appelerApi<VigilanceDepartementJourApi[]>(`vigilance/departement-historique&departement=${departement}&annee=${annee}&mois=${mois}`),

  vigilanceBulletinsEnregistrer: (bulletins: VigilanceBulletinApi[]) =>
    appelerApi<{ ok: true; compte: number }>('vigilance/bulletins', { method: 'POST', body: JSON.stringify({ bulletins }) }),

  vigilanceBulletinsJour: (date: string) =>
    appelerApi<VigilanceBulletinApi[]>(`vigilance/bulletins-jour&date=${date}`),

  vigilanceRecherche: (p: VigilanceRechercheParams) =>
    appelerApi<{ jours: VigilanceRechercheJourApi[]; tronque: boolean }>(
      `vigilance/recherche&debut=${p.debut}&fin=${p.fin}&couleur=${p.couleur ?? ''}&phenomene=${p.phenomene ?? ''}&departement=${p.departement ?? ''}`,
    ),

  vigilanceBulletinsARecuperer: (limite = 200) =>
    appelerApi<{ bulletins: { base: string; bulletinId: number }[]; restant: number }>(`vigilance/bulletins-a-recuperer&limite=${limite}`),

  vigilanceBulletinsTextesEnregistrer: (textes: VigilanceBulletinTexteApi[]) =>
    appelerApi<{ ok: true; compte: number }>('vigilance/bulletins-textes', { method: 'POST', body: JSON.stringify({ textes }) }),

  vigilanceBulletin: (base: string, id: number) =>
    appelerApi<VigilanceBulletinCompletApi>(`vigilance/bulletin&base=${base}&id=${id}`),

  syncLogsListe: (limite = 20) => appelerApi<SyncLogApi[]>(`sync-logs&limite=${limite}`),

  syncLogEnregistrer: (tache: string, statut: 'ok' | 'erreur' | 'partiel', message: string) =>
    appelerApi<{ ok: true }>('sync-logs', { method: 'POST', body: JSON.stringify({ tache, statut, message }) }),

  pageJourGenerer: (date: string) =>
    appelerApi<{ ok: true }>('pages-jour', { method: 'POST', body: JSON.stringify({ date }) }),
};
