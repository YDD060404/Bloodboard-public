/**
 * V5.5: AI files and coaches — the AI file format (bundled files, validation, no separate style), the legacy
 * mapping of old saves, and the `coachChange` input that changes who coaches a team during a match (logged, no dice,
 * nothing else changed, only between actions; temporary takeovers only of human-coached teams).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { cloneState, coachOf, createMatch, decide, execute, newTeamDef, playerFromRoster, ROSTER_BY_ID, validateInput, type ActionInput, type GameState, type TeamDef, type TeamId } from '../src/engine/index';
import { BASE_WEIGHTS, bindEngine, BUNDLED_FILES, DEFAULT_AI_ID, entriesFromFiles, fallbackCoach, legacyAiId, nextMove, parseAIFile, profileWeights, setLoadedCoaches, styleWeights, usableCoaches, waitingFor, type AIFile } from '../src/ai/index';

declare function require(m: string): any;
const fs = require('node:fs');

bindEngine(Engine);
// Legacy profiles remain test fixtures; only Balanced + Hopeful are shipped in this browser fork.
const TEST_FILES: AIFile[] = [...BUNDLED_FILES, ...['offensive','defensive'].map(style => JSON.parse(fs.readFileSync(`tests/fixtures/coaches/bloodboard-${style}.json`, 'utf8')))];


function team(id: string, rosterId: string, comp: Array<[string, number]>): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 3;
  return t;
}
const humans = () => team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]);
const orcs = () => team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]);

function match(coaches: Partial<Record<TeamId, { ai: string; name?: string; version?: string }>> = { B: { ai: 'bloodboard-balanced', name: 'Bloodboard AI — Balanced', version: '5.5.0' } }, seed = 11): GameState {
  const r = createMatch('tournament', humans(), orcs(), { rules: 'full', ...(coaches.A || coaches.B ? { computer: { team: coaches.A ? 'A' : 'B' }, coaches } : {}) }, seed);
  assert.ok(r.ok, r.errors.join('\n'));
  return r.state as GameState;
}

/** Everything but the log and the coaches. */
function core(s: GameState): string {
  const o = { ...s.match!.options };
  delete o.coaches;
  return JSON.stringify({ players: s.players, ball: s.ball, teams: s.teams, turn: s.turn, rng: s.rng, phase: s.phase, weather: s.weather, pending: s.pending, m: { ...s.match, options: o } });
}

/** Play the match with the computer for both teams until `stop` (the AI files' parameters: the bundled ones). */
function playUntil(s: GameState, stop: (s: GameState) => boolean, limit = 400): GameState {
  setLoadedCoaches(entriesFromFiles(TEST_FILES));
  for (let i = 0; i < limit && !stop(s); i++) {
    const t = waitingFor(s);
    let input: ActionInput | null = null;
    if (!t) input = s.phase === 'pregame' ? { kind: 'pregame' } : s.phase === 'touchdown' || s.phase === 'halfOver' ? { kind: 'nextDrive' } : null;
    if (!input && !t) break;
    if (t) {
      const mv = nextMove(s, t, 'balanced', {}, { profile: BUNDLED_FILES[0] });
      if (!mv) throw new Error('the AI has a move');
      if (mv.type === 'decision') {
        const r = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
        assert.notEqual(r.status, 'illegal', r.error);
        s = r.state;
        continue;
      }
      input = mv.input;
    }
    const r = execute(s, input as ActionInput);
    assert.notEqual(r.status, 'illegal', r.error);
    s = r.state;
  }
  return s;
}

// ---------------------------------------------------------------------------
// AI files
// ---------------------------------------------------------------------------

test('the bundled AI files in ai/ are exactly the registry’s bundled files, all valid', () => {
  const names = fs.readdirSync('ai').filter((n: string) => /\.(json|js)$/.test(n)).sort();
  assert.deepEqual(names, ['bloodboard-balanced.json', 'hopeful-1-5-9-gpt.js']);
  for (const f of BUNDLED_FILES) {
    const text = fs.readFileSync(`ai/${f.id}.json`, 'utf8');
    assert.deepEqual(JSON.parse(text), f, `ai/${f.id}.json matches BUNDLED_FILES`);
    const e = parseAIFile(text, `${f.id}.json`);
    assert.equal(e.errors, undefined, `${f.id}: ${e.errors?.join(' ')}`);
    assert.equal(e.id, f.id);
    assert.equal(e.version, '5.5.0');
    assert.equal(e.kind, 'parameters');
  }
  const ex = parseAIFile(fs.readFileSync('ai/examples/aggressive-bashers.json', 'utf8'), 'aggressive-bashers.json');
  assert.equal(ex.errors, undefined, ex.errors?.join(' '));
});

