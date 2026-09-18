import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const adminSlug = process.env.ADMIN_SLUG || 'gestion';

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [`/${adminSlug}/`, '/api/'],
    },
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
