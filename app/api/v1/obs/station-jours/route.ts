import { NextResponse } from 'next/server';
import { relevesStation } from '@/lib/meteo/dpclim-horaire';

/**
 * Relevés horaires d'une station Météo-France pour des jours passés (API climatologique DPClim, mis en cache).
 * Consommé par le module WordPress « Climatologie mensuelle » pour le détail d'une journée absente de l'archive du VPS
 * et pour combler les jours qui manquent dans la climatologie quotidienne.
 *
 * GET /api/v1/obs/station-jours?station=66049001&debut=2026-09-12&fin=2026-09-18
 */

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const MAX_SIMULTANEES = 2;
const DELAI_MIN_PAR_STATION_MS = 8000;

let enCours = 0;
const derniereCommande = new Map<string, number>();

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const station = p.get('station') ?? '';
  const debut = p.get('debut') ?? '';
  const fin = p.get('fin') ?? debut;
  if (!/^\d{8}$/.test(station) || !/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) {
    return NextResponse.json({ erreur: 'Paramètres attendus : station (8 chiffres), debut et fin (AAAA-MM-JJ)' }, { status: 400, headers: CORS });
  }
  const maintenant = Date.now();
  if (enCours >= MAX_SIMULTANEES || maintenant - (derniereCommande.get(station) ?? 0) < DELAI_MIN_PAR_STATION_MS) {
    return NextResponse.json({ erreur: 'Trop de demandes, réessayez dans quelques secondes' }, { status: 429, headers: { ...CORS, 'Retry-After': '10' } });
  }
  enCours++;
  derniereCommande.set(station, maintenant);
  try {
    const rep = await relevesStation(station, debut, fin);
    return NextResponse.json(rep, { headers: { ...CORS, 'Cache-Control': 'public, max-age=600' } });
  } catch (e) {
    console.error('obs/station-jours', station, debut, fin, e);
    return NextResponse.json({ erreur: e instanceof Error ? e.message : 'Erreur' }, { status: 502, headers: CORS });
  } finally {
    enCours--;
  }
}
