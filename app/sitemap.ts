import type { MetadataRoute } from 'next';

/**
 * Sitemap limité aux 90 derniers jours + aujourd'hui, pour éviter un fichier
 * qui grossit indéfiniment (365+ URLs/an). Les jours plus anciens restent
 * accessibles par navigation/maillage interne mais sortent du sitemap actif.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || '';
  const entrees: MetadataRoute.Sitemap = [];
  const aujourdHui = new Date();

  for (let i = 0; i < 90; i++) {
    const date = new Date(aujourdHui);
    date.setDate(date.getDate() - i);
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

  return entrees;
}
