import { NextRequest, NextResponse } from 'next/server';
import { DEPARTEMENTS_FR } from '@/lib/meteo/departements-fr';
import { COORDS_DEPARTEMENTS } from '@/lib/meteo/departements-coords';
import { recupererPrevisionsDepartements, type ModeleMeteo } from '@/lib/meteo/previsions-modeles';

export interface PointCarte {
  code: string;
  nom: string;
  mini: number | null;
  maxi: number | null;
  codeConditions: number | null;
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
    // Un seul appel : Alertes Météo calcule les départements demandés avec ses modèles (fichier recalculé quatre fois par jour).
    const prevus = await recupererPrevisionsDepartements(modele, codesValides, dateISO);
    const parCode = new Map(prevus.map((p) => [p.code, p]));
    const points: PointCarte[] = codesValides.map((code) => {
      const p = parCode.get(code);
      return {
        code,
        nom: DEPARTEMENTS_FR[code] ?? code,
        mini: p?.mini ?? null,
        maxi: p?.maxi ?? null,
        codeConditions: p?.codeConditions ?? null,
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
