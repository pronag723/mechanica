# Prompt series for Claude Code

Each file is one work order for one fresh Claude Code session (Opus). The prompts build on each other and must be run in order.

## How to run a prompt
1. Open the repo root in Claude Code and start a **new session**.
2. Switch to **plan mode** and send: `Implement prompts/NN-name.md`.
3. Review the plan before approving it:
   - Does it stay inside the prompt's scope?
   - Does it list the tests the prompt asks for?
   - Does it read `CLAUDE.md`, `docs/DESIGN.md` and `docs/PROGRESS.md`?
4. Let it work. When it reports done, check the result yourself:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
   For UI prompts, also run `pnpm dev` and click through the app.
5. Fix problems in the same session. **Refuse "fixes" that loosen tolerances or edit expected values.** Physics tests fail for a reason.
6. Each prompt ends with a commit. Make sure `docs/PROGRESS.md` got a new entry before you move on.

Use **high effort** for prompts 01–04 (numerics and physics) and the default for the rest.

**If a session runs out of room:** say "Finish the current section, update PROGRESS.md with exactly where you stopped, and stop." Then start a new session with "Continue prompts/NN-name.md from PROGRESS.md".

## Index
### Phase 0: engine only (exit: DESIGN §8 tests 1, 2a–c, 3 at 1e-9)
| # | Prompt | Result |
|---|---|---|
| 00 | [Bootstrap](00-bootstrap.md) | Monorepo, tooling, CI, independent SymPy oracle |
| 01 | [Numerics](01-numerics.md) | LU/QR, DOPRI5 with dense output, event location |
| 02 | [Model and constraints](02-model-and-constraints.md) | ModelSpec, string over pulleys, contacts, instantaneous KKT solve |
| 03 | [Hybrid simulator](03-hybrid-simulator.md) | Phases, guards, mode selection, probes, queries, Trajectory |
| 04 | [Impacts and Phase 0 exit](04-impacts-and-phase0-exit.md) | Impacts, slack/taut, Zeno, terminal events, CLI, regression harness |

### Phase 1: minimal end-to-end app (exit: a newcomer builds tests 1–3 in under 2 minutes)
| # | Prompt | Result |
|---|---|---|
| 05 | [App shell and design system](05-app-shell.md) | Vite app, tokens, layout, canvas camera, grid, i18n |
| 06 | [Scene document](06-scene-document.md) | Relational schema, expressions, resolver, compiler, store, undo, URL share |
| 07 | [Editor](07-editor.md) | Palette, placement, snapping, selection, inspector, parameters |
| 08 | [String tool](08-string-tool.md) | Routing over pulleys, "hang a weight", alignment |
| 09 | [Simulation and timeline](09-simulation-and-timeline.md) | Worker, playback, phase bands, event stepping |
| 10 | [Answers](10-answers.md) | Probes, Find panel, event log, phase summary, assumptions, examples |

### Later phases (to be written after the previous phase ships, so they match the real code)
- **Phase 2:**
  - 11 Static inclines with face-aligned blocks and a pulley at the top
  - 12 Springs, bumpers, elastic strings
  - 13 Applied forces F(t), drivers, massive pulleys
  - 14 Free-body diagram overlay, velocity and acceleration arrows, traces
  - 15 Graphs (uPlot), query builder with expressions, "check my answer"
  - 16 Phase 2 regression (tests 4–14) and coverage matrix
- **Phase 3:**
  - 17 Point masses and projectiles
  - 18 Curved tracks (arc, loop, hemisphere)
  - 19 Pendulum and rods
  - 20 Collisions and stick-together
  - 21 Energy and momentum panels
- **Phase 4:**
  - 22 Contacts between moving bodies (stacks, board, cart, movable wedge)
  - 23 Movable pulleys and knots
  - 24 Elevator and conveyor
- **Phase 5:**
  - 25 Equations of each phase (symbols, numbers, residual check)
  - 26 Parameter sweeps and inverse solving
  - 27 Accounts and library (Supabase)
