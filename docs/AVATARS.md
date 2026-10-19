# Coach avatars (V7-04)

Every computer coach gets a 16x16 pixel face on the **Computer** card (drawn as inline SVG; no external files). Open **Avatars…** on that card to customize it.

**What the face shows (all from real runtime state — nothing random or scripted)**

| Face | When |
| --- | --- |
| thinking | the coach is computing its move (`computer.thinking`) and it is that coach's turn to act |
| acting | that coach's own dice are being shown in the tray |
| cheer | a Touchdown for it, the opponent's Turnover, or a casualty/KO of an opposing player |
| dismay | a Touchdown against it, or its own Turnover |
| hurt | one of its players was knocked out or became a casualty |
| idle | otherwise |

A reaction lasts about 2.6 s and appears after the dice have been shown (it never spoils a roll). A mere Stun is not a reaction.

**Speech bubbles** (optional): short reactions ("Touchdown!", "Ouch.", "Our ball!"). A second, separate switch also puts the coach's one-line reason for its move in the bubble — the same text the Computer card already shows, shortened; it is off by default so a coach's reasoning is never shown unless you ask.

**Customize** per AI file: skin, accent, headgear (none/helmet/horns/cap/crown), face (dots/wide/narrow/visor) and a name tag (24 characters, markup stripped). Looks are saved in this browser under `bloodboard.avatars.v1` and follow the AI file id into every match. **Reset** restores its default look (a deterministic function of the AI id). Both **Show avatars** and **Speech bubbles** can be switched off; with avatars off the Computer card is exactly as before. Animations stop with the system "reduce motion" setting.

**Verification:** `tests/avatars-v7.test.ts` (6: determinism, sanitizing, sprite validity and mood distinctness, reactions from real engine events, expiry/precedence, bubble switches) and `scripts/ui-flow-v7-avatars.mjs` (11: a watched computer-v-computer match in Chromium — thinking only while computing on its own turn, acting only during its dice, real reactions and a bubble, customization persisted and sanitized, switches, reload). Not verified: the native Mac app (never built). Avatars for human coaches and for network opponents are not offered.
