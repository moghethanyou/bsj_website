#!/usr/bin/env python3
"""Rebuild the data files the BSJ website reads.

Run it from the project root:

    python3 scripts/build.py              # rebuild everything
    python3 scripts/build.py --issues     # only refetch issues from eScholarship
    python3 scripts/build.py --articles   # only rebuild the article index

Uses the Python standard library only, so it runs on any Mac or Linux machine
with python3 and needs nothing installed.

What it produces
----------------
assets/data/issues.json          every issue, with its table of contents
assets/data/articles-index.json  the light list every page loads
assets/data/articles/<slug>.json one file per article, loaded on its own page

What it reads
-------------
eScholarship's public API         the journal's system of record for issues
assets/data/articles.json         the 288 articles imported from the old site
content/articles/*.md             new articles written since the rebuild
"""

import argparse
import collections
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ARCHIVE = os.path.join(ROOT, 'assets/data/articles.json')
MARKDOWN_DIR = os.path.join(ROOT, 'content/articles')
INDEX_OUT = os.path.join(ROOT, 'assets/data/articles-index.json')
ARTICLES_OUT = os.path.join(ROOT, 'assets/data/articles')
ISSUES_OUT = os.path.join(ROOT, 'assets/data/issues.json')
PDF_DIR = os.path.join(ROOT, 'assets/issues/pdfs')

SEARCH_CHARS = 800
WORDS_PER_MINUTE = 200

GRAPHQL = 'https://escholarship.org/graphql'
UNIT = 'our_bsj'


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def plain_text(markup):
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', markup or '', flags=re.S | re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', html.unescape(text)).strip()


def slugify(value):
    value = unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode()
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', value.lower())).strip('-')


def norm_title(value):
    value = unicodedata.normalize('NFKD', value or '').replace('’', "'")
    value = value.encode('ascii', 'ignore').decode().lower().replace("'", '')
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


# --------------------------------------------------------------------------- #
# Markdown, in the subset a blog post needs
# --------------------------------------------------------------------------- #

def _inline(text):
    """Links, images, bold, italic, code. Everything else is escaped."""
    out = html.escape(text, quote=False)
    out = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)\)',
                 r'<img src="\2" alt="\1" loading="lazy">', out)
    out = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', r'<a href="\2">\1</a>', out)
    out = re.sub(r'`([^`]+)`', r'<code>\1</code>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', out)
    out = re.sub(r'(?<![*\w])\*([^*]+)\*(?!\w)', r'<em>\1</em>', out)
    return out


def markdown_to_html(text):
    """Headings, paragraphs, lists, blockquotes, images and horizontal rules.

    Deliberately small. If a post ever needs something this does not cover,
    raw HTML can be written straight into the .md file and it passes through.
    """
    lines = (text or '').replace('\r\n', '\n').split('\n')
    out, buffer, list_type = [], [], None

    def flush_paragraph():
        if buffer:
            out.append('<p>' + _inline(' '.join(buffer).strip()) + '</p>')
            buffer.clear()

    def close_list():
        nonlocal list_type
        if list_type:
            out.append('</%s>' % list_type)
            list_type = None

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            flush_paragraph()
            close_list()
            continue

        # Raw HTML block: pass through untouched.
        if stripped.startswith('<') and not stripped.startswith('<http'):
            flush_paragraph()
            close_list()
            out.append(stripped)
            continue

        heading = re.match(r'^(#{1,4})\s+(.*)$', stripped)
        if heading:
            flush_paragraph()
            close_list()
            # The page's <h1> is the article title, so body headings start at <h2>.
            # The in-article table of contents is built from <h2>, so '#' and '##'
            # both land there; '###' and '####' nest below it.
            level = max(2, min(len(heading.group(1)), 4))
            out.append('<h%d>%s</h%d>' % (level, _inline(heading.group(2)), level))
            continue

        if re.match(r'^(---|\*\*\*|___)$', stripped):
            flush_paragraph()
            close_list()
            out.append('<hr>')
            continue

        if stripped.startswith('> '):
            flush_paragraph()
            close_list()
            out.append('<blockquote><p>%s</p></blockquote>' % _inline(stripped[2:]))
            continue

        bullet = re.match(r'^[-*+]\s+(.*)$', stripped)
        number = re.match(r'^\d+[.)]\s+(.*)$', stripped)
        if bullet or number:
            flush_paragraph()
            wanted = 'ul' if bullet else 'ol'
            if list_type != wanted:
                close_list()
                out.append('<%s>' % wanted)
                list_type = wanted
            out.append('<li>%s</li>' % _inline((bullet or number).group(1)))
            continue

        close_list()
        buffer.append(stripped)

    flush_paragraph()
    close_list()
    return '\n'.join(out)


