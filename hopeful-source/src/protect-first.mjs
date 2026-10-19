/** S4.26 protect-before-pickup ordering.
 *
 * Defect fixed: the frozen champion scores every candidate as ONE root action. A risky pickup (possession credit) always
 * outranks a dice-free screen move, so "screen first, then pick up" is never chosen: if the pickup then fails, the Turn
 * ends with the ball unprotected and every unmoved player wasted. A dice-free move cannot fail, so doing it first loses
 * nothing and keeps the pickup available afterwards. This stage runs only when the champion's own choice is a risky
 * pickup of a ground ball; it returns at most one engine-certified dice-free protection move, and the champion decides
 * again from the real successor position (so the protection sequence is executed move by move, then the pickup).
 *
 * Protection value is explicit, not a pickup score tweak: exposure(ball) = how many opponents could reach a square
 * next to the ball (where the carrier stands after a successful pickup, and where a failed pickup bounces) on their next
 * Turn, measured with an obstacle- and tackle-zone-aware route cost. A guard move is admitted only if it removes at
 * least MIN_GAIN of that exposure, is a single certain outcome in the engine (no dice, no turnover), keeps the ball on
 * the ground where it was, and leaves the champion's pickup input legal from the actual successor position.
 */
const MIN_GAIN = 0.5, MAX_PROBES = 4;
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const key = p => `${p.x},${p.y}`;
const onPitch = p => p?.location === 'pitch' && !!p.pos;
const standing = p => onPitch(p) && p.stance === 'standing';
const has = (p, s) => (p?.skills || []).some(x => x === s || String(x).startsWith(s + '('));
const unreliable = p => ['boneHead', 'reallyStupid', 'unchannelledFury', 'animalSavagery', 'takeRoot', 'bloodlust'].some(s => has(p, s));
// A guard that ends next to standing opponents is itself blocked off the screen; fragile guards pay more.
const contactCost = p => ((p?.st ?? 3) >= 4 || has(p, 'block') ? 0.35 : 0.75) + ((p?.av ?? 8) <= 7 ? 0.25 : 0) +
  (['pass', 'catch', 'sureHands'].some(x => has(p, x)) ? 0.75 : 0);   // keep ball-handlers out of the contact screen
const exertsZone = p => standing(p) && p.tackleZone !== false && !p.distracted;
const width = o => o.pitch?.width ?? (o.format === 'sevens' ? 20 : 26);
const height = o => o.pitch?.height ?? (o.format === 'sevens' ? 11 : 15);

/** Which pickups this stage reorders: the champion's own risky pickup of the ground ball, with no score this action. */
export function riskyPickup(o, line) {
  const input = line?.input, ball = o.ball?.pos;
  if (o.ball?.kind !== 'ground' || !ball || input?.kind !== 'playerAction' || !['move', 'secure'].includes(input.action)) return null;
  const last = input.path?.at(-1)?.to;
  if (input.action === 'move' && !(last && key(last) === key(ball))) return null;
  const pTurnover = Number(line.ex?.pTurnover ?? line.pTurnover);
  if (!Number.isFinite(pTurnover) || pTurnover < 0.005) return null;
  if (Number(line.ex?.pTouchdown ?? line.pTouchdown ?? 0) > 0) return null;
  return { pickerId: input.playerId, pTurnover, pathKeys: new Set((input.path || []).map(s => key(s.to))) };
}

