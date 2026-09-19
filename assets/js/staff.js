/* Renders the Staff page from content/staff.json.

   The roster changes every semester, so it lives in a plain data file rather
   than in the page markup. Editing that file is the whole job — there is no
   build step to run afterwards. */
(function () {
  'use strict';

  var DATA_URL = 'content/staff.json';

  var LINKEDIN_PATH = 'M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.28 2.38 4.28 5.47v6.27zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.11 20.45H3.56V9h3.55v11.45z';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function initials(name) {
    return (name || '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
  }

  function photo(person) {
    var frame = el('div', 'person-photo');
    if (!person.photo) {
      frame.appendChild(el('span', null, initials(person.name)));
      return frame;
    }
    // A .webp is used when one has been generated alongside the .jpg.
    var picture = document.createElement('picture');
    var webp = document.createElement('source');
    webp.srcset = 'assets/team/' + person.photo + '.webp';
    webp.type = 'image/webp';
    var image = el('img');
    image.src = 'assets/team/' + person.photo + '.jpg';
    image.alt = person.name;
    image.loading = 'lazy';
    image.addEventListener('error', function () {
      // No usable photo on disk: fall back to initials rather than a broken frame.
      frame.replaceChildren(el('span', null, initials(person.name)));
    });
    picture.append(webp, image);
    frame.appendChild(picture);
    return frame;
  }

  function card(person) {
    var node;
    if (person.linkedin) {
      node = el('a', 'person-card');
      node.href = person.linkedin;
      node.target = '_blank';
      node.rel = 'noopener';
      node.setAttribute('aria-label', person.name + ' on LinkedIn');
    } else {
      node = el('div', 'person-card');
    }

    node.appendChild(photo(person));

    var body = el('div', 'person-body');
    var row = el('div', 'person-name-row');
    row.appendChild(el('h3', null, person.name));
    if (person.linkedin) {
      var mark = el('span', 'person-linkedin');
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="'
        + LINKEDIN_PATH + '"/></svg>';
      row.appendChild(mark);
    }
    body.appendChild(row);
    if (person.role) body.appendChild(el('div', 'person-role', person.role));
    node.appendChild(body);
    return node;
  }

  function grid(members) {
    var wrap = el('div', 'grid grid-4');
    members.forEach(function (person) { wrap.appendChild(card(person)); });
    return wrap;
  }

  function render(data) {
    var host = document.getElementById('staff-roster');
    if (!host) return;
    host.replaceChildren();

    (data.groups || []).forEach(function (group) {
      var section = el('div', 'leadership-group');
      section.appendChild(el('h2', null, group.group));

      if (group.members && group.members.length) {
        section.appendChild(grid(group.members));
      }
      (group.departments || []).forEach(function (dept) {
        var block = el('div', 'editor-dept');
        block.appendChild(el('p', 'editor-dept-label', dept.department));
        block.appendChild(grid(dept.members || []));
        section.appendChild(block);
      });

      host.appendChild(section);
    });

    var stamp = document.getElementById('staff-semester');
    if (stamp && data.semester) stamp.textContent = data.semester;
  }

  if (!document.getElementById('staff-roster')) return;

  fetch(DATA_URL, { headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('Could not load the roster');
      return response.json();
    })
    .then(render)
    .catch(function () {
      var host = document.getElementById('staff-roster');
      if (host) {
        host.replaceChildren(el('p', 'article-message',
          'The staff roster could not be loaded. Please email bsj.berkeley@gmail.com.'));
      }
    });
})();
