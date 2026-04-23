(function () {
  'use strict';

  function serialize(form) {
    var data = {};
    var fd = new FormData(form);
    fd.forEach(function (v, k) {
      data[k] = v;
    });
    data.tc_accepted = !!(form.querySelector('input[name="tc_accepted"]') || {}).checked;
    data._source = location.pathname || '/';
    var fs = form.getAttribute('data-form-secret');
    if (fs) data._secret = fs;
    return data;
  }

  function setState(form, state) {
    var wrap = form.closest('.w-form') || form.parentNode;
    if (!wrap) return;
    var done = wrap.querySelector('.w-form-done');
    var fail = wrap.querySelector('.w-form-fail');
    if (state === 'success') {
      form.style.display = 'none';
      if (done) done.style.display = 'block';
      if (fail) fail.style.display = 'none';
    } else if (state === 'error') {
      if (done) done.style.display = 'none';
      if (fail) fail.style.display = 'block';
    } else {
      if (done) done.style.display = 'none';
      if (fail) fail.style.display = 'none';
    }
  }

  function setSubmitLoading(form, loading) {
    var btn = form.querySelector('input[type="submit"], button[type="submit"]');
    if (!btn) return;
    if (loading) {
      btn.dataset._value = btn.value || btn.textContent;
      if (btn.tagName === 'INPUT') {
        btn.value = btn.getAttribute('data-wait') || 'Se încarcă...';
      } else {
        btn.textContent = btn.getAttribute('data-wait') || 'Se încarcă...';
      }
      btn.disabled = true;
    } else {
      if (btn.dataset._value) {
        if (btn.tagName === 'INPUT') btn.value = btn.dataset._value;
        else btn.textContent = btn.dataset._value;
      }
      btn.disabled = false;
    }
  }

  function showInlineError(form, msg) {
    var wrap = form.closest('.w-form') || form.parentNode;
    var fail = wrap && wrap.querySelector('.w-form-fail');
    if (fail) {
      var div = fail.querySelector('div');
      if (div) div.textContent = msg || div.textContent;
      fail.style.display = 'block';
    }
  }

  function handle(form) {
    form.setAttribute('data-intercepted', '1');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopPropagation();

      var tc = form.querySelector('input[name="tc_accepted"]');
      if (tc && !tc.checked) {
        showInlineError(form, 'Te rog să accepți Termenii și Condițiile pentru a continua.');
        setState(form, 'error');
        if (tc.focus) tc.focus();
        return;
      }

      var payload = serialize(form);
      setState(form, 'idle');
      setSubmitLoading(form, true);

      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, body: j };
          });
        })
        .then(function (res) {
          setSubmitLoading(form, false);
          if (res.ok && res.body && res.body.ok) {
            setState(form, 'success');
            try { form.reset(); } catch (_) {}
          } else {
            var msg = (res.body && res.body.error) || 'A apărut o eroare. Încearcă din nou.';
            showInlineError(form, msg);
            setState(form, 'error');
          }
        })
        .catch(function () {
          setSubmitLoading(form, false);
          showInlineError(form, 'Conexiune întreruptă. Verifică internetul și reîncearcă.');
          setState(form, 'error');
        });
    }, true);
  }

  function init() {
    var forms = document.querySelectorAll('form#email-form, form[data-name="Email Form"]');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].getAttribute('data-intercepted')) continue;
      if (!forms[i].querySelector('input[name="First-name"]')) continue;
      handle(forms[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