/** Opponent access to the squares around `at` on their next Turn (0 = nobody can get there). Pure geometry. */
export function exposure(o, at, team) {
  const w = width(o), h = height(o), opp = team === 'A' ? 'B' : 'A';
  const occupied = new Set(o.players.filter(onPitch).map(p => key(p.pos)));
  const ourZones = new Map();
  for (const p of o.players) if (p.team === team && exertsZone(p))
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) {
      const k = `${p.pos.x + dx},${p.pos.y + dy}`; ourZones.set(k, (ourZones.get(k) || 0) + 1);
    }
  const targets = new Set();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) {
    const c = { x: at.x + dx, y: at.y + dy };
    if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h && !occupied.has(key(c))) targets.add(key(c));
  }
  // A square next to the ball is worth less to an attacker for every guard of ours next to it (defensive assists,
  // and the attacker standing there is itself marked). Squares our players occupy are not available at all.
  const guardsNext = new Map([...targets].map(k => { const [x, y] = k.split(',').map(Number);
    return [k, o.players.filter(p => p.team === team && standing(p) && dist(p.pos, { x, y }) === 1 && dist(p.pos, at) > 0).length]; }));
  const quality = k => 1 / (1 + 0.5 * guardsNext.get(k));
  const rows = [];
  let total = 0;
  for (const q of o.players) {
    if (q.team !== opp || !onPitch(q) || q.rooted || !['standing', 'prone'].includes(q.stance)) continue;
    const ma = Math.max(0, (q.ma || 6) - (q.stance === 'prone' ? 3 : 0));
    const budget = ma + 2;                       // two Rushes
    if (dist(q.pos, at) - 1 > budget) continue;
    // Already standing next to the ball: it can block from where it is (still reduced by our assists there).
    if (standing(q) && dist(q.pos, at) === 1) {
      const n = o.players.filter(p => p.team === team && standing(p) && dist(p.pos, q.pos) === 1 && dist(p.pos, at) > 0).length;
      const weight = 1 / (1 + 0.5 * n); rows.push({ id: q.id, cost: 0, weight }); total += weight; continue;
    }
    // Dijkstra: one per step, +1.5 for each step that leaves one of OUR tackle zones (a Dodge we force).
    const best = new Map([[key(q.pos), 0]]), frontier = [[0, q.pos]];
    let value = 0, at_ = null;
    while (frontier.length) {
      frontier.sort((x, y) => x[0] - y[0]);
      const [cost, p] = frontier.shift();
      if (cost > (best.get(key(p)) ?? Infinity) || cost > budget) continue;
      if (targets.has(key(p))) {
        // Free approach = 1; each forced Dodge (+1.5) or Rush beyond MA lowers it; the edge of reach (MA+2) = 0.5.
        const v = Math.min(1, 0.5 + (budget - cost) / 4) * quality(key(p));
        if (v > value) { value = v; at_ = { square: key(p), cost }; }
      }
      const leave = ourZones.get(key(p)) && !has(q, 'ballAndChain') ? 1.5 : 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) {
        const n = { x: p.x + dx, y: p.y + dy }, k = key(n);
        if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h || occupied.has(k)) continue;
        const c = cost + 1 + leave;
        if (c < (best.get(k) ?? Infinity) && c <= budget) { best.set(k, c); frontier.push([c, n]); }
      }
    }
    if (!value) continue;
    rows.push({ id: q.id, cost: Math.round(at_.cost * 10) / 10, square: at_.square, weight: Math.round(value * 1000) / 1000 }); total += value;
  }
  total = Math.round(total * 1000) / 1000;
  return { total, rows, openSquares: targets.size };
}

/** Geometric copy of `o` with one of our players moved to `to` (used only for ranking; the engine certifies). */
function movedCopy(o, playerId, to) {
  return { ...o, players: o.players.map(p => p.id === playerId ? { ...p, pos: { ...to } } : p) };
}

