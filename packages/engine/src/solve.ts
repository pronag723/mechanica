/**
 * solveAccelerations: the instantaneous solve of one given mode at one instant (DESIGN §3.2).
 * No mode selection here; prompt 03 enumerates modes and validates the multipliers this returns.
 */
import { type Diagnostic, diagnostic } from './diagnostics';
import { type ForceContribution, forceBreakdown } from './forces';
import { assembleKkt, createKktSystem, kktLayout } from './kkt/assemble';
import { type KktStatus, solveKkt } from './kkt/solve-system';
import type { Constraint, Model } from './model/types';
import type { Mode } from './mode';

export interface AccelerationSolution {
  /** `unique`; `indeterminate` (motion unique, some forces not); `undetermined` (no unique motion). */
  readonly status: KktStatus;
  /** Accelerations per DOF; NaN when undetermined. */
  readonly a: Float64Array;
  /** Multiplier per active constraint: tension (strings) or normal force (contacts), in N. */
  readonly lambda: Readonly<Record<string, number>>;
  /**
   * Signed friction force along the face tangent +t for every active contact: the multiplier λ_t
   * when it sticks, −μk·s·λ_n when it slips (s = +1 slipPos, −1 slipNeg).
   */
  readonly frictionLambda: Readonly<Record<string, number>>;
  /** Active constraints whose λ is not determined (the value given is the minimum-norm split). */
  readonly indeterminate: readonly string[];
  /** Active contacts whose friction is not determined. */
  readonly indeterminateFriction: readonly string[];
  readonly forces: readonly ForceContribution[];
  readonly diagnostics: readonly Diagnostic[];
}

const unique = <T>(items: Iterable<T>): T[] => [...new Set(items)];

/**
 * Builds and solves [M −C; J 0][a; λ] = [f; −curvature] for `mode` at (t, q, v). Throws RangeError
 * if the mode does not fit the model (an engine bug); every physical problem is a diagnostic.
 */
export function solveAccelerations(
  model: Model,
  mode: Mode,
  t: number,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
): AccelerationSolution {
  const layout = kktLayout(model, mode);
  const sys = createKktSystem(model, layout);
  const n = layout.nDof;
  const nA = layout.active.length;
  const activeOf = (j: number): Constraint => model.constraints[layout.active[j]];

  if (!assembleKkt(model, sys, t, q, v)) {
    const c = activeOf(sys.failed);
    return undetermined(model, layout.mode, [
      diagnostic(
        'PULLEY_WRAP_INVALID',
        'error',
        c.elementIds,
        { reason: 'tangentMissing' },
        `String "${c.id}" has no tangent at this configuration.`,
      ),
    ]);
  }

  const sol = solveKkt(sys);
  const diagnostics: Diagnostic[] = [];
  // Multiplier position → the constraint it belongs to (stick rows map to their contact).
  const ownerOf = (j: number): Constraint => activeOf(j < nA ? j : layout.stick[j - nA]);

  if (sol.status === 'undetermined') {
    const constraints = unique(sol.undeterminedMultipliers.map((j) => ownerOf(j).id));
    const bodies = unique(sol.undeterminedDofs.map((i) => model.dofs[i].body));
    const elementIds = unique([
      ...bodies,
      ...sol.undeterminedMultipliers.flatMap((j) => ownerOf(j).elementIds),
    ]);
    return undetermined(model, layout.mode, [
      diagnostic(
        'MOTION_UNDETERMINED',
        'error',
        elementIds,
        { reason: sol.reason ?? 'singular', constraints, bodies },
        sol.reason === 'inconsistent'
          ? 'The active constraints contradict each other: no motion satisfies this mode.'
          : `The motion is not uniquely determined (bodies: ${bodies.join(', ')}).`,
      ),
    ]);
  }

  const x = sol.x;
  const lam = new Float64Array(nA);
  const fric = new Float64Array(nA);
  const indet = new Set<number>();
  const indetFric = new Set<number>();
  for (const j of sol.indeterminate) {
    if (j < nA) {
      indet.add(j);
      if (layout.slip[j] !== 0) indetFric.add(j); // μk·λ_n inherits the indeterminacy
    } else {
      indetFric.add(layout.stick[j - nA]);
    }
  }
  for (let j = 0; j < nA; j++) {
    lam[j] = x[n + j];
    const c = activeOf(j);
    if (c.kind === 'contact' && layout.slip[j] !== 0)
      fric[j] = 0 - c.material.muK * layout.slip[j] * lam[j]; // 0 − x: no −0 when μk = 0
  }
  layout.stick.forEach((j, k) => (fric[j] = x[n + nA + k]));

  const a = x.slice(0, n);
  const lambda: Record<string, number> = {};
  const frictionLambda: Record<string, number> = {};
  for (let j = 0; j < nA; j++) {
    const c = activeOf(j);
    lambda[c.id] = lam[j];
    if (c.kind === 'contact') frictionLambda[c.id] = fric[j];
  }
  const indeterminate = [...indet].sort((p, r) => p - r).map((j) => activeOf(j).id);
  const indeterminateFriction = [...indetFric].sort((p, r) => p - r).map((j) => activeOf(j).id);
  if (sol.status === 'indeterminate') {
    const involved = unique([...indet, ...indetFric].sort((p, r) => p - r).map((j) => activeOf(j)));
    diagnostics.push(
      diagnostic(
        'STATICALLY_INDETERMINATE',
        'warning',
        unique(involved.flatMap((c) => c.elementIds)),
        { constraints: indeterminate, friction: indeterminateFriction },
        `Statically indeterminate: the forces of ${involved.map((c) => c.id).join(', ')} ` +
          'are not uniquely determined (the motion is).',
      ),
    );
  }
  return {
    status: sol.status,
    a,
    lambda,
    frictionLambda,
    indeterminate,
    indeterminateFriction,
    forces: forceBreakdown(model, layout, q, lam, fric, indet, indetFric),
    diagnostics,
  };
}

function undetermined(model: Model, mode: Mode, diagnostics: Diagnostic[]): AccelerationSolution {
  const lambda: Record<string, number> = {};
  const frictionLambda: Record<string, number> = {};
  for (const id of mode.active) {
    lambda[id] = NaN;
    if (Object.hasOwn(mode.friction, id)) frictionLambda[id] = NaN;
  }
  return {
    status: 'undetermined',
    a: new Float64Array(model.nDof).fill(NaN),
    lambda,
    frictionLambda,
    indeterminate: [],
    indeterminateFriction: [],
    forces: [],
    diagnostics,
  };
}
