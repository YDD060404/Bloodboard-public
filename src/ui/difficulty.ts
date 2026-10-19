/**
 * Optional difficulty house rule (V5.5, outcome-based) — matches against the computer only. Two independent levels:
 * the human side's handicap and the computer side's boost. The engine weighs every consequential roll by how good its
 * result is for each side (src/engine/dice.ts, context `difficultyFactors`); this module only explains it.
 */
import { h } from './dom';
import { E } from './engine-global';

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

/** Worked examples for the chosen levels: the chances the match (and every preview) uses. */
export function difficultyTable(player: number, computer: number): HTMLElement {
  const rows = E.difficultyExamples(player, computer);
  return h(
    'table',
    { class: 'difftable small', id: 'difficulty-table' },
    h('thead', null, h('tr', null, h('th', null, 'Example'), h('th', null, 'Standard'), h('th', null, 'Human side rolls'), h('th', null, 'Computer side rolls'))),
    h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.what), h('td', null, pct(r.standard)), h('td', null, pct(r.human)), h('td', null, pct(r.computer))))),
  );
}

export const DIFFICULTY_TEXT =
  'Not standard Blood Bowl. Every consequential roll — tests, re-roll checks, Block dice, Armour, Injury and Casualty Rolls, KO recovery, roll-offs — is judged by who its result helps: results good for the human side are made a little less likely, results good for the computer side a little more (the two levels are independent). A high number is never assumed to be good: an Armour Roll counts as good for the side it breaks armour for, Block dice by the face the choosing coach would take. Every result stays possible; neutral rolls (Weather, Kick-off table, scatter, throw-ins, random picks) are never changed; Off = standard dice. The previews, the computer and AI Focus use exactly the same odds, and the match records the setting. Only in matches between a human and the computer (never on the tactical board, in Tournament matches, hot-seat or computer v computer).';
