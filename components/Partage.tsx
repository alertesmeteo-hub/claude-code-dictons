'use client';

import { useEffect, useState } from 'react';

export default function Partage({ titre }: { titre: string }) {
  const [url, setUrl] = useState('');
  const [copie, setCopie] = useState(false);
  const [natif, setNatif] = useState(false);

  useEffect(() => {
    setUrl(window.location.href);
    setNatif(typeof navigator.share === 'function');
  }, []);

  const u = encodeURIComponent(url);
  const t = encodeURIComponent(titre);

  async function copier() {
    try {
      await navigator.clipboard.writeText(url);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {}
  }

  return (
    <section aria-labelledby="partager">
      <h2 id="partager">Partager cette page</h2>
      <div className="partage">
        {natif && (
          <button type="button" onClick={() => navigator.share({ title: titre, url }).catch(() => {})}>
            Partager…
          </button>
        )}
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${u}`} target="_blank" rel="noopener noreferrer">Facebook</a>
        <a href={`https://twitter.com/intent/tweet?url=${u}&text=${t}`} target="_blank" rel="noopener noreferrer">X</a>
        <a href={`https://wa.me/?text=${t}%20${u}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${u}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
        <a href={`mailto:?subject=${t}&body=${u}`}>E-mail</a>
        <button type="button" onClick={copier}>{copie ? 'Lien copié ✓' : 'Copier le lien'}</button>
      </div>
    </section>
  );
}
