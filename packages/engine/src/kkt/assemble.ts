/**
 * The acceleration-level KKT system of one mode (DESIGN §3.2):
 *
 *   [ M   −C ] [a]   [ f          ]
 *   [ J    0 ] [λ] = [ −curvature ]
 *
 * One multiplier per active constraint (in id order), then one per sticking contact (static
 * friction λ_t, in id order). J stacks the rows: ∂g/∂q for constraints, J_t = tᵀ for stick rows.
 * C holds the force columns: J_iᵀ, except for a sliding contact, whose column is
 * (J_n − μk·s·J_t)ᵀ with s = +1 for slipPos and −1 for slipNeg. Kinetic friction μk·λ_n then acts
 * along −s·t inside the same multiplier λ_n, and K is non-symmetric (solved with LU).
 * M·a = f + C·λ: λ ≥ 0 pulls (strings) or pushes (contacts) the bodies; λ_t is the signed static
 * friction along +t.
 */
import { createModelRow, evalConstraint, evalContactTangent } from '../constraints';
import type { ConstraintRow } from '../constraints/row';
import { generalizedForces } from '../model/forces';
import type { Model } from '../model/types';
import { type Mode, assertValidMode, normalizeMode, slipSign } from '../mode';
import { type Matrix, createMatrix } from '../numeric/matrix';

export interface KktLayout {
  /** The mode in canonical (sorted) form. */
  readonly mode: Mode;
  readonly nDof: number;
  /** Constraint indices of the active constraints, in id order. */
  readonly active: Int32Array;
  /** Slip sign s per active constraint: +1 slipPos, −1 slipNeg, 0 otherwise. */
  readonly slip: Int8Array;
  /** Positions in `active` of the sticking contacts; multiplier active.length + k is λ_t of stick[k]. */
  readonly stick: Int32Array;
  /** Number of multipliers, active.length + stick.length. */
  readonly nMult: number;
  /** nDof + nMult. */
  readonly size: number;
}

/** Validates the mode against the model (throws RangeError on misuse) and lays out the unknowns. */
export function kktLayout(model: Model, mode: Mode): KktLayout {
  assertValidMode(model, mode);
  const m = normalizeMode(mode);
  const active = Int32Array.from(m.active, (id) => model.constraintIndex.get(id) ?? -1);
  const slip = new Int8Array(active.length);
  const stick: number[] = [];
  m.active.forEach((id, j) => {
    const state = m.friction[id];
    if (state === undefined) return;
    slip[j] = slipSign(state);
    if (state === 'stick') stick.push(j);
  });
  const nMult = active.length + stick.length;
  return {
    mode: m,
    nDof: model.nDof,
    active,
    slip,
    stick: Int32Array.from(stick),
    nMult,
    size: model.nDof + nMult,
  };
}

export interface KktSystem {
  readonly layout: KktLayout;
  readonly K: Matrix;
  readonly rhs: Float64Array;
  /** nMult × nDof. */
  readonly J: Matrix;
  /** nDof × nMult. */
  readonly C: Matrix;
  /** Per multiplier: J̇v (+ time terms). */
  readonly curvature: Float64Array;
  /** Generalized applied forces f. */
  readonly f: Float64Array;
  /** Scratch row. */
  readonly row: ConstraintRow;
  /** Index (in `active`) of the first constraint outside its domain, or −1 after a good assembly. */
  failed: number;
}

export function createKktSystem(model: Model, layout: KktLayout): KktSystem {
  return {
    layout,
    K: createMatrix(layout.size, layout.size),
    rhs: new Float64Array(layout.size),
    J: createMatrix(layout.nMult, layout.nDof),
    C: createMatrix(layout.nDof, layout.nMult),
    curvature: new Float64Array(layout.nMult),
    f: new Float64Array(layout.nDof),
    row: createModelRow(model),
    failed: -1,
  };
}

/**
 * Fills K and rhs at (t, q, v) without allocating. Returns false (and sets `failed`) when an active
 * constraint cannot be evaluated: a string whose tangent does not exist at q.
 */
export function assembleKkt(
  model: Model,
  sys: KktSystem,
  t: number,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
): boolean {
  const { layout, K, rhs, J, C, curvature, f, row } = sys;
  const n = layout.nDof;
  const nA = layout.active.length;
  const N = layout.size;
  J.data.fill(0);
  C.data.fill(0);
  sys.failed = -1;

  for (let j = 0; j < nA; j++) {
    const c = model.constraints[layout.active[j]];
    if (!evalConstraint(c, t, q, v, row)) {
      sys.failed = j;
      return false;
    }
    curvature[j] = row.curvature;
    for (let k = 0; k < row.nnz; k++) {
      J.data[j * n + row.idx[k]] = row.val[k];
      C.data[row.idx[k] * layout.nMult + j] = row.val[k];
    }
    const s = layout.slip[j];
    if (s !== 0 && c.kind === 'contact') {
      // Sliding: column (J_n − μk·s·J_t)ᵀ, J_t = t on the body's (x, y).
      const mu = c.material.muK;
      C.data[c.dofX * layout.nMult + j] -= mu * s * c.tangent.x;
      C.data[c.dofY * layout.nMult + j] -= mu * s * c.tangent.y;
    }
  }
  for (let k = 0; k < layout.stick.length; k++) {
    const j = nA + k;
    const c = model.constraints[layout.active[layout.stick[k]]];
    if (c.kind !== 'contact') throw new Error('kkt: a stick row on a non-contact');
    evalContactTangent(c, q, row);
    curvature[j] = row.curvature;
    for (let e = 0; e < row.nnz; e++) {
      J.data[j * n + row.idx[e]] = row.val[e];
      C.data[row.idx[e] * layout.nMult + j] = row.val[e];
    }
  }

  generalizedForces(model, t, q, v, f);
  K.data.fill(0);
  for (let i = 0; i < n; i++) {
    K.data[i * N + i] = model.mass[i];
    for (let j = 0; j < layout.nMult; j++) K.data[i * N + n + j] = -C.data[i * layout.nMult + j];
    rhs[i] = f[i];
  }
  for (let j = 0; j < layout.nMult; j++) {
    for (let i = 0; i < n; i++) K.data[(n + j) * N + i] = J.data[j * n + i];
    rhs[n + j] = -curvature[j];
  }
  return true;
}
