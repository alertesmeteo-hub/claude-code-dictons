(function () {
  var KEY = 'am_dashboard_key';
  var $ = function (id) { return document.getElementById(id); };

  function getKey() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setKey(v) { try { if (v) { sessionStorage.setItem(KEY, v); } else { sessionStorage.removeItem(KEY); } } catch (e) { /* stockage indisponible */ } }

  function api(path, method) {
    return fetch(path, { method: method || 'GET', headers: { 'X-API-Key': getKey() } })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  function fmt(n) { return Number(n).toLocaleString('fr-FR'); }

  function showLogin(message) {
    $('board').hidden = true;
    $('login').hidden = false;
    var m = $('loginMsg');
    m.hidden = !message;
    m.textContent = message || '';
  }

  function render(d) {
    $('login').hidden = true;
    $('loginMsg').hidden = true;
    $('board').hidden = false;
    $('who').textContent = 'Clé ' + d.key_prefix + '… · offre ' + d.plan;
    $('monthUsed').textContent = fmt(d.used.month);
    $('monthLimit').textContent = 'sur ' + fmt(d.limits.per_month);
    $('monthLeft').textContent = fmt(Math.max(0, d.limits.per_month - d.used.month));
    $('monthBar').style.width = Math.min(100, (d.used.month / d.limits.per_month) * 100) + '%';
    $('minuteUsed').textContent = fmt(d.used.minute);
    $('minuteLimit').textContent = 'sur ' + fmt(d.limits.per_minute) + ' par minute';
    $('expires').textContent = new Date(d.expires_at).toLocaleDateString('fr-FR');

    var chart = $('chart');
    chart.textContent = '';
    var max = 1;
    d.days.forEach(function (day) { if (day.total > max) { max = day.total; } });
    d.days.slice().reverse().forEach(function (day) {
      var bar = document.createElement('div');
      bar.style.height = Math.max(2, (day.total / max) * 100) + '%';
      bar.title = day.day + ' : ' + fmt(day.total) + ' requêtes';
      chart.appendChild(bar);
    });
    $('chartNote').textContent = d.days.length ? '' : 'Aucune requête enregistrée pour le moment.';

    var totals = {};
    d.days.forEach(function (day) {
      Object.keys(day.endpoints).forEach(function (e) { totals[e] = (totals[e] || 0) + day.endpoints[e]; });
    });
    var tbody = $('endpoints');
    tbody.textContent = '';
    Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }).forEach(function (e) {
      var tr = document.createElement('tr');
      var a = document.createElement('td');
      a.textContent = '/v1/' + e;
      var b = document.createElement('td');
      b.textContent = fmt(totals[e]);
      tr.appendChild(a);
      tr.appendChild(b);
      tbody.appendChild(tr);
    });
  }

  function load() {
    if (!getKey()) { showLogin(); return; }
    api('/v1/usage').then(function (r) {
      if (r.status === 200) { render(r.body.data); return; }
      setKey('');
      showLogin((r.body && r.body.error && r.body.error.message) || 'Clé refusée.');
    }).catch(function () { showLogin('Impossible de joindre le service.'); });
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    setKey($('key').value.trim());
    $('key').value = '';
    load();
  });
  $('logout').addEventListener('click', function () { setKey(''); showLogin(); });
  $('revoke').addEventListener('click', function () {
    if (!window.confirm('Révoquer cette clé ? Elle cessera immédiatement de fonctionner.')) { return; }
    api('/v1/keys', 'DELETE').then(function (r) {
      var m = $('revokeMsg');
      m.hidden = false;
      if (r.status === 200) {
        m.className = 'msg ok';
        m.textContent = 'Clé révoquée.';
        setKey('');
        setTimeout(function () { showLogin('Clé révoquée.'); }, 1500);
      } else {
        m.className = 'msg err';
        m.textContent = (r.body && r.body.error && r.body.error.message) || 'Échec de la révocation.';
      }
    });
  });

  load();
})();
