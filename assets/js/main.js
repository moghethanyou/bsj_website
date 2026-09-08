// Shared behavior across all BSJ site pages
(function () {
  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var navbar = document.querySelector('.navbar');
  if (toggle && navbar) {
    toggle.addEventListener('click', function () {
      navbar.classList.toggle('open');
    });
  }

  // Theme toggle (light by default, persists via localStorage)
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var themeBtn = document.querySelector('.theme-toggle');
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
  function paintThemeBtn() {
    if (!themeBtn) return;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.innerHTML = isDark ? ICON_SUN : ICON_MOON;
    themeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  try {
    var saved = localStorage.getItem('bsj-theme');
    if (saved === 'dark') applyTheme('dark');
  } catch (e) {}
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('bsj-theme', next); } catch (e) {}
      paintThemeBtn();
    });
    paintThemeBtn();
  }

  // Scroll reveal. IntersectionObserver is the primary mechanism, but a fast/instant
  // scroll (browser back-forward restore, a jump-to-anchor, or a headless test driver
  // teleporting scrollY without an intermediate rendered frame) can skip an element's
  // viewport transit entirely and leave it observed-but-never-triggered — i.e. permanently
  // invisible. The manual rAF-throttled scroll/resize check below is a cheap backstop that
  // catches anything IntersectionObserver missed.
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0, rootMargin: '0px 0px -5% 0px' });
      revealEls.forEach(function (el) { io.observe(el); });
    }

    var pending = Array.prototype.slice.call(revealEls);
    var ticking = false;
    function sweepReveal() {
      ticking = false;
      var vh = window.innerHeight;
      pending = pending.filter(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) {
          el.classList.add('in-view');
          return false;
        }
        return true;
      });
      if (!pending.length) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      }
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(sweepReveal); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    sweepReveal();
  }

  // Contact form — submits to Formspree via fetch so we can show our own success message
  // instead of redirecting to Formspree's generic confirmation page.
  var form = document.querySelector('#contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      var action = form.getAttribute('action') || '';
      var success = document.querySelector('#form-success');
      var error = document.querySelector('#form-error');
      if (action.indexOf('formspree.io') === -1) {
        // No live endpoint configured — fall back to a local-only confirmation.
        e.preventDefault();
        if (success) { success.style.display = 'block'; success.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        form.reset();
        return;
      }
      e.preventDefault();
      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
      if (error) error.style.display = 'none';
      fetch(action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          if (res.ok) {
            if (success) { success.style.display = 'block'; success.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            form.reset();
          } else {
            if (error) error.style.display = 'block';
          }
        })
        .catch(function () {
          if (error) error.style.display = 'block';
        })
        .finally(function () {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Message'; }
        });
    });
  }
})();
