import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Dicton du jour',
    template: '%s',
  },
  description: 'Dictons, proverbes, saint du jour, météo et éphéméride, mis à jour chaque jour.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};

/** Applique le thème avant l'affichage (évite l'éclair clair → sombre) : choix mémorisé, sinon réglage du système. */
const SCRIPT_THEME = "(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})()";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
