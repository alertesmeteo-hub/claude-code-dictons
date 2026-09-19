'use client';

import { usePathname } from 'next/navigation';

const ENTREES = [
  { libelle: 'Fête du jour', ancre: 'fete-du-jour' },
  { libelle: 'Dictons, proverbes', ancre: 'dictons' },
  { libelle: 'Météo locale', ancre: 'meteo-locale' },
  { libelle: 'Cycle lunaire', ancre: 'cycle-lunaire' },
  { libelle: 'Événements historiques', ancre: 'evenements-historiques' },
];

const PAGE_DU_JOUR = /^\/\d{4}\/\d{2}\/\d{2}\/?$/;

/**
 * Sur une page du jour, les liens sont de simples ancres (#bloc) : le navigateur descend directement
 * sur le bloc. Ailleurs (ex. jours fériés), ils renvoient vers la page du jour à l'ancre voulue.
 */
export default function MenuSite() {
  const pathname = usePathname();
  const surPageDuJour = PAGE_DU_JOUR.test(pathname);

  return (
    <header className="menu-site">
      <nav aria-label="Menu principal">
        <ul>
          {ENTREES.map((e) => (
            <li key={e.ancre}>
              <a href={surPageDuJour ? `#${e.ancre}` : `/#${e.ancre}`}>{e.libelle}</a>
            </li>
          ))}
          <li>
            <a href="/calendrier">Calendrier</a>
          </li>
          <li>
            <a href="/jours-feries">Jours fériés</a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
