# Editing the BSJ website

This site is plain HTML, CSS and JavaScript. There is no WordPress, no login
page and no database — which is deliberate: the old WordPress site was
compromised in 2026 and used to host spam under the berkeley.edu domain. There
is nothing here for an attacker to log into.

Everything that changes regularly lives in a **data file**, not in the page
markup. You should rarely need to touch HTML.

---

## The three things you'll actually change

| What | File to edit | Rebuild needed? |
|---|---|---|
| Staff roster | `content/staff.json` | No |
| A new issue came out | nothing — run the build | Yes |
| A new article | add a file to `content/articles/` | Yes |

---

## 1. Updating the staff roster

Open **`content/staff.json`**. It looks like this:

```json
{
  "semester": "Fall 2026",
  "groups": [
    {
      "group": "Executive board",
      "members": [
        {
          "name": "Sania Moghe",
          "role": "Editor-in-Chief",
          "photo": "sania",
          "linkedin": "https://www.linkedin.com/in/sania-moghe/"
        }
      ]
    }
  ]
}
```

To add someone, copy an existing block and change the values. Only `name` and
`role` are required.

- **`photo`** is the filename in `assets/team/` **without the extension**.
  `"photo": "sania"` means `assets/team/sania.jpg`. Add new photos as `.jpg`
  there; square images look best. Leave `photo` out entirely and the page shows
  the person's initials instead, which looks fine.
- **`linkedin`** is optional. With it, the card links to their profile.
- **`semester`** is the small line under the page heading.

Watch the commas: every entry needs a comma after it **except the last one in a
list**. If the page shows "Loading the roster…" and never finishes, that's
almost always a missing or extra comma. Paste the file into
<https://jsonlint.com> to find it.

Changing the roster needs **no rebuild** — the page reads this file directly.

---

## 2. When a new issue is published

Issue data comes from **eScholarship**, which is the journal's system of record.
Once the issue and its articles are up there, run:

```bash
python3 scripts/build.py --issues
```

That refetches all 35+ issues with their full tables of contents and author
lists. You don't type any of it by hand.

Two things eScholarship doesn't record, so they live in `scripts/build.py`:

- **The issue theme.** Find the `TITLES` dictionary near the top and add a line,
  e.g. `(30, 1): 'Your Theme',`
- **The cover image.** Save it as `assets/covers/jpg/30_1.jpg` and
  `assets/covers/webp/30_1.webp` (volume_issue). If there's a full-issue PDF,
  put it at `assets/issues/pdfs/30_1.pdf` and the card links to it automatically.

---

## 3. Writing a new article

Create a file in `content/articles/`, named after the URL you want — for
example `gut-bacteria-and-memory.md`:

```markdown
---
title: Gut Bacteria and Memory
author: Jane Doe
date: 2026-10-04
section: Blogs
excerpt: One sentence that shows on the article card.
cover: assets/article-media/2026/10/gut-bacteria.jpg
---

## The first section heading

Write normally. You can use **bold**, *italics*, and
[links](https://example.com).

- Bullet points
- Work as expected

> Blockquotes are good for pull quotes.

![A caption for the image](assets/article-media/2026/10/figure-1.jpg)
```

Everything between the `---` lines is information *about* the article;
everything after is the article itself.

- `title`, `author` and `date` are the important ones. `section` should be
  `Features`, `Interviews` or `Blogs`.
- `cover` and `excerpt` are optional but make the card look much better.
- Put images in `assets/article-media/YEAR/MONTH/` to match how the rest of the
  archive is organised.

Then run:

```bash
python3 scripts/build.py --articles
```

Headings: `##` makes a section heading that appears in the sidebar contents on
the article page. `###` makes a smaller one beneath it.

---

## Previewing before you publish

Always look at it locally first:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a browser. Press `Ctrl+C` in the terminal
to stop.

---

## Publishing

```bash
./scripts/deploy.sh
```

That rebuilds the data, uploads everything to OCF, fixes file permissions, and
prints the live URL. It asks for the OCF password unless an SSH key is set up.

To see what *would* change without sending anything:

```bash
./scripts/deploy.sh --dry-run
```

---

## Where everything lives

```
index.html, about.html, ...     the pages themselves
content/staff.json              the staff roster        <- edit this
content/articles/*.md           new articles            <- and these
scripts/build.py                regenerates the data files
scripts/deploy.sh               publishes to OCF
assets/css/style.css            all styling
assets/js/                      the code that renders issues, articles, staff
assets/data/                    generated - do not edit by hand
assets/team/                    staff photos
assets/covers/                  issue cover images
assets/article-media/           images used inside articles
```

Anything in `assets/data/` is **generated by the build script**. If you edit it
directly, your changes are wiped the next time anyone runs a build. The one
exception is `assets/data/articles.json`, which is the frozen archive of the
288 articles imported from the old WordPress site — leave it alone.

---

## If something breaks

- **A page shows "Loading…" forever** — a data file has a JSON syntax error.
  Check `content/staff.json` at <https://jsonlint.com>.
- **The site looks unstyled** — `assets/css/style.css` didn't upload. Rerun
  the deploy.
- **An image is missing** — check the path and that the file was committed.
  Filenames are case-sensitive on the server but not on a Mac, so `Photo.JPG`
  and `photo.jpg` are different there and the same here.
- **You broke something and want to undo it** — every change is in git:
  `git log` to see history, `git checkout <file>` to discard edits to a file.

---

## A note on security

Keep it static. The reason this site can't be hacked the way the old one was is
that there's no server-side code — no PHP, no plugins, no admin accounts. If
someone suggests adding a CMS, a contact form that emails, or "just a small
plugin," that reintroduces exactly the attack surface that cost BSJ its site
and nine months of search reputation.

If you need a form, use an external service (Google Forms) and link to it.
