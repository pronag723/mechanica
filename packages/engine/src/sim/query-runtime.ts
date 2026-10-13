/**
 * Queries during a run: which ones are supported, where their hits go, and the running path
 * length a path-length query needs inside the current step (s(t) = s at the step start + ∫|v| on
 * the step's dense output, see path-length.ts; maintained only when such a query exists).
 */
import { type Diagnostic, diagnostic } from '../diagnostics';
import type { Model } from '../model/types';
import type { AcceptedStep } from '../numeric/dense';
import type { QuerySpec } from '../spec';
import type { QueryContext } from './guards';
import { stepSpeedIntegral } from './path-length';
import { probeHasRate } from './probes';
import type { PhaseSteps, QueryHit } from './types';

export interface QueryRuntime {
  /** The supported queries (max/min need an analytic rate). */
  readonly queries: readonly QuerySpec[];
  readonly hits: Record<string, QueryHit[]>;
  readonly diagnostics: readonly Diagnostic[];
  readonly context: QueryContext & { readonly qRef: Float64Array };
  /** The step being searched for events (null between steps). */
  current: AcceptedStep | null;
  /** Adds the path travelled on `step` up to t1. */
  advance(step: AcceptedStep, t1: number): void;
}

export function createQueryRuntime(model: Model): QueryRuntime {
  const n = model.nDof;
  const dim = 2 * n;
  const queries: QuerySpec[] = [];
  const hits: Record<string, QueryHit[]> = {};
  const diagnostics: Diagnostic[] = [];
  for (const qs of model.queries) {
    hits[qs.id] = [];
    if (qs.condition.kind !== 'equals' && !probeHasRate(qs.probe)) {
      diagnostics.push(
        diagnostic(
          'QUERY_UNSUPPORTED',
          'warning',
          [qs.id],
          { query: qs.id, probe: qs.probe.kind, condition: qs.condition.kind },
          `Query "${qs.id}": ${qs.condition.kind} of ${qs.probe.kind} is not supported yet.`,
        ),
      );
    } else queries.push(qs);
  }
  const needsPath = queries.some((qs) => qs.probe.kind === 'bodyPathLength');
  const pathAtStep = new Float64Array(model.bodies.length);
  const view = (s: AcceptedStep): PhaseSteps => ({
    t0: Float64Array.of(s.t0),
    h: Float64Array.of(s.h),
    coeffs: s.data.subarray(s.offset, s.offset + 5 * dim),
  });
  const rt: QueryRuntime = {
    queries,
    hits,
    diagnostics,
    current: null,
    context: {
      qRef: new Float64Array(n),
      path: (bi, t) => {
        const s = rt.current;
        const b = model.bodies[bi];
        return pathAtStep[bi] + (s ? stepSpeedIntegral(view(s), dim, n, 0, b, s.t0, t) : 0);
      },
    },
    advance(step, t1) {
      if (!needsPath) return;
      const v = view(step);
      model.bodies.forEach(
        (b, i) => (pathAtStep[i] += stepSpeedIntegral(v, dim, n, 0, b, step.t0, t1)),
      );
    },
  };
  return rt;
}
