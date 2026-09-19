import Link from 'next/link';

const ENTREES = [
  { libelle: 'Éphéméride', href: '/' },
  { libelle: 'Date du jour', href: '/#date-du-jour' },
  { libelle: 'Saint du jour', href: '/#saint-du-jour' },
  { libelle: 'Fête du jour', href: '/#fete-du-jour' },
  { libelle: 'Jours fériés', href: '/jours-feries' },
  { libelle: 'Lever du soleil', href: '/#meteo-locale' },
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
