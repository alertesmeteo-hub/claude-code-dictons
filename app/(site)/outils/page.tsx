import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Outils',
  description: "Outils météo d'AlertesMétéo.com : génération de carte météo, et à venir.",
};

const OUTILS = [
  {
    href: '/outils/carte-meteo',
    titre: 'Carte météo France',
    description: 'Carte des températures mini/maxi par région ou département (Harmonie/AROME ou CEP/ECMWF), export en JPG.',
  },
];

export default function PageOutils() {
  return (
    <main className="page-jour">
      <h1>Outils</h1>
      <p className="meta-jour">Outils météo pratiques, générés en quelques clics.</p>
      <ul>
        {OUTILS.map((o) => (
          <li key={o.href}>
            <Link href={o.href}>{o.titre}</Link> — {o.description}
          </li>
        ))}
      </ul>
    </main>
  );
}