test('the bundled Offensive and Defensive files reproduce the former style presets exactly (same algorithm, separate files)', () => {
  const ctx = { scoreDiff: 0, turnsLeft: 5, half: 1 as const, possession: 'us' as const, format: 'standard' as const };
  for (const style of ['offensive', 'defensive'] as const) {
    const file = TEST_FILES.find((f) => f.id === `bloodboard-${style}`) as AIFile;
    const w = profileWeights(BASE_WEIGHTS, file, ctx);
    const old = styleWeights(style);
    for (const k of Object.keys(BASE_WEIGHTS) as Array<keyof typeof BASE_WEIGHTS>) assert.ok(Math.abs(w[k] - old[k]) < 1e-9, `${style}.${k}: ${w[k]} vs ${old[k]}`);
  }
  const bal = profileWeights(BASE_WEIGHTS, BUNDLED_FILES[0], ctx);
  assert.deepEqual(bal, { ...BASE_WEIGHTS });
});

test('AI file validation: a "style" setting, unknown weights, bad versions and unknown algorithms are rejected with reasons', () => {
  const good: AIFile = { format: 'bloodboard-ai', formatVersion: 1, apiVersion: 1, id: 'my-coach', name: 'My Coach', version: '1.0', implementation: 'bloodboard', parameters: { preferences: { aggression: 0.5 } } };
  assert.equal(parseAIFile(JSON.stringify(good), 'x.json').errors, undefined);
  const bad = (patch: Record<string, unknown>, re: RegExp) => {
    const e = parseAIFile(JSON.stringify({ ...good, ...patch }), 'x.json');
    assert.ok(e.errors?.some((x) => re.test(x)), `${JSON.stringify(patch)} → ${e.errors?.join(' | ')}`);
    assert.equal(e.profile, undefined, 'an invalid file is not usable');
  };
  bad({ style: 'offensive' }, /"style" is not supported/);
  bad({ version: '' }, /version/);
  bad({ id: 'x' }, /id/);
  bad({ implementation: 'other' }, /not installed/);
  bad({ apiVersion: 2 }, /apiVersion/);
  bad({ format: 'bloodboard-ai-profile' }, /format/);
  bad({ parameters: { weights: { nonsense: 2 } } }, /unknown weight/);
  bad({ parameters: { weights: { cage: 9 } } }, /multiplier from 0 to 5/);
  bad({ parameters: { search: { maxExplored: 400 } } }, /maxExplored/);
  assert.ok(parseAIFile('{not json', 'x.json').errors?.[0].startsWith('Not valid JSON'));
});

test('selectable files: one per valid file; none installed → none offered; formats respected; the fallback', () => {
  setLoadedCoaches([]);
  assert.deepEqual(usableCoaches(), []);
  assert.equal(fallbackCoach(), null);
  setLoadedCoaches(entriesFromFiles([TEST_FILES[2]]));
  assert.deepEqual(usableCoaches().map((c) => c.id), ['bloodboard-defensive']);
  assert.equal(fallbackCoach()?.id, 'bloodboard-defensive', 'no Balanced file: the first valid file');
  const sevensOnly: AIFile = { ...BUNDLED_FILES[0], id: 'sevens-only', name: 'Sevens only', formats: ['sevens'] };
  setLoadedCoaches(entriesFromFiles([...TEST_FILES, sevensOnly]));
  assert.equal(usableCoaches('standard').length, 3);
  assert.equal(usableCoaches('sevens').length, 4);
  assert.equal(fallbackCoach()?.id, DEFAULT_AI_ID);
});

