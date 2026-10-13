/**
 * simulate(): the event-driven hybrid simulation (DESIGN §3.3–3.4). Each phase has a fixed mode
 * and a smooth right-hand side; every non-smoothness is a located event followed by a new mode
 * selection.
 *
 * Loop: take one DOPRI5 step (the RHS solves the phase's KKT system), locate guard crossings on its
 * dense output; without an event, store the step and (if a nonlinear constraint is active) project
 * the end state back onto the constraints; with one, cut the step at t*, take y = dense(t*), and
 * either record a query hit and continue in the same mode, or select a new mode and start a phase
 * (whose start snaps the state onto the new mode). Impacts are prompt 04: a touchdown or a string
 * jerking taut with a closing rate ends the run with `impactNotImplemented`.
 *
 * End conditions: the horizon; no consistent mode (NO_CONSISTENT_MODE) or too many candidates;
 * terminal geometry; an impact; maxEvents (EVENT_LIMIT, chatter or Zeno behaviour) or 16
 * consecutive events at one instant (EVENT_LIMIT, stalled); integration failure. When v = 0 and
 * a = 0 exactly, the state is an equilibrium of the phase (Phase 0 forces are constant): one
 * constant step reaches the horizon and `atRestFrom` records the time.
 */
import { type Diagnostic, diagnostic } from '../diagnostics';
import type { Model } from '../model/types';
import type { Mode } from '../mode';
import { evalDense } from '../numeric/dense';
import { type Dopri5Stepper, createDopri5 } from '../numeric/dopri5';
import { locateEvents } from '../numeric/events';
import type { QuerySpec } from '../spec';
import { queryValue } from './guards';
import { classifyHits } from './hits';
import { initialState } from './initial';
import { findCandidates, modeIsFeasible, selectModelMode } from './model-modes';
import { type Phase, closePhase, openPhase, projectStepEnd, stepGuards } from './phase';
import { createPhaseSolver } from './phase-solver';
import { projectPositions, projectVelocities } from './projection';
import { createQueryRuntime } from './query-runtime';
import { pushConstant, pushStep } from './steps';
import { simTolerances } from './tolerances';
import type {
  EndReason,
  EventKind,
  SimEvent,
  SimStats,
  SimulateOptions,
  Trajectory,
  TrajectoryPhase,
} from './types';

/** Consecutive events within εt of each other before the run is declared stalled. */
const STALL_LIMIT = 16;

type Outcome = 'same' | 'new' | 'end';

