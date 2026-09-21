'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/** Bouton « Mode clair / Mode sombre » : le choix est mémorisé, à défaut on suit le réglage du système. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }, []);

  if (!theme) return <span style={{ display: 'inline-block', minWidth: 120 }} />;

  const basculer = () => {
    const suivant: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', suivant);
    try {
      localStorage.setItem('theme', suivant);
    } catch {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
    setTheme(suivant);
  };

  return (
    <button type="button" className="bouton-theme" onClick={basculer} aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}>
      {theme === 'dark' ? '☀️ Mode clair' : '🌙 Mode sombre'}
    </button>
  );
}