def read_markdown_article(path):
    """Parse one content/articles/*.md file into the same shape as an archived article."""
    raw = open(path, encoding='utf-8').read()
    meta, body = {}, raw

    front = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)$', raw, re.S)
    if front:
        body = front.group(2)
        for line in front.group(1).split('\n'):
            if ':' not in line or line.strip().startswith('#'):
                continue
            key, _, value = line.partition(':')
            meta[key.strip().lower()] = value.strip().strip('"').strip("'")

    name = os.path.splitext(os.path.basename(path))[0]
    title = meta.get('title') or name.replace('-', ' ').title()
    date = meta.get('date') or time.strftime('%Y-%m-%d')
    if len(date) == 10:
        date += ' 12:00:00'

    article = {
        # zlib.crc32, not hash(): Python randomises string hashing per process,
        # which would hand the same article a different id on every build.
        'id': int(meta['id']) if meta.get('id', '').isdigit()
              else zlib.crc32(name.encode()) % 900000 + 100000,
        'title': title,
        'slug': meta.get('slug') or slugify(name),
        'date': date,
        'content_html': markdown_to_html(body),
        'excerpt': meta.get('excerpt', ''),
        'author': meta.get('author') or None,
        'source': 'markdown',
    }
    if meta.get('section'):
        article['section'] = meta['section']
    if meta.get('cover'):
        article['cover_image'] = meta['cover']
    return article


# --------------------------------------------------------------------------- #
# Issues, from eScholarship
# --------------------------------------------------------------------------- #

FRONT_MATTER = re.compile(
    r'^(.*?[:\-]\s*)?(table of contents|cover|back cover|front cover|editorial note|'
    r'masthead|front matter|back matter|letter from the editors?|thank you to our donors|'
    r'acknowledgements?|staff)\s*$', re.I)

# Semesters for volumes 12-19 come from BSJ's own "Past Issues" page, recovered
# from the 2015 database backup. Volume 15 issue 1 keeps a year only: that page
# dates it Fall 2009 alongside volume 13 issue 1, and the two cannot both be right.
DATED = {
    (12, 1): ('Spring', 2008), (12, 2): ('Fall', 2008),
    (13, 1): ('Fall', 2009), (13, 2): ('Spring', 2010),
    (14, 1): ('Fall', 2010), (14, 2): ('Spring', 2011),
    (15, 1): (None, 2009), (15, 2): ('Spring', 2009),
    (16, 1): ('Fall', 2011), (16, 2): ('Spring', 2012),
    (17, 1): ('Fall', 2012), (17, 2): ('Spring', 2013),
    (18, 1): ('Fall', 2013), (18, 2): ('Spring', 2014),
    (19, 1): ('Fall', 2014), (19, 2): ('Spring', 2015),
}

# Issue themes. eScholarship does not record them, so they are kept here.
# Adding a new issue: add its theme, then run this script.
TITLES = {
    (12, 1): 'Science and War', (12, 2): 'Consciousness and the Mind',
    (13, 1): 'Technology & the Human', (13, 2): 'Economics',
    (14, 1): 'Infectious Disease', (14, 2): 'Accidents: Serendipity in Science',
    (15, 1): 'Emotions and Thought', (15, 2): 'Science Fiction',
    (16, 1): 'The Science of Food', (16, 2): 'Save or Destroy',
    (17, 1): 'Science of Color', (17, 2): 'Death and Dying',
    (18, 1): 'Stress', (18, 2): 'Synthetics',
    (19, 1): 'Extremes', (19, 2): 'Waste',
    (20, 1): 'Symmetry', (21, 1): 'Chronos', (21, 2): None,
    (22, 1): 'Order & Disorder', (22, 2): 'Next Generation',
    (23, 1): 'Crisis', (23, 2): 'Perspectives',
    (24, 1): 'Glitch', (24, 2): 'Intersections',
    (25, 1): 'Bonds', (25, 2): 'Emergence',
    (26, 1): 'Origins', (26, 2): 'Flux',
    (27, 1): 'Signal', (27, 2): 'Potential',
    (28, 1): 'Magnitude', (28, 2): 'Anomaly',
    (29, 1): 'Pulse', (29, 2): 'Chimera',
}
NOTES = {(26, 1): '25th anniversary edition'}

