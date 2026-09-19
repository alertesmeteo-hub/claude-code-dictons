import { describe, it, expect } from 'vitest';
import { saisonsAstronomiques, saisonsMeteo } from '@/lib/calculs/saisons';
import { extremesOrbite } from '@/lib/calculs/lune';

describe('saisons', () => {
  it("équinoxe de septembre 2026 : 23/09 vers 00 h 05 UTC", () => {
    const { prochaine } = saisonsAstronomiques(new Date('2026-09-19T12:00:00Z'));
    expect(prochaine.nom).toBe('automne');
    expect(Math.abs(new Date(prochaine.debut).getTime() - Date.UTC(2026, 8, 23, 0, 5))).toBeLessThan(10 * 60000);
  });
  it('saison météo : automne, prochaine = hiver au 1er décembre', () => {
    const s = saisonsMeteo(2026, 9, 19);
    expect(s.actuelle).toBe('automne');
    expect(s.prochaine).toMatchObject({ nom: 'hiver', date: '2026-12-01', joursRestants: 73 });
  });
});

describe('orbite lunaire', () => {
  it('apogée du 19/09/2026 vers 03 h UTC, ~404 200 km', () => {
    const [e] = extremesOrbite(new Date('2026-09-18T12:00:00Z'), new Date('2026-09-20T12:00:00Z'));
    expect(e.type).toBe('apogee');
    expect(Math.abs(new Date(e.instant).getTime() - Date.UTC(2026, 8, 19, 3))).toBeLessThan(2 * 3600000);
    expect(Math.abs(e.distanceKm - 404221)).toBeLessThan(100);
  });
});
