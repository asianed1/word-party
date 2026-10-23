#!/usr/bin/env python3
"""Rebuild data/common-words.txt (the default "everyday English" word list).

Source: SCOWL 2020.12.07 (http://wordlist.aspell.net/), size 55, English + American + British word lists
(these already contain inflected forms: plurals, -ed, -ing, comparatives...). We skip SCOWL's proper-name,
abbreviation, upper-case and contraction lists, keep only all-lowercase A-Z words of 2-15 letters, intersect with
ENABLE (so only game-legal spellings remain), drop data/common-exclude.txt (non-everyday 2-letter words) and
data/blocked-words.txt (slurs), and add data/common-add.txt (OK).

Usage: curl -LO https://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz && tar xzf scowl-2020.12.07.tar.gz
       python3 scripts/build-common-words.py scowl-2020.12.07/final
"""
import os, re, sys

LEVEL = 55
here = os.path.dirname(os.path.abspath(__file__))
data = os.path.join(here, '..', 'data')
final = sys.argv[1]
words = set()
for f in os.listdir(final):
    m = re.fullmatch(r'(english|american|british)-words\.(\d+)', f)
    if m and int(m.group(2)) <= LEVEL:
        for w in open(os.path.join(final, f), encoding='latin-1'):
            w = w.strip()
            if re.fullmatch(r'[a-z]{2,15}', w):
                words.add(w.upper())
enable = {w.strip().upper() for w in open(os.path.join(data, 'enable1.txt'))}
lines = lambda name: {l.strip().upper() for l in open(os.path.join(data, name)) if l.strip() and not l.startswith('#')}
out = ((words & enable) - lines('common-exclude.txt') - lines('blocked-words.txt')) | lines('common-add.txt')
with open(os.path.join(data, 'common-words.txt'), 'w') as fh:
    fh.write('\n'.join(sorted(out)) + '\n')
print(f'SCOWL {LEVEL}: {len(words)} words; after ENABLE filter + exclusions + additions: {len(out)}')
