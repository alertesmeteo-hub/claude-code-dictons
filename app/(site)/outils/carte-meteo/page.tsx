import type { Metadata } from 'next';
import FormulaireCarte from '@/components/carte-meteo/FormulaireCarte';

export const metadata: Metadata = {
  title: 'Carte météo France — Harmonie / CEP',
  description:
    'Génère une carte de France des températures (mini/maxi) par région ou département, modèle Harmonie (AROME) ou CEP (ECMWF), pictos et valeurs éditables, export en JPG.',
};

export default function PageCarteMeteo() {
  return (
    <main className="page-jour carte-meteo">
      <h1>Carte météo France</h1>
      <p className="meta-jour">
        Modèle Harmonie (AROME) ou CEP (ECMWF), par région ou département, pictos et températures modifiables avant export.
      </p>
      <FormulaireCarte />
    </main>
  );
}
