/**
 * Feasibility of a small system of linear inequalities  b_i + A_i·w ≥ −ε_i,  w ∈ ℝᵏ.
 *
 * Used for statically indeterminate modes: the multipliers are λ = λ_p + Z·w (Z a null-space basis
 * of the force columns), and the mode is admissible iff some split satisfies every sign and
 * friction-cone condition, not just the minimum-norm split λ_p (PROGRESS, prompt 02 follow-up).
 *
 * Vertex enumeration. P = {w : A·w ≥ −b} is the sum of its lineality space null(A) and a pointed
 * polyhedron P' in the row space of A. If P is nonempty, P' has a vertex, where r = rank(A)
 * linearly independent inequalities are tight. So it suffices to try w = 0 and, for every subset S
 * of r rows with rank(A_S) = r, the unique row-space solution of A_S·w = −b_S (the minimum-norm
 * solution) — then check all inequalities with their ε. The systems here have a handful of rows.
 */
import { matrixFromRows } from '../numeric/matrix';
import { leastSquaresMinNorm, rank } from '../numeric/qr';

export function linearFeasible(
  A: readonly (readonly number[])[],
  b: readonly number[],
  eps: readonly number[],
): boolean {
  const m = b.length;
  const ok = (w: ArrayLike<number> | null): boolean => {
    for (let i = 0; i < m; i++) {
      let s = b[i];
      if (w) for (let j = 0; j < w.length; j++) s += A[i][j] * w[j];
      if (!(s >= -eps[i])) return false;
    }
    return true;
  };
  if (ok(null)) return true;
  if (m === 0 || A[0].length === 0) return false;
  const r = rank(matrixFromRows(A.map((row) => [...row])));
  if (r === 0) return false;

  const subset: number[] = [];
  const visit = (start: number): boolean => {
    if (subset.length === r) {
      const AS = matrixFromRows(subset.map((i) => [...A[i]]));
      if (rank(AS) < r) return false;
      return ok(
        leastSquaresMinNorm(
          AS,
          subset.map((i) => -b[i]),
        ),
      );
    }
    for (let i = start; i <= m - (r - subset.length); i++) {
      subset.push(i);
      if (visit(i + 1)) return true;
      subset.pop();
    }
    return false;
  };
  return visit(0);
}
