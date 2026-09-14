/* Issue data rendering — the current issue and recent issues on the home page,
   and the searchable issue archive. Everything comes from assets/data/issues.json,
   which is generated from the eScholarship catalogue for our_bsj. */
(function () {
  'use strict';

  var DATA_URL = 'assets/data/issues.json';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function issueLabel(issue) {
    return issue.title || 'Volume ' + issue.volume + ', Issue ' + issue.issue;
  }

  function issueDate(issue) {
    if (issue.semester && issue.year) return issue.semester + ' ' + issue.year;
    return issue.year ? String(issue.year) : '';
  }

  function volumeLine(issue) {
    return 'Vol. ' + issue.volume + ' · No. ' + issue.issue;
  }

  function authorLine(entry) {
    if (!entry.authors || !entry.authors.length) return '';
    if (entry.authors.length <= 3) return entry.authors.join(', ');
    return entry.authors.slice(0, 2).join(', ') + ', and ' + (entry.authors.length - 2) + ' others';
  }

  function coverImage(issue, alt) {
    var image = el('img');
    image.src = issue.cover;
    image.alt = alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', function handle() {
      image.removeEventListener('error', handle);
      image.src = issue.cover_fallback;
    });
    return image;
  }

  /* ---------------------------------------------------------------- home */

  function renderCurrentIssue(issue) {
    var shell = document.getElementById('current-issue');
    if (!shell) return;

    var coverLink = shell.querySelector('[data-issue-cover]');
    if (coverLink) {
      coverLink.href = issue.pdf || issue.escholarship_url;
      if (!issue.pdf) { coverLink.target = '_blank'; coverLink.rel = 'noopener'; }
      coverLink.appendChild(coverImage(issue, issueLabel(issue) + ' cover'));
    }

    var stamp = shell.querySelector('[data-issue-stamp]');
    if (stamp) {
      stamp.replaceChildren(
        el('b', null, volumeLine(issue)),
        el('span', 'dot'),
        el('span', null, issueDate(issue))
      );
    }

    var heading = shell.querySelector('[data-issue-title]');
    if (heading) heading.textContent = issueLabel(issue);

    var count = shell.querySelector('[data-issue-count]');
    if (count) {
      count.textContent = issue.article_count + ' articles, interviews, and research papers';
    }

    var links = shell.querySelector('[data-issue-links]');
    if (links) {
      links.replaceChildren();
      if (issue.pdf) {
        var pdf = el('a', 'btn btn-primary', 'Read the issue');
        pdf.href = issue.pdf;
        pdf.target = '_blank';
        pdf.rel = 'noopener';
        links.appendChild(pdf);
      }
      var record = el('a', 'btn btn-outline', 'View on eScholarship');
      record.href = issue.escholarship_url;
      record.target = '_blank';
      record.rel = 'noopener';
      links.appendChild(record);
    }

    var list = shell.querySelector('[data-issue-contents]');
    if (list) {
      list.replaceChildren();
      issue.contents.forEach(function (entry) {
        var link = el('a', 'toc-entry');
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noopener';

        var main = el('span');
        main.appendChild(el('span', 'toc-title', entry.title));
        var authors = authorLine(entry);
        if (authors) main.appendChild(el('span', 'toc-authors', authors));
        link.appendChild(main);

        if (entry.peer_reviewed) link.appendChild(el('span', 'toc-flag', 'Research'));
        var item = el('li');
        item.appendChild(link);
        list.appendChild(item);
      });
    }
  }

  function renderRecentIssues(issues) {
    var grid = document.getElementById('recent-issues');
    if (!grid) return;
    var limit = Number(grid.dataset.limit || 6);
    grid.replaceChildren();

    issues.slice(0, limit).forEach(function (issue) {
      var card = el('article', 'issue-card');
      var cover = el('a', 'issue-cover');
      cover.href = issue.pdf || issue.escholarship_url;
      if (!issue.pdf) { cover.target = '_blank'; cover.rel = 'noopener'; }
      cover.setAttribute('aria-label', issueLabel(issue));
      cover.appendChild(coverImage(issue, issueLabel(issue) + ' cover'));

      var meta = el('div', 'issue-meta');
      meta.appendChild(el('div', 'vol', volumeLine(issue)));
      meta.appendChild(el('h3', null, issueLabel(issue)));
      meta.appendChild(el('div', 'sem', issueDate(issue)));

      card.append(cover, meta);
      grid.appendChild(card);
    });
  }

  /* ------------------------------------------------------------- archive */

  function renderFeatured(issue) {
    var shell = document.getElementById('featured-issue');
    if (!shell) return;
    var cover = shell.querySelector('[data-issue-cover]');
    if (cover) {
      cover.href = issue.pdf || issue.escholarship_url;
      if (!issue.pdf) { cover.target = '_blank'; cover.rel = 'noopener'; }
      cover.appendChild(coverImage(issue, issueLabel(issue) + ' cover'));
    }
    var title = shell.querySelector('[data-issue-title]');
    if (title) title.textContent = issueLabel(issue);
    var meta = shell.querySelector('[data-issue-meta]');
    if (meta) {
      meta.replaceChildren(
        document.createTextNode('Volume ' + issue.volume + ', Issue ' + issue.issue),
        el('br'),
        document.createTextNode(issueDate(issue))
      );
    }
    var link = shell.querySelector('[data-issue-link]');
    if (link) {
      link.href = issue.pdf || issue.escholarship_url;
      link.target = '_blank';
      link.rel = 'noopener';
    }
  }

  function issueCard(issue) {
    var card = el('article', 'issue-card');

    var cover = el('a', 'issue-cover');
    cover.href = issue.pdf || issue.escholarship_url;
    if (!issue.pdf) { cover.target = '_blank'; cover.rel = 'noopener'; }
    cover.setAttribute('aria-label', 'Read ' + issueLabel(issue));
    cover.appendChild(coverImage(issue, issueLabel(issue) + ' cover'));

    var meta = el('div', 'issue-meta');
    meta.appendChild(el('div', 'vol', volumeLine(issue)));
    meta.appendChild(el('h3', null, issueLabel(issue)));
    var date = issueDate(issue);
    if (issue.note) date = date ? date + ' · ' + issue.note : issue.note;
    if (date) meta.appendChild(el('div', 'sem', date));

    var links = el('div', 'issue-links');
    if (issue.pdf) {
      var pdf = el('a', null, 'PDF');
      pdf.href = issue.pdf;
      pdf.target = '_blank';
      pdf.rel = 'noopener';
      links.appendChild(pdf);
    }
    var record = el('a', null, 'eScholarship');
    record.href = issue.escholarship_url;
    record.target = '_blank';
    record.rel = 'noopener';
    links.appendChild(record);

    card.append(cover, meta, links);

    if (issue.contents.length) {
      var details = el('details', 'issue-toc');
      details.appendChild(el('summary', null, 'Contents (' + issue.contents.length + ')'));
      var list = el('ol');
      issue.contents.forEach(function (entry) {
        var item = el('li');
        var link = el('a');
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.appendChild(el('span', null, entry.title));
        var authors = authorLine(entry);
        if (authors) link.appendChild(el('span', 'toc-authors', authors));
        item.appendChild(link);
        list.appendChild(item);
      });
      details.appendChild(list);
      card.appendChild(details);
    }

    return card;
  }

  function setupArchive(issues) {
    var grid = document.getElementById('issue-grid');
    if (!grid) return;
    var empty = document.getElementById('issue-empty');
    var search = document.getElementById('issue-search');
    var filterBar = document.getElementById('decade-filters');
    var count = document.getElementById('issue-count');

    function decadeOf(issue) {
      return issue.year ? Math.floor(issue.year / 10) * 10 + 's' : 'Undated';
    }

    var decades = ['All issues'];
    issues.forEach(function (issue) {
      var decade = decadeOf(issue);
      if (decades.indexOf(decade) === -1) decades.push(decade);
    });
    var activeDecade = 'All issues';

    function render() {
      var query = (search.value || '').trim().toLowerCase();
      grid.replaceChildren();
      var shown = 0;

      issues.forEach(function (issue) {
        if (activeDecade !== 'All issues' && decadeOf(issue) !== activeDecade) return;
        if (query) {
          var haystack = [
            issueLabel(issue), issueDate(issue),
            'volume ' + issue.volume, 'issue ' + issue.issue,
            issue.contents.map(function (entry) {
              return entry.title + ' ' + entry.authors.join(' ');
            }).join(' ')
          ].join(' ').toLowerCase();
          if (haystack.indexOf(query) === -1) return;
        }
        shown++;
        grid.appendChild(issueCard(issue));
      });

      if (count) count.textContent = shown + (shown === 1 ? ' issue' : ' issues');
      if (empty) empty.hidden = shown !== 0;
    }

    if (filterBar) {
      decades.forEach(function (decade) {
        var button = el('button', decade === activeDecade ? 'active' : null, decade);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(decade === activeDecade));
        button.addEventListener('click', function () {
          activeDecade = decade;
          filterBar.querySelectorAll('button').forEach(function (other) {
            other.classList.toggle('active', other === button);
            other.setAttribute('aria-pressed', String(other === button));
          });
          render();
        });
        filterBar.appendChild(button);
      });
    }
    if (search) search.addEventListener('input', render);
    render();
  }

  /* ---------------------------------------------------------------- boot */

  if (!document.getElementById('current-issue') &&
      !document.getElementById('recent-issues') &&
      !document.getElementById('issue-grid') &&
      !document.getElementById('featured-issue')) return;

  fetch(DATA_URL, { headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('Could not load issue data');
      return response.json();
    })
    .then(function (issues) {
      if (!Array.isArray(issues) || !issues.length) throw new Error('Issue data is empty');
      renderCurrentIssue(issues[0]);
      renderRecentIssues(issues);
      renderFeatured(issues[0]);
      setupArchive(issues);
    })
    .catch(function () {
      var grid = document.getElementById('issue-grid');
      if (grid) {
        grid.replaceChildren();
        var message = el('p', 'article-message',
          'The issue archive could not be loaded. Every issue is also available on eScholarship.');
        var link = el('a', 'btn btn-outline btn-sm', 'Open eScholarship');
        link.href = 'https://escholarship.org/uc/our_bsj';
        link.target = '_blank';
        link.rel = 'noopener';
        message.appendChild(link);
        grid.appendChild(message);
      }
    });
})();
