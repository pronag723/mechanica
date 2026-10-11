/**
 * Dormand–Prince 5(4) with dense output, driven one accepted step at a time by the caller.
 * A port of E. Hairer's dopri5.f (version of 2004-10-11, http://www.unige.ch/~hairer/software.html;
 * Hairer, Nørsett, Wanner, "Solving ODEs I", §II.4–II.6), keeping its error norm, its PI step
 * size controller with Lund stabilization, its initial step heuristic (HINIT) and its handling of
 * the end of the interval. Not ported: stiffness detection and SOLOUT; the caller drives instead.
 *
 * The stepper does not allocate inside the stepping loop: stage vectors are preallocated. Each
 * accepted step gets a small record whose 6n doubles are sliced from a shared ~32 KB chunk; a
 * typed array per step (off-heap backing store, > 64 bytes) cost more than the step's arithmetic.
 */
import { type AcceptedStep, createStep, fillDense, stepStorageLength } from './dense';
import { hairerInitialStep } from './dopri5-hinit';
import { errorNorm, stages } from './dopri5-stages';

/** Right-hand side y' = f(t, y). Writes into `dydt`; must not keep references to `y` or `dydt`. */
export type OdeRhs = (t: number, y: Float64Array, dydt: Float64Array) => void;

export interface Dopri5Options {
  /** Relative tolerance (default 1e-10, DESIGN §3.3). */
  rtol?: number;
  /** Absolute tolerance, scalar or per component; must be > 0 (default 1e-12). */
  atol?: number | ArrayLike<number>;
  /**
   * End of the integration interval (default +∞). Fixes the direction, and the last step is
   * clamped to land on tEnd exactly. Never steps past it.
   */
  tEnd?: number;
  /** Largest |h| (default ∞). The simulator caps it so a guard cannot cross twice unseen. */
  hmax?: number;
  /** Smallest |h| allowed before failing (default 0: only Hairer's rounding-level check). */
  hmin?: number;
  /** First step size; 0 or omitted → Hairer's heuristic (one extra RHS evaluation). */
  h0?: number;
  /** Cap on step attempts (accepted + rejected) over the stepper's life (default 100 000). */
  maxSteps?: number;
  /** Controller constants, Hairer's defaults. */
  safety?: number; // 0.9
  facMin?: number; // 0.2: h_new ≥ facMin·h
  facMax?: number; // 10: h_new ≤ facMax·h
  beta?: number; // 0.04: Lund stabilization exponent
}

export interface Dopri5RestartOptions {
  /** Step size hint; omitted → Hairer's heuristic. */
  h?: number;
  /** New end of the interval (default: keep the current one). */
  tEnd?: number;
}

export type Dopri5Failure = 'max-steps' | 'step-size-too-small' | 'non-finite' | 'end-reached';

export type Dopri5Result =
  | { readonly ok: true; readonly step: AcceptedStep }
  | {
      readonly ok: false;
      readonly reason: Dopri5Failure;
      readonly message: string;
      readonly t: number;
    };

export interface Dopri5Stats {
  /** RHS evaluations. */
  nfev: number;
  /** Step attempts. */
  nsteps: number;
  naccept: number;
  nreject: number;
}

export interface Dopri5Stepper {
  readonly n: number;
  /** Time reached (end of the last accepted step, or the restart time). */
  readonly t: number;
  /** State at `t`. A live internal buffer: read or copy it, never write to it. */
  readonly y: Float64Array;
  /** Signed step size the next attempt will start from. */
  readonly h: number;
  readonly tEnd: number;
  /** True once t === tEnd; step() then returns 'end-reached'. */
  readonly done: boolean;
  readonly stats: Readonly<Dopri5Stats>;
  /** Attempts steps until one is accepted (or fails) and returns it with its dense output. */
  step(): Dopri5Result;
  /** Continues from (t, y): drops the FSAL derivative and resets the step size controller. */
  restart(t: number, y: ArrayLike<number>, opts?: Dopri5RestartOptions): void;
}

