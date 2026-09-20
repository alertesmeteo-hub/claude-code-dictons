(function () {
  var HOST = 'https://api.alertes-meteo.com';
  var KEY = 'am_dashboard_key';
  var $ = function (id) { return document.getElementById(id); };

  var CITIES = [
    ['Paris', 48.8566, 2.3522], ['Lyon', 45.764, 4.8357], ['Marseille', 43.2965, 5.3698], ['Toulouse', 43.6047, 1.4442],
    ['Lille', 50.6292, 3.0573], ['Bordeaux', 44.8378, -0.5792], ['Strasbourg', 48.5734, 7.7521], ['Nantes', 47.2184, -1.5536]
  ];
  var LEVELS = [{ v: '', l: 'Défaut' }, { v: '1', l: '1 (vert)' }, { v: '2', l: '2 (jaune)' }, { v: '3', l: '3 (orange)' }, { v: '4', l: '4 (rouge)' }];
  var LIMIT = { name: 'limit', label: 'Limite', type: 'number', hint: '1 à 200, défaut 50' };
  var OFFSET = { name: 'offset', label: 'Décalage', type: 'number', hint: 'défaut 0' };

  var ENDPOINTS = {
    sun: {
      path: '/v1/sun', desc: 'Lever, coucher, midi solaire, aube et crépuscule, calculés localement.', presets: true,
      params: [
        { name: 'lat', label: 'Latitude', type: 'number', required: true, def: '48.8566' },
        { name: 'lon', label: 'Longitude', type: 'number', required: true, def: '2.3522' },
        { name: 'date', label: 'Date', type: 'date', hint: 'défaut : aujourd\'hui' },
        { name: 'tz', label: 'Fuseau', type: 'text', def: 'Europe/Paris' }
      ]
    },
    vigilance: {
      path: '/v1/vigilance', desc: 'Vigilances par département et phénomène (service non officiel).',
      params: [
        { name: 'domain', label: 'Département', type: 'text', hint: 'ex. 30, 2A, ou zone côtière 3010' },
        { name: 'echeance', label: 'Échéance', type: 'select', options: [{ v: '', l: 'Toutes' }, { v: 'J', l: 'J (aujourd\'hui)' }, { v: 'J1', l: 'J1 (demain)' }] },
        { name: 'min_level', label: 'Niveau minimum', type: 'select', options: LEVELS }
      ]
    },
    extremes: {
      path: '/v1/extremes/france', desc: 'Températures maximale et minimale du jour parmi les stations collectées.',
      params: [
        { name: 'altitude_max', label: 'Altitude max (m)', type: 'number', hint: 'ex. 500' },
        { name: 'stations', label: 'Stations', type: 'select', options: [{ v: '', l: 'Toutes' }, { v: 'principales', l: 'Réseau principal' }] }
      ]
    },
    records: {
      path: '/v1/records', desc: 'Records de température du jour, calculés et provisoires (non officiels).',
      params: [
        { name: 'kind', label: 'Type', type: 'select', options: [{ v: '', l: 'Tous' }, { v: 'heat', l: 'Chaleur' }, { v: 'cold', l: 'Froid' }, { v: 'tropical', l: 'Nuit tropicale' }] },
        { name: 'scope', label: 'Portée', type: 'select', options: [{ v: '', l: 'Toutes' }, { v: 'absolute', l: 'Absolu' }, { v: 'monthly', l: 'Mensuel' }, { v: 'fortnight', l: 'Quinzaine' }, { v: 'daily', l: 'Quotidien' }] },
        { name: 'department', label: 'Département', type: 'text', hint: 'ex. 30' }, LIMIT, OFFSET
      ]
    },
    rain: {
      path: '/v1/rain', desc: 'Pluie observée par station en métropole (cumuls provisoires).',
      params: [
        { name: 'sort', label: 'Tri', type: 'select', options: ['rr1', 'rr24', 'rr48', 'rr72', 'month', 'season', 'year'].map(function (v) { return { v: v === 'rr24' ? '' : v, l: v === 'rr24' ? 'rr24 (défaut)' : v }; }) },
        { name: 'department', label: 'Département', type: 'text', hint: 'ex. 30' },
        { name: 'station', label: 'Station', type: 'text', hint: 'identifiant de 8 caractères' },
        { name: 'complete_only', label: 'Cumuls complets seulement', type: 'select', options: [{ v: '', l: 'Non' }, { v: '1', l: 'Oui' }] }, LIMIT, OFFSET
      ]
    },
    status: { path: '/v1/status', desc: 'Fraîcheur des sources (sans clé).', nokey: true, params: [] },
    usage: { path: '/v1/usage', desc: 'Votre consommation et votre quota.', params: [] }
  };

  var inputs = {};
  var current = null;

  function getKey() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setKey(v) { try { if (v) { sessionStorage.setItem(KEY, v); } else { sessionStorage.removeItem(KEY); } } catch (e) { /* stockage indisponible */ } }

  function option(v, l) { var o = document.createElement('option'); o.value = v; o.textContent = l; return o; }

  function buildParams(name) {
    current = ENDPOINTS[name];
    $('desc').textContent = current.desc;
    $('preset-wrap').hidden = !current.presets;
    var box = $('params');
    box.textContent = '';
    inputs = {};
    current.params.forEach(function (p) {
      var wrap = document.createElement('div');
      var label = document.createElement('label');
      label.htmlFor = 'p-' + p.name;
      label.textContent = p.label + (p.required ? ' *' : '');
      if (p.hint) { var s = document.createElement('small'); s.textContent = ' (' + p.hint + ')'; label.appendChild(s); }
      var el;
      if (p.type === 'select') {
        el = document.createElement('select');
        p.options.forEach(function (o) { el.appendChild(option(o.v, o.l)); });
      } else {
        el = document.createElement('input');
        el.type = p.type === 'number' ? 'text' : p.type;
        if (p.type === 'number') { el.inputMode = 'decimal'; }
        el.autocomplete = 'off';
        if (p.def) { el.value = p.def; }
      }
      el.id = 'p-' + p.name;
      inputs[p.name] = el;
      wrap.appendChild(label);
      wrap.appendChild(el);
      box.appendChild(wrap);
    });
  }

  function buildQuery() {
    var qs = new URLSearchParams();
    for (var i = 0; i < current.params.length; i++) {
      var p = current.params[i];
      var v = inputs[p.name].value.trim();
      if (p.required && v === '') { return { error: 'Le paramètre « ' + p.label + ' » est obligatoire.' }; }
      if (v !== '') { qs.append(p.name, v); }
    }
    return { qs: qs.toString() };
  }

  function show(id, text) { $(id).textContent = text; }

  $('endpoint').addEventListener('change', function () { buildParams(this.value); });
  $('preset').addEventListener('change', function () {
    var c = CITIES[this.selectedIndex - 1];
    if (c && inputs.lat) { inputs.lat.value = String(c[1]); inputs.lon.value = String(c[2]); }
  });

  $('copy').addEventListener('click', function () {
    var btn = this;
    if (navigator.clipboard) {
      navigator.clipboard.writeText($('curl').textContent).then(function () { btn.textContent = 'Copié'; setTimeout(function () { btn.textContent = 'Copier'; }, 1500); });
    }
  });

  $('pg').addEventListener('submit', function (e) {
    e.preventDefault();
    var typedKey = $('key').value.trim();
    if (typedKey) { setKey(typedKey); $('key').value = ''; }
    var key = getKey();
    var q = buildQuery();
    $('out').hidden = false;
    if (q.error) { show('url', ''); show('curl', ''); show('meta', q.error); show('json', ''); return; }
    if (!key && !current.nokey) { show('meta', 'Saisissez votre clé API.'); return; }

    var path = current.path + (q.qs ? '?' + q.qs : '');
    show('url', HOST + path);
    show('curl', 'curl "' + HOST + path + '"' + (current.nokey ? '' : ' \\\n  -H "X-API-Key: VOTRE_CLE"'));
    show('meta', 'Envoi…');
    show('json', '');
    $('send').disabled = true;

    var t0 = performance.now();
    var headers = current.nokey ? {} : { 'X-API-Key': key };
    fetch(path, { headers: headers })
      .then(function (r) {
        var ms = Math.round(performance.now() - t0);
        var remaining = r.headers.get('X-RateLimit-Remaining-Month');
        return r.text().then(function (txt) {
          var out = txt;
          try { out = JSON.stringify(JSON.parse(txt), null, 2); } catch (err) { /* réponse non JSON */ }
          show('meta', 'HTTP ' + r.status + ' · ' + ms + ' ms' + (remaining !== null ? ' · requêtes restantes ce mois : ' + remaining : ''));
          show('json', out);
          if (r.status === 401) { setKey(''); }
        });
      })
      .catch(function () { show('meta', 'Impossible de joindre le service.'); })
      .then(function () { $('send').disabled = false; });
  });

  var select = $('endpoint');
  Object.keys(ENDPOINTS).forEach(function (k) { select.appendChild(option(k, ENDPOINTS[k].path)); });
  var preset = $('preset');
  preset.appendChild(option('', 'Choisir une ville…'));
  CITIES.forEach(function (c) { preset.appendChild(option(c[0], c[0])); });
  buildParams(select.value);
})();
