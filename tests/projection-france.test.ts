import { describe, it, expect } from 'vitest';
import { projeter, moyenne } from '@/lib/meteo/projection-france';

describe('projeter', () => {
  it('place un point au centre proche du milieu de la carte', () => {
    const taille = { largeur: 1000, hauteur: 1000 };
    const { x, y } = projeter(46.2, 2.2, taille); // centre approximatif de la France
    expect(x).toBeGreaterThan(300);
    expect(x).toBeLessThan(700);
    expect(y).toBeGreaterThan(300);
    expect(y).toBeLessThan(700);
  });

  it('place Dunkerque (Nord) au-dessus de Perpignan (Sud)', () => {
    const taille = { largeur: 1000, hauteur: 1000 };
    const nord = projeter(51.03, 2.38, taille);
    const sud = projeter(42.7, 2.89, taille);
    expect(nord.y).toBeLessThan(sud.y);
  });
});

describe('moyenne', () => {
  it('calcule la moyenne arrondie au dixième', () => {
    expect(moyenne([20, 21, 25])).toBeCloseTo(22, 1);
  });

  it('renvoie null pour une liste vide', () => {
    expect(moyenne([])).toBeNull();
  });
});
