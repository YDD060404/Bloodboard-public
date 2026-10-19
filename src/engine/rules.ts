import type { RuleRef } from './types';

/**
 * Rule citations. Page numbers are the PRINTED page numbers of the supplied
 * "Blood Bowl Third Season — Official Rulebook (FAQ Nov 2025, update 2026-01-30)"
 * compilation (PDF page = printed page + 2).
 */
export const R = {
  diceRolls: { page: 32, title: 'Dice rolls & target numbers' },
  modifiers: { page: 33, title: 'Modifying dice rolls / natural 1 & 6' },
  rerolls: { page: 33, title: 'Re-rolls and Team Re-rolls' },
  scatter: { page: 34, title: 'Deviate, Scatter and Bouncing Balls' },
  turnover: { page: 35, title: 'The Turnover' },
  armourValue: { page: 37, title: 'Armour Value & Armour Rolls' },
  tackleZones: { page: 38, title: 'Tackle Zones, Marking, Open players' },
  distracted: { page: 39, title: 'Distracted' },
  prone: { page: 39, title: 'Prone and Stunned players' },
  placedProne: { page: 39, title: 'Placed Prone' },
  fallsOver: { page: 40, title: 'Falls Over' },
  knockedDown: { page: 40, title: 'Knocked Down' },
  weather: { page: 46, title: 'The Weather' },
  turn: { page: 50, title: "A Team's Turn" },
  actions: { page: 51, title: 'Declaring Actions' },
  forgo: { page: 52, title: 'Forego Activation' },
  move: { page: 54, title: 'Move Actions' },
  standUp: { page: 54, title: 'Standing Up' },
  dodge: { page: 55, title: 'Dodging' },
  jump: { page: 56, title: 'Jumping over Players' },
  pickUp: { page: 57, title: 'Picking up the Ball' },
  rush: { page: 58, title: 'Rushing' },
  secure: { page: 59, title: 'Secure the Ball Actions' },
  block: { page: 60, title: 'Block Actions' },
  assists: { page: 61, title: 'Assisting a Block Action' },
  blockDice: { page: 62, title: 'Block Dice' },
  push: { page: 62, title: 'Pushed Player' },
  chainPush: { page: 63, title: 'Chain Pushes' },
  crowdPush: { page: 63, title: 'Pushed into the Crowd' },
  followUp: { page: 63, title: 'Follow-up' },
  blitz: { page: 64, title: 'Blitz Actions' },
  injury: { page: 66, title: 'Injury Rolls' },
  stuntyInjury: { page: 66, title: 'Stunty Injury Table' },
  casualty: { page: 67, title: 'Casualty Rolls' },
  crowdInjury: { page: 68, title: 'Injury by the Crowd' },
  foul: { page: 69, title: 'Foul Actions' },
  pass: { page: 70, title: 'Pass Actions' },
  passRange: { page: 71, title: 'Passing Range Chart' },
  passTest: { page: 71, title: 'Test for Accuracy' },
  interception: { page: 71, title: 'Interceptions' },
  resolvePass: { page: 71, title: 'Resolve Pass Action' },
  catch: { page: 72, title: 'Catching the Ball' },
  throwIn: { page: 73, title: 'Throw-ins' },
  cornerThrowIn: { page: 73, title: 'Corner Throw-ins' },
  handoff: { page: 74, title: 'Hand-off Actions' },
  ttm: { page: 76, title: 'Throw Team-mate Actions' },
  touchdown: { page: 80, title: 'Touchdown!' },
  tdOpponentTurn: { page: 80, title: "Scoring during your opponent's turn" },
  stalling: { page: 80, title: 'Stalling' },
  crowdTakesAction: { page: 81, title: 'The Crowd Takes Action' },
  skillUse: { page: 121, title: 'Skill Use (Active / Passive)' },
  traitUse: { page: 122, title: 'Traits' },
} satisfies Record<string, RuleRef>;

export function cite(r: RuleRef): string {
  return `p.${r.page}`;
}
