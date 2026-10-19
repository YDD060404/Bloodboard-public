// Hopeful 0.2 — user-directed tactical coach on Bloodboard Strategy API 1.2 (platform services).
//
// A separate module from Hopeful 0.1 (which is unchanged and remains the baseline). It uses only generic services:
// `candidates`, `explore` (with an explicit decision policy), `threats.*`, `sequence` is not needed. Nothing in the
// platform knows these principles; every number below belongs to this coach.
//
// Bounded search (all exact engine enumeration, limits reported in `trace.search`):
//   1. THIS Turn     — shortlist legal candidates, explore each one's outcomes (Block dice / re-roll / push choices are
//                      solved: own choices best, the opponent's worst for us).
//   2. OPPONENT reply — for the most promising actions, end the Turn in each likely outcome and look at the opponent's
//                      best single reply (every legal action they have there, valued from our side), their direct
//                      scoring threats, and their Blitzes on our ball carrier.
//   3. NEXT Turn      — after that reply, our own direct scoring chance next Turn.
// The search is depth-limited (one opponent action, not a whole opponent Turn) and breadth-limited; see README.
(function () {
  'use strict';

  // ── Principle constants (Hopeful's, documented in docs/HOPEFUL_0_2.md) ───────────────────────────────────────────
  // Opponent Blitz on our carrier: the opponent's own Turnover chance must be at least this, by Block dice.
  // 1 die 90% and 2 dice 95% are the supplied standards; 3 dice 96.9% is derived from engine outcomes (see docs).
  const BLITZ_TURNOVER_MIN = { 1: 0.90, 2: 0.95, 3: 0.969 };
  const thresholdFor = (dice) => BLITZ_TURNOVER_MIN[Math.max(1, Math.min(3, dice || 1))];

  const W = {
    turnoverOwn: 12, // per unit Turnover probability (of this Turn)
    turnoverCarrier: 18, // …when we hold the ball
    lastTurnTd: 120, // extra value per unit TD probability on our last Turn of the half (scoring urgency)
    exposedCarrier: 6, // carrier can be Blitzed below the standard (kept small: the search already values the Blitz reply itself)
    exposedBall: 8, // × chance the Blitz frees the ball / knocks the carrier down
    crowd: 10, // × chance a Blitz pushes the carrier into the crowd
    oppScore: 60, // × the opponent's direct scoring chance next Turn (route denial)
    nextScore: 26, // × our own direct scoring chance next Turn
    looseBall: 30, // × gain in chance we hold the ball (ball first)
    foulOffBall: 10,
    unreliable: 3,
  };
  const BUDGET_SHARE = 0.8; // the search may use up to 80% of the module's own time limit (48 s of the 60 s maximum); the rest is headroom for the one engine call in flight when the budget ends
const MAX_BUDGET_MS = 48000; // and returns earlier when the search space is covered

  const opposite = (t) => (t === 'A' ? 'B' : 'A');
  const cheb = (a, b) => (a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : 99);
  const has = (p, skill) => (p?.skills || []).some((s) => s === skill || s.startsWith(skill + '('));
  const byId = (o, id) => o.players.find((p) => p.id === id);
  const carrierOf = (o) => (o.ball && o.ball.kind === 'held' ? byId(o, o.ball.playerId) : null);
  const keyOf = (i) => JSON.stringify(i);
  const round = (x, n = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : x);
  const UNRELIABLE = ['reallyStupid', 'boneHead', 'wildAnimal', 'unsteady', 'takeRoot'];

  async function chooseAction(o, cands, sv) {
    const t0 = Date.now();
    const BUDGET_MS = Math.max(1200, Math.min(MAX_BUDGET_MS, (Number(o.timeLimitMs) || 60000) * BUDGET_SHARE));
    // Breadth grows with the time available (more lines, more outcomes, more opponent replies).
    const big = BUDGET_MS >= 20000;
    const L1_MAX = big ? 22 : 14;
    const DEEP_MAX = big ? 7 : 4;
    const OUTCOMES_PER_DEEP = big ? 3 : 2;
    const REPLIES = big ? 22 : 14;
    const EX = big ? { maxLeaves: 6000, maxMs: 2500, maxOutcomes: 8 } : { maxLeaves: 1500, maxMs: 900, maxOutcomes: 6 }; // first-action exploration
    const EXR = big ? { maxLeaves: 2500, maxMs: 1200, maxOutcomes: 5 } : { maxLeaves: 500, maxMs: 350, maxOutcomes: 4 }; // opponent-reply exploration
    const left = () => BUDGET_MS - (Date.now() - t0);
    const me = o.team;
    const opp = opposite(me);
    const trace = { coach: 'Hopeful 0.2', turn: o.turn[me], turnsPerHalf: o.turnsPerHalf, thresholds: BLITZ_TURNOVER_MIN, shortlist: [], deep: [], search: { calls: 0, budgetMs: BUDGET_MS } };
    // Progress notes for the person watching (display only; facts from the engine). Sent once a decision takes > 1.2 s.
    const note = (stage, headline, extra) => { if (typeof sv.progress === 'function' && Date.now() - t0 > 1200) { try { void sv.progress({ stage, headline, ...extra }); } catch (e) { /* display only */ } } };
    const pc = (x) => `${Math.round((x || 0) * 100)}%`;
    const call = async (fn) => { trace.search.calls++; try { const r = await fn(); if (r && r.ok !== false) { const u = typeof r.unresolvedMass === 'number' ? r.unresolvedMass : Number(r.unresolved) || 0; if (r.exact === false || u > 1e-9) { trace.search.inexactCalls = (trace.search.inexactCalls || 0) + 1; trace.search.maxUnresolved = Math.max(trace.search.maxUnresolved || 0, u); } } return r; } catch (e) { trace.search.errors = (trace.search.errors || 0) + 1; return null; } };
    const carrier = carrierOf(o);
    const ownCarrier = carrier && carrier.team === me ? carrier : null;
    const oppCarrier = carrier && carrier.team === opp ? carrier : null;
    const lastTurn = o.turn[me] >= o.turnsPerHalf;
    const ballLoose = o.ball.kind === 'ground';
    const decisions = { own: 'best', opponent: 'worst' };

    // ── 1. candidates: the legacy list plus targeted, engine-generated legal candidates ──────────────────────────
    const pool = new Map();
    const add = (c, src) => {
      if (!c || c.legal === false || !c.input) return;
      const k = keyOf(c.input);
      const cur = pool.get(k);
      if (cur) { cur.src.add(src); return; }
      pool.set(k, { input: c.input, label: c.label, kind: c.kind, family: c.family || c.kind, actorId: c.actorId ?? c.playerId ?? null, targetId: c.targetId ?? null, pSuccess: c.pSuccess, pTurnover: c.pTurnover ?? 0, pTouchdown: c.pTouchdown ?? 0, pActiveHasBall: c.pActiveHasBall, builtIn: c.builtInValue ?? c.builtIn?.builtInValue ?? null, src: new Set([src]), legacyId: typeof c.id === 'number' ? c.id : null, serviceId: typeof c.id === 'string' ? c.id : null, dest: c.destination || null });
    };
    cands.forEach((c) => add(c, 'built-in'));
    const fetchC = async (opts, src) => { if (left() < BUDGET_MS * 0.7) { trace.search.fetchSkipped = (trace.search.fetchSkipped || 0) + 1; return; } const r = await call(() => sv.candidates({ builtIn: true, maxMs: Math.max(200, Math.min(2500, left() * 0.5)), ...opts })); if (r && r.ok) r.candidates.forEach((c) => add(c, src)); };
    // Targeted, pre-filtered requests: exact probabilities cost real time, so each call names the players / targets that
    // matter for a principle instead of asking the engine to rank everything.
    const nearCarrier = (p) => ownCarrier && p.pos && ownCarrier.pos && cheb(p.pos, ownCarrier.pos) <= 2;
    const threatTargets = o.players.filter((p) => p.team === opp && p.location === 'pitch' && p.stance === 'standing' && (nearCarrier(p) || (oppCarrier && p.id === oppCarrier.id))).map((p) => p.id).slice(0, 4);
    if (ownCarrier) {
      await fetchC({ players: [ownCarrier.id], families: ['move'], sort: 'goalDistance', limit: 6 }, 'carrier-route');
      await fetchC({ families: ['pass', 'handoff'], limit: 8, maxPerPlayer: 4 }, 'ball-work');
    }
    if (threatTargets.length) await fetchC({ families: ['block', 'blitz'], targets: threatTargets, maxPerPlayer: 2, limit: 10 }, 'threat-hits');
    await fetchC({ families: ['secure', 'standUp'], limit: 6 }, 'ball-work');
    if (ballLoose) await fetchC({ families: ['move'], region: { within: nearBall(o) }, sort: 'steps', maxPerPlayer: 2, limit: 8 }, 'ball-recovery');
    add({ input: { kind: 'endTurn' }, kind: 'endTurn', family: 'endTurn', label: 'End the Turn', pTurnover: 0, pTouchdown: 0 }, 'end');
    if (!pool.size) return null;

    // Early return: on our last Turn a route that scores for certain needs no search.
    if (lastTurn) {
      const sure = [...pool.values()].filter((c) => c.pTouchdown >= 0.999).sort((a, b) => a.pTurnover - b.pTurnover)[0];
      if (sure) return { ...(sure.serviceId ? { candidateId: sure.serviceId } : sure.legacyId !== null ? { candidateId: sure.legacyId } : { input: sure.input }), why: `Hopeful 0.2: certain Touchdown on the last Turn — ${sure.label}.`, trace: { coach: 'Hopeful 0.2', early: 'certain touchdown', search: { calls: trace.search.calls, elapsedMs: Date.now() - t0 } } };
    }

    // ── shortlist by cheap principle score (probabilities are exact engine numbers) ──────────────────────────────
    const all = [...pool.values()];
    all.forEach((c) => { c.cheap = cheapScore(o, c, { me, opp, ownCarrier, oppCarrier, ballLoose, lastTurn }); });
    all.sort((a, b) => b.cheap - a.cheap);
    const pick = new Map();
    const take = (list, n) => list.slice(0, n).forEach((c) => pick.set(keyOf(c.input), c));
    take(all, 7);
    take(all.filter((c) => c.pTouchdown > 0).sort((a, b) => b.pTouchdown - a.pTouchdown), 3);
    take(all.filter((c) => c.builtIn !== null).sort((a, b) => b.builtIn - a.builtIn), 4);
    take(all.filter((c) => c.kind === 'endTurn'), 1);
    const short = [...pick.values()].slice(0, L1_MAX);
    note('options', `${all.length} legal options found; ${short.length} shortlisted for exact outcome checks.`, { evaluating: short.slice(0, 4).map((c) => c.label) });
    trace.search.pool = all.length;
    trace.search.shortlisted = short.length;

    // ── 2. this Turn: exact outcomes of each shortlisted action ──────────────────────────────────────────────────
    for (const c of short) {
      if (left() < BUDGET_MS * 0.55) { c.skipped = 'budget'; continue; }
      const ex = await call(() => sv.explore(c.input, { team: me, decisions, ...EX, observations: true }));
      if (!ex || !ex.ok) { c.skipped = 'explore-failed'; continue; }
      c.ex = ex;
      c.l1 = ex.value - principleTerms(c, ex, { lastTurn, ownCarrier, ballLoose, o }).sum;
      c.terms = principleTerms(c, ex, { lastTurn, ownCarrier, ballLoose, o });
    }
    const scored = short.filter((c) => c.ex).sort((a, b) => b.l1 - a.l1);
    if (scored.length) {
      const top = scored[0];
      const out = scored.slice(1).filter((c) => top.l1 - c.l1 > 6 || c.pTurnover > top.pTurnover + 0.15).slice(0, 5).map((c) => `${c.label}: ${pc(c.pTurnover)} Turnover, ${Math.round(top.l1 - c.l1)} points behind`);
      note('this-turn', `Exact outcomes of ${scored.length} actions checked; next: the opponent's reply.`, { ruledOut: out, best: { label: top.label, pTurnover: top.pTurnover, pTouchdown: top.pTouchdown, value: round(top.l1, 1) } });
    }
    if (!scored.length) return fallbackAnswer(short, 'no explorable candidate');

    // ── 3. opponent reply + next Turn for the best few ───────────────────────────────────────────────────────────
    const deepList = scored.slice(0, DEEP_MAX);
    for (const c of deepList) {
      if (left() < 2000) { c.deepSkipped = 'budget'; continue; }
      c.deep = await deepen(c, o, sv, { me, opp, decisions, call, left, lastTurn, OUTCOMES_PER_DEEP, REPLIES, EXR });
      if (c.deep && c.deep.ok) {
        c.total = c.deep.total;
        const done = deepList.filter((x) => x.deep && x.deep.ok).sort((a, b) => b.deep.total - a.deep.total);
        const first = c.deep.report.rows[0];
        const why = first && first.blitz && typeof first.blitz === 'object' ? `leaves the carrier open to a ${first.blitz.dice}-die Blitz (opponent Turnover ${pc(first.blitz.pTurnover)}, standard ${pc(first.blitz.need)})` : first && first.oppScoringChance > 0.05 ? `lets the opponent score ${pc(first.oppScoringChance)} next Turn` : '';
        note('opponent-reply', `Opponent replies checked for ${done.length} of ${Math.min(DEEP_MAX, scored.length)} lines.`, { evaluating: [c.label], ruledOut: done.slice(1).filter((x) => done[0].deep.total - x.deep.total > 4).slice(0, 4).map((x) => `${x.label}: ${Math.round(done[0].deep.total - x.deep.total)} points worse after the reply`), best: { label: done[0].label, pTurnover: done[0].pTurnover, pTouchdown: done[0].pTouchdown, value: round(done[0].deep.total, 1), detail: why && done[0] === c ? why : undefined } });
      }
    }
    // Only actions examined to the same depth are compared with each other (a deeper look always sees the opponent's reply,
    // so mixing depths would favour whatever was not examined).
    const deepened = deepList.filter((c) => c.deep && c.deep.ok);
    for (const c of scored) c.total = c.deep && c.deep.ok ? c.deep.total : c.l1;
    const ranked = deepened.length ? deepened : scored;
    ranked.sort((a, b) => b.total - a.total || (a.pTurnover - b.pTurnover) || (a.kind === 'endTurn' ? 1 : -1));
    const best = ranked[0];
    trace.shortlist = scored.map((c) => ({ label: c.label, kind: c.kind, pTurnover: round(c.pTurnover), pTouchdown: round(c.pTouchdown), builtIn: c.builtIn === null ? null : round(c.builtIn, 2), l1: round(c.l1, 2), total: round(c.total, 2), deepened: !!(c.deep && c.deep.ok), terms: c.terms && c.terms.parts }));
    trace.deep = deepList.filter((c) => c.deep && c.deep.ok).map((c) => ({ label: c.label, ...c.deep.report }));
    trace.search.elapsedMs = Date.now() - t0;
    trace.chosen = best.label;
    const why = describe(best, trace);
    const answer = { why, trace };
    if (best.kind === 'endTurn') answer.endTurn = true;
    else if (best.serviceId) answer.candidateId = best.serviceId;
    else if (best.legacyId !== null) answer.candidateId = best.legacyId;
    else answer.input = best.input;
    return answer;
  }

  function squaresAround(b, r) {
    const sq = [];
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) sq.push({ x: b.x + dx, y: b.y + dy });
    return sq;
  }
  function nearBall(o) {
    return o.ball.kind === 'ground' ? squaresAround(o.ball.pos, 6) : [];
  }

  // Cheap, exact-number-based ordering used only to decide what deserves a look (not the final score).
  function cheapScore(o, c, ctx) {
    let v = 0;
    const actor = c.actorId ? byId(o, c.actorId) : null;
    const tgt = c.targetId ? byId(o, c.targetId) : null;
    v += c.builtIn !== null ? c.builtIn * 0.5 : 0;
    v += (ctx.lastTurn ? 200 : 40) * c.pTouchdown;
    v -= 12 * c.pTurnover;
    if (ctx.oppCarrier && tgt && tgt.id === ctx.oppCarrier.id) v += 8 * (1 - c.pTurnover);
    if (ctx.ballLoose && c.pActiveHasBall) v += 10 * c.pActiveHasBall;
    if (ctx.ownCarrier && actor && actor.id === ctx.ownCarrier.id && c.dest) v += 1;
    if (c.family === 'foul') v -= 6;
    if (c.kind === 'endTurn') v -= 4;
    return v;
  }

  // Principle terms applied to a first action using exact chances of THIS Turn (subtracted from `ex.value` as costs / added as bonuses).
  function principleTerms(c, ex, ctx) {
    const parts = {};
    const pT = ex.pTurnover;
    const pTd = ex.pTouchdown;
    const turnoverCost = (ctx.ownCarrier ? W.turnoverCarrier : W.turnoverOwn) * (ctx.lastTurn && pTd > 0 ? 0.25 : 1);
    parts.turnover = -turnoverCost * pT;
    if (ctx.lastTurn) parts.urgency = W.lastTurnTd * pTd;
    if (ctx.ballLoose) {
      // Ball first: the exact chance our team holds the ball after this action (from the explored outcomes).
      let hold = 0;
      for (const out of ex.outcomes) {
        const ob = out.observation;
        const h = ob && ob.ball && ob.ball.kind === 'held' ? ob.players.find((q) => q.id === ob.ball.playerId) : null;
        if (h && h.team === ctx.o.team) hold += out.p;
      }
      c.pHold = hold;
      parts.ballFirst = W.looseBall * hold;
    }
    if (c.family === 'foul' && !(ctx.ballLoose || ctx.ownCarrier)) parts.foul = -W.foulOffBall;
    const receiver = c.input && (c.input.handoffTarget || c.input.passTarget);
    if (receiver) { const r = byId(ctx.o, receiver); if (r) parts.receiver = -W.unreliable * UNRELIABLE.filter((s) => has(r, s)).length; }
    // `sum` is the amount to SUBTRACT from ex.value so that l1 = ex.value + Σparts: sum = -Σparts
    const sum = -Object.values(parts).reduce((a, b) => a + b, 0);
    return { parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v, 2)])), sum };
  }

  // Opponent reply and next Turn, averaged over the most likely outcomes of the first action.
  async function deepen(c, o, sv, k) {
    const { me, opp, decisions, call, left, OUTCOMES_PER_DEEP, REPLIES, EXR } = k;
    const ex = c.ex;
    const outs = ex.outcomes.filter((x) => x.key).sort((a, b) => b.p - a.p).slice(0, OUTCOMES_PER_DEEP);
    if (!outs.length) return { ok: false };
    let total = 0;
    let mass = 0;
    const rows = [];
    for (const out of outs) {
      if (left() < 1500) break;
      const row = { p: round(out.p), value: round(out.value, 2), turnover: out.turnover, touchdown: out.touchdown };
      let v = out.value;
      if (out.touchdown || !out.active) { rows.push({ ...row, note: out.touchdown ? 'touchdown: Drive over' : 'state not kept' }); total += out.p * v; mass += out.p; continue; }
      // Bring the position to the opponent's Turn start.
      let oppKey = out.key;
      if (out.active === me) {
        const e = await call(() => sv.explore({ kind: 'endTurn' }, { from: out.key, team: me, maxOutcomes: 1, maxMs: 600 }));
        if (!e || !e.ok || !e.outcomes.length || !e.outcomes[0].key) { total += out.p * v; mass += out.p; rows.push({ ...row, note: 'end of Turn not explorable' }); continue; }
        oppKey = e.outcomes[0].key;
        v = e.outcomes[0].value;
        if (e.outcomes[0].active !== opp) { total += out.p * v; mass += out.p; rows.push({ ...row, note: 'Drive/half ended' }); continue; }
      }
      const obs = out.observation;
      const carrier = obs && obs.ball && obs.ball.kind === 'held' ? obs.players.find((p) => p.id === obs.ball.playerId) : null;
      const myCarrier = carrier && carrier.team === me ? carrier : null;
      const adj = {};
      // Route denial: the opponent's direct scoring chance next Turn.
      const sc = await call(() => sv.threats.scoring({ from: oppKey, team: opp }));
      const oppPTd = sc && sc.ok && sc.threats.length ? sc.threats[0].pTouchdown : 0;
      adj.oppScoring = -W.oppScore * oppPTd;
      // Carrier protection: the opponent's best Blitz on our carrier against the Turnover standards.
      if (myCarrier) {
        const bl = await call(() => sv.threats.blitz({ from: oppKey, team: opp, targets: [myCarrier.id], limit: 12, precision: 'fast', maxMs: Math.max(200, Math.min(1500, left() * 0.4)) }));
        if (bl && bl.ok) {
          let exposed = null;
          for (const row of bl.blitzes) for (const vv of row.variants) {
            const dice = vv.block ? vv.block.dice : 1;
            const need = thresholdFor(dice);
            if (vv.pTurnover < need) {
              const freed = Math.max(vv.pTargetDown, 0);
              if (!exposed || freed > exposed.freed) exposed = { attacker: row.attackerId, dice, pTurnover: round(vv.pTurnover), need, freed: round(freed), crowd: round(vv.pTargetCrowd || 0) };
            }
          }
          row.blitz = exposed || 'no Blitz below the standard';
          if (exposed) {
            adj.carrierExposed = -(W.exposedCarrier + W.exposedBall * exposed.freed);
            adj.sideline = -W.crowd * exposed.crowd;
          }
        }
      }
      // The opponent's best single reply, valued from our side (every legal action they have, enumerated exactly).
      const oppTargets = myCarrier ? [myCarrier.id] : null;
      const repIn = [];
      const askRep = async (opts) => { const r = await call(() => sv.candidates({ from: oppKey, team: opp, precision: 'none', maxMs: Math.max(200, Math.min(1000, left() * 0.3)), ...opts })); if (r && r.ok) repIn.push(...r.candidates); };
      if (oppTargets) await askRep({ families: ['block', 'blitz'], targets: oppTargets, maxPerPlayer: 1, limit: 6 });
      const oppHolder = carrier && carrier.team === opp ? carrier : null;
      if (oppHolder) await askRep({ players: [oppHolder.id], families: ['move'], sort: 'goalDistance', limit: 4 });
      if (obs && obs.ball && obs.ball.kind === 'ground') await askRep({ families: ['move', 'secure'], region: { within: squaresAround(obs.ball.pos, 6) }, sort: 'steps', maxPerPlayer: 1, limit: 6 });
      await askRep({ families: ['pass', 'handoff'], limit: 3 });
      await askRep({ families: ['endTurn'], limit: 1 });
      const reps = { ok: true, candidates: repIn.slice(0, REPLIES) };
      let worst = null;
      if (reps && reps.ok) {
        for (const r of reps.candidates) {
          if (left() < 1000) break;
          if (!r.legal || !r.input) continue;
          const re = await call(() => sv.explore(r.input, { from: oppKey, team: opp, perspective: 'self', decisions, ...EXR, observations: false }));
          if (!re || !re.ok) continue;
          if (!worst || re.value < worst.value) worst = { value: re.value, label: r.label, pOppTd: re.pOpponentTouchdown, rep: re, input: r.input };
        }
      }
      if (worst) { v = worst.value; row.reply = { label: worst.label, valueForUs: round(worst.value, 2) }; }
      // Our next Turn: direct scoring chance after the opponent's most likely outcome of that reply.
      if (worst && left() > 1500) {
        const lik = worst.rep.outcomes.filter((x) => x.key && !x.touchdown).sort((a, b) => b.p - a.p)[0];
        if (lik && lik.active === opp) {
          const e2 = await call(() => sv.explore({ kind: 'endTurn' }, { from: lik.key, team: opp, maxOutcomes: 1, maxMs: 500 }));
          const mine = e2 && e2.ok && e2.outcomes[0] && e2.outcomes[0].key && e2.outcomes[0].active === me ? e2.outcomes[0].key : null;
          if (mine) {
            const s2 = await call(() => sv.threats.scoring({ from: mine, team: me }));
            const myPTd = s2 && s2.ok && s2.threats.length ? s2.threats[0].pTouchdown : 0;
            adj.nextScoring = W.nextScore * myPTd;
            row.next = { ourScoringChance: round(myPTd) };
          }
        }
      }
      const adjSum = Object.values(adj).reduce((a, b) => a + b, 0);
      row.adjustments = Object.fromEntries(Object.entries(adj).map(([a, b]) => [a, round(b, 2)]));
      row.oppScoringChance = round(oppPTd);
      rows.push(row);
      total += out.p * (v + adjSum);
      mass += out.p;
    }
    if (mass <= 0) return { ok: false };
    // Outcomes not followed (low probability / merged rest) are valued where they stand.
    const restP = Math.max(0, 1 - mass);
    const restV = ex.rest && ex.rest.p > 0 ? ex.rest.value : ex.value;
    const t = total + restP * restV - c.terms.sum * 1;
    return { ok: true, total: t, report: { followed: round(mass), rows } };
  }

  function describe(best, trace) {
    const parts = best.terms && best.terms.parts ? Object.entries(best.terms.parts).filter(([, v]) => Math.abs(v) >= 0.5).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ') : '';
    const d = best.deep && best.deep.ok ? best.deep.report.rows[0] : null;
    const reply = d && d.reply ? `; worst opponent reply: ${d.reply.label}` : '';
    const blitz = d && d.blitz && typeof d.blitz === 'object' ? `; carrier exposed to a ${d.blitz.dice}-die Blitz (opponent Turnover ${Math.round(d.blitz.pTurnover * 100)}% < ${Math.round(d.blitz.need * 100)}%)` : d && d.blitz ? '; carrier meets the Blitz standard' : '';
    return `Hopeful 0.2: ${best.label} — Turnover ${Math.round(best.pTurnover * 100)}%, Touchdown ${Math.round(best.pTouchdown * 100)}%${parts ? ` [${parts}]` : ''}${reply}${blitz}.`.slice(0, 390);
  }

  function fallbackAnswer(short, why) {
    const safe = short.filter((c) => c.kind !== 'endTurn').sort((a, b) => a.pTurnover - b.pTurnover || b.cheap - a.cheap)[0] || short[0];
    if (!safe) return null;
    const a = { why: `Hopeful 0.2: ${why}; ${safe.label} (lowest Turnover risk).` };
    if (safe.kind === 'endTurn') a.endTurn = true;
    else if (safe.serviceId) a.candidateId = safe.serviceId;
    else if (safe.legacyId !== null) a.candidateId = safe.legacyId;
    else a.input = safe.input;
    return a;
  }

  // ── rule decisions ─────────────────────────────────────────────────────────────────────────────────────────────
  function chooseDecision(o, req) {
    if (req.type === 'touchback') {
      const standing = (p) => p && p.location === 'pitch' && p.stance === 'standing' && p.pos;
      const elig = (req.options || []).map((opt) => ({ opt, p: byId(o, opt.id) })).filter((x) => standing(x.p));
      if (!elig.length) return null;
      const ours = elig.filter((x) => x.p.team === o.team);
      const pool = ours.length ? ours : elig;
      const rel = (p) => -(UNRELIABLE.filter((s) => has(p, s)).length * 2 + (has(p, 'bloodlust') ? 1.5 : 0) + (has(p, 'loner') ? 0.75 : 0));
      const carry = (p) => ['sureHands', 'catch', 'pass', 'pro'].reduce((n, s) => n + (has(p, s) ? 1 : 0), 0);
      const rated = pool.map((x) => ({ ...x, v: x.p.st * 3 + x.p.ma + x.p.ag * 0.15 + carry(x.p) * 0.8 + rel(x.p) })).sort((a, b) => b.v - a.v);
      return { optionId: rated[0].opt.id, why: 'Hopeful 0.2: touchback to the strongest reliable player who can anchor the ball.' };
    }
    return null; // every other rule decision: the built-in coach (documented)
  }

  bloodboard.register({
    id: 'hopeful-0-2',
    name: 'Hopeful 0.2',
    apiVersion: 1,
    apiMinor: 2,
    requires: ['candidates', 'explore', 'threats.scoring', 'threats.blitz'],
    version: '0.2',
    description: 'Bounded exact search over this Turn, the opponent reply and the next Turn, with Hopeful\'s principles (score urgency, ball first, turnover cost, carrier protection, route denial, reliable receiving, sideline danger).',
    timeLimitMs: 60000,
    chooseAction,
    chooseDecision,
  });
})();