test('older saves: the built-in AI with a style is the bundled file of that name', () => {
  assert.equal(legacyAiId('bloodboard', 'offensive'), 'bloodboard-offensive');
  assert.equal(legacyAiId('bloodboard', 'defensive'), 'bloodboard-defensive');
  assert.equal(legacyAiId('bloodboard'), 'bloodboard-balanced');
  assert.equal(legacyAiId(undefined, 'balanced'), 'bloodboard-balanced');
  assert.equal(legacyAiId('cautious-scorer', 'offensive'), 'cautious-scorer');
  // A V5 step 6 match (options.computer only) is coached by the file of its style.
  const r = createMatch('tournament', humans(), orcs(), { rules: 'full', computer: { team: 'B', style: 'defensive' } }, 3);
  const s = r.state as GameState;
  assert.deepEqual(coachOf(s, 'B'), { ai: 'bloodboard-defensive', style: 'defensive' });
  assert.equal(coachOf(s, 'A'), null);
});

// ---------------------------------------------------------------------------
// coachChange
// ---------------------------------------------------------------------------

test('coachChange: human ↔ computer, logged, no dice, nothing else changes', () => {
  const s0 = match();
  const r1 = execute(s0, { kind: 'coachChange', team: 'A', coach: { ai: 'bloodboard-offensive', name: 'Bloodboard AI — Offensive', version: '5.5.0' } });
  assert.equal(r1.status, 'completed', r1.error);
  const s1 = r1.state;
  assert.deepEqual(coachOf(s1, 'A'), { ai: 'bloodboard-offensive', name: 'Bloodboard AI — Offensive', version: '5.5.0' });
  assert.equal(coachOf(s1, 'B')?.ai, 'bloodboard-balanced');
  assert.equal(core(s1), core(s0), 'board, teams, Turns, dice generator and rules unchanged');
  assert.equal(s1.log.length, s0.log.length + 1);
  const e = s1.log[s1.log.length - 1];
  assert.equal(e.input.kind, 'coachChange');
  assert.match(e.title, /coached by Bloodboard AI — Offensive 5\.5\.0/);
  assert.match(e.events.map((x) => x.text).join(' '), /coach changed from the human coach to the computer \(Bloodboard AI — Offensive 5\.5\.0\)/);
  assert.ok(e.events.every((x) => !x.dice?.length), 'no dice');
  // Both computer → the computer team B to human.
  const s2 = execute(s1, { kind: 'coachChange', team: 'B', coach: null }).state;
  assert.equal(coachOf(s2, 'B'), null);
  assert.equal(core(s2), core(s0));
  assert.match(s2.log[s2.log.length - 1].title, /human coach takes control/);
});

test('coachChange: refused while a decision is pending, and for impossible takeovers', () => {
  let s = playUntil(match(), (g) => g.phase === 'play' && !g.pending && !g.match?.pendingPhase);
  assert.equal(s.phase, 'play');
  const team = s.turn.active;
  const other: TeamId = team === 'A' ? 'B' : 'A';
  const take = (t: TeamId, mode: 'activation' | 'turn' | 'untilBack'): ActionInput => ({ kind: 'coachChange', team: t, coach: { ai: 'bloodboard-balanced', takeover: { mode, half: 1, turn: 0, since: 0 } } });
  // Make the active team human-coached, the other the computer.
  s = execute(s, { kind: 'coachChange', team, coach: null }).state;
  s = execute(s, { kind: 'coachChange', team: other, coach: { ai: 'bloodboard-balanced' } }).state;
  assert.deepEqual(validateInput(s, take(other, 'untilBack')), ['A takeover is for a team the human coaches.']);
  s = execute(s, { kind: 'coachChange', team: other, coach: null }).state;
  assert.match(validateInput(s, take(other, 'activation'))[0], /not this team’s Turn/);
  assert.deepEqual(validateInput(s, take(other, 'untilBack')), []);
  assert.deepEqual(validateInput(s, take(team, 'activation')), []);
  assert.deepEqual(validateInput(s, take(team, 'turn')), []);
  const r = execute(s, take(team, 'turn'));
  assert.equal(r.status, 'completed', r.error);
  const tk = coachOf(r.state, team)?.takeover;
  assert.equal(tk?.mode, 'turn');
  assert.equal(tk?.turn, s.teams[team].turn, 'the takeover records the Turn it began in');
  assert.equal(tk?.since, r.state.log[r.state.log.length - 1].id, 'and the log entry of the change');
  assert.match(r.state.log[r.state.log.length - 1].events[0].text, /temporary coaching takeover/);
  // A pending decision: no coach change until it is answered.
  const pend = { ...cloneState(s), pending: { base: s, input: { kind: 'endTurn' }, decisions: [], request: { id: 1, team, type: 'reroll', prompt: 'x', options: [{ id: 'none', label: 'No' }] }, events: [] } } as unknown as GameState;
  const x = execute(pend, { kind: 'coachChange', team: other, coach: { ai: 'bloodboard-balanced' } });
  assert.equal(x.status, 'illegal');
  // Not a match: refused.
  const practice = { ...cloneState(s), match: undefined } as unknown as GameState;
  assert.equal(execute(practice, { kind: 'coachChange', team, coach: null }).status, 'illegal');
});

