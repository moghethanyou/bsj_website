(function () {
  'use strict';

  var LOCAL_DATA_URL = 'assets/data/articles.json';
  var WORDPRESS_API_ROOT = 'https://bsj.studentorg.berkeley.edu/wp-json/wp/v2';
  var WORDPRESS_ORIGIN = 'https://bsj.studentorg.berkeley.edu';
  var ARCHIVE_PAGE_SIZE = 18;
  var REQUEST_TIMEOUT = 6000;
  var lastFigureTrigger = null;

  function wordpressEnabled() {
    var host = window.location.hostname;
    return Boolean(host) && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  }

  function fetchJson(url) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT) : null;
    var options = { headers: { Accept: 'application/json' } };
    if (controller) options.signal = controller.signal;
    return fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error('Request failed with status ' + response.status);
      return response.json();
    }).finally(function () {
      if (timer) window.clearTimeout(timer);
    });
  }

  function fetchJsonResponse(url) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT) : null;
    var options = { headers: { Accept: 'application/json' } };
    if (controller) options.signal = controller.signal;
    return fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error('Request failed with status ' + response.status);
      return response.json().then(function (data) { return { data: data, response: response }; });
    }).finally(function () {
      if (timer) window.clearTimeout(timer);
    });
  }

  function cleanInvisibleText(value) {
    return String(value || '')
      .replace(/([\p{L}\p{N}])\u00ad[ \t]+(?=[\p{L}\p{N}])/gu, '$1')
      .replace(/\u00ad/g, '')
      .replace(/([A-Za-z0-9])[\u200B\u200C\u2060]+(?=[A-Za-z0-9])/g, '$1')
      .replace(/[\u200B\u200C\u2060]+/g, ' ');
  }

  function plainText(html) {
    var documentFragment = new DOMParser().parseFromString(html || '', 'text/html');
    documentFragment.querySelectorAll('br').forEach(function (lineBreak) { lineBreak.replaceWith(' '); });
    return cleanInvisibleText(documentFragment.body.textContent).replace(/\s+/g, ' ').trim();
  }

  function truncate(value, limit) {
    var copy = (value || '').replace(/\s+/g, ' ').trim();
    if (copy.length <= limit) return copy;
    return copy.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
  }

  function articleText(post) {
    if (typeof post._plainText === 'string') return post._plainText;
    post._plainText = plainText(post.content_html);
    return post._plainText;
  }

  function excerpt(post, limit) {
    return truncate((post.excerpt || '').trim() || articleText(post), limit || 185);
  }

  function parseDate(value) {
    if (!value) return null;
    var date = new Date(String(value).replace(' ', 'T'));
    return isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    var date = parseDate(value);
    return date ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  }

  function yearOf(post) {
    var date = parseDate(post.date);
    return date ? String(date.getFullYear()) : '';
  }

  function readingTime(post) {
    var words = articleText(post).match(/[\w’'-]+/g) || [];
    return Math.max(1, Math.round(words.length / 225));
  }

  function normalizeSource(value) {
    var source = String(value || '').replace(/[\u00ad\u200B\u200C\u2060]/g, '').trim();
    if (!source) return '';
    if (source.indexOf('./assets/') === 0) source = source.slice(2);
    if (source.indexOf('assets/') === 0) return source;
    if (source.indexOf('//') === 0) source = 'https:' + source;
    if (source.charAt(0) === '/') return WORDPRESS_ORIGIN + source;
    try {
      var url = new URL(source, WORDPRESS_ORIGIN);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.hostname === 'bsj.studentorg.berkeley.edu') url.protocol = 'https:';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function normalizeLink(value) {
    var href = String(value || '').replace(/[\u00ad\u200B\u200C\u2060]/g, '').trim();
    if (!href) return '';
    if (href.charAt(0) === '#') return href;
    if (href.indexOf('./assets/') === 0) return href.slice(2);
    if (href.indexOf('assets/') === 0) return href;
    if (/^mailto:/i.test(href)) return href;
    if (href.indexOf('//') === 0) href = 'https:' + href;
    if (href.charAt(0) === '/') href = WORDPRESS_ORIGIN + href;
    try {
      var url = new URL(href, WORDPRESS_ORIGIN);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.hostname === 'bsj.studentorg.berkeley.edu') url.protocol = 'https:';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function firstImage(post) {
    if (Object.prototype.hasOwnProperty.call(post, '_cardImage')) return post._cardImage;
    if (post.featured_image && post.featured_image.src) {
      var featuredSource = normalizeSource(post.featured_image.src);
      if (featuredSource) {
        post._cardImage = {
          src: featuredSource,
          alt: post.featured_image.alt || '',
          featured: true
        };
        return post._cardImage;
      }
    }
    var parsed = new DOMParser().parseFromString(post.content_html || '', 'text/html');
    var images = Array.prototype.slice.call(parsed.querySelectorAll('img[src]'));
    var selected = images.filter(function (image) {
      var width = Number(image.getAttribute('width') || 0);
      var height = Number(image.getAttribute('height') || 0);
      return !width || !height || width >= 240 || height >= 180;
    })[0] || images[0];
    if (!selected) {
      post._cardImage = null;
      return null;
    }
    var source = normalizeSource(selected.getAttribute('src'));
    post._cardImage = source ? { src: source, alt: selected.getAttribute('alt') || '', featured: false } : null;
    return post._cardImage;
  }

  function usefulCategory(categories) {
    var names = categories || [];
    var match = names.find(function (name) { return /interview/i.test(name); });
    if (match) return 'Interviews';
    match = names.find(function (name) { return /feature/i.test(name); });
    if (match) return 'Features';
    match = names.find(function (name) { return /blog|research/i.test(name); });
    if (match) return 'Research & Blogs';
    match = names.find(function (name) {
      return !/^\d{4}$/.test(name) && !/^(featured|recent|uncategorized|fall|spring)/i.test(name);
    });
    return match || 'Article';
  }

  function normalizeLocalPost(post) {
    return {
      id: post.id,
      title: plainText(post.title),
      slug: post.slug,
      date: post.date,
      modified: post.modified || post.date,
      content_html: post.content_html || '',
      excerpt: plainText(post.excerpt || ''),
      author: (post.author || '').trim() || null,
      categories: Array.isArray(post.categories) ? post.categories : [],
      featured_image: post.featured_image || null,
      source_link: post.source_link || '',
      source: 'archive'
    };
  }

  function wordpressAuthor(post) {
    var candidates = [];
    if (post.acf) candidates.push(post.acf.author, post.acf.byline, post.acf.writer);
    if (post.meta) candidates.push(post.meta.author, post.meta.byline, post.meta.writer);
    var embedded = post._embedded || {};
    if (embedded.author && embedded.author[0]) candidates.push(embedded.author[0].name);
    var author = candidates.find(function (candidate) {
      return typeof candidate === 'string' && candidate.trim() && !/^(admin|bsj|berkeley scientific journal)$/i.test(candidate.trim());
    });
    return author ? plainText(author) : null;
  }

  function wordpressTerms(post) {
    var embedded = post._embedded || {};
    var groups = embedded['wp:term'] || [];
    var names = [];
    groups.forEach(function (group) {
      (group || []).forEach(function (term) {
        if (term && term.taxonomy === 'category' && term.name && names.indexOf(term.name) === -1) names.push(plainText(term.name));
      });
    });
    return names;
  }

  function wordpressFeaturedImage(post) {
    var embedded = post._embedded || {};
    var media = embedded['wp:featuredmedia'] && embedded['wp:featuredmedia'][0];
    if (!media) return null;
    var sizes = media.media_details && media.media_details.sizes;
    var preferred = sizes && (sizes.large || sizes.medium_large || sizes.full);
    var source = normalizeSource((preferred && preferred.source_url) || media.source_url || '');
    return source ? { src: source, alt: plainText(media.alt_text || media.caption && media.caption.rendered || '') } : null;
  }

  function normalizeWordPressPost(post) {
    return {
      id: post.id,
      title: plainText(post.title && post.title.rendered || ''),
      slug: post.slug,
      date: post.date,
      modified: post.modified || post.date,
      content_html: post.content && post.content.rendered || '',
      excerpt: plainText(post.excerpt && post.excerpt.rendered || ''),
      author: wordpressAuthor(post),
      categories: wordpressTerms(post),
      featured_image: wordpressFeaturedImage(post),
      source_link: normalizeLink(post.link || ''),
      source: 'wordpress'
    };
  }

  function validPosts(posts) {
    return (posts || []).filter(function (post) {
      return post && post.slug && post.title;
    }).sort(function (a, b) {
      var first = parseDate(a.date);
      var second = parseDate(b.date);
      return (second ? second.getTime() : 0) - (first ? first.getTime() : 0);
    });
  }

  function requestLocalArchive() {
    return fetchJson(LOCAL_DATA_URL).then(function (posts) {
      return validPosts(posts.map(normalizeLocalPost));
    });
  }

  function requestWordPressArchive() {
    var fields = 'id,date,modified,slug,link,title,excerpt,author,featured_media,categories,_links,_embedded';
    function pageUrl(page) {
      return WORDPRESS_API_ROOT + '/posts?per_page=100&page=' + page + '&orderby=date&order=desc&context=embed&_embed=1&_fields=' + encodeURIComponent(fields);
    }
    return fetchJsonResponse(pageUrl(1)).then(function (firstPage) {
      var totalPages = Math.min(Number(firstPage.response.headers.get('X-WP-TotalPages') || 1), 10);
      var requests = [];
      for (var page = 2; page <= totalPages; page++) requests.push(fetchJson(pageUrl(page)));
      return Promise.all(requests).then(function (remainingPages) {
        var posts = firstPage.data.concat.apply(firstPage.data, remainingPages);
        return validPosts(posts.map(normalizeWordPressPost));
      });
    });
  }

  function requestWordPressArticle(slug) {
    var query = '?slug=' + encodeURIComponent(slug) + '&_embed=1';
    return fetchJson(WORDPRESS_API_ROOT + '/posts' + query).then(function (posts) {
      return posts && posts[0] ? normalizeWordPressPost(posts[0]) : null;
    });
  }

  function mergePosts(localPosts, wordpressPosts) {
    var bySlug = new Map();
    localPosts.forEach(function (post) { bySlug.set(post.slug, post); });
    wordpressPosts.forEach(function (remotePost) {
      var localPost = bySlug.get(remotePost.slug);
      if (!localPost) {
        bySlug.set(remotePost.slug, remotePost);
        return;
      }
      bySlug.set(remotePost.slug, {
        id: remotePost.id || localPost.id,
        title: remotePost.title || localPost.title,
        slug: remotePost.slug,
        date: remotePost.date || localPost.date,
        modified: remotePost.modified || localPost.modified,
        content_html: remotePost.content_html || localPost.content_html,
        excerpt: remotePost.excerpt || localPost.excerpt,
        author: remotePost.author || localPost.author,
        categories: remotePost.categories.length ? remotePost.categories : localPost.categories,
        featured_image: remotePost.featured_image || localPost.featured_image,
        source_link: remotePost.source_link || localPost.source_link,
        source: 'wordpress'
      });
    });
    return validPosts(Array.from(bySlug.values()));
  }

  function createPlaceholder(container) {
    container.className = 'article-card-image article-card-placeholder';
    container.replaceChildren();
    var mark = document.createElement('span');
    mark.className = 'article-card-placeholder-mark';
    mark.textContent = 'BSJ';
    var line = document.createElement('span');
    line.textContent = 'Berkeley Scientific Journal';
    container.append(mark, line);
  }

  function articleCard(post, options) {
    options = options || {};
    var card = document.createElement('a');
    card.className = 'article-card';
    if (options.compact) card.classList.add('article-card-compact');
    card.href = 'article.html?slug=' + encodeURIComponent(post.slug);

    var visual = document.createElement('div');
    var category = document.createElement('span');
    category.className = 'article-card-category';
    category.textContent = usefulCategory(post.categories);
    var image = firstImage(post);
    if (image && image.src) {
      visual.className = 'article-card-image' + (image.featured ? ' article-card-image-featured' : ' article-card-image-figure');
      var imageElement = document.createElement('img');
      imageElement.src = image.src;
      imageElement.alt = image.featured ? image.alt : '';
      imageElement.loading = 'lazy';
      imageElement.decoding = 'async';
      imageElement.addEventListener('error', function () {
        createPlaceholder(visual);
        visual.appendChild(category);
      });
      visual.appendChild(imageElement);
    } else {
      createPlaceholder(visual);
    }
    visual.appendChild(category);
    card.appendChild(visual);

    var body = document.createElement('div');
    body.className = 'article-card-body';
    var meta = document.createElement('div');
    meta.className = 'article-card-meta';
    var date = document.createElement('time');
    date.textContent = formatDate(post.date);
    var parsedDate = parseDate(post.date);
    if (parsedDate) date.dateTime = parsedDate.toISOString();
    var duration = document.createElement('span');
    duration.textContent = readingTime(post) + ' min read';
    meta.append(date, duration);

    var title = document.createElement('h2');
    title.textContent = post.title;
    var summary = document.createElement('p');
    summary.textContent = excerpt(post, options.compact ? 130 : 170);
    var footer = document.createElement('div');
    footer.className = 'article-card-footer';
    var author = document.createElement('span');
    author.className = 'article-card-author';
    author.textContent = post.author ? 'By ' + post.author : 'Berkeley Scientific Journal';
    var arrow = document.createElement('span');
    arrow.className = 'article-card-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    footer.append(author, arrow);
    body.append(meta, title, summary, footer);
    card.appendChild(body);
    return card;
  }

  function normalizeSearch(value) {
    return (value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }

  function setupArchive(initialPosts) {
    var grid = document.getElementById('article-grid');
    if (!grid) return null;
    var form = document.getElementById('article-filter-form');
    var search = document.getElementById('article-search');
    var clear = document.getElementById('article-clear');
    var year = document.getElementById('article-year');
    var sort = document.getElementById('article-sort');
    var count = document.getElementById('article-count');
    var empty = document.getElementById('article-empty');
    var reset = document.getElementById('article-reset');
    var more = document.getElementById('article-more');
    var posts = initialPosts;
    var shown = ARCHIVE_PAGE_SIZE;
    var params = new URLSearchParams(window.location.search);

    search.value = params.get('q') || '';
    sort.value = params.get('sort') || 'newest';

    function populateYears() {
      var selected = year.value || params.get('year') || '';
      var years = Array.from(new Set(posts.map(yearOf).filter(Boolean))).sort(function (a, b) { return Number(b) - Number(a); });
      year.replaceChildren(new Option('All years', ''));
      years.forEach(function (value) { year.add(new Option(value, value)); });
      if (years.indexOf(selected) !== -1) year.value = selected;
    }

    function matchingPosts() {
      var query = normalizeSearch(search.value);
      var selectedYear = year.value;
      var matches = posts.filter(function (post) {
        if (selectedYear && yearOf(post) !== selectedYear) return false;
        if (!query) return true;
        var haystack = [post.title, post.author, post.excerpt, articleText(post), (post.categories || []).join(' '), yearOf(post)].join(' ');
        return normalizeSearch(haystack).indexOf(query) !== -1;
      });
      if (sort.value === 'oldest') {
        matches.sort(function (a, b) { return (parseDate(a.date) || 0) - (parseDate(b.date) || 0); });
      } else if (sort.value === 'title') {
        matches.sort(function (a, b) { return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }); });
      } else {
        matches.sort(function (a, b) { return (parseDate(b.date) || 0) - (parseDate(a.date) || 0); });
      }
      return matches;
    }

    function syncUrl() {
      var url = new URL(window.location.href);
      var query = search.value.trim();
      if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
      if (year.value) url.searchParams.set('year', year.value); else url.searchParams.delete('year');
      if (sort.value !== 'newest') url.searchParams.set('sort', sort.value); else url.searchParams.delete('sort');
      window.history.replaceState({}, '', url);
    }

    function render() {
      var matches = matchingPosts();
      var visible = matches.slice(0, shown);
      var fragment = document.createDocumentFragment();
      visible.forEach(function (post) { fragment.appendChild(articleCard(post)); });
      grid.replaceChildren(fragment);
      grid.setAttribute('aria-busy', 'false');
      count.textContent = matches.length ? 'Showing ' + visible.length + ' of ' + matches.length + ' articles' : '0 articles';
      empty.hidden = matches.length !== 0;
      more.hidden = visible.length >= matches.length;
      clear.hidden = !search.value;
      syncUrl();
    }

    function resetShownAndRender() {
      shown = ARCHIVE_PAGE_SIZE;
      render();
    }

    form.addEventListener('submit', function (event) { event.preventDefault(); });
    search.addEventListener('input', resetShownAndRender);
    clear.addEventListener('click', function () { search.value = ''; search.focus(); resetShownAndRender(); });
    year.addEventListener('change', resetShownAndRender);
    sort.addEventListener('change', resetShownAndRender);
    more.addEventListener('click', function () { shown += ARCHIVE_PAGE_SIZE; render(); });
    reset.addEventListener('click', function () {
      search.value = '';
      year.value = '';
      sort.value = 'newest';
      resetShownAndRender();
      search.focus();
    });

    populateYears();
    render();
    return {
      update: function (updatedPosts) {
        posts = updatedPosts;
        populateYears();
        render();
      }
    };
  }

  function renderPreview(posts) {
    var preview = document.getElementById('article-preview');
    if (!preview) return;
    var fragment = document.createDocumentFragment();
    posts.slice(0, 3).forEach(function (post) { fragment.appendChild(articleCard(post, { compact: true })); });
    preview.replaceChildren(fragment);
  }

  function looksLikeHeading(label) {
    var text = label.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 115 || text.split(' ').length > 15) return false;
    if (/^(figure|fig\.?|table|image|source|note)\b/i.test(text)) return false;
    if (/[.,;]$/.test(text)) return false;
    if (/^(references|works cited|sources|image references|acknowledg(e)?ments?|introduction|background|conclusion|closing thoughts|additional information|about the author):?$/i.test(text)) return true;
    var letters = text.match(/[a-z]/gi) || [];
    var uppercase = text.match(/[A-Z]/g) || [];
    if (letters.length && uppercase.length / letters.length > 0.68) return true;
    return /^[A-Z][^.!]*[:?]?$/.test(text);
  }

  function promoteEditorialHeadings(body) {
    Array.prototype.slice.call(body.querySelectorAll('p')).forEach(function (paragraph) {
      var lead = paragraph.firstElementChild;
      if (!lead || (lead.tagName !== 'STRONG' && lead.tagName !== 'B')) return;
      var beforeLead = '';
      var cursor = paragraph.firstChild;
      while (cursor && cursor !== lead) {
        beforeLead += cursor.textContent || '';
        cursor = cursor.nextSibling;
      }
      if (beforeLead.trim()) return;
      var label = lead.textContent.replace(/\s+/g, ' ').trim();
      if (!looksLikeHeading(label)) return;
      var heading = document.createElement('h2');
      heading.textContent = label.replace(/:$/, '');
      paragraph.parentNode.insertBefore(heading, paragraph);
      lead.remove();
      while (paragraph.firstChild && ((paragraph.firstChild.nodeType === Node.TEXT_NODE && !paragraph.firstChild.textContent.trim()) || paragraph.firstChild.nodeName === 'BR')) {
        paragraph.firstChild.remove();
      }
      if (!paragraph.textContent.trim() && !paragraph.querySelector('img, iframe')) paragraph.remove();
    });
  }

  function cleanImportedPageFurniture(body) {
    var walker = body.ownerDocument.createTreeWalker(body, 4);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (node) {
      node.nodeValue = cleanInvisibleText(node.nodeValue)
        .replace(/\bB\s+S\s+J\s+B\s+S\s+J\b/gi, '')
        .replace(/(^|\s)[•·]\s*S(?=\s|$)/g, '$1')
        .replace(/[ \t]{2,}/g, ' ');
    });
    body.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (heading) {
      if (!heading.textContent.trim()) heading.remove();
    });
    body.querySelectorAll('p, li').forEach(function (block) {
      if (!block.textContent.trim() && !block.querySelector('img, iframe')) block.remove();
    });
    body.querySelectorAll('ul, ol').forEach(function (list) {
      if (!list.querySelector('li, img, iframe')) list.remove();
    });
  }

  function removeRepeatedLeadTitle(body, articleTitle) {
    var lead = body.firstElementChild;
    if (!lead || !/^(P|H[1-3])$/.test(lead.tagName)) return;
    var titleWords = normalizeSearch(articleTitle).split(' ').filter(Boolean);
    var leadWords = normalizeSearch(lead.textContent).split(' ').filter(Boolean);
    if (titleWords.length < 5 || Math.abs(titleWords.length - leadWords.length) > 1) return;
    var matches = titleWords.reduce(function (total, word, index) {
      return total + (leadWords[index] === word ? 1 : 0);
    }, 0);
    if (matches / Math.max(titleWords.length, leadWords.length) >= 0.85) lead.remove();
  }

  function promoteImportedSectionHeadings(body) {
    var labels = {
      abstract: 'Abstract',
      introduction: 'Introduction',
      background: 'Background',
      'materials and methods': 'Materials and Methods',
      methods: 'Methods',
      methodology: 'Methodology',
      results: 'Results',
      discussion: 'Discussion',
      conclusion: 'Conclusion',
      conclusions: 'Conclusions',
      limitations: 'Limitations',
      'future directions': 'Future Directions',
      acknowledgements: 'Acknowledgements',
      acknowledgments: 'Acknowledgments'
    };
    var pattern = /^(\s*)(Abstract|Introduction|Background|Materials and Methods|Methods|Methodology|Results|Discussion|Conclusion|Conclusions|Limitations|Future Directions|Acknowledgements|Acknowledgments)(?:([.:])\s*|\s+)/i;
    Array.prototype.slice.call(body.children).forEach(function (paragraph) {
      if (paragraph.tagName !== 'P') return;
      var walker = body.ownerDocument.createTreeWalker(paragraph, 4);
      var firstText = null;
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.trim()) {
          firstText = walker.currentNode;
          break;
        }
      }
      if (!firstText) return;
      var match = firstText.nodeValue.match(pattern);
      if (!match) return;
      var remainder = firstText.nodeValue.slice(match[0].length);
      if (!match[3] && remainder && !/^[A-Z0-9(]/.test(remainder)) return;
      var heading = document.createElement('h2');
      heading.textContent = labels[match[2].toLowerCase()];
      paragraph.parentNode.insertBefore(heading, paragraph);
      firstText.nodeValue = remainder;
      if (!paragraph.textContent.trim() && !paragraph.querySelector('img, iframe')) paragraph.remove();
    });
  }

  function safeSrcset(value) {
    var candidates = (value || '').split(',').map(function (candidate) {
      var parts = candidate.trim().split(/\s+/);
      var source = normalizeSource(parts.shift());
      return source ? [source].concat(parts).join(' ') : '';
    }).filter(Boolean);
    return candidates.join(', ');
  }

  function prepareArticleBody(html, articleTitle) {
    var parsed = new DOMParser().parseFromString(html || '', 'text/html');
    var body = parsed.body;
    body.querySelectorAll('script, style, object, embed, form, input, button, link, meta, svg, canvas').forEach(function (node) { node.remove(); });

    body.querySelectorAll('iframe').forEach(function (frame) {
      var source = normalizeSource(frame.getAttribute('src'));
      if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//i.test(source)) {
        frame.remove();
        return;
      }
      frame.src = source;
      frame.loading = 'lazy';
      frame.title = frame.title || 'Embedded video';
      frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      frame.setAttribute('allowfullscreen', '');
    });

    body.querySelectorAll('*').forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attribute) {
        var name = attribute.name.toLowerCase();
        if (name.indexOf('on') === 0 || name === 'style' || name === 'srcdoc' || name === 'formaction') node.removeAttribute(attribute.name);
      });
    });

    body.querySelectorAll('a').forEach(function (link) {
      var href = normalizeLink(link.getAttribute('href'));
      if (!href) {
        link.removeAttribute('href');
        return;
      }
      link.href = href;
      if (href.charAt(0) !== '#') {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });

    body.querySelectorAll('img').forEach(function (image) {
      var source = normalizeSource(image.getAttribute('src'));
      if (!source) {
        image.remove();
        return;
      }
      image.src = source;
      var srcset = safeSrcset(image.getAttribute('srcset'));
      if (srcset) image.srcset = srcset; else image.removeAttribute('srcset');
      ['width', 'height'].forEach(function (attribute) {
        var value = image.getAttribute(attribute);
        if (value && !/^\d+$/.test(value)) image.removeAttribute(attribute);
      });
      image.loading = 'lazy';
      image.decoding = 'async';
    });

    body.querySelectorAll('h1').forEach(function (heading) {
      var replacement = document.createElement('h2');
      replacement.innerHTML = heading.innerHTML;
      Array.prototype.slice.call(heading.attributes).forEach(function (attribute) { replacement.setAttribute(attribute.name, attribute.value); });
      heading.replaceWith(replacement);
    });

    cleanImportedPageFurniture(body);
    removeRepeatedLeadTitle(body, articleTitle);
    promoteEditorialHeadings(body);
    promoteImportedSectionHeadings(body);

    var normalizedTitle = normalizeSearch(articleTitle);
    var firstHeading = body.querySelector('h2, h3');
    if (firstHeading && normalizeSearch(firstHeading.textContent) === normalizedTitle) firstHeading.remove();

    body.querySelectorAll('p').forEach(function (paragraph) {
      if (!paragraph.textContent.trim() && paragraph.querySelector('img') && !paragraph.closest('figure')) {
        var figure = document.createElement('figure');
        figure.dataset.looseImage = 'true';
        while (paragraph.firstChild) figure.appendChild(paragraph.firstChild);
        paragraph.replaceWith(figure);
      } else if (!paragraph.textContent.trim() && !paragraph.querySelector('img, figure, iframe')) {
        paragraph.remove();
      }
    });

    body.querySelectorAll('img').forEach(function (image) {
      if (image.closest('figure')) return;
      var visual = image;
      if (image.parentElement && image.parentElement.tagName === 'A' && image.parentElement.querySelectorAll('img').length === 1) {
        visual = image.parentElement;
      }
      var block = image.closest('p, h2, h3, h4, h5, h6');
      var looseFigure = document.createElement('figure');
      looseFigure.dataset.looseImage = 'true';
      var textBeforeImage = '';
      if (block) {
        var range = parsed.createRange();
        range.setStart(block, 0);
        range.setEndBefore(visual);
        textBeforeImage = range.cloneContents().textContent.replace(/\s+/g, ' ').trim();
      }
      var remainingText = block ? block.textContent.replace(/\s+/g, ' ').trim() : '';

      if (block && block.tagName === 'P' && !textBeforeImage && remainingText.length <= 300) {
        block.parentNode.insertBefore(looseFigure, block);
        looseFigure.appendChild(visual);
        if (block.textContent.replace(/\s+/g, ' ').trim()) {
          var inlineCaption = document.createElement('figcaption');
          while (block.firstChild) inlineCaption.appendChild(block.firstChild);
          looseFigure.appendChild(inlineCaption);
        }
        block.remove();
        return;
      }

      if (block) {
        if (textBeforeImage) block.after(looseFigure); else block.before(looseFigure);
      } else {
        visual.parentNode.insertBefore(looseFigure, visual);
      }
      looseFigure.appendChild(visual);
      if (block && !block.textContent.trim() && !block.querySelector('img, iframe')) block.remove();
    });

    body.querySelectorAll('figure[data-loose-image]').forEach(function (figure) {
      if (figure.querySelector('figcaption')) {
        figure.removeAttribute('data-loose-image');
        return;
      }
      var next = figure.nextElementSibling;
      if (!next || next.tagName !== 'P') {
        figure.removeAttribute('data-loose-image');
        return;
      }
      var text = next.textContent.replace(/\s+/g, ' ').trim();
      var captionPattern = /^(figure|fig\.?|image|photo|source|credit|risk|survival|molecular|diagram|schematic)\b|\b(image courtesy|shown above|shown below)\b|^the\b.{0,90}\b(device|diagram|image|structure|model|rates?)\b/i;
      if (text && text.length <= 300 && captionPattern.test(text)) {
        var detachedCaption = document.createElement('figcaption');
        while (next.firstChild) detachedCaption.appendChild(next.firstChild);
        figure.appendChild(detachedCaption);
        next.remove();
      }
      figure.removeAttribute('data-loose-image');
    });

    body.querySelectorAll('iframe').forEach(function (frame) {
      if (frame.closest('.video-embed')) return;
      var wrapper = document.createElement('div');
      wrapper.className = 'video-embed';
      frame.parentNode.insertBefore(wrapper, frame);
      wrapper.appendChild(frame);
    });

    body.querySelectorAll('table').forEach(function (table) {
      if (table.parentElement && table.parentElement.classList.contains('article-table-wrap')) return;
      var wrapper = document.createElement('div');
      wrapper.className = 'article-table-wrap';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });

    body.querySelectorAll('figure').forEach(function (figure) {
      if (!figure.querySelector('img, iframe') && !figure.classList.contains('wp-block-gallery')) {
        figure.remove();
        return;
      }
      figure.classList.add('article-figure');
      var image = figure.querySelector('img');
      if (!image) return;
      var width = Number(image.getAttribute('width') || 0);
      var height = Number(image.getAttribute('height') || 0);
      if (width && height && height > width * 1.2) figure.classList.add('article-figure-portrait');
      if (width && width < 520) figure.classList.add('article-figure-compact');
    });

    var usedIds = new Set();
    body.querySelectorAll('h2, h3').forEach(function (heading, index) {
      var base = normalizeSearch(heading.textContent).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section-' + (index + 1);
      var id = base;
      var suffix = 2;
      while (usedIds.has(id)) id = base + '-' + suffix++;
      usedIds.add(id);
      heading.id = id;
    });

    Array.prototype.slice.call(body.children).forEach(function (heading) {
      if (heading.parentElement !== body || heading.tagName !== 'H2') return;
      var label = normalizeSearch(heading.textContent).replace(/:$/, '');
      var className = '';
      if (/^(references|works cited|sources|citations|image references)$/.test(label)) className = 'article-references';
      if (/^acknowledg(e)?ments?$/.test(label)) className = 'article-acknowledgements';
      if (!className) return;
      var section = document.createElement('section');
      section.className = className;
      body.insertBefore(section, heading);
      section.appendChild(heading);
      while (section.nextElementSibling && section.nextElementSibling.tagName !== 'H2') section.appendChild(section.nextElementSibling);
    });

    var first = body.querySelector('img');
    if (first) {
      first.loading = 'eager';
      first.setAttribute('fetchpriority', 'high');
    }
    return body;
  }

  function openFigure(image) {
    var lightbox = document.getElementById('figure-lightbox');
    var lightboxImage = document.getElementById('figure-lightbox-image');
    var caption = document.getElementById('figure-lightbox-caption');
    if (!lightbox || !lightboxImage) return;
    lastFigureTrigger = image;
    var figure = image.closest('figure');
    var figureCaption = figure && figure.querySelector('figcaption');
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt || '';
    caption.textContent = figureCaption ? figureCaption.textContent.replace(/\s+/g, ' ').trim() : image.alt || '';
    caption.hidden = !caption.textContent;
    lightbox.hidden = false;
    document.body.classList.add('lightbox-open');
    document.getElementById('figure-lightbox-close').focus();
  }

  function closeFigure() {
    var lightbox = document.getElementById('figure-lightbox');
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.classList.remove('lightbox-open');
    document.getElementById('figure-lightbox-image').removeAttribute('src');
    if (lastFigureTrigger && document.contains(lastFigureTrigger)) lastFigureTrigger.focus();
    lastFigureTrigger = null;
  }

  function enhanceFigures(content) {
    content.querySelectorAll('figure img').forEach(function (image) {
      var figure = image.closest('figure');
      var caption = figure && figure.querySelector('figcaption');
      var imageLink = image.parentElement && image.parentElement.tagName === 'A' ? image.parentElement : null;
      if (imageLink && imageLink.childElementCount === 1 && !imageLink.textContent.trim()) imageLink.replaceWith(image);
      if (!image.alt && caption) image.alt = truncate(caption.textContent, 180);
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', (image.alt ? image.alt + '. ' : '') + 'Open larger figure');
      image.addEventListener('click', function (event) {
        event.preventDefault();
        openFigure(image);
      });
      image.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openFigure(image);
        }
      });
      function classifyFigure() {
        if (!figure) return;
        if (image.naturalHeight > image.naturalWidth * 1.2) figure.classList.add('article-figure-portrait');
        if (image.naturalWidth < 520) figure.classList.add('article-figure-compact');
      }
      function markUnavailable() {
        if (!figure) {
          image.remove();
          return;
        }
        figure.classList.add('article-figure-unavailable');
        image.remove();
        if (!figure.querySelector('.figure-unavailable-message')) {
          var message = document.createElement('p');
          message.className = 'figure-unavailable-message';
          message.textContent = 'This figure is unavailable in the archived copy.';
          figure.insertBefore(message, figure.firstChild);
        }
      }
      image.addEventListener('load', classifyFigure);
      image.addEventListener('error', markUnavailable);
      if (image.complete) {
        if (image.naturalWidth) classifyFigure(); else markUnavailable();
      }
    });
  }

  function buildTableOfContents(content) {
    var container = document.getElementById('article-toc');
    var list = document.getElementById('article-toc-list');
    if (!container || !list) return;
    var headings = Array.prototype.slice.call(content.querySelectorAll('h2')).slice(0, 12);
    if (headings.length < 2) {
      container.hidden = true;
      list.replaceChildren();
      return;
    }
    var fragment = document.createDocumentFragment();
    headings.forEach(function (heading) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent;
      item.appendChild(link);
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
    container.hidden = false;

    if ('IntersectionObserver' in window) {
      var links = Array.prototype.slice.call(list.querySelectorAll('a'));
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (link) { link.classList.toggle('active', link.hash === '#' + entry.target.id); });
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      headings.forEach(function (heading) { observer.observe(heading); });
    }
  }

  function setupShare(post) {
    var button = document.getElementById('article-share-button');
    var label = document.getElementById('article-share-label');
    if (!button || !label) return;
    button.onclick = function () {
      var shareData = { title: post.title, text: excerpt(post, 140), url: window.location.href };
      if (navigator.share) {
        navigator.share(shareData).catch(function () {});
        return;
      }
      var copy = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(window.location.href) : new Promise(function (resolve) {
        var field = document.createElement('textarea');
        field.value = window.location.href;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        field.remove();
        resolve();
      });
      copy.then(function () {
        label.textContent = 'Link copied';
        window.setTimeout(function () { label.textContent = 'Share article'; }, 1800);
      });
    };
  }

  function setupReadingProgress() {
    var bar = document.getElementById('article-progress-bar');
    var content = document.getElementById('article-content');
    if (!bar || !content || bar.dataset.ready) return;
    bar.dataset.ready = 'true';
    var ticking = false;
    function update() {
      ticking = false;
      var start = content.getBoundingClientRect().top + window.scrollY;
      var distance = Math.max(content.offsetHeight - window.innerHeight, 1);
      var progress = Math.min(1, Math.max(0, (window.scrollY - start) / distance));
      bar.style.transform = 'scaleX(' + progress + ')';
    }
    function requestUpdate() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    update();
  }

  function ensureMeta(selector, attributes) {
    var element = document.head.querySelector(selector);
    if (!element) {
      element = document.createElement('meta');
      Object.keys(attributes).forEach(function (key) { element.setAttribute(key, attributes[key]); });
      document.head.appendChild(element);
    }
    return element;
  }

  function updateMetadata(post) {
    var description = excerpt(post, 160);
    var canonical = new URL('article.html?slug=' + encodeURIComponent(post.slug), window.location.href).href;
    document.title = post.title + ' | Berkeley Scientific Journal';
    document.querySelector('meta[name="description"]').content = description;
    document.querySelector('meta[property="og:title"]').content = post.title;
    document.querySelector('meta[property="og:description"]').content = description;
    document.getElementById('article-canonical').href = canonical;
    ensureMeta('meta[property="og:url"]', { property: 'og:url' }).content = canonical;
    var image = firstImage(post);
    if (image) {
      var absoluteImage = new URL(image.src, window.location.href).href;
      ensureMeta('meta[property="og:image"]', { property: 'og:image' }).content = absoluteImage;
      ensureMeta('meta[name="twitter:image"]', { name: 'twitter:image' }).content = absoluteImage;
    }
    var published = parseDate(post.date);
    if (published) ensureMeta('meta[property="article:published_time"]', { property: 'article:published_time' }).content = published.toISOString();

    var existingSchema = document.getElementById('article-structured-data');
    if (existingSchema) existingSchema.remove();
    var schema = document.createElement('script');
    schema.id = 'article-structured-data';
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: description,
      datePublished: published ? published.toISOString() : undefined,
      dateModified: parseDate(post.modified) ? parseDate(post.modified).toISOString() : undefined,
      author: post.author ? { '@type': 'Person', name: post.author } : { '@type': 'Organization', name: 'Berkeley Scientific Journal' },
      publisher: {
        '@type': 'Organization',
        name: 'Berkeley Scientific Journal',
        logo: { '@type': 'ImageObject', url: new URL('assets/brand/favicons/icon-512.png', window.location.href).href }
      },
      mainEntityOfPage: canonical,
      image: image ? new URL(image.src, window.location.href).href : undefined,
      wordCount: (articleText(post).match(/[\w’'-]+/g) || []).length
    });
    document.head.appendChild(schema);
  }

  function relatedPosts(post, posts) {
    var words = new Set(normalizeSearch(post.title).split(/[^a-z0-9]+/).filter(function (word) { return word.length > 4; }));
    var category = usefulCategory(post.categories);
    var targetYear = Number(yearOf(post));
    return posts.filter(function (candidate) { return candidate.slug !== post.slug; }).map(function (candidate) {
      var score = usefulCategory(candidate.categories) === category && category !== 'Article' ? 5 : 0;
      normalizeSearch(candidate.title).split(/[^a-z0-9]+/).forEach(function (word) { if (words.has(word)) score += 1; });
      if (Math.abs(Number(yearOf(candidate)) - targetYear) <= 1) score += 0.5;
      return { post: candidate, score: score };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (parseDate(b.post.date) || 0) - (parseDate(a.post.date) || 0);
    }).slice(0, 3).map(function (entry) { return entry.post; });
  }

  function renderRelated(post, posts) {
    var section = document.getElementById('related-articles');
    var grid = document.getElementById('related-article-grid');
    if (!section || !grid) return;
    var related = relatedPosts(post, posts);
    if (!related.length) {
      section.hidden = true;
      return;
    }
    var fragment = document.createDocumentFragment();
    related.forEach(function (candidate) { fragment.appendChild(articleCard(candidate, { compact: true })); });
    grid.replaceChildren(fragment);
    section.hidden = false;
  }

  function renderArticle(post, posts) {
    var content = document.getElementById('article-content');
    if (!content || !post) return;
    var title = document.getElementById('article-title');
    var deck = document.getElementById('article-deck');
    var author = document.getElementById('article-author');
    var date = document.getElementById('article-date');
    var duration = document.getElementById('article-reading-time');
    var category = document.getElementById('article-category');
    var details = document.querySelector('.article-byline-meta');
    var aside = document.querySelector('.article-aside');
    var prepared = prepareArticleBody(post.content_html, post.title);

    if (details) details.hidden = false;
    if (aside) aside.hidden = false;

    title.textContent = post.title;
    var summary = (post.excerpt || '').trim();
    deck.textContent = summary;
    deck.hidden = !summary;
    author.textContent = post.author ? 'By ' + post.author : 'Berkeley Scientific Journal';
    date.textContent = formatDate(post.date);
    var parsedDate = parseDate(post.date);
    if (parsedDate) date.dateTime = parsedDate.toISOString();
    duration.textContent = readingTime(post) + ' min read';
    category.textContent = usefulCategory(post.categories);

    if (prepared.childNodes.length) {
      var nodes = Array.prototype.slice.call(prepared.childNodes);
      content.replaceChildren();
      nodes.forEach(function (node) { content.appendChild(node); });
    } else {
      content.innerHTML = '<div class="article-message"><h2>Article text unavailable</h2><p>This archived entry does not include readable article text.</p></div>';
    }
    content.setAttribute('aria-busy', 'false');
    enhanceFigures(content);
    buildTableOfContents(content);
    setupShare(post);
    setupReadingProgress();
    updateMetadata(post);
    renderRelated(post, posts);
  }

  function renderNotFound() {
    var content = document.getElementById('article-content');
    if (!content) return;
    document.getElementById('article-category').textContent = 'Archive';
    document.getElementById('article-title').textContent = 'Article not found';
    document.getElementById('article-deck').hidden = true;
    document.getElementById('article-author').textContent = '';
    document.getElementById('article-date').textContent = '';
    document.getElementById('article-reading-time').textContent = '';
    var details = document.querySelector('.article-byline-meta');
    if (details) details.hidden = true;
    content.innerHTML = '<div class="article-message"><h2>We could not find that story.</h2><p>It may have moved or the address may be incomplete.</p><a class="btn btn-primary" href="journals.html?view=articles">Browse all articles</a></div>';
    content.setAttribute('aria-busy', 'false');
    var aside = document.querySelector('.article-aside');
    if (aside) aside.hidden = true;
  }

  function showCollectionError() {
    var loading = document.querySelectorAll('.article-loading');
    loading.forEach(function (target) {
      target.innerHTML = '<span>The archive is temporarily unavailable.</span>';
    });
    var grid = document.getElementById('article-grid');
    if (grid) grid.setAttribute('aria-busy', 'false');
  }

  function boot() {
    var articleContent = document.getElementById('article-content');
    var archiveController = null;
    requestLocalArchive().then(function (localPosts) {
      archiveController = setupArchive(localPosts);
      renderPreview(localPosts);

      if (articleContent) {
        var slug = new URLSearchParams(window.location.search).get('slug') || '';
        var localPost = localPosts.find(function (post) { return post.slug === slug; });
        if (localPost) renderArticle(localPost, localPosts);
        if (!wordpressEnabled()) {
          if (!localPost) renderNotFound();
          return;
        }
        requestWordPressArticle(slug).then(function (wordpressPost) {
          if (!wordpressPost) {
            if (!localPost) renderNotFound();
            return;
          }
          var merged = mergePosts(localPosts, [wordpressPost]);
          renderArticle(merged.find(function (post) { return post.slug === slug; }), merged);
        }).catch(function () {
          if (!localPost) renderNotFound();
        });
        return;
      }

      if (!wordpressEnabled()) return;
      requestWordPressArchive().then(function (wordpressPosts) {
        var merged = mergePosts(localPosts, wordpressPosts);
        if (archiveController) archiveController.update(merged);
        renderPreview(merged);
      }).catch(function () {});
    }).catch(function () {
      if (articleContent) {
        var slug = new URLSearchParams(window.location.search).get('slug') || '';
        if (!wordpressEnabled()) {
          renderNotFound();
          return;
        }
        requestWordPressArticle(slug).then(function (post) {
          if (post) renderArticle(post, [post]); else renderNotFound();
        }).catch(renderNotFound);
        return;
      }
      if (!wordpressEnabled()) {
        showCollectionError();
        return;
      }
      requestWordPressArchive().then(function (posts) {
        setupArchive(posts);
        renderPreview(posts);
      }).catch(showCollectionError);
    });
  }

  var closeButton = document.getElementById('figure-lightbox-close');
  var lightbox = document.getElementById('figure-lightbox');
  if (closeButton) closeButton.addEventListener('click', closeFigure);
  if (lightbox) lightbox.addEventListener('click', function (event) { if (event.target === lightbox) closeFigure(); });
  document.addEventListener('keydown', function (event) {
    if (!lightbox || lightbox.hidden) return;
    if (event.key === 'Escape') closeFigure();
    if (event.key === 'Tab') {
      event.preventDefault();
      closeButton.focus();
    }
  });

  boot();
})();
