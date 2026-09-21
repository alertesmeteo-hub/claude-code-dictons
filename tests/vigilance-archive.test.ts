import { describe, expect, it } from 'vitest';
import { masqueDepuisLibelle, nomsDepuisMasque, parserCartesPage, parserPageJour, urlBulletin } from '@/lib/meteo/vigilance-archive';

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

// ───────────── Texte intégral des bulletins ─────────────
import { departementsDepuisTexte, niveauMaxDepuisTexte, parserBulletin, texteDepuisHtml } from '@/lib/meteo/vigilance-archive';
import { codesDepuisNoms } from '@/lib/meteo/departements-fr';

// Bulletin National de Suivi du 07/03/2010 (vigi.php?type=bulletin&id=7920&base=vigilance1a3), enveloppe <pre> d'origine.
const CNP_2010 = `<pre>
Bulletin National de Suivi.

CENTRE NATIONAL DE PREVISION

Bulletin émis le dimanche 07 mars 2010 à 16h05
Date et heure du prochain message : dimanche 07 mars 2010 à 22h30

Numéro : 0703DP03
Evenement type: Neige-Verglas
Evènement en cours.
Fin d'évènement prévu le lundi 08 mars 2010 à 19h00

Maintien de suivi pour 13 département(s) : Andorre, Ardèche (07), Ariège (09), Aude (11),
                                         Aveyron (12), Drôme (26), Gard (30), Haute-Garonne (31),
                                         Hérault (34), Isère (38), Pyrénées-Orientales (66),
                                         Tarn (81), Vaucluse (84).

Qualification de l'évènement :

Episode neigeux remarquable, d'autant plus pour une première décade de mars.

Consequences possibles :

Neige-Verglas/Orange
* Des chutes de neige ou du verglas dans des proportions importantes sont attendus.

Conseils de Comportement :

Neige-Verglas/Orange
* Soyez très prudents et vigilants si vous devez absolument vous déplacer.
</pre>
`;

// Base récente : blocs HTML (extrait réel du bulletin national du 15/10/2018).
const CNP_2018 = `<div name="corps">
<h1>Bulletin de vigilance National.<br>CENTRE NATIONAL DE PREVISION</h1>
<div class="arrondi"><p>Numéro : 1510DP01</p>Emis le : lundi 15 octobre 2018  à 02h13 par : Météo-France Toulouse<br>Date et heure du prochain message : au plus tard le lundi 15 octobre 2018  à 03h15 </div>
<div class="arrondi"><p style="text-align:center">Phénomène(s) : Orages et Pluie-Inondation.</p>Phénomène en cours.<br></div>
<div class="arrondi"><p>Localisation</p><br>Début de suivi pour :<br>Aucun département<br><br>Maintien de suivi pour :<br>Aude (11), Aveyron (12), Haute-Garonne (31), Hérault (34), Pyrénées-Orientales (66) et Tarn (81).<br><br>Fin de suivi pour :<br>Aucun département<br></div>
<div class="arrondi"><p>Description</p><br>Qualification du phénomène :<br>Episode méditerranéen très actif.<br></div></div>`;

describe('bulletin de suivi — base ancienne (<pre>)', () => {
  const r = parserBulletin(CNP_2010);
  it('conserve le texte tel quel', () => {
    expect(r.texte.startsWith('Bulletin National de Suivi.')).toBe(true);
    expect(r.texte).toContain('Numéro : 0703DP03');
  });
  it('lit les 13 départements suivis (Andorre = 99)', () => {
    expect(r.departements.map((d) => d.code)).toEqual(['07', '09', '11', '12', '26', '30', '31', '34', '38', '66', '81', '84', '99']);
    expect(r.departements.every((d) => d.statut === 2)).toBe(true);
  });
  it('lit le niveau orange', () => expect(r.niveauMax).toBe(3));
});

describe('bulletin de suivi — base récente (HTML)', () => {
  const r = parserBulletin(CNP_2018);
  it('sépare Début / Maintien / Fin et ignore « Aucun département »', () => {
    expect(r.departements).toEqual([
      { code: '11', statut: 2 }, { code: '12', statut: 2 }, { code: '31', statut: 2 },
      { code: '34', statut: 2 }, { code: '66', statut: 2 }, { code: '81', statut: 2 },
    ]);
  });
  it('produit un texte lisible', () => {
    const t = texteDepuisHtml(CNP_2018);
    expect(t).toContain('Bulletin de vigilance National.');
    expect(t).not.toMatch(/<[a-z]/i);
  });
});

describe('ancien format régional : départements nommés', () => {
  it('reconnaît les noms sans code, en distinguant Marne / Haute-Marne', () => {
    expect(codesDepuisNoms("Cotes d'Armor Finistère Morbihan")).toEqual(['22', '29', '56']);
    expect(codesDepuisNoms('Haute-Marne et Aube')).toEqual(['10', '52']);
    expect(codesDepuisNoms('Marne')).toEqual(['51']);
    expect(codesDepuisNoms('Haute-Loire, Loire-Atlantique')).toEqual(['43', '44']);
  });
  it('lit la ligne « Lieux concernés par l’événement »', () => {
    expect(departementsDepuisTexte("Lieux concernés par l'événement : Cotes d'Armor Finistère Morbihan\nDébut d'événement : x").map((d) => d.code)).toEqual(['22', '29', '56']);
  });
});

describe('niveauMaxDepuisTexte', () => {
  it('prend le plus élevé', () => {
    expect(niveauMaxDepuisTexte('Vent violent/Orange\nOrages/Rouge')).toBe(4);
    expect(niveauMaxDepuisTexte('Canicule/Jaune')).toBe(2);
    expect(niveauMaxDepuisTexte('aucune couleur ici')).toBeNull();
  });
});

describe('parserCartesPage', () => {
  const PAGE_CARTES =
    `<h3>CARTES :</h3><table><tbody><tr><td><a class='iframe' title='Carte de 2021-12-13 06:00:00' alt='carte' href='vigi.php?type=carte&id=10583&base=vigilance4'>06:00</a></td><td class='couleur_orange'><span class='contenu'>Orange</span></td></tr>` +
    `<tr><td><a class='iframe' href='vigi.php?type=carte&id=10584&base=vigilance4'>10:01</a></td><td class='couleur_rouge'><span class='contenu'>Rouge</span></td></tr></tbody></table>` +
    `<span class='contenu'>Pas de Bulletin Vigilance le 2021-12-13</span>`;

  it('extrait heure, niveau et identifiant de chaque carte', () => {
    const c = parserCartesPage('2021-12-13', PAGE_CARTES);
    expect(c).toHaveLength(2);
    expect(c[0]).toEqual({
      date: '2021-12-13', heure: '06:00:00', producteur: 'Carte', phenomenes: 'Carte de vigilance — niveau max orange', masque: 0, bulletinId: 10583, base: 'carte_vigilance4',
    });
    expect(c[1].phenomenes).toContain('rouge');
  });

  it('renvoie une liste vide sans carte', () => {
    expect(parserCartesPage('2003-08-05', '<p>rien</p>')).toEqual([]);
  });
});
