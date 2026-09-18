import { NextRequest, NextResponse } from 'next/server';
import { construireContenuJour } from '@/lib/calculs/page-jour';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date: dateStr } = await params;

  if (!DATE_REGEX.test(dateStr)) {
    return NextResponse.json({ erreur: 'Format de date invalide, attendu YYYY-MM-DD' }, { status: 400 });
  }

  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ erreur: 'Date invalide' }, { status: 400 });
  }

  try {
    const contenu = await construireContenuJour(date);
    return NextResponse.json(contenu, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (erreur) {
    console.error('Erreur construction page jour', erreur);
    return NextResponse.json({ erreur: 'Erreur serveur' }, { status: 500 });
  }
}
