'use client';

import { useEffect, useState } from 'react';

interface Previsions {
  temperatureActuelle: number;
  temperatureMax: number;
  temperatureMin: number;
  vitesseVent: number;
  precipitationsMm: number;
}

interface Soleil {
  lever: string | null;
  coucher: string | null;
  dureeJourMinutes: number | null;
  casPolaire: boolean;
}

interface VilleResultat {
  nom: string;
  departement: string | null;
  slug: string;
  latitude: number;
  longitude: number;
}

type Etat = 'demande_geoloc' | 'chargement' | 'pret' | 'refuse' | 'erreur';

export default function MeteoSoleil({ date }: { date: string }) {
  const [etat, setEtat] = useState<Etat>('demande_geoloc');
  const [ville, setVille] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [previsions, setPrevisions] = useState<Previsions | null>(null);
  const [soleil, setSoleil] = useState<Soleil | null>(null);
  const [recherche, setRecherche] = useState('');
  const [suggestions, setSuggestions] = useState<VilleResultat[]>([]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setEtat('refuse');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lon: position.coords.longitude });
        setVille('votre position');
        setEtat('chargement');
      },
      () => setEtat('refuse'),
      { timeout: 8000 }
    );
  }, []);

  useEffect(() => {
    if (!coords) return;
    Promise.all([
      fetch(`/api/v1/meteo?lat=${coords.lat}&lon=${coords.lon}`).then((r) => r.json()),
      fetch(`/api/v1/soleil?lat=${coords.lat}&lon=${coords.lon}&date=${date}`).then((r) => r.json()),
    ])
      .then(([m, s]) => {
        if (m.erreur) throw new Error(m.erreur);
        setPrevisions(m);
        setSoleil(s);
        setEtat('pret');
      })
      .catch(() => setEtat('erreur'));
  }, [coords, date]);

  useEffect(() => {
    if (recherche.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controleur = new AbortController();
    fetch(`/api/v1/villes/recherche?q=${encodeURIComponent(recherche)}`, { signal: controleur.signal })
      .then((r) => r.json())
      .then((d) => setSuggestions(d.resultats ?? []))
      .catch(() => {});
    return () => controleur.abort();
  }, [recherche]);

  function choisirVille(v: VilleResultat) {
    setCoords({ lat: v.latitude, lon: v.longitude });
    setVille(v.nom);
    setEtat('chargement');
    setSuggestions([]);
    setRecherche('');
  }

  return (
    <section aria-labelledby="meteo-locale">
      <h2 id="meteo-locale">Météo locale et soleil</h2>

      {etat === 'demande_geoloc' && <p>Localisation en cours…</p>}

      {etat === 'refuse' && (
        <div>
          <p>Recherchez votre commune pour afficher la météo et le lever/coucher du soleil :</p>
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom de la commune"
            aria-label="Recherche de commune"
          />
          {suggestions.length > 0 && (
            <ul className="suggestions-villes">
              {suggestions.map((v) => (
                <li key={v.slug}>
                  <button type="button" onClick={() => choisirVille(v)}>
                    {v.nom} {v.departement ? `(${v.departement})` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {etat === 'erreur' && <p>Météo momentanément indisponible. Réessayez plus tard.</p>}

      {etat === 'pret' && previsions && soleil && (
        <div>
          <h3>Prévisions météo pour {ville}</h3>
          <p>
            {Math.round(previsions.temperatureActuelle)} °C actuellement · min {Math.round(previsions.temperatureMin)} °C
            / max {Math.round(previsions.temperatureMax)} °C · vent {Math.round(previsions.vitesseVent / 5) * 5} km/h
          </p>

          <h3>Lever et coucher du soleil</h3>
          {soleil.casPolaire ? (
            <p>Jour ou nuit polaire à cette latitude ce jour-là.</p>
          ) : (
            <p>
              Lever : {soleil.lever} · Coucher : {soleil.coucher}
              {soleil.dureeJourMinutes != null && (
                <> · Durée du jour : {Math.floor(soleil.dureeJourMinutes / 60)} h {soleil.dureeJourMinutes % 60} min</>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
