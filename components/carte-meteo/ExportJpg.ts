import { toJpeg } from 'html-to-image';

/** Exporte un élément DOM (la carte) en JPG téléchargé côté client. */
export async function exporterEnJpg(noeud: HTMLElement, nomFichier: string): Promise<void> {
  const dataUrl = await toJpeg(noeud, { quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff' });
  const lien = document.createElement('a');
  lien.href = dataUrl;
  lien.download = nomFichier.endsWith('.jpg') ? nomFichier : `${nomFichier}.jpg`;
  lien.click();
}
