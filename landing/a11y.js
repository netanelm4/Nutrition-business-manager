/* ═══════════════════════════════════════════════════════════════════════
   נתא · Accessibility widget ("הגדרות נגישות") + cookie settings ("הגדרות עוגיות")
   Load in <head> (not deferred) so saved settings apply before first paint.
   Storage (browser only, never sent to the server):
     nt-a11y    : { scale, contrast: null|'dark'|'light'|'gray', links, font, cursor, still }
     nt-consent : { essential: true, stats: bool, savedAt }
   Other scripts can read window.ntConsent.get() and listen for the 'nt-consent' event
   before loading any statistics tool.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var A11Y_KEY = 'nt-a11y';
  var CONSENT_KEY = 'nt-consent';
  var SCALE_MIN = 100, SCALE_MAX = 150, SCALE_STEP = 10;
  var BASE = new URL('.', (document.currentScript && document.currentScript.src) || location.href).pathname;
  var root = document.documentElement;

  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function clear(key) { try { localStorage.removeItem(key); } catch (e) {} }

  var DEFAULTS = { scale: 100, contrast: null, links: false, font: false, cursor: false, still: false };
  var state = Object.assign({}, DEFAULTS, read(A11Y_KEY) || {});

  /* ── Apply settings to <html> (runs immediately, before the page paints) ── */
  function apply() {
    if (state.scale > SCALE_MIN) { root.setAttribute('data-a11y-zoom', ''); root.style.setProperty('--a11y-zoom', String(state.scale / 100)); }
    else { root.removeAttribute('data-a11y-zoom'); root.style.removeProperty('--a11y-zoom'); }
    root.classList.toggle('a11y-dark', state.contrast === 'dark');
    root.classList.toggle('a11y-light', state.contrast === 'light');
    root.classList.toggle('a11y-gray', state.contrast === 'gray');
    root.classList.toggle('a11y-links', !!state.links);
    root.classList.toggle('a11y-font', !!state.font);
    root.classList.toggle('a11y-cursor', !!state.cursor);
    root.classList.toggle('a11y-still', !!state.still);
    if (state.still) {
      root.classList.remove('motion-ready');         // the landing page skips its intro and entrance motion
      document.querySelectorAll('video').forEach(function (v) { if (!v.controls) v.pause(); });
    }
  }
  apply();

  // Autoplaying decorative videos stay paused while animations are stopped (user-started players are allowed).
  document.addEventListener('play', function (e) {
    if (state.still && e.target.tagName === 'VIDEO' && !e.target.controls) e.target.pause();
  }, true);

  function save() { write(A11Y_KEY, state); apply(); render(); }

  /* ── Consent API ──────────────────────────────────────────────────── */
  window.ntConsent = {
    get: function () { return read(CONSENT_KEY); },
    open: function () { openCookies(); }
  };

  /* ── UI ───────────────────────────────────────────────────────────── */
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="4" r="2" fill="currentColor"/><path d="M4 8.5l8 1.5 8-1.5M12 10v5m0 0l-3.5 6.5M12 15l3.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLOSE = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  var TOGGLES = {
    contrast: [
      { key: 'dark', label: 'ניגודיות כהה' },
      { key: 'light', label: 'ניגודיות בהירה' },
      { key: 'gray', label: 'גווני אפור' }
    ],
    reading: [
      { key: 'links', label: 'הדגשת קישורים' },
      { key: 'font', label: 'גופן קריא' },
      { key: 'cursor', label: 'סמן עכבר גדול' },
      { key: 'still', label: 'עצירת אנימציות' }
    ]
  };

  function toggleHtml(group, t) {
    return '<button type="button" class="a11y-toggle" aria-pressed="false" data-' + group + '="' + t.key + '">' +
      '<span>' + t.label + '</span><span class="a11y-badge" aria-hidden="true">כבוי</span></button>';
  }

  var fab, panel, card, statsSwitch;

  function build() {
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'a11y-ui a11y-fab';
    fab.setAttribute('aria-label', 'הגדרות נגישות');
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.setAttribute('aria-controls', 'a11y-panel');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = ICON;

    panel = document.createElement('dialog');
    panel.id = 'a11y-panel';
    panel.className = 'a11y-ui a11y-panel';
    panel.setAttribute('aria-labelledby', 'a11y-title');
    panel.innerHTML =
      '<div class="a11y-panel__inner">' +
        '<div class="a11y-panel__head"><h2 id="a11y-title">הגדרות נגישות</h2>' +
          '<button type="button" class="a11y-x" aria-label="סגירת הגדרות הנגישות" data-a11y-close>' + CLOSE + '</button></div>' +
        '<div class="a11y-panel__body">' +
          '<section class="a11y-group" aria-labelledby="a11y-g1"><h3 id="a11y-g1">גודל טקסט</h3>' +
            '<div class="a11y-size">' +
              '<button type="button" aria-label="הקטנת טקסט" data-scale="-1">א-</button>' +
              '<output aria-live="polite" aria-label="גודל טקסט נוכחי" data-scale-out>100%</output>' +
              '<button type="button" aria-label="הגדלת טקסט" data-scale="1">א+</button>' +
            '</div></section>' +
          '<section class="a11y-group" aria-labelledby="a11y-g2"><h3 id="a11y-g2">צבע וניגודיות</h3>' +
            TOGGLES.contrast.map(function (t) { return toggleHtml('contrast', t); }).join('') + '</section>' +
          '<section class="a11y-group" aria-labelledby="a11y-g3"><h3 id="a11y-g3">עזרי קריאה</h3>' +
            TOGGLES.reading.map(function (t) { return toggleHtml('flag', t); }).join('') + '</section>' +
        '</div>' +
        '<div class="a11y-panel__foot">' +
          '<a href="' + BASE + 'accessibility/">הצהרת נגישות <span aria-hidden="true">↗</span></a>' +
          '<button type="button" class="a11y-reset" data-a11y-reset>איפוס הגדרות</button>' +
        '</div>' +
      '</div>';

    card = document.createElement('section');
    card.className = 'a11y-ui ck-card';
    card.hidden = true;
    card.tabIndex = -1;
    card.setAttribute('aria-labelledby', 'ck-title');
    card.innerHTML =
      '<h2 id="ck-title">הגדרות עוגיות</h2>' +
      '<p>האתר משתמש בעוגיות כדי לעבוד טוב יותר ולהעניק לך חוויה מותאמת.</p>' +
      '<div class="ck-row"><div><b id="ck-ess">עוגיות חיוניות</b><small>תמיד פעילות, בלעדיהן האתר לא עובד</small></div>' +
        '<button type="button" class="ck-switch" role="switch" aria-checked="true" aria-disabled="true" aria-labelledby="ck-ess"></button></div>' +
      '<div class="ck-row"><div><b id="ck-stats">עוגיות סטטיסטיקה</b><small>עוזרות להבין איך משתמשים באתר, בלי לזהות אתכם אישית</small></div>' +
        '<button type="button" class="ck-switch" role="switch" aria-checked="false" aria-labelledby="ck-stats" data-ck-stats></button></div>' +
      '<div class="ck-actions"><a href="' + BASE + 'privacy/#cookies">מדיניות פרטיות</a>' +
        '<button type="button" class="ck-save" data-ck-save>שמירת הבחירה</button></div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    document.body.appendChild(card);
    statsSwitch = card.querySelector('[data-ck-stats]');

    fab.addEventListener('click', openPanel);
    panel.addEventListener('close', function () { fab.setAttribute('aria-expanded', 'false'); fab.focus(); });
    panel.addEventListener('click', function (e) {
      if (e.target === panel) { panel.close(); return; }        // click on the backdrop
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-a11y-close')) panel.close();
      else if (b.hasAttribute('data-a11y-reset')) { state = Object.assign({}, DEFAULTS); clear(A11Y_KEY); apply(); render(); }
      else if (b.hasAttribute('data-scale')) {
        var next = state.scale + Number(b.getAttribute('data-scale')) * SCALE_STEP;
        state.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, next)); save();
      } else if (b.hasAttribute('data-contrast')) {
        var c = b.getAttribute('data-contrast');
        state.contrast = state.contrast === c ? null : c; save();  // the three modes are mutually exclusive
      } else if (b.hasAttribute('data-flag')) {
        var f = b.getAttribute('data-flag'); state[f] = !state[f]; save();
      }
    });

    statsSwitch.addEventListener('click', function () {
      statsSwitch.setAttribute('aria-checked', statsSwitch.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });
    card.querySelector('[data-ck-save]').addEventListener('click', saveCookies);
    card.addEventListener('keydown', function (e) { if (e.key === 'Escape' && read(CONSENT_KEY)) closeCookies(); });

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-cookie-settings]');
      if (t) { e.preventDefault(); openCookies(); }
    });

    window.addEventListener('resize', liftFab);
    render();
    if (!read(CONSENT_KEY)) openCookies(true);
  }

  function render() {
    if (!panel) return;
    panel.querySelector('[data-scale-out]').textContent = state.scale + '%';
    panel.querySelector('[data-scale="-1"]').disabled = state.scale <= SCALE_MIN;
    panel.querySelector('[data-scale="1"]').disabled = state.scale >= SCALE_MAX;
    panel.querySelectorAll('[data-contrast]').forEach(function (b) { setPressed(b, state.contrast === b.getAttribute('data-contrast')); });
    panel.querySelectorAll('[data-flag]').forEach(function (b) { setPressed(b, !!state[b.getAttribute('data-flag')]); });
  }

  function setPressed(b, on) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.querySelector('.a11y-badge').textContent = on ? 'פעיל' : 'כבוי';
  }

  function openPanel() {
    if (panel.open) return;
    panel.showModal();
    fab.setAttribute('aria-expanded', 'true');
    panel.querySelector('[data-a11y-close]').focus();
  }

  /* ── Cookies ──────────────────────────────────────────────────────── */
  function openCookies(firstVisit) {
    var c = read(CONSENT_KEY);
    statsSwitch.setAttribute('aria-checked', c && c.stats ? 'true' : 'false');
    card.hidden = false;
    liftFab();
    if (!firstVisit) card.focus();
  }

  function closeCookies() { card.hidden = true; liftFab(); }

  function saveCookies() {
    var consent = { essential: true, stats: statsSwitch.getAttribute('aria-checked') === 'true', savedAt: new Date().toISOString() };
    write(CONSENT_KEY, consent);
    closeCookies();
    try { document.dispatchEvent(new CustomEvent('nt-consent', { detail: consent })); } catch (e) {}
  }

  // Keep the accessibility button above the cookie card on small screens.
  function liftFab() {
    if (!fab) return;
    var overlaps = !card.hidden && card.getBoundingClientRect().left < 16 + 54 + 8;
    var lift = overlaps ? card.offsetHeight + 8 : 0;
    fab.style.setProperty('--a11y-lift', lift + 'px');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
