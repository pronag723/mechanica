/**
 * Classifying the guard hits located at one instant t* (all within εt: handled together).
 *
 * - query hits are recorded and the phase continues;
 * - a hit whose `confirm` declines it (a touchdown beside the face, a string end passing beside
 *   its anchor) is no event: the guard becomes pending or dormant;
 * - terminal geometry ends the run;
 * - a touchdown or taut with closing rate ġ < −εvel is an impact (prompt 04) and ends the run;
 *   with |ġ| ≤ εvel it is a soft contact and joins the mode selection;
 * - every other hit is a mode event: its subject's firing state is forbidden in the next mode
 *   selection, and a contact that left its surface is no candidate. Simultaneous hits on one
 *   constraint give one record, of the most significant kind (lift-off subsumes the friction
 *   cone's two margins, which reach 0 together with λ_n).
 */
import { createModelRow, evalConstraint, rowDot } from '../constraints';
import type { Model } from '../model/types';
import type { CandidateState } from './mode-select';
import type { Phase } from './phase';
import type { SimTolerances } from './tolerances';
import type { EventKind } from './types';

const RANK: Record<EventKind, number> = {
  terminal: 0,
  touchdown: 1,
  taut: 1,
  separation: 2,
  slack: 2,
  leftSurface: 3,
  breakLoose: 4,
  stopOrReverse: 5,
  query: 6,
};

export interface ModeHit {
  readonly kind: EventKind;
  readonly subject: string;
  /** The guard's id. */
  readonly id: string;
}

export interface ClassifiedHits {
  /** Guard indices of query hits. */
  readonly queries: number[];
  readonly terminal: ModeHit | null;
  readonly impact: (ModeHit & { readonly rate: number }) | null;
  readonly modeHits: ModeHit[];
  readonly forbidden: Map<string, Set<CandidateState>>;
  readonly involved: Set<string>;
  readonly exclude: Set<string>;
}

/** Classifies the hits (guard indices of `ph`) at (t, y); updates the guards' statuses. */
export function classifyHits(
  model: Model,
  ph: Phase,
  hits: readonly number[],
  t: number,
  y: Float64Array,
  tol: SimTolerances,
): ClassifiedHits {
  const n = model.nDof;
  const v = y.subarray(n);
  const out: ClassifiedHits = {
    queries: [],
    terminal: null,
    impact: null,
    modeHits: [],
    forbidden: new Map(),
    involved: new Set(),
    exclude: new Set(),
  };
  let terminal: ModeHit | null = null;
  let impact: (ModeHit & { rate: number }) | null = null;
  const row = createModelRow(model);
  for (const i of hits) {
    const g = ph.guards[i];
    const hit: ModeHit = { kind: g.kind, subject: g.subject, id: g.id };
    if (g.kind === 'query') {
      if (!out.queries.includes(i)) out.queries.push(i);
      ph.status[i] = 'pending';
      continue;
    }
    const ignore = g.confirm?.(t, y) ?? null;
    if (ignore) {
      ph.status[i] = ignore;
      continue;
    }
    if (g.kind === 'terminal') {
      terminal ??= hit;
      continue;
    }
    if (g.kind === 'touchdown' || g.kind === 'taut') {
      const c = model.constraints[model.constraintIndex.get(g.subject) ?? -1];
      evalConstraint(c, t, y, v, row);
      const rate = rowDot(row, v);
      if (rate < -tol.vel) {
        impact ??= { ...hit, rate };
        continue;
      }
    }
    if (g.kind === 'leftSurface') out.exclude.add(g.subject);
    if (g.forbid) {
      const set = out.forbidden.get(g.subject) ?? new Set<CandidateState>();
      for (const s of g.forbid) set.add(s);
      out.forbidden.set(g.subject, set);
    }
    out.involved.add(g.subject);
    const same = out.modeHits.findIndex((h) => h.subject === g.subject);
    if (same < 0) out.modeHits.push(hit);
    else if (RANK[g.kind] < RANK[out.modeHits[same].kind]) out.modeHits[same] = hit;
  }
  return { ...out, terminal, impact };
}
