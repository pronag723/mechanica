/**
 * Mode selection on a compiled model: which unilateral constraints are candidates at a state, and
 * the abstract problem (mode-select.ts) built from the KKT solve of each combination.
 */
import {
  contactGap,
  contactOverlap,
  contactTangentialVelocity,
  createModelRow,
  evalConstraint,
  rowDot,
} from '../constraints';
import { type Diagnostic, diagnostic } from '../diagnostics';
import { assembleKkt, createKktSystem, kktLayout } from '../kkt/assemble';
import type { Constraint, Model } from '../model/types';
import { type FrictionState, type Mode, modeKey } from '../mode';
import { nullSpace } from '../numeric/qr';
import { solveAccelerations } from '../solve';
import {
  type CandidateState,
  type ModeCandidate,
  type ModeSelection,
  type ModeSolve,
  type NullDirection,
  selectMode,
} from './mode-select';
import type { SimTolerances } from './tolerances';

export interface Candidate {
  readonly c: Constraint;
  /** Contacts: v_t ≈ 0 (may stick); otherwise the sign of v_t. */
  readonly stickCandidate: boolean;
  readonly slipSign: -1 | 0 | 1;
}

/**
 * Candidates at (q, v): unilateral constraints with |g| ≤ εpos and |ġ| ≤ εvel (with
 * `allowClosing`, at t₀, any ġ ≤ εvel: the initial projection removes the closing rate), contacts
 * only inside their face's extent (overlap > εpos). `exclude` drops ids (contacts that just left
 * their surface). Sorted by id, like the constraints.
 */
export function findCandidates(
  model: Model,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
  tol: SimTolerances,
  opts: { allowClosing?: boolean; exclude?: ReadonlySet<string> } = {},
): Candidate[] {
  const row = createModelRow(model);
  const out: Candidate[] = [];
  for (const c of model.constraints) {
    if (opts.exclude?.has(c.id)) continue;
    let gap: number;
    let rate: number;
    if (c.kind === 'contact') {
      if (!(contactOverlap(c, q) > tol.pos)) continue;
      gap = contactGap(c, q);
      if (!(Math.abs(gap) <= tol.pos)) continue;
      rate = c.normal.x * v[c.dofX] + c.normal.y * v[c.dofY];
    } else {
      if (!evalConstraint(c, 0, q, v, row)) continue;
      gap = row.value;
      if (!(Math.abs(gap) <= tol.pos)) continue;
      rate = rowDot(row, v);
    }
    const rateOk = opts.allowClosing ? rate <= tol.vel : Math.abs(rate) <= tol.vel;
    if (!rateOk) continue;
    if (c.kind === 'contact') {
      const vt = contactTangentialVelocity(c, v);
      const stick = Math.abs(vt) <= tol.vel;
      out.push({ c, stickCandidate: stick, slipSign: stick ? 0 : vt > 0 ? 1 : -1 });
    } else {
      out.push({ c, stickCandidate: false, slipSign: 0 });
    }
  }
  return out;
}

export interface ModelSelectOptions {
  /** The mode before the event; its states are tried first. */
  readonly current?: Mode;
  /** States a candidate may not take now (the state its guard just fired from). */
  readonly forbidden?: ReadonlyMap<string, ReadonlySet<CandidateState>>;
  /** Candidates of the event being handled (their zero values are not "boundary cases"). */
  readonly involved?: ReadonlySet<string>;
}

export interface ModelSelectResult {
  readonly mode: Mode | null;
  readonly selection: ModeSelection;
  readonly diagnostics: Diagnostic[];
}

const STICK_ORDER: readonly CandidateState[] = ['stick', 'slipPos', 'slipNeg', 'inactive'];

function currentState(mode: Mode | undefined, c: Constraint): CandidateState | undefined {
  if (!mode) return undefined;
  if (!mode.active.includes(c.id)) return 'inactive';
  return c.kind === 'string' ? 'active' : mode.friction[c.id];
}

