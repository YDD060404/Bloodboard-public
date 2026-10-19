#!/usr/bin/env python3
"""Compare two bench-engine outputs position by position: same numbers (within tolerance) and latency ratio.
usage: bench-compare.py before.json after.json"""
import json, sys
def close(a, b, tol=1e-9):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= tol * max(1, abs(a), abs(b))
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(close(a[k], b[k], tol) for k in a)
    return a == b
A = {p['id']: p for p in json.load(open(sys.argv[1]))['positions']}
B = {p['id']: p for p in json.load(open(sys.argv[2]))['positions']}
for k in A:
    if k not in B: continue
    a, b = A[k]['out'], B[k]['out']
    diffs = [f for f in ('candidates', 'risky', 'blitz', 'scoring', 'explore', 'threats') if not close(a.get(f), b.get(f))]
    print(f"{k:34s} before {A[k]['totalMs']:7d} ms  after {B[k]['totalMs']:7d} ms  ratio {A[k]['totalMs']/max(1,B[k]['totalMs']):5.2f}x  maxUnresolved {A[k]['maxUnresolved']:.3g} -> {B[k]['maxUnresolved']:.3g}  identical: {'yes' if not diffs else 'NO ' + ','.join(diffs)}")
