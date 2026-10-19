/** Ready-made teams for offline batches (the same compositions the calibration scripts use). */
import * as Engine from '../../engine/index';
import { newTeamDef, playerFromRoster, ROSTER_BY_ID, ROSTERS as ALL_ROSTERS, buildTeam as draftTeam, type TeamDef } from '../../engine/index';

function team(id: string, rosterId: string, comp: Array<[string, number]>, rerolls: number, sevens = false): TeamDef {
  const t = sevens ? newTeamDef('tournament', rosterId, `${rosterId} sevens`, id, 'sevens') : newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = sevens ? 1 : rerolls;
  t.apothecary = !sevens;
  if (sevens) {
    const vet = t.players.find((p) => p.keywords.includes('Lineman'));
    if (vet) Engine.setVeteran(t, vet.id);
  }
  return t;
}

export const ROSTERS: Record<string, { standard: () => TeamDef; sevens: () => TeamDef }> = {
  human: {
    standard: () => team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]], 3),
    sevens: () => team('hum7', 'human', [['blitzer', 2], ['catcher', 1], ['lineman', 5]], 1, true),
  },
  orc: {
    standard: () => team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]], 3),
    sevens: () => team('orc7', 'orc', [['blitzer', 2], ['bigUn', 1], ['lineman', 4]], 1, true),
  },
};

/** Teams the caller registered by key (for example saved team files); checked first. */
const custom = new Map<string, TeamDef>();
export const registerTeam = (key: string, def: TeamDef): void => { custom.set(key, def); };

/** Rosters a batch may name: the two classic compositions used by earlier batches, then every engine roster (drafted by the engine's own team builder). */
export const listRosters = (): Array<{ id: string; name: string; classic: boolean; formats: string[] }> => [
  ...Object.keys(ROSTERS).map((id) => ({ id, name: `${ROSTER_BY_ID[id]?.name ?? id} (classic)`, classic: true, formats: ['standard', 'sevens'] })),
  ...ALL_ROSTERS.map((r) => ({ id: `draft:${r.id}`, name: `${r.name} (drafted)`, classic: false, formats: (['standard', 'sevens'] as const).filter((f) => { try { return !!draftTeam(r.id, { format: f, play: 'exhibition', id: `t-${r.id}` }); } catch { return false; } }) as string[] })),
];

export const buildTeam = (roster: string, format: 'standard' | 'sevens'): TeamDef => {
  const c = custom.get(roster);
  if (c) return JSON.parse(JSON.stringify(c)) as TeamDef;
  if (roster.startsWith('draft:')) {
    const id = roster.slice(6);
    const t = draftTeam(id, { format, play: 'exhibition', id: `d-${id}` });
    if (!t) throw new Error(`Roster "${id}" cannot be drafted for ${format}.`);
    return t;
  }
  const r = ROSTERS[roster];
  if (!r) throw new Error(`Unknown roster "${roster}" (available: ${Object.keys(ROSTERS).join(', ')}, draft:<id>, or a registered team)`);
  return r[format]();
};
