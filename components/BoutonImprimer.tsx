'use client';

export default function BoutonImprimer() {
  return (
    <button type="button" className="bouton-imprimer" onClick={() => window.print()}>
      🖨️ Imprimer ce calendrier
    </button>
  );
}
