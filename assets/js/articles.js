(function () {
  'use strict';
  var DATA_URL = 'assets/data/articles.json';
  var YT_EMBED_RE = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//i;

  function requestArchive() {
    return fetch(DATA_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('Archive data could not be loaded.');
        return response.json();
      })
      .then(function (posts) {
        return posts
          .filter(function (post) { return post && post.slug && post.title; })
          .sort(function (a, b) { return new Date(b.date.replace(' ', 'T')) - new Date(a.date.replace(' ', 'T')); });
      });
  }

  function plainText(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('br').forEach(function (br) { br.replaceWith(' '); });
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function excerpt(post) {
    var copy = (post.excerpt || '').trim() || plainText(post.content_html);
    return copy.length > 200 ? copy.slice(0, 197).replace(/\s+\S*$/, '') + '…' : copy;
  }

  function formatDate(value) {
    var date = new Date(value.replace(' ', 'T'));
    return isNaN(date) ? '' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function escapeHtml(value) {
    var element = document.createElement('div');
    element.textContent = value || '';
    return element.innerHTML;
  }

  function fallbackOnError(img) {
    img.addEventListener('error', function () {
      var figure = img.closest('figure');
      var card = img.closest('.article-card');
      if (figure) figure.remove();
      else if (card) { card.querySelector('.article-card-image').remove(); card.classList.remove('has-image'); }
      else img.remove();
    });
  }

  function firstImageSrc(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    var image = doc.querySelector('img[src]');
    return image ? image.getAttribute('src') : null;
  }

  function articleCard(post) {
    var card = document.createElement('a');
    var imageSrc = firstImageSrc(post.content_html);
    card.className = 'article-card' + (imageSrc ? ' has-image' : '');
    card.href = 'article.html?slug=' + encodeURIComponent(post.slug);
    if (imageSrc) {
      var visual = document.createElement('div');
      visual.className = 'article-card-image';
      var image = document.createElement('img');
      image.src = imageSrc;
      image.alt = '';
      image.loading = 'lazy';
      fallbackOnError(image);
      visual.appendChild(image);
      card.appendChild(visual);
    }
    var body = document.createElement('div');
    body.className = 'article-card-body';
    body.innerHTML = '<div class="article-card-meta">' + formatDate(post.date) + '</div>' +
      '<h2>' + escapeHtml(post.title) + '</h2>' +
      '<p>' + escapeHtml(excerpt(post)) + '</p>' +
      '<span class="article-card-link">Read article <span aria-hidden="true">→</span></span>';
    card.appendChild(body);
    return card;
  }

  function renderArchive(posts) {
    var grid = document.getElementById('article-grid');
    if (!grid) return;
    var search = document.getElementById('article-search');
    var count = document.getElementById('article-count');
    var empty = document.getElementById('article-empty');
    var more = document.getElementById('article-more');
    var pageSize = 24;
    var shown = pageSize;

    function render() {
      var query = (search.value || '').trim().toLowerCase();
      var matches = posts.filter(function (post) {
        return !query || (post.title + ' ' + excerpt(post) + ' ' + post.date).toLowerCase().indexOf(query) !== -1;
      });
      grid.innerHTML = '';
      matches.slice(0, shown).forEach(function (post) { grid.appendChild(articleCard(post)); });
      count.textContent = matches.length + (matches.length === 1 ? ' article' : ' articles');
      empty.style.display = matches.length ? 'none' : 'block';
      more.hidden = shown >= matches.length;
    }

    search.addEventListener('input', function () { shown = pageSize; render(); });
    more.addEventListener('click', function () { shown += pageSize; render(); });
    render();
  }

  function sanitizeArticle(html) {
    var parsed = new DOMParser().parseFromString(html || '', 'text/html');
    parsed.querySelectorAll('script, style, object, embed, form, input, button, link, meta').forEach(function (node) { node.remove(); });
    parsed.querySelectorAll('iframe').forEach(function (node) {
      if (!YT_EMBED_RE.test(node.getAttribute('src') || '')) node.remove();
    });
    parsed.querySelectorAll('*').forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attribute) {
        var name = attribute.name.toLowerCase();
        if (name.indexOf('on') === 0 || name === 'style' || name === 'srcset') node.removeAttribute(attribute.name);
      });
    });
    parsed.querySelectorAll('img').forEach(function (image) {
      var source = image.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(source) && source.indexOf('assets/') !== 0) { image.remove(); return; }
      image.src = source.replace(/^http:\/\//i, 'https://');
      image.loading = 'lazy';
      if (!image.alt) image.alt = '';
      fallbackOnError(image);
    });
    parsed.querySelectorAll('a').forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href)) link.removeAttribute('href');
      else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    });
    parsed.querySelectorAll('p').forEach(function (paragraph) {
      if (!paragraph.textContent.trim() && !paragraph.querySelector('img, figure, iframe')) paragraph.remove();
    });
    return parsed.body.innerHTML.replace(/<!--[^]*?-->/g, '');
  }

  function renderArticle(posts) {
    var content = document.getElementById('article-content');
    if (!content) return;
    var slug = new URLSearchParams(window.location.search).get('slug');
    var post = posts.filter(function (item) { return item.slug === slug; })[0];
    var title = document.getElementById('article-title');
    var deck = document.getElementById('article-deck');
    var date = document.getElementById('article-date');
    if (!post) {
      title.textContent = 'Article not found';
      content.innerHTML = '<p>That article is not in the archive. <a href="journals.html?view=articles">Return to all articles.</a></p>';
      return;
    }
    document.title = post.title + ' | Berkeley Scientific Journal';
    title.textContent = post.title;
    deck.textContent = excerpt(post);
    date.textContent = formatDate(post.date);
    content.innerHTML = sanitizeArticle(post.content_html);
  }

  function renderPreview(posts) {
    var preview = document.getElementById('article-preview');
    if (!preview) return;
    preview.innerHTML = '';
    posts.slice(0, 3).forEach(function (post) { preview.appendChild(articleCard(post)); });
  }

  requestArchive().then(function (posts) {
    renderArchive(posts);
    renderArticle(posts);
    renderPreview(posts);
  }).catch(function () {
    document.querySelectorAll('.article-loading').forEach(function (target) { target.textContent = 'The article archive is temporarily unavailable.'; });
  });
})();
