export type ModeleMeteo = 'harmonie' | 'cep';

export interface PrevisionJour {
  dateISO: string; // YYYY-MM-DD
  mini: number | null;
  maxi: number | null;
  codeConditions: number | null;
}

export interface PrevisionDepartement {
  code: string;
  nom: string;
  mini: number | null;
  maxi: number | null;
  codeConditions: number | null;
}

const URL_PAR_DEFAUT = 'https://app.alertes-meteo.com';

/**
 * Prévisions mini/maxi/code météo des départements demandés pour un jour et une famille de modèles : « harmonie » (AROME, puis
 * ARPEGE et ICON au-delà de leur échéance) ou « cep » (ECMWF IFS). Calculées par Alertes Météo avec ses modèles et lues sur son API
 * (remplace Open-Meteo, API gratuite non commerciale). Appelé uniquement côté serveur.
 */
export async function recupererPrevisionsDepartements(
  modele: ModeleMeteo,
  codes: string[],
  dateISO?: string
): Promise<PrevisionDepartement[]> {
  const base = (process.env.ALERTES_METEO_API_URL || URL_PAR_DEFAUT).replace(/\/+$/, '');
  const params = new URLSearchParams({ modele, codes: codes.join(',') });
  if (dateISO) params.set('date', dateISO);
  const reponse = await fetch(`${base}/api/carte-departements?${params.toString()}`, {
    next: { revalidate: 900 }, // cache ISR 15 min
    signal: AbortSignal.timeout(25_000),
  });
  if (!reponse.ok) throw new Error(`Alertes Météo a répondu ${reponse.status}`);
  return ((await reponse.json()) as { points: PrevisionDepartement[] }).points;
}
