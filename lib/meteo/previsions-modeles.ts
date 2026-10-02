export type ModeleMeteo = 'harmonie' | 'cep';

const MODELE_OPEN_METEO: Record<ModeleMeteo, string> = {
  harmonie: 'meteofrance_arome_france', // AROME (famille Harmonie), haute résolution, échéances courtes
  cep: 'ecmwf_ifs025', // CEP = Centre Européen de Prévision (ECMWF)
};

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export interface PrevisionJour {
  dateISO: string; // YYYY-MM-DD
  mini: number | null;
  maxi: number | null;
  codeConditions: number | null;
}

/**
 * Prévisions mini/maxi/code météo d'un point pour un modèle donné (Harmonie-AROME ou CEP/ECMWF),
 * via Open-Meteo (gratuit, sans clé, licence CC BY 4.0). Appelé uniquement côté serveur.
 */
export async function recupererPrevisionsModele(
  latitude: number,
  longitude: number,
  modele: ModeleMeteo
): Promise<PrevisionJour[]> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    models: MODELE_OPEN_METEO[modele],
    timezone: 'Europe/Paris',
    forecast_days: '7',
  });

  const reponse = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
    next: { revalidate: 900 }, // cache ISR 15 min
  });

  if (!reponse.ok) {
    throw new Error(`Open-Meteo a répondu ${reponse.status}`);
  }

  const donnees = await reponse.json();
  const dates: string[] = donnees.daily?.time ?? [];
  const maxis: (number | null)[] = donnees.daily?.temperature_2m_max ?? [];
  const minis: (number | null)[] = donnees.daily?.temperature_2m_min ?? [];
  const codes: (number | null)[] = donnees.daily?.weather_code ?? [];

  return dates.map((dateISO, i) => ({
    dateISO,
    maxi: maxis[i] ?? null,
    mini: minis[i] ?? null,
    codeConditions: codes[i] ?? null,
  }));
}