export async function protectFirst(o, line, services, deadline) {
  const report = { attempted: false, selected: null, reason: 'not-a-risky-loose-ball-pickup' };
  const pick = riskyPickup(o, line);
  if (!pick) return report;
  if (o.phase !== 'play' || o.pending || o.active !== o.team) return { ...report, reason: 'not-own-open-turn' };
  // A guard placed by the previous decision may still hold an open activation; the engine closes it when another player
  // acts (every proposal below is explored from this exact position). Only the picker's own activation stops the stage.
  const activeId = o.activation && !o.activation.over ? o.activation.playerId : null;
  if (activeId && activeId === pick.pickerId) return { ...report, reason: 'picker-activation-in-progress' };
  if ((o.turn?.[o.team] || 0) >= o.turnsPerHalf) return { ...report, reason: 'last-turn-of-half: protection has no next-Turn value' };
  if (typeof services?.candidates !== 'function' || typeof services?.explore !== 'function' || typeof services?.validate !== 'function')
    return { ...report, reason: 'services-unavailable' };
  const left = () => deadline - Date.now();
  if (left() < 1500) return { ...report, reason: 'budget-unavailable' };
  const ball = o.ball.pos, before = exposure(o, ball, o.team);
  Object.assign(report, { attempted: true, pickup: line.input, pickupTurnover: pick.pTurnover, exposureBefore: before.total, threats: before.rows, rejections: [] });
  if (before.total < MIN_GAIN) return { ...report, reason: 'ball-not-exposed' };
  const guards = o.players.filter(p => p.team === o.team && standing(p) && !p.rooted && !p.activated && p.canBeActivated !== false &&
    p.id !== pick.pickerId && p.id !== activeId && !unreliable(p));
  if (!guards.length) return { ...report, reason: 'no-available-guard' };
  const occupied = new Set(o.players.filter(onPitch).map(p => key(p.pos)));
  const cells = [];
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    const c = { x: ball.x + dx, y: ball.y + dy };
    if ((dx || dy) && c.x >= 0 && c.y >= 0 && c.x < width(o) && c.y < height(o) && !occupied.has(key(c)) && !pick.pathKeys.has(key(c))) cells.push(c);
  }
  let found;
  try {
    found = await services.candidates({ families: ['move'], players: guards.map(p => p.id), maxRushes: 0, region: { within: cells },
      precision: 'none', sort: 'steps', limit: 100, maxMs: Math.max(100, Math.min(800, left() - 1000)) });
  } catch (e) { return { ...report, reason: 'candidate-service-failed', error: String(e).slice(0, 120) }; }
  // Dodges are dice: a route that leaves an opponent's tackle zone (from its start or any intermediate square) is not a
  // guard move. Geometric pre-filter only; the engine still certifies every probe.
  const enemyZone = new Set();
  for (const q of o.players) if (q.team !== o.team && exertsZone(q))
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) enemyZone.add(`${q.pos.x + dx},${q.pos.y + dy}`);
  const departsZone = c => { const p = o.players.find(x => x.id === c.input.playerId);
    return [p?.pos, ...c.input.path.slice(0, -1).map(s => s.to)].some(at => at && enemyZone.has(key(at))); };
  const rows = (found?.candidates || []).filter(c => c.legal !== false && c.input?.action === 'move' && c.input.path?.length &&
    guards.some(p => p.id === c.input.playerId) && !c.input.path.some(s => key(s.to) === key(ball) || pick.pathKeys.has(key(s.to))) &&
    !departsZone(c));
  // Rank guard plans of one or two distinct players by explicit protection gain (a cage needs several guards: a first
  // guard may only pay off together with a second). The first move of the best plan is played; the champion and this
  // stage then re-decide from the actual position, so the second move is re-checked, never assumed.
  const singles = [], seenDest = new Set();
  for (const c of rows) {
    const to = c.input.path.at(-1).to, k = c.input.playerId + '@' + key(to);
    if (seenDest.has(k)) continue; seenDest.add(k);
    const guard = o.players.find(p => p.id === c.input.playerId);
    const contacts = o.players.filter(q => q.team !== o.team && standing(q) && dist(q.pos, to) === 1).length;
    const after = exposure(movedCopy(o, c.input.playerId, to), ball, o.team).total;
    singles.push({ c, to, contacts, cost: contacts * contactCost(guard), gain: before.total - after, after, steps: c.input.path.length });
  }
  singles.forEach(r => { r.net = r.gain - r.cost; });
  singles.sort((a, b) => b.net - a.net || a.steps - b.steps);
  const plans = singles.map(r => ({ first: r, net: r.net, size: 1 }));
  const top = singles.filter(r => r.net >= -0.25).slice(0, 14);
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const x = top[i], y = top[j];
    if (x.c.input.playerId === y.c.input.playerId || key(x.to) === key(y.to)) continue;
    const both = exposure(movedCopy(movedCopy(o, x.c.input.playerId, x.to), y.c.input.playerId, y.to), ball, o.team).total;
    const net = 0.9 * (before.total - both - x.cost - y.cost);   // the second move is not yet certified
    plans.push({ first: x.net >= y.net ? x : y, second: x.net >= y.net ? y : x, net, size: 2 });
  }
  plans.sort((a, b) => b.net - a.net || a.size - b.size);
  const ranked = [], firstSeen = new Set();
  for (const p of plans) {
    if (p.net < MIN_GAIN || p.first.net < -0.25) continue;     // never open with a move that clearly hurts on its own
    const k = JSON.stringify(p.first.c.input);
    if (firstSeen.has(k)) continue; firstSeen.add(k);
    ranked.push({ ...p.first, planNet: p.net, planSize: p.size, second: p.second ? { input: p.second.c.input, net: p.second.net } : null });
  }
  report.considered = rows.length; report.admissibleByGeometry = ranked.length;
  if (!ranked.length) return { ...report, reason: 'no-guard-move-reduces-exposure' };
  const probedPlayers = new Set();
  for (const r of ranked) {
    if (probedPlayers.size >= MAX_PROBES) break;
    if (probedPlayers.has(r.c.input.playerId)) continue;   // one probe per player: diversity over near-duplicate routes
    probedPlayers.add(r.c.input.playerId);
    if (left() < 600) { report.rejections.push('budget'); break; }
    let ex;
    try {
      ex = await services.explore(r.c.input, { observations: true, decisions: 'builtin', perspective: o.team, threshold: 1e-6,
        maxOutcomes: 8, maxKeep: 16, maxLeaves: 400, maxMs: Math.max(100, Math.min(900, left() - 400)) });
    } catch { report.rejections.push('explore-failed'); continue; }
    const out = ex?.outcomes?.[0];
    if (ex?.ok !== true || ex.outcomes.length !== 1 || !(out.p > 1 - 1e-9) || Number(ex.pTurnover) > 0 || out.turnover ||
        Number(ex.unresolvedMass || 0) > 0 || out.observation?.ball?.kind !== 'ground' || key(out.observation.ball.pos) !== key(ball)) {
      report.rejections.push({ input: r.c.input, reason: 'not-a-certain-dice-free-move' }); continue;
    }
    if (out.key) {
      let v;
      try { v = await services.validate(line.input, { from: out.key }); } catch { v = null; }
      if (v?.ok === false || v?.legal === false) { report.rejections.push({ input: r.c.input, reason: 'pickup-not-legal-after-guard-move' }); continue; }
      report.pickupStillLegal = v?.legal === true ? true : 'unverified';
    }
    // Recompute exposure on the engine's actual successor (not the geometric copy).
    const actual = out.observation?.players ? exposure({ ...o, players: out.observation.players }, ball, o.team).total : r.after;
    // The engine's actual successor must reproduce the geometric single-move value (no hidden displacement).
    if (Math.abs(actual - r.after) > 1e-6) { report.rejections.push({ input: r.c.input, reason: 'actual-successor-differs-from-geometry', actual, expected: r.after }); continue; }
    return { ...report, selected: { input: r.c.input, label: r.c.label || `move ${r.c.input.playerId}`, gain: r.gain, net: r.net, planNet: r.planNet,
      planSize: r.planSize, nextGuard: r.second, contacts: r.contacts, exposureAfter: actual },
      reason: 'dice-free guard move before risky pickup' };
  }
  return { ...report, reason: 'no-certified-guard-move' };
}
