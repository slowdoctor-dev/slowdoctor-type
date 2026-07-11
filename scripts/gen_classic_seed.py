#!/usr/bin/env python3
"""Generate migrations/0002_classic_seed.sql from Gutenberg texts, verbatim.

Extraction: find anchor phrase -> take that whole paragraph (and optionally
the next N paragraphs) -> normalize like the Rust ingest (straight quotes,
ASCII dashes, collapsed whitespace, _italics_ markers stripped) -> chunk to
40-85 words at sentence boundaries (min flush 40, floor 25).
"""
import re, sys, html

S = "/tmp"

WORKS = [
    {
        "file": f"{S}/gb-205.txt",
        "id": "gutenberg-205-walden",
        "title": "Walden",
        "attribution": "Henry David Thoreau, Walden (1854) — public domain",
        "url": "https://www.gutenberg.org/ebooks/205",
        "anchors": [
            ("I went to the woods because I wished to live deliberately", 2),
            ("The mass of men lead lives of quiet desperation", 1),
            ("Time is but the stream I go a-fishing in", 1),
        ],
    },
    {
        "file": f"{S}/gb-16643.txt",
        "id": "gutenberg-16643-self-reliance",
        "title": "Self-Reliance (Essays: First Series)",
        "attribution": "Ralph Waldo Emerson, Self-Reliance (1841) — public domain",
        "url": "https://www.gutenberg.org/ebooks/16643",
        "anchors": [
            ("There is a time in every man's education", 1),
            ("Whoso would be a man must be a nonconformist", 1),
            ("A foolish consistency is the hobgoblin of little minds", 1),
        ],
    },
    {
        "file": f"{S}/gb-5827.txt",
        "id": "gutenberg-5827-problems-philosophy",
        "title": "The Problems of Philosophy",
        "attribution": "Bertrand Russell, The Problems of Philosophy (1912) — public domain",
        "url": "https://www.gutenberg.org/ebooks/5827",
        "anchors": [
            ("The man who has no tincture of philosophy", 1),
            ("Philosophy is to be studied, not for the sake of any definite answers", 1),
        ],
    },
    {
        "file": f"{S}/gb-148.txt",
        "id": "gutenberg-148-franklin",
        "title": "The Autobiography of Benjamin Franklin",
        "attribution": "Benjamin Franklin, Autobiography (1791) — public domain",
        "url": "https://www.gutenberg.org/ebooks/148",
        "anchors": [
            ("It was about this time I conceiv", 2),  # spelling varies: conceiv'd
        ],
    },
]

MIN_W, MAX_W, FLOOR_W = 40, 85, 25

def paragraphs(path):
    raw = open(path, encoding="utf-8-sig", errors="ignore").read()
    raw = raw.replace("\r\n", "\n")
    paras = [re.sub(r"\s+", " ", p).strip() for p in raw.split("\n\n")]
    return [p for p in paras if p]

def normalize(t):
    t = t.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    t = t.replace("–", "-").replace("—", "-").replace("‐", "-").replace("‑", "-")
    t = t.replace("…", "...").replace(" ", " ")
    t = re.sub(r"_(.+?)_", r"\1", t)  # gutenberg italics markers
    t = re.sub(r"\s+", " ", t).strip()
    return t

def sentences(t):
    out, cur = [], ""
    for i, ch in enumerate(t):
        cur += ch
        if ch in ".?!" and (i + 1 == len(t) or t[i + 1].isspace()):
            out.append(cur.strip()); cur = ""
    if cur.strip():
        out.append(cur.strip())
    return out

def chunk(paras):
    chunks, cur, curw = [], "", 0
    def flush():
        nonlocal cur, curw
        if curw >= FLOOR_W:
            chunks.append(cur.strip())
        cur, curw = "", 0
    for p in paras:
        w = len(p.split())
        if w > MAX_W:
            flush()
            pieces, pc, pw = [], "", 0
            for s in sentences(p):
                sw = len(s.split())
                if pw > 0 and pw + sw > MAX_W:
                    pieces.append(pc.strip()); pc, pw = "", 0
                pc = (pc + " " + s).strip(); pw += sw
            tail = pc.strip()
            if tail:
                if len(tail.split()) >= FLOOR_W or not pieces:
                    pieces.append(tail)
                elif pieces:
                    pieces[-1] += " " + tail
            chunks.extend([x for x in pieces if len(x.split()) >= FLOOR_W])
            continue
        if curw > 0 and curw + w > MAX_W:
            flush()
        cur = (cur + " " + p).strip(); curw += w
        if curw >= MIN_W:
            flush()
    flush()
    return chunks

def sq(s):
    return s.replace("'", "''")

lines = ["-- classic track seed: verbatim Project Gutenberg extracts (US public domain),",
         "-- generated 2026-07-10 by scripts documented in AGENTS.md. Do not hand-edit texts."]
total = 0
for w in WORKS:
    paras = paragraphs(w["file"])
    picked = []
    for anchor, take in w["anchors"]:
        idx = next((i for i, p in enumerate(paras) if anchor.lower() in p.lower()), None)
        if idx is None:
            print(f"!! anchor not found in {w['id']}: {anchor}", file=sys.stderr)
            continue
        picked.extend(paras[idx: idx + take])
    if not picked:
        continue
    passages = chunk([normalize(p) for p in picked])
    if not passages:
        continue
    lines.append("")
    lines.append(
        "INSERT OR IGNORE INTO articles (id, url, title, source, track, license, attribution, published_at, fetched_at) "
        f"VALUES ('{w['id']}', '{w['url']}', '{sq(w['title'])}', 'gutenberg', 'classic', 'public-domain', '{sq(w['attribution'])}', NULL, datetime('now'));"
    )
    for i, p in enumerate(passages):
        wc = len(p.split())
        lines.append(
            f"INSERT OR IGNORE INTO passages (article_id, seq, text, word_count) VALUES ('{w['id']}', {i}, '{sq(p)}', {wc});"
        )
        total += 1
    print(f"{w['id']}: {len(passages)} passages")

open("migrations/0002_classic_seed.sql", "w").write("\n".join(lines) + "\n")
print(f"total passages: {total}")
