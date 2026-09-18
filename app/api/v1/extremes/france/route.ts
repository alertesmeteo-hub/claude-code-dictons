import { NextResponse } from 'next/server';
import { ovhApi } from '@/lib/db/ovh-api-client';

/**
 * Endpoint public consommé notamment par le plugin WordPress [temperatures_extremes_france].
 * Relaie vers l'API OVH (seul point d'accès direct à la base). Ne calcule/n'invente jamais
 * de valeur : si aucune donnée n'a été synchronisée, retourne un tableau vide.
 */
export async function GET() {
  try {
    const { date, donnees } = await ovhApi.extremesFrance();

    const derniereMaj = donnees.reduce<string | null>((plusRecente, e) => {
      return !plusRecente || e.fetched_at > plusRecente ? e.fetched_at : plusRecente;
    }, null);

    return NextResponse.json(
      {
        date,
        derniereMiseAJour: derniereMaj,
        donnees: donnees.map((e) => ({
          type: e.type,
          commune: e.nom_commune,
          departement: e.departement,
          altitudeM: e.altitude_m,
          valeurC: Number(e.valeur_c),
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
