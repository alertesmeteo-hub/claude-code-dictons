'use client';

import { useMemo, useState } from 'react';
import { DEPARTEMENTS_FR } from '@/lib/meteo/departements-fr';
import { COORDS_DEPARTEMENTS } from '@/lib/meteo/departements-coords';
import { REGIONS_FR, departementsDeLaRegion } from '@/lib/meteo/regions-fr';
import type { ModeleMeteo } from '@/lib/meteo/previsions-modeles';
import type { PointCarte } from '@/app/api/v1/carte-meteo/previsions/route';
import EditeurCarte from './EditeurCarte';

type TypeZone = 'france' | 'region' | 'departements';

const CODES_FRANCE = Object.keys(DEPARTEMENTS_FR).filter((c) => COORDS_DEPARTEMENTS[c]);

const ECHEANCES = [
  { offset: 0, label: "Aujourd'hui" },
  { offset: 1, label: 'Demain (J+1)' },
  { offset: 2, label: 'J+2' },
  { offset: 3, label: 'J+3' },
  { offset: 4, label: 'J+4' },
  { offset: 5, label: 'J+5' },
  { offset: 6, label: 'J+6' },
];

function dateDecalee(offset: number): { iso: string; label: string } {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return { iso, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

export default function FormulaireCarte() {
  const [modele, setModele] = useState<ModeleMeteo>('harmonie');
  const [typeZone, setTypeZone] = useState<TypeZone>('france');
  const [region, setRegion] = useState(REGIONS_FR[0]);
  const [departementsChoisis, setDepartementsChoisis] = useState<string[]>([]);
  const [echeance, setEcheance] = useState(0);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ points: (PointCarte & { lat: number; lon: number })[]; dateLabel: string } | null>(null);

  const codesSelectionnes = useMemo(() => {
    if (typeZone === 'france') return CODES_FRANCE;
    if (typeZone === 'region') return departementsDeLaRegion(region);
    return departementsChoisis;
  }, [typeZone, region, departementsChoisis]);

  async function genererCarte() {
    setErreur(null);
    if (codesSelectionnes.length === 0) {
      setErreur('Choisissez au moins un département.');
      return;
    }
    setChargement(true);
    const { iso, label } = dateDecalee(echeance);
    try {
      const reponse = await fetch('/api/v1/carte-meteo/previsions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modele, codesDepartements: codesSelectionnes, date: iso }),
      });
      if (!reponse.ok) throw new Error('Échec de la récupération des prévisions');
      const donnees: { points: PointCarte[] } = await reponse.json();
      const points = donnees.points.map((p) => ({ ...p, ...COORDS_DEPARTEMENTS[p.code] }));
      setResultat({ points, dateLabel: label });
    } catch {
      setErreur('Prévisions momentanément indisponibles. Réessayez plus tard.');
    } finally {
      setChargement(false);
    }
  }

  function basculerDepartement(code: string) {
    setDepartementsChoisis((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  if (resultat) {
    return (
      <EditeurCarte
        points={resultat.points}
        modele={modele}
        dateLabel={resultat.dateLabel}
        onRecommencer={() => setResultat(null)}
      />
    );
  }

  return (
    <section className="carte-meteo-formulaire">
      <fieldset>
        <legend>1. Modèle</legend>
        <label>
          <input type="radio" name="modele" checked={modele === 'harmonie'} onChange={() => setModele('harmonie')} />
          Harmonie (AROME, haute résolution)
        </label>
        <label>
          <input type="radio" name="modele" checked={modele === 'cep'} onChange={() => setModele('cep')} />
          CEP (ECMWF)
        </label>
      </fieldset>

      <fieldset>
        <legend>2. Région &amp; département</legend>
        <label>
          <input type="radio" name="zone" checked={typeZone === 'france'} onChange={() => setTypeZone('france')} />
          France entière
        </label>
        <label>
          <input type="radio" name="zone" checked={typeZone === 'region'} onChange={() => setTypeZone('region')} />
          Une région
        </label>
        {typeZone === 'region' && (
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS_FR.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <label>
          <input type="radio" name="zone" checked={typeZone === 'departements'} onChange={() => setTypeZone('departements')} />
          Départements choisis
        </label>
        {typeZone === 'departements' && (
          <div className="carte-meteo-departements-liste">
            {CODES_FRANCE.map((code) => (
              <label key={code} className="carte-meteo-departement-case">
                <input type="checkbox" checked={departementsChoisis.includes(code)} onChange={() => basculerDepartement(code)} />
                {code} — {DEPARTEMENTS_FR[code]}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>3. Période</legend>
        <select value={echeance} onChange={(e) => setEcheance(Number(e.target.value))}>
          {ECHEANCES.map((e) => (
            <option key={e.offset} value={e.offset}>
              {e.label}
            </option>
          ))}
        </select>
      </fieldset>

      {erreur && <p className="carte-meteo-erreur">{erreur}</p>}

      <button type="button" onClick={genererCarte} disabled={chargement}>
        {chargement ? 'Génération…' : 'Générer la carte'}
      </button>
    </section>
  );
}
