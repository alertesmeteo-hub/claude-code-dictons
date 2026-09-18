import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

/**
 * Endpoint public consommé notamment par le plugin WordPress [temperatures_extremes_france].
 * Retourne les extrêmes du jour, alimentés par la tâche cron dédiée (voir scripts/cron-extremes-meteo.ts).
 * Ne calcule/n'invente jamais de valeur : si aucune donnée n'a été synchronisée, retourne un tableau vide.
 */
export async function GET() {
  const aujourdHui = new Date();
  aujourdHui.setHours(0, 0, 0, 0);

  try {
    const extremes = await prisma.temperatureExtremeJour.findMany({
      where: { date: aujourdHui },
      include: { station: true },
      orderBy: [{ type: 'asc' }, { valeurC: 'desc' }],
    });

    const derniereMaj = extremes.reduce<Date | null>((plusRecente, e) => {
      return !plusRecente || e.fetchedAt > plusRecente ? e.fetchedAt : plusRecente;
    }, null);

    return NextResponse.json(
      {
        date: aujourdHui.toISOString().slice(0, 10),
        derniereMiseAJour: derniereMaj?.toISOString() ?? null,
        donnees: extremes.map((e) => ({
          type: e.type,
          commune: e.station.nomCommune,
          departement: e.station.departement,
          altitudeM: e.station.altitudeM,
          valeurC: Number(e.valeurC),
          source: e.source,
        })),
      },
      { headers: { 'Cache-Control': 'public, max-age=900', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (erreur) {
    console.error('Erreur extremes france', erreur);
    return NextResponse.json({ erreur: 'Données momentanément indisponibles' }, { status: 503 });
  }
}
