import { describe, it, expect } from 'vitest';
import { signeZodiaque, signeAstrologieChinoise } from '@/lib/calculs/zodiaque';

describe('signeZodiaque', () => {
  it('reconnaît la Vierge le 18 septembre', () => {
    expect(signeZodiaque(new Date(2026, 8, 18)).nom).toBe('Vierge');
  });

  it('gère le Capricorne à cheval sur décembre/janvier', () => {
    expect(signeZodiaque(new Date(2026, 11, 25)).nom).toBe('Capricorne');
    expect(signeZodiaque(new Date(2026, 0, 5)).nom).toBe('Capricorne');
  });
});

describe('signeAstrologieChinoise', () => {
  it('retourne Rat pour 2020 (année de référence)', () => {
    expect(signeAstrologieChinoise(new Date(2020, 5, 1))).toBe('Rat');
  });

  it('retourne Buffle pour 2021', () => {
    expect(signeAstrologieChinoise(new Date(2021, 5, 1))).toBe('Buffle');
  });
});
