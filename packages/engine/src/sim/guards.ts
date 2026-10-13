/**
 * Guards of one phase (DESIGN §3.4): scalar functions of (t, y) on the dense output whose sign
 * change is an event. Every guard has a home side (where it lives while the phase is valid) and
 * fires when it leaves it:
 *
 * | phase state        | guard                         | dir     | home | event           | band |
 * |--------------------|-------------------------------|---------|------|-----------------|------|
 * | active string      | λ (tension)                   | falling | +    | slack           | εF   |
 * | active contact     | λ_n                           | falling | +    | separation      | εF   |
 * | active contact     | overlap with the face extent  | falling | +    | leftSurface     | εpos |
 * | slipPos / slipNeg  | v_t                           | fall/rise | ± | stopOrReverse   | εvel |
 * | stick              | μs·λ_n − λ_t, μs·λ_n + λ_t    | falling | +    | breakLoose      | εF   |
 * | inactive contact   | gap                           | falling | +    | touchdown       | εpos |
 * | inactive string    | gap = L₀ − L                  | falling | +    | taut            | εpos |
 * | active string      | signed length per moving seg. | falling | +    | terminal        | εpos |
 * | active string      | unwrapped wrap angle per via  | falling | +    | terminal        | 1e-9 |
 * | query              | probe − value, or its rate    | per query      | query           | 1e-9·scale |
 *
 * λ guards solve the phase's KKT system at the dense state (cached per sample time).
 * Segment guards ("length → 0") need a sign change, but ℓ ≥ 0 only touches 0 (a hanging block
 * rising along the tangent line into its pulley, or passing through a fixed end point). The guard
 * is d_k·(B − A), with d_k the segment's direction at the start of the current step and a
 * pulley's tangent point frozen there (the tangent formula itself keeps ℓ ≥ 0 and rolls the
 * tangent point on as an end slides past it). It equals ℓ up to second order in the step's motion
 * and changes sign when an end passes its tangent point or the other end; entering a pulley's
 * disc (no tangent) reads −L*. A hit is confirmed only if ℓ ≤ 1e-6·L* there; otherwise the end
 * passed beside its anchor and nothing happens.
 * A wrap guard is the wrap angle unwrapped continuously from step to step (the raw angle is
 * reduced to [0, 2π) and jumps at the cut). Geometry guards watch taut strings only: a slack
 * string has no path in Phase 0. Outside a string's domain (no tangent) λ guards read their home
 * side (no event) and geometry guards read a negative value (an event at the domain boundary).
 */
import { contactGap, contactOverlap, createModelRow, evalConstraint } from '../constraints';
import type { StringConstraint } from '../model/types';
import type { QuerySpec } from '../spec';
import type { CandidateState } from './mode-select';
import type { PhaseEval } from './phase-eval';
import { type ProbeState, evalProbe, evalProbeRate, probeRateScale, probeScale } from './probes';
import type { SimTolerances } from './tolerances';
import type { EventKind } from './types';

const FAR = 1e300;
const TWO_PI = 2 * Math.PI;

export interface GuardDef {
  readonly id: string;
  readonly kind: EventKind;
  /** The guard's subject: a constraint, string or query id. */
  readonly subject: string;
  readonly direction: 'rising' | 'falling' | 'any';
  /** +1: lives above 0 (falling guards); −1: below (rising); 0: either ('any' queries). */
  readonly home: 1 | -1 | 0;
  readonly band: number;
  /** When it fires: the states the subject may not take in the next mode selection. */
  readonly forbid?: readonly CandidateState[];
  /** Pending guards fire at the far edge of the band (mode guards: true; queries: false). */
  readonly fallback: boolean;
  readonly fn: (t: number, y: Float64Array) => number;
  /** Called with the state at the start of every step, before the guard is evaluated on it. */
  readonly refresh?: (t: number, y: Float64Array) => void;
  /**
   * Called on a hit at (t*, y*): null confirms the event; a status means "no event here" and
   * sets the guard's new status (a touchdown beside the face, a string end passing beside its
   * anchor).
   */
  readonly confirm?: (t: number, y: Float64Array) => 'pending' | 'dormant' | null;
}

export interface QueryContext {
  readonly qRef: ArrayLike<number>;
  /** Path length of a body at (t, y) inside the current step. */
  path(bodyIndex: number, t: number): number;
}

