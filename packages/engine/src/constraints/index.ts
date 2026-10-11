/** Constraint evaluation: one dispatch over the constraint kinds. */
import type { Constraint, Model } from '../model/types';
import { evalContact } from './contact';
import { type ConstraintRow, createConstraintRow } from './row';
import { evalString } from './string';

export * from './row';
export * from './string';
export * from './contact';

/** A row buffer large enough for every constraint of the model. */
export function createModelRow(model: Model): ConstraintRow {
  // A string touches at most its two end bodies (2 DOFs each); a contact one body.
  return createConstraintRow(4, model.maxRouteNodes);
}

/**
 * Evaluates g, J and the curvature term of constraint `c` at (t, q, v) into `row`. Phase 0 has no
 * explicitly time-dependent constraints, so t is unused. Returns false when the configuration is
 * outside the constraint's domain (a string tangent does not exist); the row then holds NaN.
 */
export function evalConstraint(
  c: Constraint,
  _t: number,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
  row: ConstraintRow,
): boolean {
  if (c.kind === 'string') return evalString(c, q, v, row);
  evalContact(c, q, row);
  return true;
}
