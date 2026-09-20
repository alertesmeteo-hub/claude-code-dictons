(function () {
  var LABELS = { vigilance: 'Vigilance', extremes: 'Températures extrêmes', records: 'Records du jour', rain: 'Pluie' };
  var globalEl = document.getElementById('global');
  var rows = document.getElementById('rows');

  function cell(text, cls) {
    var td = document.createElement('td');
    if (cls) {
      var s = document.createElement('span');
      s.className = 'pill ' + cls;
      s.textContent = text;
      td.appendChild(s);
    } else {
      td.textContent = text;
    }
    return td;
  }

  function render(status) {
    rows.textContent = '';
    var sources = (status.data && status.data.sources) || {};
    Object.keys(LABELS).forEach(function (key) {
      var s = sources[key];
      if (!s) { return; }
      var tr = document.createElement('tr');
      tr.appendChild(cell(LABELS[key]));
      tr.appendChild(s.stale ? cell('En retard', 'warn') : cell('À jour', 'ok'));
      tr.appendChild(cell(s.last_success_at ? new Date(s.last_success_at).toLocaleString('fr-FR') : 'Aucune donnée'));
      rows.appendChild(tr);
    });
    var ok = status.data.status === 'ok';
    globalEl.textContent = ok ? 'Tous les systèmes fonctionnent normalement.' : 'Service dégradé : au moins une source est en retard.';
  }

  function refresh() {
    fetch('/v1/status')
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        rows.textContent = '';
        globalEl.textContent = 'API injoignable pour le moment.';
      });
  }

  refresh();
  setInterval(refresh, 60000);
})();