/** All guards of a phase, in a stable order (constraints by id, then strings, then queries). */
export function buildGuards(
  ev: PhaseEval,
  tol: SimTolerances,
  t0: number,
  y0: Float64Array,
  queries: readonly QuerySpec[],
  qc: QueryContext,
): GuardDef[] {
  const { model, solver } = ev;
  const out: GuardDef[] = [];
  const n = model.nDof;
  const layout = solver.layout;
  const nA = layout.active.length;
  const row = createModelRow(model);
  const lam = (j: number) => (t: number, y: Float64Array) =>
    ev.at(t, y) && Number.isFinite(solver.lambda[j]) ? solver.lambda[j] : FAR;
  const posOf = new Map<number, number>();
  layout.active.forEach((ci, j) => posOf.set(ci, j));
  const stickOf = new Map<number, number>();
  layout.stick.forEach((j, k) => stickOf.set(j, nA + k));
  const ACTIVE: CandidateState[] = ['active', 'stick', 'slipPos', 'slipNeg'];

  for (const c of model.constraints) {
    const j = posOf.get(c.index);
    if (j !== undefined) {
      // Active.
      if (solver.determined[j]) {
        out.push({
          id: `lambda:${c.id}`,
          kind: c.kind === 'string' ? 'slack' : 'separation',
          subject: c.id,
          direction: 'falling',
          home: 1,
          band: tol.force,
          forbid: ACTIVE,
          fallback: true,
          fn: lam(j),
        });
      }
      if (c.kind !== 'contact') continue;
      if (Number.isFinite(c.faceLo) || Number.isFinite(c.faceHi)) {
        out.push({
          id: `overlap:${c.id}`,
          kind: 'leftSurface',
          subject: c.id,
          direction: 'falling',
          home: 1,
          band: tol.pos,
          fallback: true,
          fn: (_t, y) => contactOverlap(c, y),
        });
      }
      const s = layout.slip[j];
      if (s !== 0) {
        out.push({
          id: `vt:${c.id}`,
          kind: 'stopOrReverse',
          subject: c.id,
          direction: s > 0 ? 'falling' : 'rising',
          home: s > 0 ? 1 : -1,
          band: tol.vel,
          forbid: [s > 0 ? 'slipPos' : 'slipNeg'],
          fallback: true,
          fn: (_t, y) => c.tangent.x * y[n + c.dofX] + c.tangent.y * y[n + c.dofY],
        });
      } else {
        const jt = stickOf.get(j) ?? -1;
        if (!solver.determined[j] || !solver.determined[jt]) continue;
        const mu = c.material.muS;
        for (const sign of [-1, 1] as const) {
          out.push({
            id: `stick${sign > 0 ? '+' : '-'}:${c.id}`,
            kind: 'breakLoose',
            subject: c.id,
            direction: 'falling',
            home: 1,
            band: tol.force,
            forbid: ['stick'],
            fallback: true,
            fn: (t, y) => (ev.at(t, y) ? mu * solver.lambda[j] + sign * solver.lambda[jt] : FAR),
          });
        }
      }
      continue;
    }
    // Inactive: the gap closing. A contact only touches down inside its face's extent.
    out.push({
      id: `gap:${c.id}`,
      kind: c.kind === 'string' ? 'taut' : 'touchdown',
      subject: c.id,
      direction: 'falling',
      home: 1,
      band: tol.pos,
      fallback: true,
      ...(c.kind === 'contact'
        ? {
            confirm: (_t: number, y: Float64Array) =>
              contactOverlap(c, y) > tol.pos ? null : ('dormant' as const),
          }
        : {}),
      fn:
        c.kind === 'contact'
          ? (_t, y) => contactGap(c, y)
          : (t, y) => (evalConstraint(c, t, y, y, row) ? row.value : FAR), // v unused by g
    });
  }

  for (const c of model.constraints) {
    if (c.kind === 'string' && posOf.has(c.index))
      out.push(...stringGeometryGuards(c, tol, t0, y0, row));
  }
  for (const qs of queries) out.push(...queryGuards(ev, tol, qs, qc));
  return out;
}

