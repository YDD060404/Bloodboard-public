#!/usr/bin/env python3
"""Extract the exercises of "BB School of Block - English.pdf" into
src/courses/blockSchoolData.json (positions, strengths, Guard, questions,
workbook answers, workbook page numbers).

Usage: python3 scripts/workbook/import_block_school.py "BB School of Block - English.pdf"
Needs `pdftotext` (poppler). The workbook's explanations are NOT copied; the
app writes its own explanations from the rules engine.
"""
import json, re, subprocess, sys, os

pdf = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'courses', 'blockSchoolData.json')
text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
pages = text.split('\f')

def page_of(idx_page):
    return idx_page + 1  # PDF page numbers equal the printed workbook page numbers

exercises = {}
answers = {}
for pi, page in enumerate(pages):
    lines = page.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = re.match(r'^Level (\d) - Exercise (\d+)$', line)
        if not m:
            i += 1
            continue
        level, num = int(m.group(1)), int(m.group(2))
        key = f'L{level}E{num}'
        # collect block until next "Level" header or end of page
        j = i + 1
        block = []
        while j < len(lines) and not re.match(r'^\s*Level \d - (Exercise \d+|Exercises|Answer Key)\s*$', lines[j]):
            block.append(lines[j])
            j += 1
        body = [b.rstrip() for b in block]
        ans_line = next((b.strip() for b in body if b.strip().startswith('Answer:')), '')
        is_key = ans_line and '____' not in ans_line and '/' not in ans_line.split('Choice')[0][8:] if ans_line else False
        if ans_line and '1D / 2D' not in ans_line and '____' not in ans_line:
            answers[key] = {'answer': ans_line[len('Answer:'):].strip(), 'page': page_of(pi)}
        elif key not in exercises:
            ex = {'id': key, 'level': level, 'number': num, 'page': page_of(pi), 'strength': {}, 'guard': [], 'cells': [], 'notes': []}
            header_idx = None
            for k, b in enumerate(body):
                s = b.strip()
                if re.match(r'^A(\s+[A-Z])+$', s):
                    header_idx = k
                    ex['cols'] = len(s.split())
                    continue
                if header_idx is not None and re.match(r'^\d+\s', s) and k > header_idx and k <= header_idx + 7:
                    toks = s.split()
                    row = int(toks[0])
                    cells = toks[1:]
                    if len(cells) != ex['cols']:
                        raise SystemExit(f'{key}: row {row} has {len(cells)} cells, expected {ex["cols"]}: {s!r}')
                    for c, tok in enumerate(cells):
                        if tok != '.':
                            ex['cells'].append({'id': tok, 'col': c, 'row': row - 1})
                    ex['rows'] = row
                    continue
                if s.startswith('Strength:'):
                    for pid, st in re.findall(r'([XY]\d+) = ST(\d)', s):
                        ex['strength'][pid] = int(st)
                    mo = re.search(r'All other players = ST(\d)', s)
                    ex['defaultST'] = int(mo.group(1)) if mo else 3
                elif s.startswith('All players are ST'):
                    ex['defaultST'] = int(re.search(r'ST(\d)', s).group(1))
                elif s.startswith('Guard:'):
                    ex['guard'] = re.findall(r'[XY]\d+', s)
            # question = text after the grid, before "Answer:"
            q = []
            after = False
            for b in body:
                s = b.strip()
                if header_idx is not None and re.match(r'^\d+\s', s):
                    after = True
                    continue
                if after and s.startswith('Answer:'):
                    break
                if after and s:
                    q.append(s)
            ex['question'] = ' '.join(q)
            mq = re.match(r'^([XY]\d+) blocks ([XY]\d+)\. How many Block dice\?$', ex['question'])
            if mq:
                ex['kind'] = 'count'
                ex['attacker'], ex['defender'] = mq.group(1), mq.group(2)
            else:
                ex['kind'] = 'setup'
                ex['attacker'], ex['defender'] = 'X1', 'Y1'
            exercises[key] = ex
        i = j

for key, ex in exercises.items():
    a = answers.get(key)
    if not a:
        raise SystemExit(f'no answer for {key}')
    ex['workbookAnswer'] = a['answer']
    ex['answerPage'] = a['page']
    ex.setdefault('defaultST', 3)

order = sorted(exercises.values(), key=lambda e: (e['level'], e['number']))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w') as f:
    json.dump({'source': 'BB School of Block - English.pdf (unofficial fan-made workbook by Ferns / Richard F. J., bbsob.net)', 'exercises': order}, f, indent=1)
from collections import Counter
print(len(order), 'exercises', dict(Counter(e['level'] for e in order)))