export function createDopri5(
  f: OdeRhs,
  t0: number,
  y0: ArrayLike<number>,
  opts: Dopri5Options = {},
): Dopri5Stepper {
  const n = y0.length;
  if (n === 0) throw new RangeError('createDopri5: the state needs at least one component');
  if (!Number.isFinite(t0)) throw new RangeError(`createDopri5: t0 = ${t0} is not finite`);
  const rtol = opts.rtol ?? 1e-10;
  const atol = new Float64Array(n);
  const atolIn = opts.atol ?? 1e-12;
  if (typeof atolIn === 'number') atol.fill(atolIn);
  else if (atolIn.length === n) for (let i = 0; i < n; i++) atol[i] = atolIn[i];
  else throw new RangeError(`createDopri5: atol has ${atolIn.length} ≠ ${n} entries`);
  if (!(rtol >= 0) || !atol.every((a) => a > 0)) {
    throw new RangeError('createDopri5: need rtol ≥ 0 and atol > 0');
  }
  const hmax = Math.abs(opts.hmax ?? Infinity);
  const hmin = Math.abs(opts.hmin ?? 0);
  const maxSteps = opts.maxSteps ?? 100_000;
  const safe = opts.safety ?? 0.9;
  const beta = opts.beta ?? 0.04;
  const facc1 = 1 / (opts.facMin ?? 0.2);
  const facc2 = 1 / (opts.facMax ?? 10);
  const expo1 = 0.2 - beta * 0.75;
  if (!(hmax > 0) || !(safe > 0 && safe < 1) || !(facc1 > 1) || !(facc2 < 1)) {
    throw new RangeError('createDopri5: invalid hmax or controller constants');
  }

  const y = new Float64Array(n);
  const ys = new Float64Array(n); // stage input
  const ynew = new Float64Array(n);
  let k1 = new Float64Array(n);
  const k2 = new Float64Array(n);
  const k3 = new Float64Array(n);
  const k4 = new Float64Array(n);
  const k5 = new Float64Array(n);
  const k6 = new Float64Array(n);
  let k7 = new Float64Array(n);
  const stats: Dopri5Stats = { nfev: 0, nsteps: 0, naccept: 0, nreject: 0 };

  // Step records are sliced from chunks of ~4096 doubles. A chunk stays alive while any step in
  // it is referenced.
  const perStep = stepStorageLength(n);
  const stepsPerChunk = Math.max(1, Math.floor(4096 / perStep));
  let chunk = new Float64Array(0);
  let chunkUsed = stepsPerChunk;
  function allocStep(tStart: number, tStop: number, hStep: number): AcceptedStep {
    if (chunkUsed === stepsPerChunk) {
      chunk = new Float64Array(stepsPerChunk * perStep);
      chunkUsed = 0;
    }
    return createStep(n, tStart, tStop, hStep, chunk, perStep * chunkUsed++);
  }

  let t = t0;
  let tEnd = opts.tEnd ?? Infinity;
  let dir = 1;
  let h = 0;
  let facOld = 1e-4;
  let reject = false;
  let done = false;
  let k1Finite = true;
  let lastNonFinite = false;

  function begin(tStart: number, yStart: ArrayLike<number>, hHint: number | undefined): void {
    if (yStart.length !== n) {
      throw new RangeError(`dopri5: state has ${yStart.length} ≠ ${n} entries`);
    }
    if (Number.isNaN(tEnd)) throw new RangeError('dopri5: tEnd is NaN');
    t = tStart;
    for (let i = 0; i < n; i++) y[i] = yStart[i];
    dir = tEnd >= t ? 1 : -1;
    done = t === tEnd;
    facOld = 1e-4;
    reject = false;
    lastNonFinite = false;
    f(t, y, k1);
    stats.nfev++;
    k1Finite = allFinite(k1);
    if (done || !k1Finite) return;
    if (hHint !== undefined && hHint !== 0) {
      h = dir * Math.min(Math.abs(hHint), hmax);
    } else {
      h = hairerInitialStep(f, t, y, k1, dir, hmax, rtol, atol, ys, k2);
      stats.nfev++;
    }
  }

  function fail(reason: Dopri5Failure, message: string): Dopri5Result {
    return { ok: false, reason, message: `dopri5: ${message}`, t };
  }

  function step(): Dopri5Result {
    if (done) return fail('end-reached', `already at tEnd = ${tEnd}`);
    if (!k1Finite) return fail('non-finite', `f(t, y) is not finite at t = ${t}`);

    for (;;) {
      if (stats.nsteps >= maxSteps) {
        return fail('max-steps', `step attempt limit ${maxSteps} reached at t = ${t}`);
      }
      // Hairer: the step is lost in the rounding of t; plus the caller's hmin.
      if (Math.abs(h) < hmin || 0.1 * Math.abs(h) <= Math.abs(t) * Number.EPSILON) {
        return lastNonFinite
          ? fail('non-finite', `f is not finite near t = ${t}, even with |h| = ${Math.abs(h)}`)
          : fail('step-size-too-small', `step size ${Math.abs(h)} is too small at t = ${t}`);
      }
      // Land on tEnd exactly; stretch the step up to 1 % rather than leave a sliver (Hairer).
      let clamped = false;
      if (dir * (t + 1.01 * h - tEnd) > 0) {
        h = tEnd - t;
        clamped = true;
      }
      stats.nsteps++;

      const tph = clamped ? tEnd : t + h;
      stages(f, n, t, h, tph, y, k1, k2, k3, k4, k5, k6, k7, ys, ynew);
      stats.nfev += 6;
      const err = errorNorm(n, h, y, ynew, k1, k3, k4, k5, k6, k7, atol, rtol);

      if (!Number.isFinite(err)) {
        // A stage hit a singularity of f (or y₁ overflowed): shrink as hard as allowed, retry.
        lastNonFinite = true;
        reject = true;
        stats.nreject++;
        h /= facc1;
        continue;
      }

      // PI controller: h_new = h·err^(−α)·err_old^β/safety with α = 0.2 − 0.75β, and the
      // factor h_new/h kept in [facMin, facMax].
      const fac11 = err ** expo1;
      const fac = Math.max(facc2, Math.min(facc1, fac11 / facOld ** beta / safe));
      let hnew = h / fac;

      if (err <= 1) {
        facOld = Math.max(err, 1e-4);
        stats.naccept++;
        const accepted = allocStep(t, tph, h);
        fillDense(accepted, y, ynew, k1, k3, k4, k5, k6, k7);
        const tmp = k1; // FSAL: f(t₁, y₁) is the next step's first stage.
        k1 = k7;
        k7 = tmp;
        y.set(ynew);
        t = tph;
        done = clamped;
        if (Math.abs(hnew) > hmax) hnew = dir * hmax;
        if (reject) hnew = dir * Math.min(Math.abs(hnew), Math.abs(h));
        reject = false;
        lastNonFinite = false;
        h = hnew;
        return { ok: true, step: accepted };
      }

      hnew = h / Math.min(facc1, fac11 / safe);
      reject = true;
      lastNonFinite = false;
      stats.nreject++;
      h = hnew;
    }
  }

  begin(t0, y0, opts.h0);

  return {
    n,
    get t() {
      return t;
    },
    get y() {
      return y;
    },
    get h() {
      return h;
    },
    get tEnd() {
      return tEnd;
    },
    get done() {
      return done;
    },
    stats,
    step,
    restart(tNew, yNew, ropts) {
      if (!Number.isFinite(tNew))
        throw new RangeError(`dopri5: restart time ${tNew} is not finite`);
      if (ropts?.tEnd !== undefined) tEnd = ropts.tEnd;
      begin(tNew, yNew, ropts?.h);
    },
  };
}

function allFinite(v: Float64Array): boolean {
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false;
  return true;
}
