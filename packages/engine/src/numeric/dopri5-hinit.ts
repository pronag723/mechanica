import type { OdeRhs } from './dopri5';

/**
 * Hairer's HINIT (dopri5.f; "Solving ODEs I", §II.4, "Starting step size") for order 5. A first guess h₀ = 0.01·‖y₀‖/‖f₀‖ (scaled
 * norms) makes an explicit Euler increment small compared with y; one Euler step then estimates
 * ‖y''‖, and h is chosen so that h⁵·max(‖f₀‖, ‖y''‖) = 0.01, capped by 100·h₀ and hmax.
 * Uses one RHS evaluation; `yScratch` and `fScratch` are length-n work vectors. Returns signed h.
 */
export function hairerInitialStep(
  f: OdeRhs,
  t0: number,
  y0: Float64Array,
  f0: Float64Array,
  dir: number,
  hmax: number,
  rtol: number,
  atol: Float64Array,
  yScratch: Float64Array,
  fScratch: Float64Array,
): number {
  const n = y0.length;
  let dnf = 0;
  let dny = 0;
  for (let i = 0; i < n; i++) {
    const sk = atol[i] + rtol * Math.abs(y0[i]);
    dnf += (f0[i] / sk) ** 2;
    dny += (y0[i] / sk) ** 2;
  }
  let h = dnf <= 1e-10 || dny <= 1e-10 ? 1e-6 : Math.sqrt(dny / dnf) * 0.01;
  h = dir * Math.min(h, hmax);

  for (let i = 0; i < n; i++) yScratch[i] = y0[i] + h * f0[i];
  f(t0 + h, yScratch, fScratch);
  let der2 = 0;
  for (let i = 0; i < n; i++) {
    const sk = atol[i] + rtol * Math.abs(y0[i]);
    der2 += ((fScratch[i] - f0[i]) / sk) ** 2;
  }
  der2 = Math.sqrt(der2) / Math.abs(h);

  const der12 = Math.max(der2, Math.sqrt(dnf));
  const h1 = der12 <= 1e-15 ? Math.max(1e-6, Math.abs(h) * 1e-3) : (0.01 / der12) ** (1 / 5);
  return dir * Math.min(100 * Math.abs(h), h1, hmax);
}