export function simulate(model: Model, opts: SimulateOptions = {}): Trajectory {
  const tol = simTolerances(model.scales);
  const n = model.nDof;
  const dim = 2 * n;
  const horizon = opts.horizon ?? model.options.horizon;
  const maxEvents = opts.maxEvents ?? model.options.maxEvents ?? 10_000;
  const atolScalar = opts.atol ?? model.options.atol;
  const atol = new Float64Array(dim);
  for (let i = 0; i < n; i++) {
    atol[i] = atolScalar ?? 1e-12 * model.scales.length;
    atol[n + i] = atolScalar ?? 1e-12 * model.scales.velocity;
  }
  const stepperOpts = {
    rtol: opts.rtol ?? model.options.rtol ?? 1e-10,
    atol,
    tEnd: horizon,
    hmax: opts.hmax ?? tol.hmax,
    maxSteps: 1_000_000,
  };

  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const report = (ds: readonly Diagnostic[]): void => {
    for (const d of ds) {
      const key = `${d.code}|${JSON.stringify(d.params)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(d);
    }
  };
  const phases: TrajectoryPhase[] = [];
  const events: SimEvent[] = [];
  const stats: SimStats = {
    steps: 0,
    rejected: 0,
    rhsEvals: 0,
    events: 0,
    phases: 0,
    maxProjection: 0,
    maxVelocityProjection: 0,
  };
  let atRestFrom: number | undefined;
  let endReason: EndReason = 'horizon';
  let tEnd = 0;
  const qr = createQueryRuntime(model);
  report(qr.diagnostics);

  const y = new Float64Array(dim);
  y.set(model.q0);
  y.set(model.v0, n);
  const q = y.subarray(0, n);
  const v = y.subarray(n);
  const init = initialState(model, y, tol);
  report(init.diagnostics);
  qr.context.qRef.set(q);

  const finish = (): Trajectory => ({
    dim,
    nDof: n,
    tEnd,
    phases,
    events,
    queries: qr.hits,
    diagnostics,
    endReason,
    ...(atRestFrom !== undefined ? { atRestFrom } : {}),
    stats,
  });
  const noMode = (status: string): EndReason =>
    status === 'tooManyCandidates' ? 'tooManyCandidates' : 'noConsistentMode';
  if (!init.mode) {
    endReason = noMode(init.status);
    return finish();
  }

  // One stepper for the run; the RHS reads the current phase's solver. (A holder object, so that
  // TypeScript does not narrow the closure-assigned state.)
  const run: { phase: Phase | null; stepper: Dopri5Stepper | null } = {
    phase: null,
    stepper: null,
  };
  const qs = new Float64Array(n);
  const vs = new Float64Array(n);
  const rhs = (t: number, yy: Float64Array, dy: Float64Array): void => {
    for (let i = 0; i < n; i++) {
      qs[i] = yy[i];
      vs[i] = yy[n + i];
      dy[i] = yy[n + i];
    }
    const s = run.phase?.solver;
    const ok = s?.solve(t, qs, vs) ?? false;
    for (let i = 0; i < n; i++) dy[n + i] = ok && s ? s.a[i] : NaN;
  };
  const scratch = new Float64Array(dim);
  let lastEventT = NaN;
  let stalled = 0;

  /** Closes the current phase at t and ends the run. */
  const end = (t: number, reason: EndReason, ds: Diagnostic[] = []): 'end' => {
    if (run.phase) phases.push(closePhase(run.phase, t, tol));
    tEnd = t;
    endReason = reason;
    report(ds);
    return 'end';
  };
  const failure = (
    code: 'EVENT_LIMIT' | 'INTEGRATION_FAILED',
    t: number,
    params: Record<string, string | number>,
    message: string,
  ): Diagnostic[] => [diagnostic(code, 'error', [], { t, ...params }, message)];
  const record = (
    t: number,
    kind: EventKind,
    ids: string[],
    after: number,
    data: SimEvent['data'],
  ): void => {
    events.push({ t, kind, ids, phaseBefore: phases.length, phaseAfter: after, data });
    stats.events++;
  };

  /** Starts a phase at (t, y) in mode m (snapping y onto it); false if the run is over. */
  const start = (t: number, m: Mode): boolean => {
    // The snap: q onto g_A = 0, v onto J_A·v = 0 (v_t = 0 exactly for a new stick, gap 0 for a
    // new resting contact).
    projectPositions(model, m, q, tol.project);
    projectVelocities(model, m, q, v, -1);
    const made = createPhaseSolver(model, m, t, q, v);
    if (!made.ok) {
      run.phase = null;
      end(
        t,
        'integrationFailed',
        failure('INTEGRATION_FAILED', t, { reason: made.reason }, `Mode solve failed at t = ${t}.`),
      );
      return false;
    }
    stats.phases++;
    const phase = openPhase(
      model,
      phases.length,
      t,
      y,
      m,
      made.solver,
      tol,
      qr.queries,
      qr.context,
    );
    run.phase = phase;
    if (
      v.every((x) => x === 0) &&
      made.solver.solve(t, q, v) &&
      made.solver.a.every((x) => x === 0)
    ) {
      atRestFrom ??= t;
      if (horizon > t) pushConstant(phase.builder, t, horizon - t, y);
      end(horizon, 'horizon');
      return false;
    }
    if (!run.stepper) run.stepper = createDopri5(rhs, t, y, stepperOpts);
    else run.stepper.restart(t, y);
    return true;
  };
  /** Handles the hits (guard indices) at t*, with y = dense(t*). */
  const handle = (t: number, hitIdx: readonly number[]): Outcome => {
    const ph = run.phase as Phase;
    ph.ev.bump();
    const c = classifyHits(model, ph, hitIdx, t, y, tol);
    for (const i of c.queries) {
      const spec = qr.queries.find((x) => x.id === ph.guards[i].subject) as QuerySpec;
      const value = queryValue(ph.ev, spec, qr.context, t, y);
      qr.hits[spec.id].push({ t, value });
      record(t, 'query', [spec.id], phases.length, { value });
    }
    if (c.terminal) {
      record(t, 'terminal', [c.terminal.subject], -1, { guard: c.terminal.id });
      return end(t, 'terminal');
    }
    if (c.impact) {
      record(t, c.impact.kind, [c.impact.subject], -1, { rate: c.impact.rate });
      return end(t, 'impactNotImplemented');
    }
    if (c.modeHits.length === 0) return 'same';

    const simultaneous = Math.abs(t - lastEventT) <= tol.simultaneity * Math.max(1, Math.abs(t));
    stalled = simultaneous ? stalled + 1 : 0;
    lastEventT = t;
    const cands = findCandidates(model, q, v, tol, { exclude: c.exclude });
    const sel = selectModelMode(model, t, q, v, cands, tol, {
      current: ph.mode,
      forbidden: c.forbidden,
      involved: c.involved,
    });
    const next = sel.mode && stalled < STALL_LIMIT ? phases.length + 1 : -1;
    for (const h of c.modeHits) record(t, h.kind, [h.subject], next, { guard: h.id });
    report(sel.diagnostics);
    if (stalled >= STALL_LIMIT)
      return end(
        t,
        'eventLimit',
        failure(
          'EVENT_LIMIT',
          t,
          { reason: 'stalled', count: stalled },
          `Events repeat at t = ${t} without progress.`,
        ),
      );
    if (!sel.mode) return end(t, noMode(sel.selection.status));
    phases.push(closePhase(ph, t, tol));
    tEnd = t;
    run.phase = null;
    return start(t, sel.mode) ? 'new' : 'end';
  };

  if (!start(0, init.mode)) return finish();

  for (;;) {
    const ph = run.phase as Phase;
    const st = run.stepper as Dopri5Stepper;
    if (st.done) {
      end(horizon, 'horizon');
      break;
    }
    if (stats.events >= maxEvents) {
      end(
        st.t,
        'eventLimit',
        failure(
          'EVENT_LIMIT',
          st.t,
          { reason: 'maxEvents', count: maxEvents },
          `More than ${maxEvents} events: chatter or Zeno behaviour.`,
        ),
      );
      break;
    }
    const r = st.step();
    if (!r.ok) {
      end(
        st.t,
        'integrationFailed',
        failure('INTEGRATION_FAILED', st.t, { reason: r.reason }, r.message),
      );
      break;
    }
    const step = r.step;
    qr.current = step;
    ph.ev.bump();
    const { guards, owner } = stepGuards(ph, step, scratch);
    const found = locateEvents(step, guards, { scratch, simultaneityTol: tol.simultaneity });
    if (found) {
      // Event at t*: cut the step there.
      if (found.t > step.t0) pushStep(ph.builder, step);
      qr.advance(step, found.t);
      evalDense(step, found.t, y);
      qr.current = null;
      const out = handle(
        found.t,
        found.hits.map((h) => owner[h.index]),
      );
      if (out === 'end') break;
      if (out === 'same') st.restart(found.t, y, { h: step.h });
      continue;
    }
    pushStep(ph.builder, step);
    qr.advance(step, step.t1);
    qr.current = null;
    y.set(st.y);
    if (!ph.solver.linear) {
      const p = projectStepEnd(model, ph, step.t1, y, tol);
      stats.maxProjection = Math.max(stats.maxProjection, p.dq);
      stats.maxVelocityProjection = Math.max(stats.maxVelocityProjection, p.dv);
      if (p.dq > 0 || p.dv > 0) st.restart(step.t1, y, { h: st.h });
      if (p.hits.length > 0) {
        const out = handle(step.t1, p.hits);
        if (out === 'end') break;
        continue;
      }
    }
    if (
      ph.solver.status === 'indeterminate' &&
      !modeIsFeasible(model, ph.mode, step.t1, q, v, tol)
    ) {
      end(step.t1, 'indeterminateRegimeChange', [
        diagnostic(
          'INDETERMINATE_REGIME_CHANGE',
          'error',
          [...ph.mode.active],
          { t: step.t1 },
          `The statically indeterminate supports change regime at t ≈ ${step.t1}; not supported.`,
        ),
      ]);
      break;
    }
  }

  stats.steps = run.stepper?.stats.naccept ?? 0;
  stats.rejected = run.stepper?.stats.nreject ?? 0;
  stats.rhsEvals = run.stepper?.stats.nfev ?? 0;
  return finish();
}
