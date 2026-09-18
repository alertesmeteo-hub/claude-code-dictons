import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ resultats: [] });
  }

  const villes = await prisma.ville.findMany({
    where: { nom: { startsWith: q } },
    take: 10,
    select: { nom: true, departement: true, slug: true, latitude: true, longitude: true },
  });

  return NextResponse.json({
    resultats: villes.map((v) => ({
      ...v,
      latitude: Number(v.latitude),
      longitude: Number(v.longitude),
    })),
  });
}
