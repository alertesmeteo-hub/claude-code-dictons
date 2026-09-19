'use client';

import { suivre } from '@/lib/suivi';

export default function BoutonImprimer() {
  return (
    <button type="button" className="bouton-imprimer" onClick={() => {
        suivre('Impression calendrier');
        window.print();
      }}>
      🖨️ Imprimer ce calendrier
    </button>
  );
}