/** Builds the mode of a combination: the candidates' active states; everything else inactive. */
function toMode(cands: readonly Candidate[], states: readonly CandidateState[]): Mode {
  const active: string[] = [];
  const friction: Record<string, FrictionState> = {};
  cands.forEach(({ c }, i) => {
    const s = states[i];
    if (s === 'inactive') return;
    active.push(c.id);
    if (c.kind === 'contact') friction[c.id] = s === 'active' ? 'stick' : s;
  });
  return { active, friction };
}

export function selectModelMode(
  model: Model,
  t: number,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
  cands: readonly Candidate[],
  tol: SimTolerances,
  opts: ModelSelectOptions = {},
): ModelSelectResult {
  const row = createModelRow(model);
  const problemCands: ModeCandidate[] = cands.map(({ c, stickCandidate, slipSign }) => {
    let states: CandidateState[] =
      c.kind === 'string'
        ? ['active', 'inactive']
        : stickCandidate
          ? [...STICK_ORDER]
          : [slipSign > 0 ? 'slipPos' : 'slipNeg', 'inactive'];
    const banned = opts.forbidden?.get(c.id);
    if (banned) states = states.filter((s) => !banned.has(s));
    const cur = currentState(opts.current, c);
    if (cur !== undefined && states.includes(cur))
      states = [cur, ...states.filter((s) => s !== cur)];
    return {
      id: c.id,
      states,
      muS: c.kind === 'contact' ? c.material.muS : 0,
      slipFromRest: c.kind === 'contact' && stickCandidate,
    };
  });
  const involved = new Set<number>();
  cands.forEach(({ c }, i) => {
    if (opts.involved?.has(c.id)) involved.add(i);
  });

  const solve = (states: readonly CandidateState[]): ModeSolve => {
    const mode = toMode(cands, states);
    const sol = solveAccelerations(model, mode, t, q, v);
    const k = cands.length;
    const lambda = new Float64Array(k).fill(NaN);
    const lambdaT = new Float64Array(k).fill(NaN);
    const gapAcc = new Float64Array(k).fill(NaN);
    const tangentAcc = new Float64Array(k).fill(NaN);
    if (sol.status === 'undetermined') {
      return {
        status: 'undetermined',
        a: sol.a,
        lambda,
        lambdaT,
        gapAcc,
        tangentAcc,
        diagnostics: sol.diagnostics,
      };
    }
    cands.forEach(({ c }, i) => {
      const s = states[i];
      if (s === 'inactive') {
        evalConstraint(c, t, q, v, row);
        gapAcc[i] = rowDot(row, sol.a) + row.curvature;
        return;
      }
      lambda[i] = sol.lambda[c.id];
      if (c.kind !== 'contact') return;
      if (s === 'stick') lambdaT[i] = sol.frictionLambda[c.id];
      else tangentAcc[i] = c.tangent.x * sol.a[c.dofX] + c.tangent.y * sol.a[c.dofY];
    });
    const nullDirections =
      sol.status === 'indeterminate' ? multiplierNullSpace(model, mode, t, q, v, cands) : undefined;
    return {
      status: sol.status,
      a: sol.a,
      lambda,
      lambdaT,
      gapAcc,
      tangentAcc,
      nullDirections,
      diagnostics: sol.diagnostics,
    };
  };

  const selection = selectMode({
    candidates: problemCands,
    solve,
    tol: { force: tol.force, acc: tol.acc },
    involved,
  });
  const ids = cands.map(({ c }) => c.id);
  const elementIds = [...new Set(cands.flatMap(({ c }) => c.elementIds))];
  const diagnostics: Diagnostic[] = [];
  const keyOf = (states: readonly CandidateState[]): string => modeKey(toMode(cands, states));

  if (selection.status === 'tooManyCandidates') {
    diagnostics.push(
      diagnostic(
        'TOO_MANY_CANDIDATES',
        'error',
        elementIds,
        { t, count: cands.length, candidates: ids },
        `${cands.length} constraints are in contact at t = ${t}; mode enumeration supports up to 10.`,
      ),
    );
    return { mode: null, selection, diagnostics };
  }
  if (selection.status === 'none' || !selection.chosen) {
    diagnostics.push(
      diagnostic(
        'NO_CONSISTENT_MODE',
        'error',
        elementIds,
        { t, candidates: ids },
        `No consistent motion at t = ${t}: every combination of ${ids.join(', ')} violates a ` +
          'sign or friction condition.',
      ),
      ...selection.undetermined,
    );
    return { mode: null, selection, diagnostics };
  }
  const chosen = selection.chosen;
  const chosenKey = keyOf(chosen.states);
  if (selection.status === 'notUnique') {
    diagnostics.push(
      diagnostic(
        'MODE_NOT_UNIQUE',
        'warning',
        elementIds,
        {
          t,
          rule: selection.rule,
          chosen: chosenKey,
          alternatives: selection.admissible.map((m) => keyOf(m.states)),
        },
        `Several motions are consistent at t = ${t}; chose ${chosenKey} by rule ` +
          `"${selection.rule}" (closest to the current mode).`,
      ),
    );
  } else if (selection.boundary) {
    diagnostics.push(
      diagnostic(
        'BOUNDARY_CASE',
        'info',
        elementIds,
        { t, chosen: chosenKey, alternatives: selection.admissible.map((m) => keyOf(m.states)) },
        `Boundary case at t = ${t}: a condition holds with equality; chose ${chosenKey} ` +
          '(prefer contact, prefer stick).',
      ),
    );
  }
  diagnostics.push(...(chosen.solve.diagnostics ?? []));
  return { mode: toMode(cands, chosen.states), selection, diagnostics };
}

