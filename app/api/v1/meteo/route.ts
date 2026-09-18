import { NextRequest, NextResponse } from 'next/server';
import { recupererPrevisionsMeteo } from '@/lib/meteo/open-meteo';

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lon = Number(req.nextUrl.searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ erreur: 'Paramètres lat/lon invalides' }, { status: 400 });
  }

  try {
    const previsions = await recupererPrevisionsMeteo(lat, lon);
    return NextResponse.json(previsions, {
      headers: { 'Cache-Control': 'public, max-age=900' },
    });
  } catch (erreur) {
    console.error('Erreur météo', erreur);
    return NextResponse.json({ erreur: 'Météo momentanément indisponible' }, { status: 503 });
  }
}
