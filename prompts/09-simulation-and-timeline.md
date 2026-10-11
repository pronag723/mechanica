# Prompt 09: Simulation in a worker, playback, timeline

> Phase 1 · depends on 08 · plan mode first

## Context
Read `CLAUDE.md`, `docs/UI.md` §4 and §6, DESIGN §1.3 (precompute and scrub) and §6.7, the engine README (simulate, Trajectory, `stateAt`, events, diagnostics) and PROGRESS.md. The editor can build scenes; now they come alive. The engine precomputes the whole trajectory, so time controls just sample it. Make it feel **instant**: a parameter edit re-simulates and redraws within a frame or two, like dragging a slider in Desmos.

## Goal
The engine runs in a Web Worker on every document change. Playback is smooth at 60 fps. A timeline shows phase bands and event ticks, with exact stepping between events. Editing semantics are clear.

## Build
### 1. Worker (`src/sim/`)
- `sim.worker.ts` speaks a typed protocol:
  - in: `{ type: 'simulate', generation, model }`;
  - out: `{ type: 'result', generation, trajectory, diagnostics, stats }` or `{ type: 'error', generation, message }`.
  - Pass the Float64Array buffers of the trajectory in the transfer list.
- Compile the document to a ModelSpec on the main thread. The main thread also needs the model for `forcesAt` and probes.
- **Scheduling:**
  - re-run on every compiled-model change;
  - throttle to one run in flight plus one pending, keeping only the latest;
  - ignore stale generations.
- Show "вычисляю…" in the status chip only when a run takes more than 150 ms.
- If the compile step has errors, don't simulate. Show the errors instead.

### 2. Playback
- A clock maps wall time to simulation time × speed via `requestAnimationFrame`.
- **Per frame:** sample `stateAt(traj, t)`, then update SVG transforms and string paths **imperatively through refs**. Strings use `stringGeometry` at that q. No React re-render per frame.
- When playback reaches the horizon it stops, unless loop is on.
- **"Pause at events"** (a toggle): playback stops exactly at each event time.

### 3. Timeline bar (UI.md §6)
- **Controls:**
  - play/pause (Space) and to start (Home);
  - previous/next event (Shift+←/→), landing **exactly** on event times;
  - frame step (←/→, Δt = 1/60 s of simulation time);
  - speed menu (0.1×, 0.25×, 0.5×, 1×, 2×, 5×, 10×), loop, pause at events;
  - time readout `t = 0,714 с` with tabular figures and the scene's significant figures.
- **Track:**
  - Phase bands use alternating neutral tints. A hover tooltip gives a **mode description**, generated from the mode, provenance and i18n: for example "нить T₁ натянута · m₁ скользит вправо · m₂ висит" or "нить T₁ провисла · m₁ тормозит · m₂ на полу".
  - Event ticks have an icon per kind and a tooltip with a localized message ("0,714 с — m₂ ударился о пол (неупругий удар)").
  - The playhead is accent colored and draggable (scrub). Clicking a tick jumps to it.
  - The right end shows the horizon and a "+5 с" extend button.
- The end reason appears at the end of the track: "состояние покоя с 1,429 с", "m₁ достиг блока", or an error.

### 4. Editing semantics
These rules must be followed exactly; document them in PROGRESS.md.
- **Direct manipulation on the canvas** (drag, placement, string tool) while the playhead is not at 0: the playhead resets to 0 and playback pauses. You always edit the t = 0 scene.
- **Inspector and slider edits** keep the playhead time. The scene at that time updates live as the trajectory recomputes. This is the Desmos feel.
- Edits during playback recompute the trajectory and playback continues from the same time.
- At t > 0, edit handles are hidden and bodies are drawn at their simulated state. A toggle shows the t = 0 ghost (faint) for reference.

### 5. Status chip (top right)
- Normal: "Готово · 4 события · 3 мс".
- On problems: a warning or error count. Clicking it opens a popover listing diagnostics with localized messages; clicking a diagnostic selects the involved elements.

## Tests
- **Unit:** clock mapping (speed, pause, seek); next/previous event selection; the mode-description generator (from fixtures); the stale-generation logic in the scheduler. Test the handler function directly, without a real worker.
- **Playwright:**
  - open the t03 preset, play, use "next event" twice, and assert the readouts 0,714 с and 1,429 с at 4 significant figures;
  - drag the scrubber;
  - change m₂ with the inspector while paused at t = 0.5 s and check the playhead stays and the state updates;
  - drag a block on the canvas at t > 0 and check the playhead resets to 0.
- **Performance:** measure frame time during playback of t03 (Performance API in the e2e test, or record a manual measurement in PROGRESS.md). The target is a steady 60 fps, with recompute under 16 ms for Phase 1 scenes.

## Out of scope
Probes, the Find panel, the event log panel, the phase summary card (all in prompt 10), graphs, force vectors.

## Definition of done
- [ ] Building a scene and pressing Space plays it. Event stepping is exact. Edits update instantly.
- [ ] Tests, e2e, typecheck and lint are green.
- [ ] PROGRESS.md entry with performance numbers.
- [ ] Commit: `feat(web): worker simulation, playback, timeline with phase bands and event stepping`
