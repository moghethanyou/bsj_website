/* Shared behaviour across BSJ pages: navigation, theme, footer year, scroll reveal. */
(function () {
  'use strict';

  /* ---------------------------------------------------------- navigation */
  var toggle = document.querySelector('.nav-toggle');
  var navbar = document.querySelector('.navbar');
  if (toggle && navbar) {
    toggle.addEventListener('click', function () {
      var open = navbar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* --------------------------------------------------------------- theme */
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

  function applyTheme(theme) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }

  try {
    if (localStorage.getItem('bsj-theme') === 'dark') applyTheme('dark');
  } catch (error) { /* storage unavailable */ }

  var themeButton = document.querySelector('.theme-toggle');
  if (themeButton) {
    var paint = function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      themeButton.innerHTML = dark ? ICON_SUN : ICON_MOON;
      themeButton.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    };
    themeButton.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('bsj-theme', next); } catch (error) { /* storage unavailable */ }
      paint();
    });
    paint();
  }

  /* --------------------------------------------------------- footer year */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* -------------------------------------------------------- scroll reveal
     IntersectionObserver is the primary mechanism, but a fast or instant scroll
     (back-forward restore, a jump to an anchor, a headless driver moving scrollY
     without an intermediate frame) can skip an element's viewport transit and
     leave it observed but never triggered — permanently invisible. The
     rAF-throttled sweep below catches anything the observer missed. */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0, rootMargin: '0px 0px -5% 0px' });
      revealEls.forEach(function (element) { observer.observe(element); });
    }

    var pending = Array.prototype.slice.call(revealEls);
    var ticking = false;

    function sweep() {
      ticking = false;
      var height = window.innerHeight;
      pending = pending.filter(function (element) {
        var box = element.getBoundingClientRect();
        if (box.top < height && box.bottom > 0) {
          element.classList.add('in-view');
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
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(sweep);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    sweep();
  }
})();
