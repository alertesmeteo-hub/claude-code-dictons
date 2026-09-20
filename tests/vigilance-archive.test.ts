import { describe, expect, it } from 'vitest';
import { masqueDepuisLibelle, nomsDepuisMasque, parserPageJour, urlBulletin } from '@/lib/meteo/vigilance-archive';

// Extrait réel de http://vigilance-public.meteo.fr/vigilanceDate.php?dateVigi=2001-10-06 (mise en forme conservée).
const PAGE = `<h3>BULLETINS :</h3><table><thead><tr class='headertab'><th>Heure</th><th>Producteur</th><th>Ph&eacute;nom&egrave;nes</th></tr></thead><tbody>` +
  `<tr><td style='text-align:center'><a class='iframe' style='text-decoration:none' title='Bulletin du : 2001-10-06 15:41:00 (CMIRO)' href='vigi.php?type=bulletin&id=10781&base=vigilance1a3'>15:41</a></td><td style='text-align:center'><a class='iframe' style='text-decoration:none' title='Bulletin du : 2001-10-06 15:41:00 (CMIRO)' href='vigi.php?type=bulletin&id=10781&base=vigilance1a3'>CMIRO</a></td><td style='padding-left:5px'><span class='contenu'>Vent.</span></td></tr>` +
  `<tr><td style='text-align:center'><a class='iframe' href='vigi.php?type=bulletin&id=10832&base=vigilance1a3'>16:11</a></td><td style='text-align:center'><a class='iframe' href='vigi.php?type=bulletin&id=10832&base=vigilance1a3'>CNP</a></td><td style='padding-left:5px'><span class='contenu'>Vent et Vagues-submersion.</span></td></tr>` +
  `</tbody></table><tr><td><a class='iframe' href='vigi.php?type=carte&id=111&base=vigilance1a3'>05:57</a></td><td>Jaune</td></tr>`;

describe('parserPageJour', () => {
  it('extrait les bulletins (et ignore les cartes)', () => {
    const b = parserPageJour('2001-10-06', PAGE);
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({
      date: '2001-10-06', heure: '15:41:00', producteur: 'CMIRO', phenomenes: 'Vent.', masque: 1, bulletinId: 10781, base: 'vigilance1a3',
    });
    expect(b[1].phenomenes).toBe('Vent et Vagues-submersion.');
    expect(b[1].masque).toBe(1 | 256);
  });

  it('renvoie une liste vide pour un jour sans bulletin', () => {
    expect(parserPageJour('2003-08-05', '<table><tr><td>Aucun bulletin</td></tr></table>')).toEqual([]);
  });

  it('construit le lien officiel du bulletin', () => {
    expect(urlBulletin({ bulletinId: 10781, base: 'vigilance1a3' })).toBe('http://vigilance-public.meteo.fr/vigi.php?type=bulletin&id=10781&base=vigilance1a3');
  });
});

describe('masqueDepuisLibelle', () => {
  it.each([
    ['Vent.', 1],
    ['Pluie-Inondation.', 2],
    ['Orages et Pluie-Inondation.', 6],
    ['Crues.', 8],
    ['Grand froid et Neige-Verglas.', 80],
    ['Canicule.', 32],
    ['Vent, Avalanches et Vagues-submersion.', 385],
    ['Libellé inconnu.', 0],
  ])('%s → %i', (libelle, masque) => {
    expect(masqueDepuisLibelle(libelle)).toBe(masque);
  });

  it('retrouve les noms depuis un masque', () => {
    expect(nomsDepuisMasque(6)).toEqual(['Pluie-inondation', 'Orages']);
  });
});
