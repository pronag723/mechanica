/**
 * String over fixed pulleys: g = L₀ − L(q) ≥ 0, λ = tension (N).
 *
 * Gradient. Let a body end P be joined by a straight segment of direction d to the tangent point T
 * on the next pulley (or to the other end). When P moves by δP, T slides along the circle, so δT is
 * parallel to d (the tangent at T is the string direction). Then
 *   δℓ = d·(δT − δP)        (first-order change of |T − P|),
 *   δ(R·φ) = −d·δT          (T moving forward along d shortens the wrapped arc by |δT|),
 * and δL = −d·δP: the arc change cancels the motion of the tangent point, for any R ≥ 0. So
 * ∂L/∂P = −d for the first end (d points from P towards T) and +d for the last end (d points from
 * T towards P): in both cases the unit vector along the segment pointing away from the neighbouring
 * tangent point. Rotation is locked, so the anchor offset is constant and ∂P/∂(x, y) = I. With
 * g = L₀ − L: J_first = +d₀, J_last = −d_last.
 *
 * Curvature. L̇ = Σ_ends (∂L/∂P_e)·v_e, so L̈ = J_L·a + Σ_ends (d/dt ∂L/∂P_e)·v_e. For a segment of
 * length ℓ between points moving with v_A, v_B (Δv = v_B − v_A; a fixed pulley's tangent point
 * only slides along d, which does not turn the segment), ḋ = Δv⊥/ℓ, so the segment contributes
 * ḋ·Δv = |Δv⊥|²/ℓ = (Δv × d)²/ℓ. Segments between two fixed pulleys never turn. With g = L₀ − L:
 *   J̇v = −Σ_segments (Δv × d)²/ℓ,
 * and the acceleration-level constraint J·a = −J̇v reads, for a pendulum, u·a = −v²/ℓ (centripetal).
 * Verified against finite differences in string.test.ts.
 */
import {
  type StringPath,
  type StringTrace,
  createStringTrace,
  setTraceNode,
  traceString,
  traceToPath,
} from '../geometry/string-path';
import type { Model, ModelStringNode, StringConstraint } from '../model/types';
import { type ConstraintRow, addEntry } from './row';

/** Loads a compiled route at configuration q into a trace. */
export function loadRoute(
  nodes: readonly ModelStringNode[],
  q: ArrayLike<number>,
  tr: StringTrace,
): void {
  tr.n = nodes.length;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === 'body') {
      setTraceNode(tr, i, q[node.dofX] + node.anchor.x, q[node.dofY] + node.anchor.y, 0, 0);
    } else if (node.kind === 'fixed') {
      setTraceNode(tr, i, node.point.x, node.point.y, 0, 0);
    } else {
      setTraceNode(tr, i, node.center.x, node.center.y, node.radius, node.wrap === 'ccw' ? 1 : -1);
    }
  }
}

/**
 * Evaluates a string constraint into `row`. Returns false when a tangent does not exist (the
 * configuration is outside the string's domain); value and curvature are then NaN.
 */
export function evalString(
  c: StringConstraint,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
  row: ConstraintRow,
): boolean {
  const tr = row.trace;
  const nodes = c.nodes;
  loadRoute(nodes, q, tr);
  row.nnz = 0;
  if (!traceString(tr)) {
    row.value = NaN;
    row.curvature = NaN;
    return false;
  }
  const n = tr.n;
  row.value = c.restLength - tr.length;

  const first = nodes[0];
  if (first.kind === 'body') {
    addEntry(row, first.dofX, tr.dx[0]);
    addEntry(row, first.dofY, tr.dy[0]);
  }
  const last = nodes[n - 1];
  if (last.kind === 'body') {
    addEntry(row, last.dofX, -tr.dx[n - 2]);
    addEntry(row, last.dofY, -tr.dy[n - 2]);
  }

  // Only end nodes can move (pulleys are fixed in Phase 0).
  let curvature = 0;
  for (let s = 0; s < n - 1; s++) {
    const a = nodes[s];
    const b = nodes[s + 1];
    let dvx = 0;
    let dvy = 0;
    if (b.kind === 'body') {
      dvx += v[b.dofX];
      dvy += v[b.dofY];
    }
    if (a.kind === 'body') {
      dvx -= v[a.dofX];
      dvy -= v[a.dofY];
    }
    if (dvx === 0 && dvy === 0) continue;
    const cross = dvx * tr.dy[s] - dvy * tr.dx[s];
    curvature -= (cross * cross) / tr.len[s];
  }
  row.curvature = curvature;
  return true;
}

/** Geometric length L(q) of a string (NaN outside its domain). */
export function stringLength(c: StringConstraint, q: ArrayLike<number>, tr?: StringTrace): number {
  const trace = tr ?? createStringTrace(c.nodes.length);
  loadRoute(c.nodes, q, trace);
  traceString(trace);
  return trace.length;
}

export type StringGeometry = StringPath & { readonly id: string; readonly restLength: number };

/**
 * Segments and arcs of a string at configuration q, for drawing: the same computation as the
 * constraint, so the picture matches the physics exactly. Throws on an unknown string id.
 */
export function stringGeometry(
  model: Model,
  stringId: string,
  q: ArrayLike<number>,
): StringGeometry {
  const k = model.constraintIndex.get(stringId);
  const c = k === undefined ? undefined : model.constraints[k];
  if (c?.kind !== 'string') throw new RangeError(`stringGeometry: no string "${stringId}"`);
  const tr = createStringTrace(c.nodes.length);
  loadRoute(c.nodes, q, tr);
  const vias = c.nodes.flatMap((node) =>
    node.kind === 'pulley'
      ? [{ id: node.pulley, center: node.center, radius: node.radius, wrap: node.wrap }]
      : [],
  );
  const path: StringPath = traceString(tr)
    ? traceToPath(tr, vias)
    : { ok: false, segment: tr.failSegment, reason: 'tangentMissing' };
  return { ...path, id: c.id, restLength: c.restLength };
}