/** Null space of the force columns C, as multiplier directions restricted to the candidates. */
function multiplierNullSpace(
  model: Model,
  mode: Mode,
  t: number,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
  cands: readonly Candidate[],
): NullDirection[] {
  const layout = kktLayout(model, mode);
  const sys = createKktSystem(model, layout);
  assembleKkt(model, sys, t, q, v);
  const Z = nullSpace(sys.C);
  const nA = layout.active.length;
  const pos = new Map<number, number>(); // constraint index → position in active
  layout.active.forEach((ci, j) => pos.set(ci, j));
  const stickPos = new Map<number, number>(); // active position → multiplier of its stick row
  layout.stick.forEach((j, k) => stickPos.set(j, nA + k));
  const out: NullDirection[] = [];
  for (let col = 0; col < Z.cols; col++) {
    const lambda = new Float64Array(cands.length);
    const lambdaT = new Float64Array(cands.length);
    cands.forEach(({ c }, i) => {
      const j = pos.get(c.index);
      if (j === undefined) return;
      lambda[i] = Z.data[j * Z.cols + col];
      const jt = stickPos.get(j);
      if (jt !== undefined) lambdaT[i] = Z.data[jt * Z.cols + col];
    });
    out.push({ lambda, lambdaT });
  }
  return out;
}

/**
 * Whether `mode` is still admissible at (t, q, v): its own sign and friction conditions, with the
 * λ of a statically indeterminate mode checked for some admissible split. Used at each step of an
 * indeterminate phase, whose indeterminate multipliers have no λ guards.
 */
export function modeIsFeasible(
  model: Model,
  mode: Mode,
  t: number,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
  tol: SimTolerances,
): boolean {
  const cands: Candidate[] = mode.active.map((id) => {
    const c = model.constraints[model.constraintIndex.get(id) ?? -1];
    const state = mode.friction[id];
    return {
      c,
      stickCandidate: state === 'stick',
      slipSign: state === 'slipPos' ? 1 : state === 'slipNeg' ? -1 : 0,
    };
  });
  const forbidden = new Map<string, ReadonlySet<CandidateState>>();
  for (const { c } of cands) {
    const keep = c.kind === 'string' ? 'active' : mode.friction[c.id];
    forbidden.set(c.id, new Set(STICK_ORDER.concat('active').filter((s) => s !== keep)));
  }
  return selectModelMode(model, t, q, v, cands, tol, { forbidden }).mode !== null;
}
