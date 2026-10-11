/** Applied (non-constraint) forces on the DOFs. */
import type { Model } from './types';

/** Generalized applied forces f(t, q, v) per DOF: m·g plus applied forces (constant in Phase 0). */
export function generalizedForces(
  model: Model,
  _t: number,
  _q: ArrayLike<number>,
  _v: ArrayLike<number>,
  out: Float64Array = new Float64Array(model.nDof),
): Float64Array {
  for (const b of model.bodies) {
    out[b.dofX] = b.mass * model.gravity.x;
    out[b.dofY] = b.mass * model.gravity.y;
  }
  for (const f of model.appliedForces) {
    out[f.dofX] += f.force.x;
    out[f.dofY] += f.force.y;
  }
  return out;
}
