# Oracle

An independent source of truth for the engine's regression tests. It derives every expected answer
**symbolically** in SymPy, from Newton's laws, energy or the impact law, and writes
`tests/scenes/expected.json`. It was written before any engine code, so the expectations can't be
bent to fit the implementation (CLAUDE.md, physics rule 9).

## Run

```
python -m pip install -r tools/oracle/requirements.txt
pnpm oracle
```

`pnpm oracle` runs `tools/oracle/run.mjs`, which picks the first working Python 3 among `python`,
`python3` and `py -3`. CI runs it and fails if the committed `expected.json` differs from a fresh run.
Nothing is written unless every check passes.

## Output format

```json
{
  "t01_atwood": {
    "a": {
      "value": 1.96,
      "class": "exact",
      "note": "a = (m1 - m2)*g/(m1 + m2); acceleration of ..."
    }
  }
}
```

- Scenes are sorted by id; quantities keep their derivation order. Values have 15 significant digits.
- `class`: `exact` (relative tolerance 1e-9) for uniformly accelerated phases and statics; `ode`
  (1e-7) for motion that needs real ODE integration. Values near zero need an absolute floor (1e-12).
- `note` is `<key> = <formula in the givens>; <meaning>`. The meaning states the sign convention:
  a quantity is a magnitude unless it says "signed along …" or "y up".

## Checks

1. **Formula check.** Each note's formula is parsed with the scene's symbols and must equal the
   derivation at the givens _and_ at perturbed givens, so `mu_s` written where `mu_k` is meant fails
   even when both are 0.2.
2. **Regime check.** Each derivation tests its hypothesis (stick vs slip, taut vs slack) against the
   deciding inequality before solving that mode.
3. **Printed numbers.** `printed.py` lists the rounded values printed in `docs/DESIGN.md` §8 and
   `prompts/00-bootstrap.md`; each must match the derived value. A trailing `…` means truncated.

## Scenes (g = 9.8 m/s²)

| id                         | Givens                                          | Keys                                                           |
| -------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `t01_atwood`               | m1 = 3, m2 = 2, d = 1                           | a, T, t_m1_down_1m, v_m1_down_1m                               |
| `t02a_table_frictionless`  | M = 4 on the table, m = 1 hanging, μ = 0        | a, T, N                                                        |
| `t02b_table_kinetic`       | same, μs = μk = 0.2                             | a, T, N, F_fr                                                  |
| `t02c_table_static`        | same, μs = μk = 0.3                             | a, T, N, F_fr, F_fr_limit                                      |
| `t03_load_hits_floor`      | M = 4, m = 2, μ = 0.2, h = 0.5, e = 0           | a, T1, t_impact, v_impact, a2, T2, t_stop, path_A              |
| `t14_two_strings`          | m = 2, strings at 30° and 60° to the horizontal | T30, T60                                                       |
| `t19c_bouncing_block`      | h = 1 (bottom face), e = 0.8, μ = 0             | t_impact1, v_impact1, v_rebound1, h_bounce1, t_impact2, t_rest |
| `x01_block_slides_to_stop` | M = 1, v0 = 2, μs = μk = 0.2                    | a, F_fr, N, t_stop, s_stop                                     |
| `x02a_force_below_static`  | M = 1, μs = 0.2, μk = 0.1, F = 1.5              | a, F_fr, N, F_fr_limit                                         |
| `x02b_force_above_static`  | same, F = 2.5                                   | a, F_fr, N                                                     |
| `x03_whirl_slack`          | L = 1, v0 = 6 at the bottom                     | cos_phi_slack, v_slack, h_slack, t_slack (all `ode`)           |
| `x04_slides_off_table`     | table top H = 0.8, v0 = 2, μ = 0, floor e = 0   | t_fall, dx_fall, vy_landing, v_after_landing                   |

`t19c.t_rest` is the accumulation time of infinitely many impacts. DESIGN §3.5 accepts the engine's
Zeno cutoff within 1e-6 s of it, which is looser than its class; the regression harness needs a
per-key override for it (see PROGRESS.md, Follow-ups).

## Adding a scene

Write a function in a `scenes_*.py` module that returns a `Scene` (givens with exact values, then
`Quantity(key, derived, formula, meaning, cls)`) and add it to that module's `SCENES`. A new module's
`SCENES` must also be imported in `oracle.py`. Add any printed numbers to `printed.py`. Never type in
a final number: derive it.