QUERY = '''{ unit(id:"%s"){ items(first:100, more:%%s){ total more nodes{
  id title volume issue published permalink contentLink isPeerReviewed
  authors{ nodes{ name } } } } } }''' % UNIT


def graphql(more):
    payload = json.dumps({'query': QUERY % (json.dumps(more) if more else 'null')}).encode()
    request = urllib.request.Request(GRAPHQL, data=payload,
                                     headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(request, timeout=60))


def display_name(name):
    name = re.sub(r'\s+', ' ', html.unescape(name or '')).strip()
    if ',' in name:
        last, first = [p.strip() for p in name.split(',', 1)]
        if first and last:
            return '%s %s' % (first, last)
    return name


def build_issues():
    nodes, more = [], None
    while True:
        data = graphql(more)
        if 'errors' in data:
            raise SystemExit('eScholarship returned an error: %s' % data['errors'])
        block = data['data']['unit']['items']
        nodes += block['nodes']
        print('  fetched %d of %d items' % (len(nodes), block['total']))
        if not block['more']:
            break
        more = block['more']
        time.sleep(0.4)

    by_issue = collections.defaultdict(list)
    for item in nodes:
        by_issue[(int(item['volume']), int(item['issue']))].append(item)

    local_pdfs = {f[:-4] for f in os.listdir(PDF_DIR) if f.endswith('.pdf')} \
        if os.path.isdir(PDF_DIR) else set()

    issues = []
    for vol, num in sorted(by_issue, reverse=True):
        key = '%d_%d' % (vol, num)
        semester, year = DATED.get((vol, num), (None, None))
        if year is None:
            published = min(int(i['published'][:4]) for i in by_issue[(vol, num)] if i.get('published'))
            semester, year = ('Fall', published) if num == 1 else ('Spring', published)

        contents, front = [], []
        for item in sorted(by_issue[(vol, num)], key=lambda i: norm_title(i['title'])):
            authors = [display_name(a['name'])
                       for a in ((item.get('authors') or {}).get('nodes') or []) if a.get('name')]
            entry = {
                'title': re.sub(r'\s+', ' ', html.unescape(item['title'])).strip(),
                'authors': authors,
                'url': item['permalink'],
                'pdf': item.get('contentLink'),
                'peer_reviewed': bool(item.get('isPeerReviewed')),
            }
            (front if FRONT_MATTER.match(entry['title']) else contents).append(entry)

        issues.append({
            'volume': vol, 'issue': num,
            'title': TITLES.get((vol, num)), 'note': NOTES.get((vol, num)),
            'semester': semester, 'year': year,
            'cover': 'assets/covers/webp/%s.webp' % key,
            'cover_fallback': 'assets/covers/jpg/%s.jpg' % key,
            'pdf': 'assets/issues/pdfs/%s.pdf' % key if key in local_pdfs else None,
            'escholarship_url': 'https://escholarship.org/uc/our_bsj/%d/%d' % (vol, num),
            'article_count': len(contents),
            'contents': contents,
            'front_matter': front,
        })

    with open(ISSUES_OUT, 'w', encoding='utf-8') as handle:
        json.dump(issues, handle, indent=1, ensure_ascii=False)
    print('  wrote %s: %d issues, %d articles'
          % (os.path.relpath(ISSUES_OUT, ROOT), len(issues),
             sum(i['article_count'] for i in issues)))


# --------------------------------------------------------------------------- #
# Articles
# --------------------------------------------------------------------------- #

def card_image(article):
    """The image a card shows: the article's cover, else its first usable figure."""
    if article.get('cover_image'):
        return article['cover_image']
    best = None
    for tag in re.findall(r'<img\b[^>]*>', article.get('content_html') or ''):
        src = re.search(r'\ssrc="([^"]+)"', tag)
        if not src:
            continue
        width = re.search(r'\swidth="(\d+)"', tag)
        height = re.search(r'\sheight="(\d+)"', tag)
        w = int(width.group(1)) if width else 0
        h = int(height.group(1)) if height else 0
        if best is None:
            best = src.group(1)
        if not w or not h or w >= 240 or h >= 180:
            return src.group(1)
    return best


