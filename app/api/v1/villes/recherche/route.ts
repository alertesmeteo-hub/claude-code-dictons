import { NextRequest, NextResponse } from 'next/server';
import { ovhApi } from '@/lib/db/ovh-api-client';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ resultats: [] });
  }

  try {
    const villes = await ovhApi.villesRecherche(q);
    return NextResponse.json({
      resultats: villes.map((v) => ({
        nom: v.nom,
        departement: v.departement,
        slug: v.slug,
        latitude: Number(v.latitude),
        longitude: Number(v.longitude),
      })),
    });
  } catch (erreur) {
    console.error('Erreur recherche villes', erreur);
    return NextResponse.json({ resultats: [] });
  }
}