test('a V5 step 6 match: the first coach change turns options.computer into the coaches list', () => {
  const r = createMatch('tournament', humans(), orcs(), { rules: 'full', computer: { team: 'B', style: 'offensive' } }, 5);
  const s = execute(r.state as GameState, { kind: 'coachChange', team: 'A', coach: { ai: 'bloodboard-defensive' } }).state;
  assert.deepEqual(Object.keys(s.match!.options.coaches ?? {}).sort(), ['A', 'B']);
  assert.equal(coachOf(s, 'B')?.ai, 'bloodboard-offensive');
  assert.equal(coachOf(s, 'A')?.ai, 'bloodboard-defensive');
  assert.deepEqual(s.match!.options.computer, { team: 'B', style: 'offensive' }, 'the difficulty side stays as it was');
});

test('coach changes during a whole computer v computer match: every file plays legal moves, coaches swap sides mid-match, results stay deterministic', () => {
  const files = [BUNDLED_FILES[0], TEST_FILES[1], TEST_FILES[2]];
  const run = () => {
    let s = match({ A: { ai: 'bloodboard-offensive' }, B: { ai: 'bloodboard-defensive' } }, 21);
    setLoadedCoaches(entriesFromFiles(TEST_FILES));
    let changes = 0;
    let due = 24;
    for (let i = 0; i < 1500 && s.phase !== 'fullTime'; i++) {
      // Every 25 steps, at the next moment between actions, give one team another file (V6: "next moment" so the count does not depend on which steps happen to be pending).
      if (i >= due && !s.pending) {
        due = i + 25;
        const t: TeamId = changes % 2 ? 'A' : 'B';
        const f = files[changes % 3];
        const r = execute(s, { kind: 'coachChange', team: t, coach: { ai: f.id, name: f.name, version: f.version } });
        assert.equal(r.status, 'completed', r.error);
        assert.equal(core(r.state), core(s));
        s = r.state;
        changes++;
        continue;
      }
      const t = waitingFor(s);
      let input: ActionInput | null = null;
      if (!t) input = s.phase === 'pregame' ? { kind: 'pregame' } : s.phase === 'touchdown' || s.phase === 'halfOver' ? { kind: 'nextDrive' } : null;
      if (!t && !input) break;
      if (t) {
        const ref = coachOf(s, t);
        const file = TEST_FILES.find((f) => f.id === ref?.ai);
        assert.ok(file, `team ${t} has an AI file`);
        const mv = nextMove(s, t, 'balanced', {}, { profile: file });
        if (!mv) throw new Error('the AI has a move');
        if (mv.type === 'decision') {
          const r = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
          assert.notEqual(r.status, 'illegal', r.error);
          s = r.state;
          continue;
        }
        input = mv.input;
        assert.deepEqual(validateInput(s, input), [], `legal: ${JSON.stringify(input).slice(0, 120)}`);
      }
      const r = execute(s, input as ActionInput);
      assert.notEqual(r.status, 'illegal', r.error);
      s = r.state;
    }
    return { s, changes };
  };
  const a = run();
  assert.equal(a.s.phase, 'fullTime', 'the match is played to full time');
  assert.ok(a.changes >= 10, `coaches changed ${a.changes} times`);
  const b = run();
  assert.equal(JSON.stringify(a.s.log.map((e) => e.title)), JSON.stringify(b.s.log.map((e) => e.title)), 'same seed and same changes → the same match');
});
