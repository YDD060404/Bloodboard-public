// Vanguard 2.0 — "what can the opponent do to me afterwards?", searched adaptively, with the evidence graded.
//
// Same identity as 1.0: start from the built-in coach's own judgement (its candidate values and its pick), reuse the engine for every
// probability and every value, carry no strategic planner and no hand-set principle weights. What changes is HOW MUCH and HOW WELL the
// opponent's answer is examined, and how much a finding is trusted:
//
//   score(a) = builtInValue(a) + SHRINK·(corr(a) − corr(End the Turn)) − (pess(a) − pess(End the Turn))
//
//   corr(a)  = Σ over my outcomes o of p(o)·( worst value I can be left with after the opponent's best *continuation* − V(o if I stop) )
//              the continuation is up to 3 opponent actions in a row (Block/Blitz → follow-up → ball action …), searched only where the
//              first reply already hurts (selective extension); my own follow-up (relief) can repair a bad outcome in the deep rounds.
//   pess(a)  = penalty for what the search did not see: outcome mass not analysed, reply lists cut by time or by the stall rule.
//              An uncertain line is therefore scored lower, never higher.
//
// The opponent's reply is valued from MY side (perspective = my team letter, explicit). Opponent in-action choices (Block die, re-roll,
// push, follow-up) are solved as worst-for-me, mine as best-for-me.
// A challenger replaces the built-in pick only if (a) the reply analysis itself — not the built-in value — favours it by a margin that grows
// as its evidence shrinks, and (b) the total score agrees. Quiet positions stop after a cheap triage; critical ones are searched in rounds
// (triage → standard → deep → deeper) until the decision is stable or the time share is spent.
(function () {
  'use strict';
  const VERSION = '2.0';
  const BUDGET_SHARE = 0.8;
  const MAX_BUDGET_MS = 32000; // an upper ceiling for genuinely hard positions, never a target
  const SHRINK = 0.85; // the evaluation is a static estimate; a found reply is real but its size is not exact
  const CLIP = 30;
  const NOISE = 1.0; // one point = 1 % of a Touchdown; differences below it are not acted upon
  const BASE_MARGIN = 1.0;
  const opp = (t) => (t === 'A' ? 'B' : 'A');
  const jk = (i) => JSON.stringify(i);
  const rd = (x, n = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : x);
  const pc = (x) => `${Math.round((x || 0) * 100)}%`;
  const byId = (o, id) => o.players.find((p) => p.id === id);

  const ROUNDS = [
    { name: 'triage', cap: 0.15, roots: 2, R: { L: 10, S: 5, minTry: 4, M: 0, K: 0, depth: 1, cov: 0.6, maxOuts: 2 } },
    { name: 'standard', cap: 0.45, roots: 10, R: { L: 18, S: 8, minTry: 6, M: 0, K: 0, depth: 1, cov: 0.85, maxOuts: 4 } },
    { name: 'deep', cap: 0.7, roots: 4, relief: true, R: { L: 30, S: 12, minTry: 8, M: 3, K: 3, chainL: 12, depth: 2, cov: 0.95, maxOuts: 7 } },
    { name: 'deeper', cap: 1.0, roots: 3, relief: true, R: { L: 48, S: 20, minTry: 12, M: 4, K: 4, chainL: 18, depth: 3, cov: 0.98, maxOuts: 10 } },
  ];

  async function chooseAction(o, cands, sv) {
    const t0 = Date.now();
    const limit = Number(o.timeLimitMs) || 5000;
    const BUDGET = Math.max(900, Math.min(MAX_BUDGET_MS, limit * BUDGET_SHARE));
    const el = () => Date.now() - t0;
    const left = () => BUDGET - el();
    const me = o.team;
    const enemy = opp(me);
    const decisions = { own: 'best', opponent: 'worst' };
    const S = { calls: 0, explores: 0, cands: 0, cacheHits: 0, inexact: 0, maxUnresolved: 0, fail: {}, errors: 0, timeCuts: 0, deepest: 0, replyExplores: 0 };
    const trace = { coach: 'Vanguard ' + VERSION, budgetMs: Math.round(BUDGET), me, ctx: {}, rounds: [], rows: [], search: S };
    const note = (stage, headline, extra) => { if (typeof sv.progress === 'function' && el() > 1500) { try { void sv.progress({ stage, headline, ...extra }); } catch (e) { /* display only */ } } };
    const call = async (kind, fn) => {
      S.calls++;
      try {
        const r = await fn();
        if (!r) return null;
        if (r.ok === false) { if (kind !== 'quiet') { const c = r.code || 'error'; S.fail[c] = (S.fail[c] || 0) + 1; } return null; }
        const u = typeof r.unresolvedMass === 'number' ? r.unresolvedMass : 0;
        if (r.exact === false || u > 1e-9) { S.inexact++; S.maxUnresolved = Math.max(S.maxUnresolved, u); }
        return r;
      } catch (e) { S.errors++; return null; }
    };

    // ── the built-in coach's own list and pick ──────────────────────────────────────────────────────────────────
    const pool = cands.filter((c) => c.input).map((c) => ({ input: c.input, label: c.label, kind: c.kind, actor: c.actorId || null, gain: typeof c.builtInValue === 'number' ? c.builtInValue : null, pT: c.pTurnover || 0, pTd: c.pTouchdown || 0, legacyId: c.id }));
    if (!pool.some((c) => c.kind === 'endTurn')) pool.push({ input: { kind: 'endTurn' }, label: 'End the Turn', kind: 'endTurn', actor: null, gain: 0, pT: 0, pTd: 0, legacyId: null });
    else pool.forEach((c) => { if (c.kind === 'endTurn' && c.gain === null) c.gain = 0; });
    const endC = pool.find((c) => c.kind === 'endTurn');
    const builtinBest = pool.filter((c) => c.gain !== null).sort((a, b) => b.gain - a.gain)[0] || pool[0];
    const answerFor = (c, why) => { const a = { why: String(why).slice(0, 390), trace: finishTrace() }; if (c.kind === 'endTurn') a.endTurn = true; else if (c.legacyId !== null && c.legacyId !== undefined) a.candidateId = c.legacyId; else a.input = c.input; return a; };
    const base = (() => {
      const bc = o.builtInChoice;
      if (bc) { if (bc.endTurn) return endC; const hit = pool.find((c) => c.legacyId === bc.candidateId); if (hit) return hit; }
      return builtinBest;
    })();
    trace.builtIn = { label: base.label, gain: rd(base.gain), pTurnover: rd(base.pT, 3), pTouchdown: rd(base.pTd, 3) };
    const finishTrace = () => { S.elapsedMs = el(); const j = jk(trace); if (j.length > 36000) { trace.rows = trace.rows.slice(0, 8).map((r) => ({ ...r, outcomes: undefined })); trace.truncated = true; } return trace; };

    // Certain scoring: take it. (Deliberately unchanged from 1.0 — see docs: a delay is only right in end-game positions that
    // need a whole-game view, and a wrong delay forfeits a certain point.)
    const sure = pool.find((c) => c.pTd >= 0.999 && c.pT <= 0.001 && c.kind !== 'endTurn');
    if (sure) { trace.decision = { chosen: sure.label, stop: 'certain-touchdown' }; return answerFor(sure, `Vanguard ${VERSION}: certain Touchdown — ${sure.label}.`); }

    // Only options the built-in coach itself would not reject can replace its pick (its value > -0.5), plus End the Turn.
    const viable = (c) => c.kind === 'endTurn' || (c.gain !== null && c.gain > -0.5);
    if (base.kind === 'endTurn' && !pool.some((c) => c !== base && viable(c) && c.kind !== 'endTurn')) {
      trace.decision = { chosen: base.label, stop: 'only-option' };
      return answerFor(base, `Vanguard ${VERSION}: End the Turn — nothing else is worth doing (the built-in values of all other options are negative).`);
    }

    // ── light match context → how critical is this position? ────────────────────────────────────────────────────
    const ball = o.ball || {};
    const carrierId = ball.carrierId || ball.carrier || ball.holder || ball.playerId || null;
    const cp = carrierId ? byId(o, carrierId) : null;
    const carrierSide = cp ? (cp.team === me ? 'mine' : 'theirs') : 'loose';
    const lateTurn = (o.turnsPerHalf || 8) - (o.turn || 1) <= 1;
    let crit = 0.15;
    if (carrierSide !== 'loose') crit += carrierSide === 'mine' ? 0.25 : 0.3; else crit += 0.3;
    if (pool.some((c) => c.pTd >= 0.1)) crit += 0.25;
    if (base.pT >= 0.08) crit += 0.2;
    if (lateTurn) crit += 0.15;
    crit = Math.min(1, crit);
    trace.ctx = { carrier: carrierSide, turn: o.turn, of: o.turnsPerHalf, half: o.half, score: o.score, rerolls: o.rerolls && o.rerolls[me], crit: rd(crit), options: pool.length };

    // ── caches (positions are request-scoped keys; identical (key, input) answers are reused) ──────────────────────
    const exC = new Map();
    const EXR = { maxLeaves: 2500, maxOutcomes: 8 };
    const EXROOT = { maxLeaves: 8000, maxOutcomes: 14 };
    let rowDeadline = Infinity;
    const over = () => Math.min(BUDGET - el(), rowDeadline - Date.now()) < 120;
    const slice = (cap) => Math.max(100, Math.min(cap, (Math.min(BUDGET - el(), rowDeadline - Date.now())) * 0.3));
    async function exploreX(input, opts, cfg, cap, quiet) {
      const k = (opts.from || 'root') + '|' + opts.team + '|' + jk(input);
      const hit = exC.get(k);
      if (hit) { S.cacheHits++; return hit; }
      S.explores++;
      const r = await call(quiet ? 'quiet' : 'explore', () => sv.explore(input, { perspective: me, decisions, observations: false, ...cfg, ...opts, maxMs: slice(cfg.maxMs || 700) }));
      if (r && (r.exact || (r.unresolvedMass || 0) < 0.02)) exC.set(k, r);
      return r;
    }
    const bank = new Map(); // opponent inputs that hurt somewhere: tried first elsewhere (a threat does not disappear because I moved another piece)
    const lists = new Map();
    async function replyList(key) {
      if (lists.has(key)) return lists.get(key);
      const out = [];
      const seen = new Set();
      const ask = async (opts) => {
        const r = await call('cands', () => sv.candidates({ from: key, team: enemy, builtIn: false, maxMs: slice(900), ...opts }));
        S.cands++;
        if (r && r.candidates) for (const c of r.candidates) { if (!c.legal || !c.input) continue; const k = jk(c.input); if (seen.has(k)) continue; seen.add(k); out.push({ input: c.input, label: c.label, kind: c.family || c.kind }); }
      };
      await ask({ families: ['move', 'secure', 'pass', 'handoff'], precision: 'fast', minPTouchdown: 0.01, sort: 'pTouchdown', limit: 6 }); // scoring replies first
      await ask({ families: ['blitz', 'block'], precision: 'none', maxPerPlayer: 2, limit: 30 });
      await ask({ families: ['pass', 'handoff', 'secure', 'move'], precision: 'none', maxPerPlayer: 1, limit: 20 });
      await ask({ families: ['foul'], precision: 'none', maxPerPlayer: 1, limit: 4 });
      lists.set(key, out);
      return out;
    }

    // position where the opponent is to act after outcome `out` if I stop here
    async function stopState(out) {
      if (out.touchdown) return { td: true, V: out.value };
      if (!out.key) return null;
      if (out.active === enemy) return { key: out.key, V: out.value };
      if (out.active === me) {
        const r = await exploreX({ kind: 'endTurn' }, { from: out.key, team: me, maxOutcomes: 1 }, { maxLeaves: 200, maxMs: 400 });
        const f = r && r.outcomes && r.outcomes[0];
        if (!f || !f.key) return null;
        if (f.active !== enemy) return { end: true, V: f.value };
        return { key: f.key, V: f.value };
      }
      return { end: true, V: out.value };
    }

    // the opponent's best continuation (worst for me) from `key`, value from my side; `Vstand` = they simply stop
    async function replySearch(key, Vstand, R, depth) {
      const list0 = await replyList(key);
      const seenIn = new Set(list0.map((r) => jk(r.input)));
      const list = [...[...bank.values()].sort((a, b) => b.harm - a.harm).slice(0, 8).filter((b) => !seenIn.has(jk(b.input))).map((b) => ({ input: b.input, label: b.label, banked: true })), ...list0];
      let worst = { v: Vstand, label: 'End the Turn', chain: 0 };
      let tried = 0;
      let stall = 0;
      let stalled = false;
      let cut = false;
      const vals = [];
      for (const r of list) {
        if (tried >= R.L) break;
        if (over()) { cut = true; S.timeCuts++; break; }
        S.replyExplores++;
        const re = await exploreX(r.input, { from: key, team: enemy }, EXR, 0, !!r.banked);
        if (!re) continue;
        tried++;
        if (Vstand - re.value >= 1.5 && depth === 1) { const k = jk(r.input); const b = bank.get(k); if (!b || Vstand - re.value > b.harm) bank.set(k, { input: r.input, label: r.label, harm: Vstand - re.value }); }
        vals.push({ r, v: re.value, re });
        if (re.value < worst.v - 0.25) { worst = { v: re.value, label: r.label, chain: 1 }; stall = 0; } else stall++;
        if (stall >= R.S && tried >= R.minTry) { stalled = true; break; }
      }
      const exhausted = tried >= list.length && !cut;
      let trust = exhausted ? 1 : cut ? Math.max(0.25, 0.8 * (tried / Math.max(1, list.length))) : 0.75 + 0.25 * (tried / Math.max(1, list.length));
      if (!list.length) trust = 0.4;
      let reached = depth;
      // selective extension: where the opponent's answer hurts, let them continue (another action by the same side)
      if (depth < R.depth && R.M > 0 && !over()) {
        vals.sort((a, b) => a.v - b.v);
        for (const x of vals.slice(0, R.M)) {
          if (over()) break;
          const cont = (x.re.outcomes || []).filter((q) => q.key && q.active === enemy && !q.touchdown && !q.turnover).sort((a, b) => b.p - a.p).slice(0, R.K);
          if (!cont.length) continue;
          let v = x.v;
          let sub = null;
          for (const q of cont) {
            if (over()) break;
            const rs = await replySearch(q.key, q.value, { ...R, L: R.chainL, S: Math.min(R.S, 8), minTry: 4 }, depth + 1);
            v += q.p * (rs.worst.v - q.value);
            reached = Math.max(reached, rs.depth);
            if (!sub || q.p * (q.value - rs.worst.v) > sub.w) sub = { w: q.p * (q.value - rs.worst.v), label: rs.worst.label };
          }
          if (v < worst.v - 0.25) worst = { v, label: sub && sub.w > 0.05 ? `${x.r.label} → ${sub.label}` : x.r.label, chain: 2 };
        }
      }
      S.deepest = Math.max(S.deepest, reached);
      return { worst, trust, tried, pool: list.length, exhausted, stalled, cut, depth: reached };
    }

    // ── rows ────────────────────────────────────────────────────────────────────────────────────────────────────
    const rows = new Map();
    let Hmax = 2;
    async function openRow(c) {
      if (rows.has(c)) return rows.get(c);
      const row = { c, ex: null, outs: [], res: new Map(), level: -1, skip: null };
      rows.set(c, row);
      const ex = await exploreX(c.input, { team: me }, EXROOT, 2500);
      if (!ex) { row.skip = 'explore-failed'; return row; }
      row.ex = ex;
      row.pT = ex.pTurnover ?? c.pT;
      row.pTd = ex.pTouchdown ?? c.pTd;
      row.outs = (ex.outcomes || []).filter((x) => typeof x.p === 'number').sort((a, b) => b.p - a.p);
      row.unres = ex.unresolvedMass || 0;
      const tot = row.outs.reduce((a, x) => a + x.p, 0) + ((ex.rest && ex.rest.p) || 0);
      if (tot > 0 && Math.abs(tot - 1) > 1e-6) row.outs = row.outs.map((x) => ({ ...x, p: x.p / tot })); // probabilities of the listed outcomes + the unlisted rest sum to 1
      return row;
    }
    async function analyseOutcome(row, out, R, level) {
      const have = row.res.get(out);
      if (have && have.level >= level) return have;
      const st = await stopState(out);
      let r;
      if (!st) r = { harm: 0, trust: 0.4, depth: 0, label: 'no position kept', level };
      else if (st.td || st.end) r = { harm: 0, trust: 1, depth: 0, label: st.td ? 'touchdown' : 'turn/half ends', level };
      else {
        const rs = await replySearch(st.key, st.V, R, 1);
        r = { harm: Math.max(0, st.V - rs.worst.v), trust: rs.trust, depth: rs.depth, label: rs.worst.label, tried: rs.tried, pool: rs.pool, cut: rs.cut, stalled: rs.stalled, level, stopKey: st.key, Vs: st.V, worstV: rs.worst.v };
      }
      Hmax = Math.max(Hmax, r.harm);
      row.res.set(out, r);
      return r;
    }
    async function analyseRow(row, R, level, deadline) {
      if (row.skip || !row.outs.length) return;
      rowDeadline = deadline;
      let cov = 0;
      for (const out of row.outs) {
        if (cov >= R.cov || (cov > 0 && row.res.size >= R.maxOuts && !row.res.has(out) && level < 2)) break;
        if (el() > BUDGET || Date.now() > deadline) { if (cov < R.cov) S.timeCuts++; break; }
        await analyseOutcome(row, out, R, level);
        cov += out.p;
      }
      rowDeadline = Infinity;
      row.level = level;
    }
    async function reliefFor(row, level, deadline) {
      // own follow-up: can I repair the worst outcome by playing on? Only removes harm, never credits gain.
      const bad = [...row.res.entries()].filter(([out, r]) => out.active === me && r.harm >= Math.max(1.5, 0.3 * Hmax) && r.stopKey && !r.relief).sort((a, b) => b[0].p * b[1].harm - a[0].p * a[1].harm).slice(0, 2);
      for (const [out, r] of bad) {
        if (over() || Date.now() > deadline) break;
        rowDeadline = deadline;
        const fl = await call('cands', () => sv.candidates({ from: out.key, team: me, builtIn: false, precision: 'none', families: ['secure', 'move', 'blitz', 'block', 'pass', 'handoff'], maxPerPlayer: 1, limit: 30, maxMs: slice(900) }));
        const byFam = {};
        for (const c of (fl && fl.candidates) || []) if (c.legal && c.input) (byFam[c.family || c.kind] = byFam[c.family || c.kind] || []).push(c);
        const picks = [];
        for (let i = 0; picks.length < 6 && i < 6; i++) for (const f of ['secure', 'move', 'blitz', 'block', 'pass', 'handoff']) if (byFam[f] && byFam[f][i] && picks.length < 6) picks.push(byFam[f][i]);
        let best = r.worstV;
        let bestLabel = null;
        for (const f of picks) {
          if (over()) break;
          const e2 = await exploreX(f.input, { from: out.key, team: me }, EXR);
          if (!e2) continue;
          let acc = 0, mass = 0;
          for (const o2 of (e2.outcomes || []).sort((a, b) => b.p - a.p).slice(0, 3)) {
            const st = await stopState(o2);
            let v = o2.value;
            if (st && st.key) { const rs = await replySearch(st.key, st.V, { L: 10, S: 5, minTry: 4, M: 0, K: 0, depth: 1 }, 1); v = rs.worst.v; } else if (st) v = st.V;
            acc += o2.p * v; mass += o2.p;
          }
          const vf = acc + (1 - mass) * e2.value;
          if (vf > best) { best = vf; bestLabel = f.label; }
        }
        rowDeadline = Infinity;
        const after = r.Vs - Math.min(r.Vs, best);
        r.relief = { follow: bestLabel, harmBefore: rd(r.harm), harmAfter: rd(after) };
        if (bestLabel) r.harm = Math.min(r.harm, after);
      }
    }
    function summarise(row) {
      let an = 0, corr = 0, tr = 0;
      let top = null;
      for (const [out, r] of row.res) { an += out.p; corr -= out.p * r.harm; tr += out.p * r.trust; if (!top || out.p * r.harm > top.w) top = { w: out.p * r.harm, out, r }; }
      const covered = Math.min(1, an);
      row.cov = covered;
      row.corr = covered > 0 ? corr / covered : 0; // unanalysed mass is valued like the analysed
      row.trust = Math.max(0, Math.min(1, tr + 0.5 * (1 - covered) - (row.unres || 0)));
      row.pessRaw = (an - tr) + 0.5 * (1 - covered) + (row.unres || 0); // mass-weighted distrust, plus engine mass that was never enumerated
      row.top = top;
      row.depth = Math.max(0, ...[...row.res.values()].map((r) => r.depth));
    }
    function score(all) {
      const endRow = rows.get(endC);
      const ref = endRow && !endRow.skip ? endRow : null;
      const scale = Math.max(2, 0.5 * Hmax);
      for (const row of all) {
        if (row.skip || !row.res.size) { row.score = null; continue; }
        const rel = SHRINK * (row.corr - (ref ? ref.corr : 0)) - scale * (row.pessRaw - (ref ? ref.pessRaw : 0));
        row.rel = Math.max(-CLIP, Math.min(CLIP, rel));
        row.s = (row.c.gain ?? 0) + row.rel;
        row.score = row.s;
      }
    }
    const sig = (c) => (c.kind === 'endTurn' ? 'end' : `${c.kind}|${c.actor || c.label.split(':')[0]}`);
    function pickRoots(n, keep) {
      const g = pool.filter((c) => c.gain !== null && (viable(c) || c === base) && (!keep || keep(c)));
      const out = [endC, base];
      const sigs = new Set(out.map(sig));
      const add = (c) => { if (c && !out.includes(c) && !sigs.has(sig(c))) { out.push(c); sigs.add(sig(c)); } };
      const byGain = [...g].sort((a, b) => b.gain - a.gain);
      byGain.slice(0, Math.ceil(n / 2)).forEach(add);
      if (out.length < n) add([...g].filter((c) => c.pTd > 0.02).sort((a, b) => b.pTd - a.pTd)[0]);
      if (out.length < n) add([...g].filter((c) => c.gain > 0).sort((a, b) => a.pT - b.pT || b.gain - a.gain)[0]);
      for (const fam of ['blitz', 'block', 'secure', 'pass', 'handoff', 'move']) { if (out.length >= n) break; add(byGain.find((c) => c.kind === fam)); }
      for (const c of byGain) { if (out.length >= n) break; add(c); }
      return out.slice(0, Math.max(n, 2));
    }
    // choice with the evidence rule
    function choose(all) {
      const sc = all.filter((r) => r.score !== null && !r.skip);
      const baseRow = rows.get(base);
      if (!baseRow || baseRow.score === null) return { best: base, row: baseRow, why: 'built-in pick kept (no analysis of it)', conf: 'low', gap: 0 };
      const allowed = sc.filter((r) => (r.c.kind === 'endTurn' ? true : r.c.gain > -0.5));
      let best = baseRow, rival = null;
      for (const r of allowed.sort((a, b) => b.score - a.score)) {
        if (r === baseRow) continue;
        const M = BASE_MARGIN + 4 * (1 - r.trust);
        const evidence = r.rel - baseRow.rel; // what the opponent-reply analysis says, apart from the built-in values
        rival = rival || r;
        if (r.trust >= 0.6 && r.score - baseRow.score >= M && evidence >= Math.max(M, NOISE)) { best = r; break; }
      }
      const second = sc.filter((r) => sig(r.c) !== sig(best.c ? best.c : best)).sort((a, b) => b.score - a.score)[0];
      const gap = second ? best.score - second.score : 99;
      const conf = best.trust >= 0.85 && gap >= 2 ? 'high' : best.trust >= 0.6 && gap >= 1 ? 'medium' : 'low';
      // a rival is worth more search only if, with its distrust removed (its best case), it could still pass the chosen line by the margin
      const endRow = rows.get(endC);
      const scale = Math.max(2, 0.5 * Hmax);
      const optimistic = (r) => r.score + scale * Math.max(0, r.pessRaw - (endRow ? endRow.pessRaw : 0));
      const rivals = allowed.filter((r) => sig(r.c) !== sig(best.c) && optimistic(r) >= best.score + BASE_MARGIN + (1 - best.trust) * 2);
      return { best: best.c, row: best, rival, gap, conf, rivals: rivals.length };
    }

    // ── rounds ──────────────────────────────────────────────────────────────────────────────────────────────────
    const all = () => [...rows.values()];
    let prevChoice = null;
    let stop = 'budget';
    let capCrit = crit;
    let voiBound = Infinity;
    for (let ri = 0; ri < ROUNDS.length; ri++) {
      const rc = ROUNDS[ri];
      if (ri === 3 && capCrit < 0.5) { stop = 'effort-cap'; break; }
      const cap = BUDGET * (ri < 2 ? rc.cap : ri === 2 ? 0.45 + 0.3 * capCrit : 0.75 + 0.25 * capCrit);
      if (el() >= cap * 0.98) { stop = 'effort-cap'; continue; }
      const rr0 = Date.now();
      let roots;
      if (ri === 1) {
        roots = pickRoots(rc.roots, (c) => c === base || c === endC || c.gain + voiBound + 0.5 >= base.gain + BASE_MARGIN);
        if (roots.every((c) => c === base || c === endC)) { stop = 'no-challenger-can-win'; break; } // nothing else is within reach of the margin
      } else if (ri < 2) roots = pickRoots(rc.roots);
      else {
        const cur = all().filter((r) => r.score !== null && !r.skip).sort((a, b) => b.score - a.score);
        const best = cur[0];
        const win = cur.filter((r) => best.score - r.score <= 8 + 4 * (1 - r.trust));
        roots = [endC, base, ...win.map((r) => r.c)].filter((c, i, a) => a.indexOf(c) === i).slice(0, rc.roots);
      }
      note(rc.name, `${rc.name}: ${roots.length} options, opponent replies up to ${rc.R.depth} action(s) deep.`, { evaluating: roots.slice(0, 4).map((c) => c.label) });
      let n = 0;
      for (const c of roots) {
        if (el() >= cap) break;
        const row = await openRow(c);
        const remaining = roots.length - n;
        const dl = Date.now() + Math.max(150, (t0 + cap - Date.now()) / remaining);
        await analyseRow(row, rc.R, ri, dl);
        if (rc.relief && c !== endC && row.res.size) await reliefFor(row, ri, dl + 1500);
        summarise(row);
        n++;
      }
      score(all());
      const ch = choose(all());
      const sorted = all().filter((r) => r.score !== null).sort((a, b) => b.score - a.score);
      trace.rounds.push({ name: rc.name, ms: Date.now() - rr0, at: el(), rows: roots.length, best: ch.best.label, conf: ch.conf });
      note(rc.name, `${rc.name} done: ${sorted.length} options analysed.`, { best: { label: ch.best.label, value: rd(ch.row && ch.row.score, 1) }, ruledOut: sorted.slice(1, 4).map((r) => `${r.c.label}: ${rd(sorted[0].score - r.score, 1)} behind`) });
      // criticality is also learned from what the search finds
      const baseRow = rows.get(base), endRow = rows.get(endC);
      const hBase = baseRow && baseRow.corr !== undefined ? -baseRow.corr : 0;
      const hEnd = endRow && endRow.corr !== undefined ? -endRow.corr : 0;
      if (ri === 0 && baseRow && baseRow.score !== null) {
        // Value of information: a challenger must beat the built-in pick by M, and the reply analysis can only favour it by what the
        // built-in pick's own reply problems (plus its distrust) are worth. If that bound is below the margin, no search can change the move.
        const scale = Math.max(2, 0.5 * Hmax);
        const bound = SHRINK * hBase + scale * Math.max(0, baseRow.pessRaw - (endRow ? endRow.pessRaw : 0));
        trace.voi = { bound: rd(bound), harmBase: rd(hBase), harmEnd: rd(hEnd) };
        if (bound < BASE_MARGIN) { stop = 'no-challenger-can-win'; break; }
        voiBound = bound;
      }
      if (ri === 0) {
        const quiet = hEnd <= 1.5 * NOISE && hBase - hEnd <= NOISE && base.pT < 0.02 && (!baseRow || baseRow.trust >= 0.6);
        if (quiet) { stop = 'quiet'; break; }
      }
      if (hBase >= 3 || hEnd >= 5 || ch.rivals > 0) capCrit = Math.max(capCrit, 0.75);
      if (ri >= 1) {
        const same = prevChoice && prevChoice === ch.best;
        if (ch.rivals === 0) { stop = 'settled'; break; }
        if (ri >= 2 && same && (ch.best === base || ch.conf !== 'low')) { stop = 'settled'; break; }
      }
      prevChoice = ch.best;
    }
    if (stop === 'budget' && el() < BUDGET * 0.97) stop = 'effort-cap';

    const final = choose(all());
    const best = final.best;
    const bestRow = rows.get(best), baseRow = rows.get(base);
    if (!bestRow || bestRow.score === null) {
      trace.decision = { chosen: base.label, stop: 'no-analysis' };
      return answerFor(base, `Vanguard ${VERSION}: no time to look ahead; built-in pick (${base.label}).`);
    }
    const rowOut = (r) => {
      const t = r.top;
      return {
        label: r.c.label, kind: r.c.kind, builtIn: rd(r.c.gain), pTurnover: rd(r.pT, 3), pTouchdown: rd(r.pTd, 3),
        analysed: rd(r.cov, 3), trust: rd(r.trust, 2), depth: r.depth, unresolved: rd(r.unres, 4),
        corr: rd(r.corr), rel: rd(r.rel), score: rd(r.score),
        threat: t && t.r.harm > 0.3 ? { p: rd(t.out.p, 3), harm: rd(t.r.harm), reply: t.r.label, tried: t.r.tried, pool: t.r.pool, cut: !!t.r.cut, relief: t.r.relief || undefined } : null,
      };
    };
    trace.rows = all().filter((r) => r.score !== null).sort((a, b) => b.score - a.score).slice(0, 12).map(rowOut);
    const changed = best !== base;
    trace.decision = { chosen: best.label, builtInWould: base.label, overridden: changed, confidence: final.conf, gap: rd(final.gap, 1), stop, hmax: rd(Hmax), crit: rd(capCrit) };
    const th = bestRow.top && bestRow.top.r.harm > 0.3 ? ` Worst reply: ${bestRow.top.r.label} (${rd(bestRow.top.r.harm, 1)} pts in ${pc(bestRow.top.out.p)} of cases).` : '';
    let why = `Vanguard ${VERSION}: ${best.label} — built-in ${rd(best.gain, 1)}, reply ${bestRow.rel >= 0 ? '+' : ''}${rd(bestRow.rel, 1)}; trust ${pc(bestRow.trust)}, depth ${bestRow.depth}; ${stop}, ${final.conf}.`;
    if (changed && baseRow && baseRow.score !== null) {
      const br = baseRow.top && baseRow.top.r.harm > 0.3 ? ` (${base.label}: ${baseRow.top.r.label} costs ${rd(baseRow.top.r.harm, 1)})` : '';
      why += ` Overrides the built-in ${base.label}${br}.`;
    } else why += th;
    return answerFor(best, why);
  }

  bloodboard.register({
    id: 'vanguard-2-0',
    name: 'Vanguard 2.0',
    apiVersion: 1,
    apiMinor: 2,
    requires: ['candidates', 'explore', 'evaluate'],
    version: VERSION,
    description: 'The built-in coach\'s judgement plus an adaptive, evidence-graded search of what the opponent can do next (up to 3 actions in a row). Quiet positions stop early; critical ones use the full allowance.',
    timeLimitMs: 40000,
    chooseAction,
    chooseDecision() { return null; },
  });
})();
