import { NextRequest, NextResponse } from 'next/server';
import { DEPARTEMENTS_FR } from '@/lib/meteo/departements-fr';
import { COORDS_DEPARTEMENTS } from '@/lib/meteo/departements-coords';
import { recupererPrevisionsModele, type ModeleMeteo } from '@/lib/meteo/previsions-modeles';

export interface PointCarte {
  code: string;
  nom: string;
  mini: number | null;
  maxi: number | null;
  codeConditions: number | null;
}

const CONCURRENCE_MAX = 10;

async function parLots<T, R>(items: T[], taille: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultats: R[] = [];
  for (let i = 0; i < items.length; i += taille) {
    const lot = items.slice(i, i + taille);
    resultats.push(...(await Promise.all(lot.map(fn))));
  }
  return resultats;
}

export async function POST(req: NextRequest) {
  const corps = await req.json().catch(() => null);
  const modele: ModeleMeteo = corps?.modele === 'cep' ? 'cep' : 'harmonie';
  const codes: string[] = Array.isArray(corps?.codesDepartements) ? corps.codesDepartements : [];
  const dateISO: string | undefined = typeof corps?.date === 'string' ? corps.date : undefined;

  const codesValides = codes.filter((c) => COORDS_DEPARTEMENTS[c]);
  if (codesValides.length === 0) {
    return NextResponse.json({ erreur: 'Aucun département valide' }, { status: 400 });
  }
  if (codesValides.length > 100) {
    return NextResponse.json({ erreur: 'Trop de départements demandés' }, { status: 400 });
  }

  try {
    const points = await parLots(codesValides, CONCURRENCE_MAX, async (code): Promise<PointCarte> => {
      const { lat, lon } = COORDS_DEPARTEMENTS[code];
      const jours = await recupererPrevisionsModele(lat, lon, modele);
      const jour = (dateISO ? jours.find((j) => j.dateISO === dateISO) : jours[0]) ?? jours[0] ?? null;
      return {
        code,
        nom: DEPARTEMENTS_FR[code] ?? code,
        mini: jour?.mini ?? null,
        maxi: jour?.maxi ?? null,
        codeConditions: jour?.codeConditions ?? null,
      };
    });

    return NextResponse.json({ modele, date: dateISO ?? null, points }, {
      headers: { 'Cache-Control': 'public, max-age=900' },
    });
  } catch (erreur) {
    console.error('Erreur carte météo', erreur);
    return NextResponse.json({ erreur: 'Prévisions momentanément indisponibles' }, { status: 503 });
  }
}
