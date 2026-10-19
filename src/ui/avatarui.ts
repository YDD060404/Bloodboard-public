// V7-04 — avatar widgets: the face with its speech bubble on the Computer card, and the customization window.
import type { TeamId } from '../engine/types';
import type { App } from './app';
import { computerCoaches, type CoachCfg } from './computer';
import { h } from './dom';
import { shell } from './modals';
import { ACCENTS, FACES, HEADGEARS, SKINS, avatarSettings, bubbleText, moodFor, reactionOf, resetSpec, saveAvatarSettings, setSpec, specFor, spriteSvg, type Mood } from './avatars';

/** One coach's face (and bubble). `reasonLine` is the Computer card's own text for that coach; it only reaches the bubble if the person turned that on. */
export function avatarFor(app: App, c: Pick<CoachCfg, 'team' | 'ai' | 'name'>, reasonLine: string | null, coachToAct: boolean): HTMLElement | null {
  const s = avatarSettings();
  if (!s.enabled) return null;
  const now = Date.now();
  const mood: Mood = moodFor({ thinking: app.st.computer.thinking, coachToAct, acting: app.playbackActive() && coachToAct, reaction: reactionOf(c.team), now });
  const spec = specFor(c.ai);
  const face = h('div', { class: `avatar mood-${mood}`, 'data-mood': mood, 'data-team': c.team, 'data-ai': c.ai, title: `${spec.label || c.name} — ${mood}` });
  face.innerHTML = spriteSvg(spec, mood, 0, 3);
  const text = bubbleText(c.team, reasonLine, now);
  return h('div', { class: 'avatar-row', 'data-team': c.team }, face, text ? h('div', { class: 'avatar-bubble', 'data-team': c.team, role: 'status' }, text) : null);
}

export function avatarsModal(app: App) {
  const s = avatarSettings();
  const seen = new Map<string, string>();
  for (const c of computerCoaches(app)) seen.set(c.ai, c.name);
  for (const id of Object.keys(s.specs)) if (!seen.has(id)) seen.set(id, id);
  const redraw = () => app.set({ modal: { kind: 'avatars' } });
  const flag = (id: string, label: string, get: () => boolean, set: (v: boolean) => void) =>
    h('label', { class: 'small', style: 'display:block' }, h('input', { type: 'checkbox', id, checked: get(), onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); saveAvatarSettings(); redraw(); } }), ` ${label}`);
  const rows = [...seen.entries()].map(([id, name]) => {
    const spec = specFor(id);
    const preview = h('div', { class: 'avatar avatar-preview', 'data-ai': id });
    preview.innerHTML = spriteSvg(spec, 'idle', 0, 6);
    const pick = <T extends string | number>(label: string, key: 'skin' | 'accent' | 'headgear' | 'face', opts: T[], show: (v: T) => string) =>
      h('label', { class: 'small' }, `${label} `, h('select', { 'data-ai': id, 'data-key': key, onchange: (e: Event) => { const raw = (e.target as HTMLSelectElement).value; setSpec(id, { [key]: typeof opts[0] === 'number' ? Number(raw) : raw } as never); redraw(); } },
        opts.map((o) => h('option', { value: String(o), selected: spec[key] === o }, show(o)))));
    return h('div', { class: 'card avatar-edit', 'data-ai': id },
      h('div', { class: 'row-between' }, h('b', null, name), h('button', { class: 'btn ghost small', onclick: () => { resetSpec(id); redraw(); } }, 'Reset')),
      h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, preview,
        h('div', null,
          pick('Skin', 'skin', SKINS.map((_, i) => i), (i) => `Colour ${i + 1}`),
          pick('Accent', 'accent', ACCENTS.map((_, i) => i), (i) => `Colour ${i + 1}`),
          pick('Headgear', 'headgear', [...HEADGEARS], (v) => v),
          pick('Face', 'face', [...FACES], (v) => v),
          h('label', { class: 'small' }, 'Name tag ', h('input', { type: 'text', maxlength: '24', value: spec.label, 'data-ai': id, 'data-key': 'label', onchange: (e: Event) => { setSpec(id, { label: (e.target as HTMLInputElement).value }); redraw(); } })))));
  });
  return shell(app, 'Coach avatars', [
    h('p', { class: 'small' }, 'Each computer coach gets a pixel face. It shows what the coach is really doing: thinking while it calculates, acting while its dice roll, and cheering, wincing or sulking after a Touchdown, Turnover or injury. Nothing is random or scripted.'),
    flag('avatars-enabled', 'Show avatars', () => s.enabled, (v) => { s.enabled = v; }),
    flag('avatars-bubbles', 'Speech bubbles with short reactions (“Touchdown!”, “Ouch.”)', () => s.bubbles, (v) => { s.bubbles = v; }),
    flag('avatars-reasons', 'Also show the coach’s one-line reason for its move in the bubble (the same text as the Computer card)', () => s.reasons, (v) => { s.reasons = v; }),
    ...rows,
    rows.length ? null : h('p', { class: 'small muted' }, 'Start a match with a computer coach to customize its avatar here.'),
  ], true);
}
