'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { projeter, moyenne, LATITUDE_SEUIL_NORD_SUD, type TailleCarte } from '@/lib/meteo/projection-france';
import { LOGOS_PRESETS, logoParDefaut } from '@/lib/meteo/logos';
import { PICTOS_METEO, pictoDepuisCodeMeteo, type PictoMeteo } from './pictos';
import { exporterEnJpg } from './ExportJpg';
import type { PointCarte } from '@/app/api/v1/carte-meteo/previsions/route';

interface PointEdition {
  code: string;
  nom: string;
  lat: number;
  lon: number;
  mini: string;
  maxi: string;
  picto: PictoMeteo;
}

interface Props {
  points: (PointCarte & { lat: number; lon: number })[];
  modele: 'harmonie' | 'cep';
  dateLabel: string;
  onRecommencer: () => void;
}

const TAILLE: TailleCarte = { largeur: 760, hauteur: 760 };

type GeoJsonDepartements = {
  features: { properties: { code: string }; geometry: { type: string; coordinates: unknown } }[];
};

function anneauVersChemin(anneau: [number, number][], taille: TailleCarte): string {
  return anneau
    .map(([lon, lat], i) => {
      const { x, y } = projeter(lat, lon, taille);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ') + 'Z';
}

function geometrieVersChemin(geometry: { type: string; coordinates: unknown }, taille: TailleCarte): string {
  if (geometry.type === 'Polygon') {
    const anneaux = geometry.coordinates as [number, number][][];
    return anneaux.map((a) => anneauVersChemin(a, taille)).join(' ');
  }
  const polygones = geometry.coordinates as [number, number][][][];
  return polygones.map((p) => p.map((a) => anneauVersChemin(a, taille)).join(' ')).join(' ');
}

export default function EditeurCarte({ points, modele, dateLabel, onRecommencer }: Props) {
  const [contours, setContours] = useState<{ code: string; d: string }[]>([]);
  const [edition, setEdition] = useState<PointEdition[]>(() =>
    points.map((p) => ({
      code: p.code,
      nom: p.nom,
      lat: p.lat,
      lon: p.lon,
      mini: p.mini != null ? String(Math.round(p.mini)) : '',
      maxi: p.maxi != null ? String(Math.round(p.maxi)) : '',
      picto: pictoDepuisCodeMeteo(p.codeConditions),
    }))
  );
  const [date, setDate] = useState(dateLabel);
  const logoDefaut = useMemo(() => logoParDefaut(points.map((p) => p.code)), [points]);
  const [logoPresetId, setLogoPresetId] = useState(logoDefaut.id);
  const [logoPersonnalise, setLogoPersonnalise] = useState<string | null>(null);
  const logoUrl = logoPersonnalise ?? LOGOS_PRESETS.find((l) => l.id === logoPresetId)?.fichier ?? null;
  const [paletteOuvertePour, setPaletteOuvertePour] = useState<string | null>(null);
  const moyenneInitiale = useMemo(() => {
    const maxisNord = points.filter((p) => p.lat >= LATITUDE_SEUIL_NORD_SUD && p.maxi != null).map((p) => p.maxi as number);
    const maxisSud = points.filter((p) => p.lat < LATITUDE_SEUIL_NORD_SUD && p.maxi != null).map((p) => p.maxi as number);
    return { nord: moyenne(maxisNord), sud: moyenne(maxisSud) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [moyenneNord, setMoyenneNord] = useState(moyenneInitiale.nord != null ? String(moyenneInitiale.nord) : '—');
  const [moyenneSud, setMoyenneSud] = useState(moyenneInitiale.sud != null ? String(moyenneInitiale.sud) : '—');
  const [enExport, setEnExport] = useState(false);
  const carteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/geo/departements.geojson')
      .then((r) => r.json())
      .then((geojson: GeoJsonDepartements) => {
        setContours(
          geojson.features.map((f) => ({
            code: f.properties.code,
            d: geometrieVersChemin(f.geometry, TAILLE),
          }))
        );
      })
      .catch(() => setContours([]));
  }, []);

  function modifierPoint(code: string, champ: 'mini' | 'maxi' | 'picto', valeur: string) {
    setEdition((prev) => prev.map((p) => (p.code === code ? { ...p, [champ]: valeur } : p)));
  }

  function surLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (fichier) setLogoPersonnalise(URL.createObjectURL(fichier));
  }

  async function exporter() {
    if (!carteRef.current) return;
    setEnExport(true);
    try {
      await exporterEnJpg(carteRef.current, `carte-meteo-${modele}-${date.replace(/\s+/g, '-')}`);
    } finally {
      setEnExport(false);
    }
  }

  return (
    <div className="carte-meteo-editeur">
      <div className="carte-meteo-outils">
        <label>
          Logo (coin gauche)
          <select
            value={logoPersonnalise ? 'personnalise' : logoPresetId}
            onChange={(e) => {
              if (e.target.value === 'personnalise') return;
              setLogoPersonnalise(null);
              setLogoPresetId(e.target.value);
            }}
          >
            {LOGOS_PRESETS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nom}
                {l.id === logoDefaut.id ? ' (suggéré)' : ''}
              </option>
            ))}
            {logoPersonnalise && <option value="personnalise">Image importée</option>}
          </select>
          <input type="file" accept="image/*" onChange={surLogo} />
        </label>
        <label>
          Date affichée
          <input type="text" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Moyenne Nord
          <input type="text" value={moyenneNord} onChange={(e) => setMoyenneNord(e.target.value)} />
        </label>
        <label>
          Moyenne Sud
          <input type="text" value={moyenneSud} onChange={(e) => setMoyenneSud(e.target.value)} />
        </label>
        <button type="button" onClick={exporter} disabled={enExport}>
          {enExport ? 'Export en cours…' : 'Exporter en JPG'}
        </button>
        <button type="button" onClick={onRecommencer} className="secondaire">
          Recommencer
        </button>
      </div>

      <div ref={carteRef} className="carte-meteo-rendu" style={{ width: TAILLE.largeur, height: TAILLE.hauteur }}>
        {logoUrl && <img src={logoUrl} alt="Logo" className="carte-meteo-logo" />}
        <div className="carte-meteo-date">{date}</div>

        <div className="carte-meteo-moyennes">
          <div className="carte-meteo-moyenne carte-meteo-moyenne-nord">
            <span>Moyenne Nord</span>
            <strong>{moyenneNord}°</strong>
          </div>
          <div className="carte-meteo-moyenne carte-meteo-moyenne-sud">
            <span>Moyenne Sud</span>
            <strong>{moyenneSud}°</strong>
          </div>
        </div>

        <svg viewBox={`0 0 ${TAILLE.largeur} ${TAILLE.hauteur}`} width={TAILLE.largeur} height={TAILLE.hauteur} className="carte-meteo-fond">
          {contours.map((c) => (
            <path key={c.code} d={c.d} className="carte-meteo-departement" />
          ))}
        </svg>

        {edition.map((p) => {
          const { x, y } = projeter(p.lat, p.lon, TAILLE);
          return (
            <div key={p.code} className="carte-meteo-marqueur" style={{ left: x, top: y }} title={p.nom}>
              <button
                type="button"
                className="carte-meteo-picto"
                onClick={() => setPaletteOuvertePour((c) => (c === p.code ? null : p.code))}
              >
                {p.picto}
              </button>
              {paletteOuvertePour === p.code && (
                <div className="carte-meteo-palette">
                  {PICTOS_METEO.map((picto) => (
                    <button
                      key={picto}
                      type="button"
                      onClick={() => {
                        modifierPoint(p.code, 'picto', picto);
                        setPaletteOuvertePour(null);
                      }}
                    >
                      {picto}
                    </button>
                  ))}
                </div>
              )}
              <input
                className="carte-meteo-valeur carte-meteo-maxi"
                value={p.maxi}
                onChange={(e) => modifierPoint(p.code, 'maxi', e.target.value)}
                size={2}
              />
              <input
                className="carte-meteo-valeur carte-meteo-mini"
                value={p.mini}
                onChange={(e) => modifierPoint(p.code, 'mini', e.target.value)}
                size={2}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