function stringGeometryGuards(
  c: StringConstraint,
  tol: SimTolerances,
  t0: number,
  y0: Float64Array,
  row: ReturnType<typeof createModelRow>,
): GuardDef[] {
  const out: GuardDef[] = [];
  const L = tol.scales.length;
  if (!evalConstraint(c, t0, y0, y0, row)) return out;
  const tr = row.trace;
  const nodes = c.nodes;
  for (let s = 0; s + 1 < nodes.length; s++) {
    if (nodes[s].kind !== 'body' && nodes[s + 1].kind !== 'body') continue; // never changes
    // Direction and pulley tangent points at the start of the current step.
    const pulleyA = nodes[s].kind === 'pulley';
    const pulleyB = nodes[s + 1].kind === 'pulley';
    let dx = tr.dx[s];
    let dy = tr.dy[s];
    let ax = tr.ax[s];
    let ay = tr.ay[s];
    let bx = tr.bx[s];
    let by = tr.by[s];
    out.push({
      id: `segment:${c.id}:${s}`,
      kind: 'terminal',
      subject: c.id,
      direction: 'falling',
      home: 1,
      band: tol.pos,
      fallback: true,
      fn: (t, y) => {
        if (!evalConstraint(c, t, y, y, row)) return -L;
        const Ax = pulleyA ? ax : tr.ax[s];
        const Ay = pulleyA ? ay : tr.ay[s];
        const Bx = pulleyB ? bx : tr.bx[s];
        const By = pulleyB ? by : tr.by[s];
        return dx * (Bx - Ax) + dy * (By - Ay);
      },
      refresh: (t, y) => {
        if (!evalConstraint(c, t, y, y, row)) return;
        dx = tr.dx[s];
        dy = tr.dy[s];
        ax = tr.ax[s];
        ay = tr.ay[s];
        bx = tr.bx[s];
        by = tr.by[s];
      },
      confirm: (t, y) =>
        evalConstraint(c, t, y, y, row) && tr.len[s] > 1e-6 * L ? 'pending' : null,
    });
  }
  for (let i = 1; i + 1 < nodes.length; i++) {
    // Unwrapped angle at the last refresh, and the raw [0, 2π) angle there.
    let unwrapped = tr.wrap[i];
    let raw = tr.wrap[i];
    const at = (): number => {
      let d = tr.wrap[i] - raw;
      d -= TWO_PI * Math.round(d / TWO_PI);
      return unwrapped + d;
    };
    out.push({
      id: `wrap:${c.id}:${i}`,
      kind: 'terminal',
      subject: c.id,
      direction: 'falling',
      home: 1,
      band: tol.angle,
      fallback: true,
      fn: (t, y) => (evalConstraint(c, t, y, y, row) ? at() : -1),
      refresh: (t, y) => {
        if (!evalConstraint(c, t, y, y, row)) return;
        unwrapped = at();
        raw = tr.wrap[i];
      },
    });
  }
  return out;
}

function queryGuards(
  ev: PhaseEval,
  tol: SimTolerances,
  qs: QuerySpec,
  qc: QueryContext,
): GuardDef[] {
  const { model, mode } = ev;
  const state = (t: number, y: Float64Array): ProbeState => {
    ev.at(t, y);
    return {
      q: ev.q,
      v: ev.v,
      mode,
      qRef: qc.qRef,
      forces: () => ev.forces,
      path: (b) => qc.path(b.index, t),
    };
  };
  const cond = qs.condition;
  if (cond.kind === 'equals') {
    const dir = cond.direction ?? 'any';
    return [
      {
        id: `query:${qs.id}`,
        kind: 'query',
        subject: qs.id,
        direction: dir,
        home: dir === 'falling' ? 1 : dir === 'rising' ? -1 : 0,
        band: 1e-9 * Math.max(Math.abs(cond.value), probeScale(model, qs.probe)),
        fallback: false,
        fn: (t, y) => evalProbe(model, qs.probe, state(t, y)) - cond.value,
      },
    ];
  }
  // Extremum: the rate crosses 0 from + to − (max) or − to + (min).
  const max = cond.kind === 'max';
  return [
    {
      id: `query:${qs.id}`,
      kind: 'query',
      subject: qs.id,
      direction: max ? 'falling' : 'rising',
      home: max ? 1 : -1,
      band: 1e-9 * probeRateScale(model, qs.probe),
      fallback: false,
      fn: (t, y) => evalProbeRate(model, qs.probe, state(t, y)) ?? 0,
    },
  ];
}

/** The probe value of a query at (t, y), for recording a hit. */
export function queryValue(
  ev: PhaseEval,
  qs: QuerySpec,
  qc: QueryContext,
  t: number,
  y: Float64Array,
): number {
  ev.at(t, y);
  return evalProbe(ev.model, qs.probe, {
    q: ev.q,
    v: ev.v,
    mode: ev.mode,
    qRef: qc.qRef,
    forces: () => ev.forces,
    path: (b) => qc.path(b.index, t),
  });
}
