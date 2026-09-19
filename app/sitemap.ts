import type { MetadataRoute } from 'next';
import { dateAujourdhuiParis } from '@/lib/calculs/date-paris';

// Recalculé à chaque requête : sinon le sitemap reste figé sur le jour du build.
export const dynamic = 'force-dynamic';

/**
 * Sitemap limité aux 90 derniers jours + aujourd'hui, pour éviter un fichier
 * qui grossit indéfiniment (365+ URLs/an). Les jours plus anciens restent
 * accessibles par navigation/maillage interne mais sortent du sitemap actif.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || '';
  const [annee, mois, jour] = dateAujourdhuiParis().split('-').map(Number);
  const entrees: MetadataRoute.Sitemap = [];

  for (let i = 0; i < 90; i++) {
    const date = new Date(annee, mois - 1, jour - i);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    entrees.push({
      url: `${base}/${y}/${m}/${d}/`,
      lastModified: date,
      changeFrequency: i === 0 ? 'hourly' : 'never',
      priority: i === 0 ? 1 : 0.5,
    });
  }

  entrees.push({ url: `${base}/jours-feries/${annee}/`, changeFrequency: 'yearly', priority: 0.6 });

  return entrees;
}
