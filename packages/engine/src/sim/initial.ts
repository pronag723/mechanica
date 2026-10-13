/**
 * The initial state: mode selection at t₀ and the projection of the initial velocities (DESIGN
 * §3.6, "v_B set to 2.00 m/s by string 1").
 *
 * At t₀ a constraint with gap ≈ 0 is a candidate even when it is closing (ġ < −εvel): the user
 * gave velocities that the active constraints do not allow (one block of an Atwood machine
 * moving, the other not). After the mode is selected, q is projected onto g_A = 0 and v onto
 * J_A·v = 0 in the M-metric (the perfectly inelastic, momentum-respecting choice), and
 * INITIAL_VELOCITY_PROJECTED lists every body whose velocity changed. The curvature terms depend
 * on v, so the mode is selected once more at the projected velocities.
 */
import { type Diagnostic, diagnostic } from '../diagnostics';
import type { Model } from '../model/types';
import type { Mode } from '../mode';
import type { SelectionStatus } from './mode-select';
import { findCandidates, selectModelMode } from './model-modes';
import { projectPositions, projectVelocities } from './projection';
import type { SimTolerances } from './tolerances';

export interface InitialState {
  readonly mode: Mode | null;
  readonly status: SelectionStatus;
  readonly diagnostics: Diagnostic[];
}

/** Selects the initial mode and projects y = [q, v] (in place) onto it. */
export function initialState(model: Model, y: Float64Array, tol: SimTolerances): InitialState {
  const n = model.nDof;
  const q = y.subarray(0, n);
  const v = y.subarray(n);
  let sel = selectModelMode(
    model,
    0,
    q,
    v,
    findCandidates(model, q, v, tol, { allowClosing: true }),
    tol,
  );
  const diagnostics: Diagnostic[] = [];
  let mode = sel.mode;
  if (mode) {
    const v0 = Float64Array.from(v);
    projectPositions(model, mode, q, tol.project);
    projectVelocities(model, mode, q, v, -1);
    const changed = model.bodies.filter((b) =>
      [b.dofX, b.dofY].some((d) => Math.abs(v[d] - v0[d]) > tol.reportV),
    );
    if (changed.length > 0) {
      const fmt = (w: ArrayLike<number>, b: (typeof changed)[number]): string =>
        `${w[b.dofX]},${w[b.dofY]}`;
      diagnostics.push(
        diagnostic(
          'INITIAL_VELOCITY_PROJECTED',
          'warning',
          changed.map((b) => b.id),
          {
            bodies: changed.map((b) => b.id),
            before: changed.map((b) => fmt(v0, b)),
            after: changed.map((b) => fmt(v, b)),
          },
          'The initial velocities violate the active constraints; projected: ' +
            changed.map((b) => `${b.id} (${fmt(v0, b)}) → (${fmt(v, b)})`).join('; '),
        ),
      );
      const again = selectModelMode(model, 0, q, v, findCandidates(model, q, v, tol), tol);
      if (again.mode && JSON.stringify(again.mode) !== JSON.stringify(mode)) {
        sel = again;
        mode = again.mode;
        projectVelocities(model, mode, q, v, -1);
      }
    }
  }
  diagnostics.push(...sel.diagnostics);
  return { mode, status: sel.selection.status, diagnostics };
}
