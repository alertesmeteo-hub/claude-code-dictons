import { describe, expect, it } from 'vitest';
import { convertirPointMeteo, type ReponsePointMeteo } from '@/lib/meteo/alertes-meteo';

const reponse = (surcharge: Partial<ReponsePointMeteo> = {}): ReponsePointMeteo => ({
  actuel: { heure: '2026-10-11T14:00', temperature: 20.6, code: 3, vent: 12, precipitation: 0 },
  jours: [{ date: '2026-10-11', mini: 16.3, maxi: 24.2, code: 3, partiel: false }],
  ...surcharge,
});

describe('convertirPointMeteo', () => {
  it('reprend les conditions du moment et la minimale et la maximale du jour', () => {
    expect(convertirPointMeteo(reponse())).toEqual({
      temperatureActuelle: 20.6,
      temperatureMax: 24.2,
      temperatureMin: 16.3,
      codeConditions: 3,
      vitesseVent: 12,
      precipitationsMm: 0,
      miseAJour: '2026-10-11T14:00',
    });
  });

  it("élargit la minimale et la maximale du jour à la température du moment (jour partiel)", () => {
    const chaud = convertirPointMeteo(reponse({ jours: [{ date: '2026-10-11', mini: 16.3, maxi: 19, code: 3, partiel: true }] }));
    expect(chaud.temperatureMax).toBe(20.6);
    const froid = convertirPointMeteo(reponse({ actuel: { heure: '2026-10-11T14:00', temperature: 10, code: 3, vent: null, precipitation: 0 } }));
    expect(froid.temperatureMin).toBe(10);
    expect(froid.vitesseVent).toBe(0);
  });

  it('refuse une réponse sans conditions du moment ou sans jour', () => {
    expect(() => convertirPointMeteo(reponse({ actuel: null }))).toThrow();
    expect(() => convertirPointMeteo(reponse({ jours: [] }))).toThrow();
    expect(() => convertirPointMeteo(reponse({ jours: [{ date: '2026-10-11', mini: null, maxi: null, code: null, partiel: true }] }))).toThrow();
  });
});
