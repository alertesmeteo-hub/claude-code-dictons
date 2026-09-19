import { describe, it, expect } from 'vitest';
import { cycleLunaire, evenementsLunaires } from '@/lib/calculs/lune';

const ecartMinutes = (a: Date, iso: string) => Math.abs(a.getTime() - new Date(iso).getTime()) / 60000;

describe('lune', () => {
  it('pleine lune du 26 septembre 2026 vers 16:49 UTC (18:49 à Paris)', () => {
    const e = evenementsLunaires(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));
    const pleine = e.find((x) => x.type === 'pleine_lune')!;
    expect(ecartMinutes(pleine.instant, '2026-09-26T16:49:00Z')).toBeLessThan(10);
  });

  it('nouvelle lune du 10 octobre 2026 vers 15:50 UTC', () => {
    const e = evenementsLunaires(new Date('2026-10-05T00:00:00Z'), new Date('2026-10-15T00:00:00Z'));
    const nouvelle = e.find((x) => x.type === 'nouvelle_lune')!;
    expect(ecartMinutes(nouvelle.instant, '2026-10-10T15:50:00Z')).toBeLessThan(10);
  });

  it('cycle du 19 septembre 2026 : prochaine pleine lune le 26', () => {
    const c = cycleLunaire(2026, 9, 19);
    expect(c.prochainePleineLune.startsWith('2026-09-26')).toBe(true);
    expect(c.prochaineNouvelleLune.startsWith('2026-10-10')).toBe(true);
  });
});
