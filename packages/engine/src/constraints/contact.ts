/**
 * Body on a face of a static support (rotation locked, so everything here is linear in p).
 *
 * Face: the line n·x = d with outward unit normal n; tangent t = (n_y, −n_x) (n turned clockwise,
 * so (t, n) is right-handed: a floor has n = ŷ, t = x̂).
 * Gap: g = n·p − d − h(−n), with h(u) = max_v u·(R·v) the support function of the body's
 * fixed-orientation shape. Equivalently g = min_v n·(p + R·v) − d: the signed distance of the
 * body's lowest point (in direction n) from the face line. J = nᵀ on the body's (x, y), J̇ = 0.
 * λ = normal force (N) ≥ 0, acting along +n on the body.
 *
 * A face's gap is not a penetration test by itself: for a block on a table, the table's bottom
 * face has a large negative gap. A contact is meaningful only inside its validity domain
 * (`contactOverlap` > 0) and with |gap| small; penetration is decided by the separating-axis test
 * in the compiler.
 *
 * Friction rows use J_t = tᵀ: relative tangential velocity v_t = t·v_body (the support is fixed).
 */
import type { ContactConstraint } from '../model/types';
import type { Vec2 } from '../spec';
import { type ConstraintRow, addEntry } from './row';

/** g(q) = n·p + depth − offset. */
export function contactGap(c: ContactConstraint, q: ArrayLike<number>): number {
  return c.normal.x * q[c.dofX] + c.normal.y * q[c.dofY] + c.depth - c.offset;
}

export function evalContact(c: ContactConstraint, q: ArrayLike<number>, row: ConstraintRow): void {
  row.value = contactGap(c, q);
  row.curvature = 0;
  row.nnz = 0;
  addEntry(row, c.dofX, c.normal.x);
  addEntry(row, c.dofY, c.normal.y);
}

/**
 * The tangential row of a contact (static friction): J_t = tᵀ, J̇_t·v = 0. Its value is the
 * body's coordinate t·p along the face (velocity-level constraint; the value is informational).
 */
export function evalContactTangent(
  c: ContactConstraint,
  q: ArrayLike<number>,
  row: ConstraintRow,
): void {
  row.value = c.tangent.x * q[c.dofX] + c.tangent.y * q[c.dofY];
  row.curvature = 0;
  row.nnz = 0;
  addEntry(row, c.dofX, c.tangent.x);
  addEntry(row, c.dofY, c.tangent.y);
}

/** Tangential velocity v_t = t·v_body (slipPos ⇔ v_t > 0). */
export function contactTangentialVelocity(c: ContactConstraint, v: ArrayLike<number>): number {
  return c.tangent.x * v[c.dofX] + c.tangent.y * v[c.dofY];
}

/**
 * Validity domain of the contact: the overlap, along t, of the body's support feature (the vertex
 * or edge in direction −n) with the face's extent,
 *   min(s + supportHi − faceLo, faceHi − (s + supportLo)),  s = t·p.
 * Positive while the feature overlaps the face, 0 when its trailing end is exactly at the face's
 * end (a rotation-locked box stays supported until its whole bottom face has left the edge),
 * negative beyond. +Infinity for half-planes. Each argument of the min is linear in p, so
 * prompt 03 can watch either as a guard.
 */
export function contactOverlap(c: ContactConstraint, q: ArrayLike<number>): number {
  if (c.faceLo === -Infinity && c.faceHi === Infinity) return Infinity;
  const s = c.tangent.x * q[c.dofX] + c.tangent.y * q[c.dofY];
  return Math.min(s + c.supportHi - c.faceLo, c.faceHi - (s + c.supportLo));
}

/**
 * Where the contact force acts, for drawing: on the face line, at the middle of the overlap of the
 * support feature with the face (the middle of the feature on a half-plane).
 */
export function contactPoint(c: ContactConstraint, q: ArrayLike<number>): Vec2 {
  const s = c.tangent.x * q[c.dofX] + c.tangent.y * q[c.dofY];
  const lo = Math.max(s + c.supportLo, c.faceLo);
  const hi = Math.min(s + c.supportHi, c.faceHi);
  const m = (lo + hi) / 2;
  // x = (n·x)·n + (t·x)·t with n·x = offset on the face line.
  return {
    x: c.offset * c.normal.x + m * c.tangent.x,
    y: c.offset * c.normal.y + m * c.tangent.y,
  };
}
