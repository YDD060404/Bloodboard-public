# Bloodboard 7.0.0-alpha.4 — histories, Lab data, replay

Builds on alpha.2 (rules edition gate, DeepSeek/Luna online coach bridge). Luna (alpha.3) is still not live-verified, so alpha.3 stays open.

## Usable changes
- Canonical `bloodboard-history` v1 (single) and batch files; verified by re-executing the log. See docs/HISTORY_FORMAT.md.
- Export history… in the app; drag-and-drop import of histories and AI files; opening a history shows verification and the replay panel.
- Replay steps animate with the existing V4 timeline; replay panel shows measured match data (counts only, no win probability).
- Match Lab: live analytics panel, canonical history files and a history batch in export.
- Bridge lifecycle (single instance, ready line, auto-port, shutdown on parent exit) — Node-verified; Swift launcher written but never compiled.

## Verification (stand-in providers only)
tsc clean; history/analytics/replay/identity/faq targeted tests 55/55; bridge tests 51/51; UI flows online 18/18, play 9/9, autostart 10/10, drop 9/9, history 21/21; Lab smoke 24/24, history 13/13, analytics 7/7. Full suite: 692/692 on the frozen source.

## Not verified / known limitations
Real DeepSeek and Luna calls; native Mac build and launch; LAN and internet multiplayer (not built); win probability; multi-file AI package manifest; Quick Match remembered settings; High Elf conflict; spatial originals missing.

## Next task
alpha.5 training mode (V7-11), then LAN (V7-05), internet (V7-12), scouting/avatars/interaction (alpha.8). See NEXT_SESSION.md and docs/USER_ACTIONS.md.
