import Link from 'next/link';

const ENTREES = [
  { libelle: 'Fête du jour', href: '/#fete-du-jour' },
  { libelle: 'Dictons, proverbes', href: '/#dictons' },
  { libelle: 'Météo locale', href: '/#meteo-locale' },
  { libelle: 'Cycle lunaire', href: '/#cycle-lunaire' },
  { libelle: 'Événements historiques', href: '/#evenements-historiques' },
  { libelle: 'Jours fériés', href: '/jours-feries' },
];

export default function LayoutSite({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="menu-site">
        <nav aria-label="Menu principal">
          <ul>
            {ENTREES.map((e) => (
              <li key={e.libelle}>
                <Link href={e.href}>{e.libelle}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {children}
    </>
  );
}
