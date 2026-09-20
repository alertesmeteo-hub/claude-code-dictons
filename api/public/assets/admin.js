(function () {
  var KEY = 'am_admin_token';
  var ENDPOINTS = ['sun', 'extremes', 'vigilance', 'records', 'rain'];
  var $ = function (id) { return document.getElementById(id); };

  function getToken() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { if (v) { sessionStorage.setItem(KEY, v); } else { sessionStorage.removeItem(KEY); } } catch (e) { /* stockage indisponible */ } }

  function api(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: { 'X-Admin-Token': getToken(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  function note(text, ok) {
    var m = $('msg');
    m.hidden = !text;
    m.className = 'msg ' + (ok ? 'ok' : 'err');
    m.textContent = text || '';
  }

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) { e.textContent = text; }
    if (cls) { e.className = cls; }
    return e;
  }

  function btn(text, fn, secondary) {
    var b = el('button', text, 'btn' + (secondary === false ? '' : ' secondary'));
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function td(child) {
    var c = document.createElement('td');
    if (typeof child === 'string') { c.textContent = child; } else if (child) { c.appendChild(child); }
    return c;
  }

  function date(v) { return v ? new Date(v.replace(' ', 'T') + (v.indexOf('T') === -1 ? 'Z' : '')).toLocaleString('fr-FR') : '–'; }

  function action(path, body, okText) {
    return api(path, 'POST', body).then(function (r) {
      if (r.status === 200) {
        var d = r.body.data || {};
        note(okText + (d.key ? ' Email non envoyé : transmettez cette clé manuellement : ' + d.key : ''), true);
        load();
      } else {
        note((r.body.error && r.body.error.message) || 'Échec.', false);
      }
    });
  }

  function switchCell(name, switches) {
    var s = switches[name];
    var off = s && Number(s.disabled) === 1;
    var wrap = document.createElement('div');
    var pill = el('span', off ? 'Désactivé' : 'Actif', 'pill ' + (off ? 'bad' : 'ok'));
    wrap.appendChild(pill);
    wrap.appendChild(document.createTextNode(' '));
    wrap.appendChild(btn(off ? 'Réactiver' : 'Désactiver', function () {
      var reason = null;
      if (!off) {
        reason = window.prompt('Motif (facultatif) :', '') || null;
        if (!window.confirm('Désactiver « ' + name + ' » ?')) { return; }
      }
      action('/v1/admin/switches', { name: name, disabled: !off, reason: reason }, name + ' : ' + (off ? 'réactivé.' : 'désactivé.'));
    }));
    return wrap;
  }

  function renderOverview(o) {
    var stats = $('stats');
    stats.textContent = '';
    [['Utilisateurs', o.users], ['Clés actives', o.active_keys], ['Demandes en attente', o.pending_requests], ['Requêtes ce mois', o.requests_this_month]].forEach(function (s) {
      var c = el('div', null, 'card');
      c.appendChild(el('h3', s[0]));
      c.appendChild(el('p', Number(s[1]).toLocaleString('fr-FR'), 'stat'));
      stats.appendChild(c);
    });

    var switches = {};
    o.switches.forEach(function (s) { switches[s.name] = s; });

    var cb = $('collectors');
    cb.textContent = '';
    o.collectors.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.appendChild(td(c.name));
      tr.appendChild(td(date(c.last_success_at)));
      var last = c.last_run ? (c.last_run.status === 'ok' ? 'OK' : 'Erreur') + ' : ' + c.last_run.message : '–';
      tr.appendChild(td(last));
      tr.appendChild(td(switchCell('collector:' + c.name, switches)));
      cb.appendChild(tr);
    });

    var hits = {};
    o.endpoints_this_month.forEach(function (e) { hits[e.endpoint] = e.hits; });
    var eb = $('endpoints');
    eb.textContent = '';
    ENDPOINTS.forEach(function (name) {
      var tr = document.createElement('tr');
      tr.appendChild(td('/v1/' + name));
      tr.appendChild(td(Number(hits[name] || 0).toLocaleString('fr-FR')));
      tr.appendChild(td(switchCell(name, switches)));
      eb.appendChild(tr);
    });
  }

  function renderRequests(list) {
    var box = $('requests');
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'Aucune demande en attente.', 'muted')); return; }
    list.forEach(function (r) {
      var c = el('div', null, 'card');
      c.style.marginBottom = '12px';
      c.appendChild(el('h3', r.name + ' <' + r.email + '>'));
      c.appendChild(el('p', [r.organization, r.website, date(r.created_at)].filter(Boolean).join(' · ')));
      c.appendChild(el('p', r.usage_description));
      var a = el('div', null, 'actions');
      a.appendChild(btn('Approuver', function () { action('/v1/admin/requests/' + r.id + '/approve', null, 'Demande approuvée.'); }, false));
      a.appendChild(btn('Rejeter', function () { if (window.confirm('Rejeter cette demande ?')) { action('/v1/admin/requests/' + r.id + '/reject', null, 'Demande rejetée.'); } }));
      c.appendChild(a);
      box.appendChild(c);
    });
  }

  function renderKeys(list) {
    var kb = $('keys');
    kb.textContent = '';
    list.forEach(function (k) {
      var revoked = !!k.revoked_at;
      var tr = document.createElement('tr');
      tr.appendChild(td(k.prefix + (revoked ? ' (révoquée)' : '')));
      tr.appendChild(td(k.email));
      tr.appendChild(td(k.account_status === 'active' ? 'actif' : 'suspendu'));
      tr.appendChild(td(date(k.expires_at)));
      tr.appendChild(td(Number(k.month_hits).toLocaleString('fr-FR')));
      var cell = document.createElement('td');
      if (!revoked) {
        cell.appendChild(btn('Révoquer', function () { if (window.confirm('Révoquer la clé ' + k.prefix + ' ?')) { action('/v1/admin/keys/' + k.prefix + '/revoke', null, 'Clé révoquée.'); } }));
        cell.appendChild(document.createTextNode(' '));
      }
      var susp = k.account_status === 'active';
      cell.appendChild(btn(susp ? 'Suspendre le compte' : 'Réactiver le compte', function () {
        if (!susp || window.confirm('Suspendre ' + k.email + ' ?')) { action('/v1/admin/accounts', { email: k.email, status: susp ? 'suspended' : 'active' }, susp ? 'Compte suspendu.' : 'Compte réactivé.'); }
      }));
      tr.appendChild(cell);
      kb.appendChild(tr);
    });
  }

  function load() {
    if (!getToken()) { $('board').hidden = true; $('login').hidden = false; return; }
    Promise.all([api('/v1/admin/overview'), api('/v1/admin/requests'), api('/v1/admin/keys')]).then(function (rs) {
      if (rs[0].status !== 200) {
        if (rs[0].status === 401) { setToken(''); }
        $('board').hidden = true;
        $('login').hidden = false;
        note((rs[0].body.error && rs[0].body.error.message) || 'Accès refusé.', false);
        return;
      }
      $('login').hidden = true;
      $('board').hidden = false;
      renderOverview(rs[0].body.data);
      renderRequests(rs[1].body.data.requests);
      renderKeys(rs[2].body.data.keys);
    }).catch(function () { note('Impossible de joindre le service.', false); });
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    setToken($('token').value.trim());
    $('token').value = '';
    note('');
    load();
  });
  $('logout').addEventListener('click', function () { setToken(''); note(''); load(); });
  $('refresh').addEventListener('click', function () { note(''); load(); });
  load();
})();
