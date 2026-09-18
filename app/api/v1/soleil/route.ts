import { NextRequest, NextResponse } from 'next/server';
import { calculerLeverCoucher, formaterHeureLocale } from '@/lib/soleil/calcul';

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lon = Number(req.nextUrl.searchParams.get('lon'));
  const dateStr = req.nextUrl.searchParams.get('date');
  const fuseau = req.nextUrl.searchParams.get('tz') || 'Europe/Paris';

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ erreur: 'Paramètres lat/lon invalides' }, { status: 400 });
  }

  const date = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ erreur: 'Date invalide' }, { status: 400 });
  }

  const resultat = calculerLeverCoucher(date, lat, lon);

  if (resultat.casPolaire) {
    return NextResponse.json({ casPolaire: true, lever: null, coucher: null, dureeJour: null });
  }

  return NextResponse.json(
    {
      casPolaire: false,
      lever: resultat.leverUTC ? formaterHeureLocale(resultat.leverUTC, fuseau) : null,
      coucher: resultat.coucherUTC ? formaterHeureLocale(resultat.coucherUTC, fuseau) : null,
      dureeJourMinutes: resultat.dureeJourMinutes,
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  );
}