def label_of(entry):
    """Mirrors categoryLabel() in assets/js/articles.js."""
    issue = entry.get('issue')
    if issue and issue.get('title'):
        return issue['title']
    if issue:
        return 'Vol. %s · No. %s' % (issue['volume'], issue['issue'])
    return entry.get('section') or ''


def related_for(entry, entries):
    words = {w for w in re.split(r'[^a-z0-9]+', norm_title(entry['title'])) if len(w) > 4}
    label = label_of(entry)
    year = int(entry['date'][:4])
    scored = []
    for other in entries:
        if other['slug'] == entry['slug']:
            continue
        score = 5 if label and label_of(other) == label else 0
        for word in re.split(r'[^a-z0-9]+', norm_title(other['title'])):
            if word in words:
                score += 1
        if abs(int(other['date'][:4]) - year) <= 1:
            score += 0.5
        scored.append((score, other['date'], other))
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    keep = ('id', 'title', 'slug', 'date', 'author', 'section', 'issue',
            'card_image', 'cover_image', 'excerpt', 'minutes')
    return [{k: v for k, v in o.items() if k in keep} for _, _, o in scored[:3]]


def build_articles():
    articles = json.load(open(ARCHIVE, encoding='utf-8'))
    print('  %d articles from the archive' % len(articles))

    if os.path.isdir(MARKDOWN_DIR):
        written = sorted(f for f in os.listdir(MARKDOWN_DIR) if f.endswith('.md'))
        by_slug = {a['slug']: a for a in articles}
        for name in written:
            article = read_markdown_article(os.path.join(MARKDOWN_DIR, name))
            if article['slug'] in by_slug:
                by_slug[article['slug']].update(article)   # a rewrite of an existing piece
            else:
                articles.append(article)
        if written:
            print('  %d article(s) from content/articles/' % len(written))

    articles.sort(key=lambda a: a['date'], reverse=True)

    if os.path.isdir(ARTICLES_OUT):
        for name in os.listdir(ARTICLES_OUT):
            if name.endswith('.json'):
                os.remove(os.path.join(ARTICLES_OUT, name))
    else:
        os.makedirs(ARTICLES_OUT)

    index = []
    for article in articles:
        body = plain_text(article.get('content_html'))
        words = len(re.findall(r"[\w’'-]+", body))
        entry = {
            'id': article.get('id'),
            'title': article['title'],
            'slug': article['slug'],
            'date': article['date'],
            'author': article.get('author'),
            'section': article.get('section'),
            'issue': article.get('issue'),
            'escholarship_url': article.get('escholarship_url'),
            'cover_image': article.get('cover_image'),
            'card_image': card_image(article),
            'excerpt': (article.get('excerpt') or '').strip() or body[:260],
            'text': body[:SEARCH_CHARS],
            'minutes': max(1, round(words / WORDS_PER_MINUTE)),
        }
        index.append({k: v for k, v in entry.items() if v not in (None, '', [])})

    with open(INDEX_OUT, 'w', encoding='utf-8') as handle:
        json.dump(index, handle, ensure_ascii=False)

    by_slug = {e['slug']: e for e in index}
    for article in articles:
        payload = dict(article)
        payload['minutes'] = by_slug[article['slug']]['minutes']
        payload['related'] = related_for(by_slug[article['slug']], index)
        with open(os.path.join(ARTICLES_OUT, article['slug'] + '.json'), 'w',
                  encoding='utf-8') as handle:
            json.dump(payload, handle, ensure_ascii=False)

    size = os.path.getsize(INDEX_OUT) / 1024
    print('  wrote %s (%.0f KB) and %d per-article files'
          % (os.path.relpath(INDEX_OUT, ROOT), size, len(articles)))


# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--issues', action='store_true',
                        help='only refetch issues from eScholarship')
    parser.add_argument('--articles', action='store_true',
                        help='only rebuild the article index')
    args = parser.parse_args()

    everything = not (args.issues or args.articles)

    if args.issues or everything:
        print('Issues, from eScholarship:')
        build_issues()
    if args.articles or everything:
        print('Articles:')
        build_articles()

    print('\nDone. Preview with:  python3 -m http.server 8000')
    print('Then publish with:   ./scripts/deploy.sh')


if __name__ == '__main__':
    sys.exit(main())
