/**
 * Headless interface to the Bloodboard rules engine (no UI, no network).
 * This is the boundary a future agent (Claude, Codex, a script) would use:
 * JSON in, JSON out. No model integration is included.
 *
 *   node dist/cli/bloodboard-cli.mjs summary  <position.json>
 *   node dist/cli/bloodboard-cli.mjs options  <position.json> <playerId>
 *   node dist/cli/bloodboard-cli.mjs plan     <position.json> <action.json>
 *   node dist/cli/bloodboard-cli.mjs execute  <position.json> <action.json> [--out next.json]
 *   node dist/cli/bloodboard-cli.mjs decide   <position.json> <choice.json> [--out next.json]
 *   node dist/cli/bloodboard-cli.mjs validate <position.json>
 *
 * position.json may be a save file ({format:"bloodboard-position"}) or a bare
 * GameState ({format:"bloodboard-state"}). action.json is an ActionInput and
 * choice.json a DecisionChoice (see docs/INTERFACE.md).
 */
import { actionOptions, ballHolder, board, decide, execute, getPlayer, parseSaveFile, planAction, rulesFor, skillName, toSaveFile, validatePosition, validateState, type ActionInput, type DecisionChoice, type GameState } from '../src/engine/index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(m: string): any;
const fs = require('node:fs');

function readState(file: string): GameState {
  const parsed = parseSaveFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) fail(`Invalid position file: ${parsed.errors.join('; ')}`);
  return (parsed as { ok: true; save: { state: GameState } }).save.state;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function out(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const [cmd, a1, a2] = args;
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;

function writeNext(state: GameState) {
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(toSaveFile(state, 'CLI result'), null, 1));
}

/** Compact, agent-friendly view of a position (facts only, no advice). */
function summary(s: GameState) {
  const holder = ballHolder(s);
  const act = s.turn.activation;
  return {
    phase: s.phase,
    weather: s.weather,
    activeTeam: s.turn.active,
    teams: Object.fromEntries(
      (['A', 'B'] as const).map((t) => { const x = t === 'A' ? rulesFor(s).pitch.w - 1 : 0; return [t, { name: s.teams[t].name, turn: s.teams[t].turn, score: s.teams[t].score, rerolls: s.teams[t].rerolls, leaderReroll: s.teams[t].leaderReroll, scoresAtColumn: `${String.fromCharCode(65 + x)} (x=${x})` }]; }),
    ),
    ball: s.ball.kind === 'held' ? { held: true, playerId: s.ball.playerId, square: holder?.pos ? board.fmt(holder.pos) : null } : s.ball.kind === 'ground' ? { held: false, square: board.fmt(s.ball.pos), pos: s.ball.pos } : { held: false, square: null },
    usedThisTurn: s.turn.used,
    activation: act,
    pendingDecision: s.pending ? s.pending.request : null,
    players: s.players.map((p) => ({
      id: p.id,
      team: p.team,
      number: p.number,
      position: p.position,
      location: p.location,
      square: p.pos ? board.fmt(p.pos) : null,
      pos: p.pos,
      stance: p.stance,
      distracted: p.distracted || undefined,
      activated: p.activated,
      hasBall: holder?.id === p.id || undefined,
      profile: `MA ${p.ma} ST ${p.st} AG ${p.ag}+ PA ${p.pa === null ? '-' : `${p.pa}+`} AV ${p.av}+`,
      skills: p.skills.map((k) => skillName(k)),
      actions:
        p.team === s.turn.active && p.location === 'pitch' && s.phase === 'play'
          ? actionOptions(s, p).map((o) => ({ action: o.action, enabled: o.enabled, reason: o.reason }))
          : undefined,
    })),
  };
}

switch (cmd) {
  case 'summary': {
    out(summary(readState(a1)));
    break;
  }
  case 'options': {
    const s = readState(a1);
    out(actionOptions(s, getPlayer(s, a2)));
    break;
  }
  case 'validate': {
    const raw = JSON.parse(fs.readFileSync(a1, 'utf8'));
    const st = raw.format === 'bloodboard-position' ? raw.state : raw;
    const structural = validateState(st);
    // Position checks are for arranged positions; a paused action is mid-resolution.
    out({ structural, position: structural.length || st.pending ? [] : validatePosition(st), pendingDecision: !!st.pending });
    break;
  }
  case 'plan': {
    const s = readState(a1);
    const input = readJson<ActionInput>(a2);
    const plan = planAction(s, input);
    out(plan);
    break;
  }
  case 'execute': {
    const s = readState(a1);
    const input = readJson<ActionInput>(a2);
    const res = execute(s, input);
    writeNext(res.state);
    out({ status: res.status, error: res.error, decision: res.decision, events: res.events });
    break;
  }
  case 'decide': {
    const s = readState(a1);
    const choice = readJson<DecisionChoice>(a2);
    const res = decide(s, choice);
    writeNext(res.state);
    out({ status: res.status, error: res.error, decision: res.decision, events: res.events });
    break;
  }
  default:
    fail('Usage: bloodboard-cli <summary|options|plan|execute|decide|validate> <position.json> [action.json|choice.json|playerId] [--out next.json]');
}

declare const process: { argv: string[]; stdout: { write(s: string): void }; stderr: { write(s: string): void }; exit(code?: number): never };
