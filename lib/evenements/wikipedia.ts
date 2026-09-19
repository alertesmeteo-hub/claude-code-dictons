export interface EvenementHistorique {
  annee: number;
  texte: string;
  url: string | null;
}

interface EvenementBrut {
  year: number;
  text: string;
  pages?: { content_urls?: { desktop?: { page?: string } } }[];
}

const NB_EVENEMENTS = 5;

/**
 * Événements historiques du jour depuis le flux « Ce jour-là » de Wikipédia (fr).
 * Texte sous licence CC BY-SA 4.0 : l'attribution à Wikipédia est affichée sur la page.
 * Rien n'est généré ni inventé ; en cas d'indisponibilité, retourne [] (le bloc est masqué).
 * Sélection déterministe : NB_EVENEMENTS événements répartis sur toute la période, du plus récent au plus ancien.
 */
export async function evenementsHistoriques(mois: number, jour: number): Promise<EvenementHistorique[]> {
  const mm = String(mois).padStart(2, '0');
  const jj = String(jour).padStart(2, '0');

  try {
    const reponse = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/fr/onthisday/events/${mm}/${jj}`, {
      headers: { 'User-Agent': 'dicton-du-jour/1.0 (https://dicton-du-jour.alertes-meteo.com)' },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(5000),
    });
    if (!reponse.ok) return [];

    const donnees = (await reponse.json()) as { events?: EvenementBrut[] };
    const tous = (donnees.events ?? [])
      .filter((e) => typeof e.year === 'number' && e.text)
      .sort((a, b) => b.year - a.year);
    if (tous.length === 0) return [];

    const pas = tous.length / Math.min(NB_EVENEMENTS, tous.length);
    const choisis = Array.from({ length: Math.min(NB_EVENEMENTS, tous.length) }, (_, i) => tous[Math.floor(i * pas)]);

    return choisis.map((e) => ({
      annee: e.year,
      texte: e.text.charAt(0).toUpperCase() + e.text.slice(1),
      url: e.pages?.[0]?.content_urls?.desktop?.page ?? null,
    }));
  } catch {
    return [];
  }
}
