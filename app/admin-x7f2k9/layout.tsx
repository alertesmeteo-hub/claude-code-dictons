import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Administration',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <Link href="/admin-x7f2k9">Tableau de bord</Link>
        <Link href="/admin-x7f2k9/saints">Saints</Link>
        <Link href="/admin-x7f2k9/dictons">Dictons</Link>
        <Link href="/admin-x7f2k9/logs">Journal des tâches</Link>
      </nav>
      <div className="admin-contenu">{children}</div>
    </div>
  );
}
