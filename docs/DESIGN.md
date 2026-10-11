# Mechanics Sandbox ("Desmos for school physics"): Design & Development Plan

## Context
This is a new project; the `Physics/` folder is empty. The goal is a browser sandbox where you can build any 2D mechanics problem from grades 9–11 (later olympiad level) out of parts, simulate it, and get **textbook-exact** numbers. Regime changes (slack, lift-off, stick/slip, impacts) are treated as physics events, and "the answer" is a first-class output. This document is the deliverable: a design review, element catalog, physics core, answer extraction, editor, stack, regression suite, roadmap and risks. It contains no code. On approval I will save it as `Physics/docs/DESIGN.md` so it can serve as the project's living design doc. Nothing else gets created.

---

## 0. Questions where your answer changes the design (defaults I assumed)

| # | Question | Default assumed below | What changes if you answer differently |
|---|---|---|---|
| Q1 | Who is the primary user: a student checking their own solution, a teacher demonstrating on a board, or you preparing for olympiads? | Student checking a solution | Teacher: touch/whiteboard UX, big fonts and a preset library move earlier. Olympiad: movable wedges and rigid bodies move earlier. |
| Q2 | Do blocks need to rotate or topple in v1 (statics with moments: lever, ladder)? | No. Blocks only translate (material points) until Phase 6 | Rotation makes contacts nonlinear and multi-point, and often statically indeterminate. It roughly doubles the difficulty of the core. |
| Q3 | Do you need interaction *during* a run (dragging or pushing a body with the mouse)? | No. You always edit the t=0 scene and the whole trajectory is recomputed | "Yes" breaks the precompute-and-scrub design and pushes toward a game-style real-time loop. |
| Q4 | Do you need top-view scenes (turntable, car turning, puck on ice)? | Not before Phase 7 | In top view gravity points into the screen and friction becomes 2D (a friction disk instead of a ±1D force). That is a separate mode. |
| Q5 | Are answers in letters (a = (m₁−m₂)g/(m₁+m₂)) a must? | Nice-to-have, Phase 7 | If it's a must, CAS integration moves up. |
| Q6 | What is your time budget, and is there a deadline (project defense, competition)? | ~10 h/week, no hard deadline | With a deadline, scope freezes at Phase 2. |
| Q7 | What language and notation should the UI use? | Russian UI with textbook notation (F_тр, N, T, μ); both decimal comma and point accepted; g = 9.8 by default with a one-click switch to 10 | — |

---

## 1. Challenging the vision

### 1.1 You're right about game engines, but the strings are the smallest reason
Box2D actually has an exact pulley joint and a max-length rope joint. "Chain of links" is only how people fake ropes. These are what really disqualify game engines:
- **Fixed time step (1/60 s).** Every event time is rounded to a frame, so "when does the string go slack" can be off by up to 16 ms, and everything after it is shifted.
- **Sequential-impulse solver with a fixed iteration count.** Constraints never fully converge. Tensions come out as impulse/dt averages and are noisy.
- **Penetration slop plus position correction.** Box2D tolerates about 0.5 cm of overlap. This perturbs normal forces and makes resting bodies creep.
- **Friction model.** There is a single coefficient (no μs/μk distinction), mixed as √(μ₁μ₂), and it is clamped by the normal impulse of the current iteration. You can't reliably read off "static friction = 9.8 N, not μN".
- **Restitution threshold (~1 m/s) and sleeping.** Slow impacts become inelastic by fiat, and slow bodies freeze.
- **Symplectic Euler, which is 1st order.** On a spring oscillator at 60 Hz, period and amplitude errors are visible in a few cycles.

Game engines optimize for "stable and plausible for 1000 bodies at 60 fps". You need "exact for ≤ 20 bodies, at any cost up to ~100 ms". These trade-offs are opposite, so write your own core. Nothing in those engines is worth borrowing, because your shapes are simple.

### 1.2 What is naive, underspecified, or harder than it looks
1. **"Any curriculum problem" is several products, not one.** School problems fall into kinds:
   - (a) Forward dynamics ("find a, T, t, v"). The simulator answers these directly.
   - (b) Statics ("find the forces"). Nothing moves, and the answer is the constraint forces.
   - (c) Inverse problems ("minimal μ / F / v₀ such that…"). A forward simulator can't answer these without a parameter solver.
   - (d) Answers in letters. These need a CAS.
   - (e) Problems whose printed answer uses an approximation. The exact simulation will *disagree*.
   - (f) 3D or top-view problems. Side-view 2D can't represent them.

   Decide which kinds each phase serves. Build a **coverage matrix**: take about 100 problems from Рымкевич (dynamics, statics, conservation chapters), tag each with the phase that can solve it, and track the percentage. This is your scope compass.
