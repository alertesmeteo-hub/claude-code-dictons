import { describe, expect, it } from 'vitest';
import { controlerHeure, extremesDuJour, type CacheHoraire, type StationMf } from '@/lib/meteo/extremes-france';

const stations: StationMf[] = [
  { id: '66136001', nom: 'PERPIGNAN', altitude: 42, principale: true },
  { id: '13054001', nom: 'MARIGNANE', altitude: 9, principale: true },
  { id: '20004002', nom: 'AJACCIO', altitude: 5, principale: false },
  { id: '65059001', nom: 'PIC DU MIDI', altitude: 2880, principale: true },
  { id: '06033002', nom: 'CARROS_SAPC', altitude: 78, principale: false },
];

const releve = (id: string, t: number, tx = t, tn = t) => ({ id, t, tx, tn });

describe('controlerHeure', () => {
  it('garde une heure plausible', () => {
    expect(controlerHeure(12, 12.4, 11.8, 11.5)).toEqual([12, 12.4, 11.8]);
  });
  it("écarte une heure dont l'étendue tx - tn dépasse 15 °C", () => {
    expect(controlerHeure(22, 22, -8.4, null)).toEqual([null, null, null]);
  });
  it('écarte une température instantanée qui saute de plus de 15 °C en une heure', () => {
    expect(controlerHeure(0, 0.2, 0, 21)).toEqual([null, null, null]);
  });
  it("retire une extrême qu'aucune température voisine n'étaye", () => {
    expect(controlerHeure(14, 21, 13.8, 14.2)).toEqual([14, null, 13.8]);
  });
});

describe('extremesDuJour', () => {
  // 21/10/2026 : 22 h UTC la veille = minuit à Paris (UTC+2).
  const cache: CacheHoraire = {
    hours: {
      '2026-10-20T21:00:00Z': [releve('66136001', 25, 25, 25)], // 23 h à Paris la veille : hors du jour
      '2026-10-20T22:00:00Z': [releve('66136001', 11, 11.2, 10.4), releve('13054001', 9, 9.1, 8.7), releve('65059001', -7, -6.8, -7.3)],
      '2026-10-21T12:00:00Z': [releve('66136001', 19, 19.1, 18.5), releve('13054001', 21, 21.4, 20.6), releve('20004002', 24, 24.7, 23.5), releve('06033002', 26, 26.2, 25.1)],
    },
  };
  const mesures = extremesDuJour(cache, '2026-10-21', stations);

  it("classe les maxima du jour à l'heure de Paris, sans les stations d'altitude ni les SAPC", () => {
    expect(mesures.filter((m) => m.type === 'maxi').map((m) => [m.nomCommune, m.valeurC, m.heureMesure])).toEqual([
      ['AJACCIO', 24.7, '14:00:00'],
      ['MARIGNANE', 21.4, '14:00:00'],
      ['PERPIGNAN', 19.1, '14:00:00'],
    ]);
  });

  it('classe les minima du jour et garde le réseau dans la source', () => {
    const minis = mesures.filter((m) => m.type === 'mini');
    expect(minis.map((m) => [m.nomCommune, m.valeurC, m.heureMesure])).toEqual([
      ['MARIGNANE', 8.7, '00:00:00'],
      ['PERPIGNAN', 10.4, '00:00:00'],
      ['AJACCIO', 23.5, '14:00:00'],
    ]);
    expect(minis[0]).toMatchObject({ codeStation: '13054001', departement: '13', altitudeM: 9 });
    expect(minis[0].source).toContain('réseau principal');
    expect(minis[2].source).toContain('réseau étendu');
  });
});
