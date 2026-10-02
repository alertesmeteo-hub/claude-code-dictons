export interface LogoPreset {
  id: string;
  nom: string;
  fichier: string;
}

export const LOGOS_PRESETS: LogoPreset[] = [
  { id: 'alertesmeteo', nom: 'AlertesMétéo.com', fichier: '/logos/alertesmeteo.png' },
  { id: 'pays-catalan', nom: 'Météo Pays Catalan', fichier: '/logos/meteo-pays-catalan.jpg' },
];

/** Logo suggéré selon les départements sélectionnés (ex. Pyrénées-Orientales seul → Météo Pays Catalan). */
export function logoParDefaut(codesDepartements: string[]): LogoPreset {
  if (codesDepartements.length === 1 && codesDepartements[0] === '66') {
    return LOGOS_PRESETS.find((l) => l.id === 'pays-catalan')!;
  }
  return LOGOS_PRESETS.find((l) => l.id === 'alertesmeteo')!;
}
