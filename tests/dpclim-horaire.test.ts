import { describe, expect, it } from 'vitest';
import { analyserCsvHoraire, listeJours, quotidien } from '@/lib/meteo/dpclim-horaire';

const ENTETE = 'POSTE;DATE;RR1;QRR1;T;QT;TD;QTD;TN;QTN;TX;QTX;PMER;QPMER;FF;QFF;DD;QDD;FXI;QFXI;U;QU;INS;QINS;VV;QVV';

describe('analyserCsvHoraire', () => {
  it('regroupe par jour UTC, convertit les vitesses et clampe la pluie négative', () => {
    const csv = [
      ENTETE,
      '66049001;2026091423;0,0;1;20,5;1;;;20,1;1;20,9;1;1012,3;1;2,5;1;270;1;5,0;1;70;1;;;10000;1',
      '66049001;2026091500;-0,1;1;19,0;1;;;18,7;1;19,4;1;;;;;;;;;;;;;',
    ].join('\n');
    const j = analyserCsvHoraire(csv);
    expect(Object.keys(j)).toEqual(['2026-09-14', '2026-09-15']);
    const l = j['2026-09-14'].lignes[0];
    expect(l[0]).toBe('2026-09-14T23:00:00Z');
    expect(l[1]).toBe(20.5);
    expect(l[5]).toBe(9); // 2,5 m/s → 9 km/h
    expect(l[6]).toBe(18); // 5 m/s → 18 km/h
    expect(l[9]).toBe(10); // 10 000 m → 10 km
    expect(j['2026-09-15'].lignes[0][7]).toBe(0); // -0,1 mm → 0
  });
});

describe('quotidien', () => {
  it('utilise les extrêmes horaires TN/TX et ignore les valeurs manquantes', () => {
    const csv = [ENTETE, '1;2026091410;1,0;1;20,0;1;;;19,0;1;22,0;1;;;;;;;;;;;60;1;;', '1;2026091411;0,5;1;;;;;;;;;;;;;;;;;;;;;;'].join('\n');
    const d = analyserCsvHoraire(csv)['2026-09-14'];
    expect(quotidien(d.lignes, d.tn, d.tx)).toEqual({ tx: 22, tn: 19, rr: 1.5, insol_h: 1, n: 2 });
  });
});

describe('listeJours', () => {
  it('liste les jours inclus', () => {
    expect(listeJours('2026-09-12', '2026-09-14')).toEqual(['2026-09-12', '2026-09-13', '2026-09-14']);
  });
});