2. **"Textbook-exact" has two meanings.** One is exact for the idealized model, which is achievable to about 1e-10. The other is matching the *printed* answer, which may use g = 10, the small-angle approximation, a "smooth transition" at a corner, or a rounded sin. For a 60° pendulum the exact period is 2.154 s, while the textbook formula gives 2.007 s. The app must show both and explain the difference, or users will report the correct answer as a bug.
3. **Exactness depends on the editor as much as on the solver.** Suppose the drawn string to the pulley is 0.3° off parallel to the incline. The simulated answer is correct for *that* scene and wrong for the *problem*. That makes snapping and relational placement part of correctness, not polish (see §6.1).
4. **"Block" is ambiguous: material point or rigid body?** Textbook blocks are material points that slide and never topple. Suppose instead your blocks can rotate. A block on a 45° incline with μ = 0.9 may then tip over, and its contact becomes two points with a statically indeterminate split of the normal force. Contact constraints also become nonlinear. **Recommendation:** in v1 bodies only translate ("material point" idealization, on by default). Full rigid bodies (rods, ladders, levers, rolling) come in Phase 6. Keep θ and attachment offsets in the data model from day one, so adding rotation is not a rewrite.
5. **Massless things make the equations singular.** Massless strings and fixed pulleys are fine, because they are constraints rather than bodies. A massless *movable* pulley, or a knot joining three strings, is a zero-mass body. Its mass matrix entry is 0, so its acceleration is defined only if the constraints pin it down. This is solvable in general with the augmented system plus a rank check (§3.2). Some user-built configurations really are undefined, though, and the app must say so instead of printing a number.
6. **Idealized rigid systems can be indeterminate or paradoxical.** A lamp on three taut strings or a beam on three supports has non-unique forces. Rigid bodies with Coulomb friction can have zero or several consistent motions (Painlevé paradox). School problems avoid these cases, but a sandbox lets users build them. **Requirement:** detect them and report "not uniquely determined". Never print an arbitrary number.
7. **Impulsive events need modeling choices that the textbook makes silently.**
   - When a string jerks taut, the default is inelastic along the string.
   - «Абсолютно неупругий удар» means "stick together and move as one". That is a *weld*, not e = 0: with e = 0 the bodies can separate later.
   - Simultaneous multi-body impacts (Newton's cradle) have model-dependent answers.
   - A ball bouncing with e < 1 makes infinitely many bounces in finite time (Zeno behavior), which would hang the simulator.

   Each of these needs an explicit, documented rule.
8. **What happens when the problem "ends"?** A block reaches the pulley, a string unwraps, a body slides off the table edge, or a spring compresses to zero length. The textbook never says. **Rule:** a geometric degeneracy is a *terminal event* with a message, for example "A reached the pulley at t = 1.43 s". That time is often exactly the quantity the problem asks for.
9. **Initial conditions must be consistent.** If you set v_A = 2 m/s and B is tied to A, v_B is forced. Strings start taut unless marked slack, and a block "on" a surface has a gap of exactly 0. The editor must project inconsistent inputs onto the constraints and say what it changed.
10. **Corners in tracks.** Where an incline meets the floor, a real point mass loses its normal velocity component (an impact). The textbook assumes a "smooth transition" that keeps the speed. Make this an option at each junction.
11. **g.** Russian problem books use both 9.8 and 10. Make g a scene-level setting with a one-click switch, or every answer will be "wrong" by 2%.

### 1.3 What is easier than it looks
- **Performance.** With ≤ 20 bodies the system matrices are ≤ 60×60, and a full trajectory takes 1–50 ms in plain TypeScript.
- **Exactness for constant-force problems.** Any Runge–Kutta method of order ≥ 2 integrates constant acceleration exactly, because position is quadratic in t. RK methods also preserve linear constraints exactly up to round-off, so straight strings and flat surfaces with translating blocks never drift. Atwood and incline answers match to about 1e-13, whatever tolerance you choose.
- **Forces come for free.** Lagrange multipliers *are* the tension, normal force and static friction, so force probes cost nothing.
- **Scrubbing.** Precompute the whole trajectory with dense output (an interpolating polynomial per step). Time controls then just sample a function: no snapshots and no reverse integration.
- **Event queries.** "When has A traveled 1.5 m" uses the same mechanism (a guard function plus root finding) as "when does the string go slack".

---

## 2. Element catalog

### 2.1 Elements (v1 = Phases 0–3; later phases marked)
| Element | Parameters | Flags / options | Phase |
|---|---|---|---|
| Ground | default μs, μk, e for contacts | — | 0 |
| Static support: table, wall, ceiling | geometry, μs, μk | — | 0 |
| Block | m, w×h, relational position ("on surface X at distance s"), v₀ | material point (rotation locked); on, and the only option until Phase 6 | 0 |
| Fixed pulley | R, mount (ceiling / table edge / incline top / free) | massless (default) ↔ massive: M plus shape (disc I = MR²/2, ring I = MR²) | 0 / massive in 2 |
| String (нить) | route: endpoint → [pulley, side]… → endpoint; L₀ (default: taut at t = 0) | inextensible (default) ↔ elastic (k, pulls only). Always massless. Can always go slack. | 0 / elastic in 2 |
| Static incline (wedge) | α, base or length, μ | mount points: top corner, foot | 2 |
| Spring | k, natural length L₀, endpoints (anchor or body) | massless only; compression-only "bumper" variant | 2 |
| Applied force | F, direction (global / along surface / along string), F(t) expression | — | 2 |
| Driver ("pulled uniformly") | prescribed velocity or position of a body | reports the force required | 2 |
| Ball / point mass | m, r, v₀ vector | — | 3 |
| Massless rigid rod | length, endpoints | pushes and pulls (two-sided) | 3 |
| Curved track | arcs and lines with smooth (G¹) joins: hemisphere, loop, ramp | corner joins: smooth (speed kept) / sharp (impact) | 3 |
| Movable support: wedge, cart, board | m, geometry, μ per face | other bodies can sit on it | 4 |
| Movable pulley, knot | R | massless (default) ↔ with mass | 4 |
| Kinematic platform | y(t) or v(t) (elevator); belt speed (conveyor) | — | 4 |
| Scene globals | g, simulation horizon, significant figures shown | — | 0 |

**Friction** is set per contact pair (μs, μk). The UI has one field "μ" that sets both, with an advanced option to set them separately.

**Restitution** e is set per pair (0…1). The default is 0 and is visible in the Assumptions panel. A separate "stick together" flag adds a weld.

### 2.2 Idealization flags, shown as an auto-generated "Assumptions" panel
The panel reads like the problem statement's «считать нить невесомой и нерастяжимой». It lists:
- material point
- massless and inextensible string
- massless frictionless pulley
- massless spring
- smooth surface (μ = 0)
- smooth junction
- no air resistance
- impact type: elastic / inelastic / stick together

Generating it from the scene teaches students what each idealization means.

### 2.3 Non-ideal options: cheap vs. expensive
| Option | Cost | Why |
|---|---|---|
| μs ≠ μk | free | the stick/slip logic exists anyway |
| Massive fixed pulley (disc/ring) | cheap | Adds one degree of freedom (pulley angle φ). The string splits into two constraints coupled through Rφ, and T₁ ≠ T₂ falls out automatically. |
| Elastic string (k) | cheap | A spring that only pulls; the slack/taut kink is an event. Large k makes the ODE stiff, which only means smaller steps. |
| Restitution e, stick on impact | cheap | a parameter of the impact law, or a weld constraint |
| Air drag −kv, −kv² | cheap | a smooth force term |
| Time-dependent forces, drivers | cheap | a right-hand-side term, or a time-dependent constraint |
| Elevator, conveyor | cheap–medium | a moving surface; friction uses the relative velocity |
| Coulomb friction in the pulley axle | medium | one more stick/slip element on φ |
| String slipping on a pulley (Euler/capstan formula T₂ = T₁e^{μφ}) | medium | an extra stick/slip mode at the string–pulley contact; olympiad level |
| Variable mass (rocket, sand on a conveyor) | medium, as dedicated elements | needs dm/dt bookkeeping; not general |
| Rotating rigid bodies (rods, ladders, rolling) | **expensive** | nonlinear multi-point contacts, indeterminacy, rolling constraints |
| String with mass / chain | **expensive** | A continuum (PDE); discretizing it is not exact. Exception: "chain sliding off a table" as a dedicated 1-D element with its own ODE. |
| Spring with mass | **expensive** | a continuum; the m/3 rule only approximates the fundamental mode |
| String wrapping around arbitrary bodies or corners | **expensive** | contact detection along the string, plus topology changes |
| 3D (conical pendulum) | out of scope | — |

---

## 3. Physics core

### 3.1 Pipeline (each arrow is a pure function, unit-testable in Node)
```
Scene document (relational JSON: what the user edits, saves, shares)
  │  layout resolver → world geometry at t = 0
  ▼
Compiler → mechanical model: degrees of freedom q, mass matrix M, force elements,
           constraints g_i(q,t) (two-sided or one-sided) with provenance (element id, symbol),
           guard functions, diagnostics ("string passes through block B")
  ▼
Hybrid solver (Web Worker): mode selection ⇄ ODE integration + event location
  ▼
Trajectory: phases [t_k, t_k+1] × mode, dense output per step, event log
  ▼
Views: playback, probes, graphs, event log and phase bands, free-body diagrams, (later) equations
```

### 3.2 Formulation: maximal coordinates plus Lagrange multipliers (recommended)
**Coordinates.**
- Each body has coordinates (x, y), with θ added in Phase 6. A massive pulley adds φ.
- M = diag(m, m, [I]) is constant and diagonal.

**Constraints.** Every connector is a scalar function g_i(q, t). One-sided constraints require g_i ≥ 0; two-sided ones require g_i = 0. For each constraint type you hand-derive its value, its gradient row J_i = ∂g_i/∂q, and a velocity-dependent curvature term (J̇v)_i. Check every derivation against finite differences in unit tests. Six types cover v1:

| Constraint | Function | Notes |
|---|---|---|
| String length (one-sided) | g = L₀ − (Σ straight segments + Σ R·wrap angle) | The gradient at an endpoint is the unit vector along the string segment leaving it, **even with a finite pulley radius** (the change in the wrapped arc cancels out). J̇v = Σ \|v⊥,rel\|²/ℓ_segment. No CAS or automatic differentiation needed. |
| Block on a flat face (translating polygons) | g = n·(p_B − p_A) − d | linear |
| Point on a circle (hemisphere outside, loop inside) | g = ±(\|p − c\| − R) | — |
| Rod | \|p_A − p_B\| − ℓ = 0 | — |
| Stick (no relative sliding) | t·(v_B − v_A) = 0 | imposed at velocity/acceleration level |
| Driver | s(q) − s_prescribed(t) = 0 | — |

**Equations for the current mode.** Let A be the set of active constraints and J_A the matrix stacking their gradient rows J_i (the constraint Jacobian). The equations form one linear system, known as the KKT system:
```
[ M     −J_Aᵀ ] [ a ]   [ f(q, v, t)                ]
[ J_A     0   ] [ λ ] = [ −(J̇v)_A − (time terms)     ]
```
- a is the vector of accelerations, and f is the vector of applied forces (gravity, springs, applied forces).
- λ is the vector of Lagrange multipliers, normalized so that λ_string = tension in newtons, λ_contact = normal force, and λ_stick = static friction. **These values are the probes.**
- **Sliding friction** adds no unknown. On a sliding contact the force column J_nᵀ becomes (J_n − μk·s·J_t)ᵀ, where s = sgn(v_t) is fixed for the whole phase. The matrix becomes non-symmetric, so solve it with LU (not Cholesky).

**Solving.** Use dense LU with partial pivoting on the full system above. Unlike the reduced J M⁻¹ Jᵀ form, it works with zero-mass entries.
- Each time a new mode starts, run a rank-revealing QR or SVD.
- If the active constraints are redundant (rank(J_A) < number of rows), the motion is still unique but the forces are indeterminate. Report it.
- If the whole matrix is singular, some massless element is undetermined. Refuse to run and name the element.
- When the constraints are linear, the matrix is constant within a phase, so factor it once per phase.

**Why not reduced (generalized) coordinates?** Deriving minimal coordinates automatically for arbitrary user topologies (closed loops, movable pulleys) is hard. Constraint forces would have to be recovered separately, and every mode change alters the coordinate set. Maximal coordinates with multipliers are modular: a new element is just a new row type. The textbook's "one a for the whole system" can still be recovered for display from the null space of J (§5).

**Why event-driven and not time-stepping?** Time-stepping schemes (Moreau–Jean, and in spirit every game engine) are robust with hundreds of contacts. But they give event times only to within Δt, and they are 1st-order accurate. Event-driven integration gives exact event times and high-order accuracy, which is right for ≤ 20 bodies and textbook precision.

### 3.3 Integrator and drift
**Integrator: Dormand–Prince 5(4)** (as in MATLAB's ode45), with its 4th-order dense output.
- Steps are adaptive, with relative tolerance about 1e-10 and absolute tolerance scaled to the scene size.
- DOP853 is an option for long oscillation runs.
- Don't use Verlet or semi-implicit Euler. They are fixed-step and low-order, and they make event location worse. Their long-run energy behavior is a benefit you don't need for 10–100 s horizons at 1e-10 tolerance.

**The rule that makes everything exact:** the right-hand side must be smooth *within* a phase. Never put sgn(v), max(0, x) or "if taut" inside it. Every non-smooth point is a phase boundary, that is, an event. That is why event-driven integration reaches textbook precision and game loops can't.

**Drift.**
- Linear constraints don't drift, because RK methods preserve them exactly.
- Nonlinear constraints do drift: a pendulum, a string whose direction changes, a curved track. After each accepted step:
  - project q back onto g_A(q) = 0, using 1–2 Gauss–Newton iterations weighted by M;
  - project v onto J_A v = 0.

  The correction is about the size of the tolerance, so it doesn't bias answers.
- **Don't use Baumgarte stabilization.** Its tuned spring/damper terms leak into the constraint forces you report.

**Maximum step.** Cap the step size so that a guard can't cross zero twice inside one step unseen (for example a projectile grazing a surface).

### 3.4 Modes and events (the hard part)
**A mode** fixes, for each one-sided constraint, whether it is active or inactive. For each active contact with friction, it also fixes whether the contact sticks, slips forward, or slips backward.

**Guards** are functions of time watched during a phase. A sign change on the dense output marks an event. Its time is then refined with Brent's or the Illinois root-finding method to about 1e-12 s.

| Current state | Guard | Meaning |
|---|---|---|
| active string/contact | λ_i(t) = 0, going negative | slack / lift-off |
| inactive string/contact | gap_i(t) = 0, closing | goes taut / touchdown → impact |
| sliding contact | v_t(t) = 0 | stops or reverses → select a new mode |
| sticking contact | \|λ_t\| − μs·λ_n = 0 | breaks loose |
| geometry | segment length → 0; wrap angle → 0; body passes the end of a surface; spring length → 0 | terminal event or end of contact |
| user query | Q(t) − target = 0; dQ/dt = 0 (extremum) | recorded; mode unchanged |
| horizon / everything at rest | t = T_max | stop |

λ_i(t) is evaluated by solving the system at interpolated states, which is cheap.

**Mode selection at an event.** This is an acceleration-level complementarity problem, as in Baraff 1994.
1. **Candidates** are one-sided constraints with gap ≈ 0 and gap rate ≈ 0, plus contacts with v_t ≈ 0.
2. For each combination of candidate states, solve the system above (with equalities only), then validate the result:
   - an active constraint needs λ ≥ 0;
   - an inactive constraint needs gap acceleration ≥ 0;
   - a sticking contact needs \|λ_t\| ≤ μs·λ_n;
   - a slipping contact needs a tangential acceleration in the slip direction, with friction = μk·λ_n opposing it.
3. **Enumerate in a smart order:** current mode first, then single flips, then pairs. School scenes have ≤ 6 candidates, so this means at most about 700 tiny solves, and only at events. It is simpler than Lemke/Dantzig pivoting, and it **detects zero or multiple valid modes**. The app then reports "no consistent motion" or "non-unique: chose X by rule Y". Switch to Lemke only if scenes outgrow enumeration.

**Ties.** Validation uses a scaled ±ε. μ exactly equal to tan α is a real textbook boundary case. Break ties deterministically (prefer stick, prefer contact) and flag "boundary case".

**Re-triggering, the classic bug of hybrid simulators.** The same event fires again at t+0. Right after lift-off the gap is still 0; right after sticking, v_t is still 0.
- After a switch, set the relevant quantity to exactly zero (project).
- Arm a guard only once its function has moved away from zero in the allowed direction. Use the sign of its 1st or 2nd derivative at the event to tell.

**Simultaneous events** (symmetric scenes): gather all guards that fire within ε of the event time and handle them together with one mode selection.

### 3.5 Impacts (velocity jumps)
An impact happens on touchdown, or when a string goes taut, with a nonzero closing velocity. It is solved at velocity level: M·Δv = J_Cᵀ·Λ, where Λ is the vector of impulses.
- For each closing one-sided constraint, the post-impact gap rate must be ≥ −e × the pre-impact rate, with Λ ≥ 0 and the usual complementarity.
- Active two-sided constraints keep J v⁺ = 0. This way an impulse travels through taut strings, as when a bullet hits a block hanging over a pulley.
- Taut strings stay one-sided during the impact, so an impulse can slacken them.

**Defaults:** a string jerk has e = 0; body–body impacts use the pair's e; "stick together" adds a weld. Impacts are frictionless in v1.

**Zeno handling:** if the closing speed is below v_min, or there are more than N impacts within Δt, switch to resting contact. Test 19 checks that the ball stops within 1e-6 s of the analytic accumulation time.

**Simultaneous multi-contact impacts** use the simultaneous-impulse model. Document that Newton's cradle gives model-dependent results.

### 3.6 Report, don't guess (diagnostics are a feature)
- **Redundant constraints:** "Statically indeterminate: tensions in strings 1–3 are not uniquely determined." The motion is still shown.
- **Singular system:** "Massless knot K is not determined by its strings." The simulation refuses to run.
- **No valid mode or several valid modes:** a message that says which rule was applied.
- **Terminal geometry event:** a message with the time.
- **Initial-state projection:** "v_B set to 2.00 m/s by string 1."

### 3.7 What is genuinely hard, ranked
1. Robust event handling: re-triggering, simultaneous events, grazing contacts, Zeno behavior, tolerances at boundaries. Spend the most testing effort here.
2. Mode selection with friction when several contacts are coupled (block on board on floor).
3. Massless movable pulleys and knots in general topologies.
4. Rotation (Phase 6).

By comparison, assembling the system, the integrator (port a reference DOPRI5) and the probes are straightforward.

---

## 4. How the answer is produced

**4.1 Automatic outputs (no setup needed)**
- **Event log and phase bands on the timeline.** For example: "0–0.714 s: string taut, A slides • 0.714 s: B hits the floor (inelastic), string slack • 0.714–1.429 s: A decelerates • 1.429 s: A stops."
- **Phase summary card.** Quantities that are constant in a phase are shown as constants, marked "constant on [t₀, t₁]": accelerations, tensions, N, F_тр. Constancy is checked by evaluating at several points in the phase and requiring agreement to about 1e-12, not by curve fitting.
- **Statics.** "Equilibrium. Forces: …". Static friction is shown together with its limit: "6.70 N of max 9.21 N".
- **Conservation readouts:** KE, PE, spring PE, work of friction/heat, and momentum, with the energy balance at each event.

**4.2 Probes**
- Body: x, y, path length, v, a, momentum, KE.
- String segment: T.
- Contact: N, F_тр, stick/slip state, μN limit.
- Spring: extension, force, energy.
- System: total energy, center of mass.

Each probe shows its value at the playhead and a time graph synced to the timeline. Forces are recomputed on demand from the stored state with one system solve, so nothing extra is stored.

**4.3 Event queries are just extra guards**
- Query forms:
  - "when [Q] = [value]" (a crossing);
  - "when [Q] is max/min" (derivative zero, with a sign check);
  - "at event [E], report [Q₁, Q₂…]";
  - "value at t = …".
- **Derived quantities** use a small expression language over probe variables, for example `x_A − x_B`, `½·m_A·v_A²`, `T1/T2`.
- **The result** is a time plus the full state and forces at that instant. Example: "s_A = 1.5 m at t = 1.2372 s; v_A = 2.425 m/s".

**4.4 Can the app find "the answer" automatically?** Partly. It can't know what the problem asks. For forward problems, though, the requested number is almost always already in the event log or on the phase summary card. Two more features help:
- a **Find** list in the problem panel (§6.5);
- a **"check my answer"** box: you enter your number and get match/mismatch at the displayed precision. This is cheap and very valuable for students.

**4.5 Inverse problems (Phase 5).** "Find p such that Q = target" brackets the value and runs Brent's method over repeated simulations, each taking milliseconds. Boolean targets ("doesn't slide", "reaches the top") use bisection on the regime boundary, which is exactly what "minimum μ" problems ask for. **Sweep plots** show an answer against a parameter, such as a vs m₂/m₁. This is very much in the Desmos spirit.

**4.6 Later: problem import.** An LLM could turn a pasted problem statement into scene JSON for you to confirm. The engine stays the only source of numbers.

---

## 5. The "equations of motion" suggestion: verdict
**It's a good idea. Displaying the equations is feasible without a full CAS; only solving them in letters needs one. It doesn't belong in v1. Plan it for Phase 5, but build two things for it from Phase 0:**
1. **Provenance.** Every force and constraint row records which element produced it, its textbook symbol (T₁, N₂, F_тр, kx), and the symbolic origin of geometric coefficients (for example "cos α of incline #2").
2. **Phases as first-class objects.** They already are in this design.

**Why it fits this architecture.** In event-driven simulation each phase has a fixed mode, which means a fixed linear system in (a, λ). Those are exactly the textbook's equations for that case («рассмотрим случай, когда брусок скользит вверх»). Display works as follows:
- For each body, project Newton's 2nd law onto natural axes: along and across the allowed motion. That is "along the incline" for a block on an incline, vertical for a hanging body, tangential/normal for a pendulum.
- Print constraint relations straight from the rows of J_A: a₁ = −a₂, a₁ = 2a₂ for a movable pulley, Rφ̈ = a for a massive pulley.

**Three levels:**
1. **Free-body diagram with labeled force vectors and values.** Phase 2, nearly free: draw J_Aᵀλ for each body, plus gravity, springs and applied forces. Russian school problems always start with «расставьте силы», so this alone carries most of the teaching value.
2. **Equations per phase, written in symbols and with numbers substituted,** plus a residual check ("both sides: 4.90 = 4.90"). Phase 5, no CAS needed: each term is a symbol, a numeric coefficient and a value, and provenance supplies coefficients like sin α. The real cost is presentation: sign conventions (one positive direction along each string for every body on it), choice of axes, and phases with several cases.
3. **Closed-form solution** (a = (m₁−m₂)g/(m₁+m₂)). This needs simplification of rational functions (multivariate polynomial GCD), so use a real CAS: Giac compiled to WASM (the CAS inside GeoGebra) or SymPy via Pyodide, lazy-loaded in a worker. Phase 7.

**Why not v1:** it's a UX rabbit hole, and it delivers nothing until the engine is trusted.

**The bigger Desmos lesson for v1 is elsewhere:** named parameters as a live list of sliders (m₁ = 3 kg, α = 30°), with instant recompute and graphs. That is cheap, and it is what makes Desmos feel magical. I'm also not aware of any mainstream tool that derives equations from a drawn scene, so Phase 5 is a real differentiator.

---

## 6. Editor UX
**You're right, and it's more than half.** Expect about 60% of the total effort, most of the UX iteration and most of the bugs. The physics core is mathematically hard but well specified; the editor is open-ended.

**6.1 A relational scene model is the key decision.** Store positions relative to their *hosts*, not as absolute coordinates. Examples:
- `Block {on: incline#2.topFace, s: 0.8 m from foot}`
- `Pulley {mount: incline#2.topCorner}`
- `String {path: [block#1.anchor, pulley#1 (clockwise), block#3.anchor]}`
- `HangingBlock {from: string#1.end, heightAboveFloor: h}`

A **layout resolver** computes world geometry by walking a dependency tree. Don't build a general CAD constraint solver.

What this buys you:
- Changing α to 45° keeps the block on the incline, moves the pulley, and re-routes the string so it stays parallel.
- Gaps are exactly 0 by construction.
- Sliders work.
- Problem "givens" (h above the floor, distance to the pulley) map directly to editable fields.

Free absolute placement still exists for projectiles and similar cases.

**6.2 Placement and snapping.** Drag an element from the palette. Dropping it near a surface snaps it face-on, with contact. Snap targets are faces, corners (pulley mounts), the ceiling, string tangent points, "parallel to surface" and "vertical". Snap guides are visible, and Alt disables snapping.

**6.3 String tool.**
1. Click the first body.
2. Click pulleys in order. Which side of the center you click on sets the wrap side, and the wrap is drawn immediately.
3. Click the end body, or choose "hang a weight", which places a block straight below the tangent point.

A rubber-band preview follows the cursor. L₀ defaults to the current length (taut), with an option for "slack by Δ". Warnings include "string passes through a body" and "segment not parallel to the surface", with a one-click fix.

**6.4 Parameter panel.** It opens on selection.
- Units are always visible, and expressions are allowed ("2*sqrt(3)", "2*m1").
- Any field can be linked to a named parameter.
- Idealization flags are toggles with a one-line physics explanation, e.g. "Massless pulley: tensions on both sides are equal".

**6.5 Problem panel** (left side, a Desmos-style list). This panel is the product's identity. It contains:
- the pasted problem text;
- **Givens**: named parameters with sliders;
- **Find**: probes and queries with live answers;
- **Assumptions**: the auto-generated list from §2.2.

**6.6 Initial conditions.** Drag velocity-arrow handles or type values; they are projected onto the constraints with visible feedback. By default everything starts at rest and is released at t = 0.

**6.7 Time controls.**
- Play/pause, and speed from 0.1× to 10×.
- A scrubber with event markers and colored phase bands.
- **Step to next/previous event**, the most important button.
- Frame step, loop, and a "pause at every event" toggle.
- The horizon defaults to 10 s or until everything is at rest. It is extended lazily when the playhead approaches the end.

You always edit the t = 0 scene. The trajectory is recomputed in a worker (debounced), and the playhead keeps its time.

**6.8 Overlays.** Free-body force vectors with labels, velocity and acceleration arrows, traces, a grid and rulers in meters, auto-fit camera, zoom and pan.

**6.9 Plumbing.**
- Undo/redo from day one (Immer patches), copy/paste, keyboard shortcuts.
- **Share by URL:** compressed scene JSON in the URL hash, with no backend.
- A **schema version plus migrations**, so old links keep working.
- Touch and whiteboard support later, or earlier if teachers are the target (Q1).

---

## 7. Stack
| Layer | Choice | Why |
|---|---|---|
| Solver | **TypeScript**, a framework-free package running in a **Web Worker** | Matrices are ≤ 60×60 and a trajectory takes milliseconds. JS numbers are the same IEEE doubles as in C++, and the same code runs in Node for tests. WASM (Rust/C++) adds a build/debug boundary for speed you don't need; revisit only if a profiler says so. |
| Linear algebra | own dense LU + Householder QR (~200 lines) or `ml-matrix` | tiny matrices; rank detection needed |
| Integrator | DOPRI5 ported from Hairer's reference code, with dense output; check it against the reference outputs | proven method |
| App | **Vite + React + TS** single-page app | Purely client-side; workers and SVG work without friction. Next.js also works (you know it), but server rendering gives nothing here; add it later for a public gallery or SEO. |
| State | Zustand + Immer | Immer patches give undo/redo |
| Schema | zod, versioned | validates shared URLs and handles migrations |
| Scene rendering | **SVG via React**; during playback, update transforms directly instead of re-rendering React each frame | Fewer than 100 elements, free hit testing, crisp arrows and labels, SVG/PNG export for worksheets. Canvas or Pixi is unnecessary at this size. |
| Graphs | uPlot | fast and small |
| Math display | KaTeX (Phase 5); MathLive for formula input later | — |
| Persistence | URL + localStorage in v1; Supabase (auth, library, teacher collections) in Phase 5 | you know Supabase |
| Tests | Vitest + fast-check (property tests); Python + SymPy scripts generate the expected values | independent oracle |
| CI | GitHub Actions runs the engine suite on every push | — |
| CAS (Phase 7) | Giac WASM or SymPy/Pyodide, lazy-loaded in a worker | — |

Repository layout (pnpm workspaces):
```
packages/engine   model, constraints, linear solve, DOPRI5, events, modes, impacts, probes (no DOM)
packages/scene    document schema (zod), layout resolver, compiler → engine model, diagnostics
apps/web          editor, SVG renderer, timeline, panels, graphs, worker glue
tests/scenes/     *.json scenes + expected.json; the same scenes ship as app presets
```

---

## 8. Correctness test suite
**Policy**
- g = 9.8 m/s² unless stated otherwise.
- Tolerances:
  - quantities in uniformly accelerated phases, and event times in them: relative error ≤ 1e-9 (expect about 1e-13);
  - quantities that need real ODE integration (springs, pendulums, curves): ≤ 1e-7;
  - event times: ≤ 1e-8 s.
- Each test is a scene JSON plus expected values computed independently by a committed SymPy script.

| # | Problem | Setup | Expected (analytic) | Exercises | Phase |
|---|---|---|---|---|---|
| 1 | Atwood machine | m₁ = 3, m₂ = 2 kg, massless pulley | a = 1.96 m/s²; T = 23.52 N; m₁ has descended 1 m at t = 1.0102 s | system solve, string, probes, query | 0 |
| 2 | Table + hanging mass | M = 4 on table, m = 1 hanging. (a) μ = 0; (b) μ = 0.2; (c) μs = 0.3 | (a) a = 1.96, T = 7.84 N; (b) a = 0.392, T = 9.408 N; (c) at rest, F_тр = 9.8 N (**not** μN = 11.76), T = 9.8 N | sliding friction; sticking at t = 0 | 0 |
| 3 | **Load hits the floor** | M = 4, μ = 0.2, m = 2 hanging h = 0.5 m above floor | a = 1.96, T = 15.68 N; impact at t = 0.71429 s, v = 1.4 m/s; string goes slack; A stops at t = 1.42857 s; total distance 1.000 m | impact, slack, slip → stick | 0 |
| 4 | Incline, slides from rest | α = 30°, μ = 0.2, L = 2 m | a = 3.2026 m/s²; t = 1.1176 s; v = 3.5792 m/s | inclined contact | 2 |
| 5 | Incline, holds | m = 2, α = 20°, μs = 0.5 | F_тр = 6.7036 N (static, not μN = 9.209); N = 18.418 N; no motion | static friction as a reaction force | 2 |
| 6 | Up the incline and back | α = 30°, v₀ = 5 m/s up. (a) μs = μk = 0.3; (b) μk = 0.3, μs = 0.7 | stops at t = 0.67149 s after 1.67873 m; (a) back at start 1.19430 s later with v = 2.8112 m/s; (b) stays | v_t = 0 event; μs ≠ μk | 2 |
| 7 | Incline + pulley + hanging mass | m₁ = 2 on α = 30°, μ = 0.1; m₂ = 3 hanging | a = 3.5805 m/s²; T = 18.658 N | your example | 2 |
| 8 | Two blocks pulled by F | m₁ = 2, m₂ = 3, F = 10 N on m₂. (a) μ = 0; (b) μ = 0.1 | (a) a = 2, T = 4 N; (b) a = 1.02, T = 4.0 N (independent of μ) | applied force | 2 |
| 9 | Atwood with massive pulley | m₁ = 3, m₂ = 2, disc pulley M = 2 kg | a = 1.6333; T₁ = 24.500 N; T₂ = 22.867 N | pulley rotation, split string | 2 |
| 10 | Horizontal spring | m = 0.5, k = 50, A = 0.1 m | T = 0.62832 s; v_max = 1.0 m/s; energy drift < 1e-9 over 100 periods | ODE accuracy, extremum queries | 2 |
| 11 | Vertical spring released at natural length | m = 0.2, k = 20 | max extension 0.196 m; period 0.62832 s; max force 3.92 N = 2mg | gravity + spring | 2 |
| 12 | Drop onto a spring | m = 1 dropped from h = 0.5 m onto k = 1000 | contact at t = 0.31944 s; max compression 0.109279 m; rebounds to 0.5 m | bumper kink as event; max query | 2 |
| 13 | Oscillator damped by dry friction | m = 1, k = 100, μs = μk = 0.1, x₀ = 0.1 m | turning points 0.1, −0.0804, 0.0608, −0.0412, 0.0216, −0.0020; sticks at x = −0.0020 m at t = π/2 = 1.570796 s | repeated stick/slip | 2 |
| 14 | Statics: two strings | m = 2, strings at 30° and 60° to the horizontal | T₃₀ = 9.8 N, T₆₀ = 16.974 N; zero drift over 100 s. Adding a third string → "indeterminate" diagnostic | statics, rank check | 2 |
| 15 | Projectile | v₀ = 20 m/s at 30° | range 35.348 m; max height 5.1020 m; flight time 2.0408 s | free flight, touchdown | 3 |
| 16 | Pendulum at 60° | L = 1 m, m = 1 | T at bottom = 19.6 N; v = 3.1305 m/s; period **2.1540 s** (small-angle formula: 2.0071 s) | nonlinear constraint, drift projection | 3 |
| 17 | Sliding off a hemisphere | point mass, R = 1 m, v₀ = 1 m/s at the top | leaves at θ = 45.52° (cos θ = 0.70068), v = 2.6204 m/s | curved contact, lift-off | 3 |
| 18 | Loop | R = 1 m, smooth ramp. (a) h = 3R; (b) h = 2R | (a) N_top = mg, N_bottom = 7mg; (b) leaves the track at height 5R/3 = 1.6667 m | curved track, lift-off | 3 |
| 19 | Collisions + Zeno | (a) m₁ = 1 at 3 m/s hits m₂ = 2 at rest, elastic; (b) same, stick together; (c) ball dropped from h = 1 m, e = 0.8 | (a) −1 and 2 m/s; (b) 1 m/s, heat 3.0 J; (c) at rest at t = 9·√(2h/g) = 4.06579 s and the simulation terminates | impacts, Zeno handling | 3 |
| 20 | Board and block | board M = 2 on smooth floor, block m = 1 on it, μ = 0.3. (a) F on board: 6 N; 15 N; (b) block given v₀ = 3 m/s | (a) 6 N: together, a = 2, friction = 2 N; 15 N: a_block = 2.94, a_board = 6.03; (b) common v = 1 m/s at t = 0.68027 s, slip 1.0204 m, heat 3.0 J | friction between two moving bodies | 4 |
| 21 | Movable pulley | ceiling → under movable pulley carrying m₂ = 3 → over fixed pulley → m₁ = 1 | T = 12.6 N; a₁ = 2.8 m/s² up; a₂ = 1.4 m/s² down | massless movable body, a₁ = 2a₂ | 4 |
| 22 | Block on a movable smooth wedge | M = 4, m = 1, α = 30°, all surfaces smooth | wedge A = 0.99848 m/s²; block relative to wedge a = 5.7647 m/s²; N = 7.9878 N | movable surface | 4 |

**Property tests** (fast-check, on random valid scenes):
- **Energy:** in conservative scenes \|ΔE\|/E < 1e-9 over the horizon; with friction, energy lost = heat from friction.
- **Constraints:** residuals < 1e-10 at every output time.
- **Rotation invariance:** rotating the whole scene and gravity by a random angle gives identical scalar answers.
- **Mirror invariance.**
- **Unit scaling:** lengths × k with time × √k give the same dimensionless answers.
- **Determinism:** identical output, bit for bit.
- **Jacobians:** match finite differences for every constraint type.
- **Mode selection:** unit tests on hand-built cases, including ones with no solution and with multiple solutions.
- **Fuzzing:** random scenes must never hang (event-count cap), never produce NaN, and always terminate with a stated reason.

---

## 9. Phased roadmap
Estimates assume about 10 h/week. They are rough; the order matters more than the dates.

**Phase 0: engine only, no UI (~4–6 weeks)**
1. Work out the math on paper for the three constraint types the slice needs:
   - string over fixed pulleys with tangent geometry;
   - a translating block on a flat face;
   - an impact with the floor.

   Derive their gradient rows J and curvature terms J̇v.
2. Build the pipeline: hand-written scene JSON → compiler → system solve (LU) → DOPRI5 with dense output → guards and root finding → mode enumeration (one-sided constraints plus stick/slip) → inelastic impact → trajectory, probes and event log.
3. Output a CSV and use a 50-line script to plot it.

**Exit:** tests 1, 2a–c and 3 pass in Vitest at 1e-9.

**About your proposed slice:** Atwood plus table-and-pulley are both single-mode, constant-acceleration problems. They would pass on a naive solver and prove nothing about the hard part. Keep them, and add 2c (static friction holds) and **3 (load hits the floor → string goes slack → block slides to a stop)**. It is the same scene with the same elements, but it exercises impact, slack, stick/slip and phase bands, which is the whole hybrid architecture. Its answers are also round (1.96, 1.4, 0.5 + 0.5 = 1.0 m), which makes it a great demo.

**Phase 1: minimal end-to-end app (~6–8 weeks)**
- Vite app with SVG renderer and worker.
- Palette: floor, table, block, fixed pulley (ceiling / table edge), string tool, "hang a weight", with relational placement for these only.
- Parameter panel, g toggle, named parameters with sliders.
- Precomputed timeline with phase bands and step-to-event.
- Probes (x, v, a, T, N, F_тр with stick/slip state), event log, phase summary card.
- Share by URL, undo/redo.

**Exit:** someone who has never seen the app builds tests 1–3 from scratch in under 2 minutes and reads the textbook answers off the screen.

**Phase 2: core curriculum dynamics (~8 weeks)**
- Inclines with parallel-string snapping.
- Springs and bumpers, elastic string.
- Applied forces and drivers, massive pulley.
- **Free-body diagram overlay**, graphs, query builder with expressions, "check my answer".
- Problem panel and Assumptions list; test scenes become presets; localStorage.

**Exit:** tests 4–14 pass. Measure coverage of Рымкевич's grade 9–10 dynamics chapters and show the app to classmates and a teacher.

**Phase 3: free motion, curves, collisions (~6 weeks)**
- Point masses and projectile traces.
- Arcs, loops and hemispheres, with smooth/sharp junctions.
- Pendulum and rods.
- Collisions with e or stick-together, Zeno handling.
- Energy and momentum panels.

**Exit:** tests 15–19 pass.

**Phase 4: interacting movable bodies (~8 weeks)**
- Contacts between moving bodies for translating polygons: stacks, boards, carts, movable wedges.
- Movable pulleys and knots with rank diagnostics.
- Elevator and conveyor.

**Exit:** tests 20–22 pass.

**Phase 5: explanation layer and inverse problems (~8 weeks)**
- Per-phase equations (symbols + numbers + residual check).
- Parameter sweep plots and inverse solving.
- Supabase accounts, library and sharing.

**Phase 6: rigid bodies with rotation**
- Rods, ladders and levers, hinges, torques, rolling, toppling, multi-point contact, statics with moments.
- Write a separate design document before starting.

**Phase 7: olympiad level and symbolic answers**
- CAS answers in letters.
- Capstan friction, chain and variable-mass elements.
- Top-view mode.
- LLM problem import.

**Milestone:** Phases 0–2 (about 5 months) give a product that is genuinely useful for most school dynamics problems.

---

## 10. Top risks (most likely project killers first)
1. **Unbounded scope.** "Any problem" never converges.
   *Mitigation:* the coverage matrix, exit criteria per phase, and saying no to rotation until Phase 6.
2. **One wrong number destroys trust.** Event edge cases in user-built scenes (re-triggering, simultaneous events, grazing contacts, Zeno behavior, ties at μ = tan α) produce confident nonsense.
   *Mitigation:*
   - Phase 0 is engine-only.
   - Property tests and fuzzing.
   - Diagnostics instead of guesses.
   - Every number on screen can be traced to a phase and a mode.
3. **The editor swallows the project.**
   *Mitigation:* a relational model with a small fixed set of host/mount relations, no general constraint solver, and an ugly-but-correct UI first.
4. **The rotation cliff.** Material-point assumptions leak into the data model (no θ, no attachment offsets, single-point contacts hard-coded), forcing a rewrite in Phase 6.
   *Mitigation:* θ and attachment offsets in the schema from day one, locked by a flag.
5. **Differences from the textbook model look like bugs.** Small-angle formulas, g, corners, "inelastic", μs vs. μk.
   *Mitigation:* the Assumptions panel and a side-by-side "exact vs. textbook approximation" display.
6. **Degenerate user scenes.** Massless knots, indeterminate supports, strings through bodies.
   *Mitigation:* compile-time diagnostics, and refusing to run with a clear message.
7. **Solo momentum.** A long engine phase with nothing to show.
   *Mitigation:* Phase 0 produces a plot demo, Phase 1 is shareable by URL, and 5 classmates or a teacher use it right after Phase 1.

**Not risks:** performance, JS numerics, rendering.

---

## Verification
- **Each phase:** its exit criterion holds, and its numbered tests pass in CI (`pnpm vitest` in `packages/engine`).
- **From Phase 1:** the same JSON scenes load in the app as presets. A Playwright smoke test opens each preset, runs it, and compares the numbers on the summary card against `expected.json`.
- **End of each phase:** update the coverage matrix (a spreadsheet of about 100 Рымкевич problems, each tagged solvable / not yet / out of scope).

## Reading list
- D. Baraff, "Fast Contact Force Computation for Nonpenetrating Rigid Bodies", SIGGRAPH 1994. Contact forces at acceleration level, with static and dynamic friction.
- Witkin & Baraff, *Physically Based Modeling* course notes, especially "Constrained Dynamics". The multiplier formulation explained in plain language.
- Pfeiffer & Glocker, *Multibody Dynamics with Unilateral Contacts*. The theory behind §3.4.
- Hairer, Nørsett, Wanner, *Solving Ordinary Differential Equations I*. DOPRI5 and dense output; Hairer's `dopri5` code is the reference to port.
- MATLAB `ode45` "Events" documentation. The practical mental model for event location.
- Siconos (open-source non-smooth dynamics, C++/Python). Use it to cross-check tricky scenes, not to embed.
- Problem sources: Рымкевич (core suite and coverage matrix), Гольдфарб, Савченко (later, olympiad phases).
