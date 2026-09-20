(function () {
  var form = document.getElementById('form');
  var result = document.getElementById('result');
  var button = document.getElementById('submit');

  function show(text, ok) {
    result.hidden = false;
    result.className = 'msg ' + (ok ? 'ok' : 'err');
    result.textContent = text;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      organization: form.organization.value.trim(),
      website: form.website.value.trim(),
      usage: form.usage.value.trim(),
      hp: form.hp.value,
      consent: form.consent.checked
    };
    button.disabled = true;
    fetch('/v1/keys/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (r) {
        if (r.status === 202) {
          form.hidden = true;
          show('Demande reçue. La clé vous sera envoyée par email après validation manuelle.', true);
        } else {
          show((r.body && r.body.error && r.body.error.message) || 'Une erreur est survenue.', false);
          button.disabled = false;
        }
      })
      .catch(function () {
        show('Impossible de joindre le service. Réessayez plus tard.', false);
        button.disabled = false;
      });
  });
})();
