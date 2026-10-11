"""Phase 0 regression scenes (DESIGN §8 tests 1, 2a-c, 3, 14, 19c) and the extras x01-x04 needed by
prompts 02-04. Every answer is derived from Newton's laws, energy or the impact law; no final number
is typed in. Units: SI, y up, g = 9.8 m/s^2.

Each derivation picks the regime the way the engine must: it tests the hypothesis (stick vs slip,
taut vs slack) against the inequality that decides it, and only then solves that mode."""

from __future__ import annotations

import sympy as sp

from common import EXACT, G, ODE, Quantity, Scene, positive_root, require, solve_unique

R = sp.Rational
Eq = sp.Eq


def _pos(names: str):
    return sp.symbols(names, positive=True)


def _nonneg(names: str):
    return sp.symbols(names, nonnegative=True)


def _real(names: str):
    return sp.symbols(names, real=True)


def t01_atwood() -> Scene:
    m1, m2, g, d, t = _pos('m1 m2 g d t')
    a, T = _real('a T')
    givens = {m1: 3, m2: 2, g: G, d: 1}
    # Newton's 2nd law along the taut string; positive direction: m1 down, m2 up.
    s = solve_unique([Eq(m1 * a, m1 * g - T), Eq(m2 * a, T - m2 * g)], [a, T])
    # From rest with constant a: d = a t^2 / 2.
    t_d = positive_root(Eq(d, s[a] * t**2 / 2), t, givens)
    return Scene('t01_atwood', givens, (
        Quantity('a', s[a], '(m1 - m2)*g/(m1 + m2)', 'acceleration of each block, m1 moving down'),
        Quantity('T', s[T], '2*m1*m2*g/(m1 + m2)', 'string tension'),
        Quantity('t_m1_down_1m', t_d, 'sqrt(2*d*(m1 + m2)/((m1 - m2)*g))',
                 'time from rest until m1 has descended d = 1 m'),
        Quantity('v_m1_down_1m', s[a] * t_d, 'sqrt(2*d*g*(m1 - m2)/(m1 + m2))',
                 'speed of m1 at that moment'),
    ))


def _table_with_hanging_mass(scene_id: str, mu_s_value, mu_k_value) -> Scene:
    """Block A (mass M) on a horizontal table, string over a pulley at the edge to B (mass m) hanging.
    Positive direction: A toward the pulley, B down."""
    M, m, g = _pos('M m g')
    mu_s, mu_k = _nonneg('mu_s mu_k')
    a, T, N, f = _real('a T N_A f')
    givens = {M: 4, m: 1, g: G, mu_s: mu_s_value, mu_k: mu_k_value}

    # Stick hypothesis: a = 0, so T = m g and static friction f on A (pointing away from the pulley)
    # balances T. It holds iff f <= mu_s N.
    stick = solve_unique([Eq(T, m * g), Eq(N, M * g), Eq(0, T - f)], [T, N, f])
    if bool((stick[f] - mu_s * stick[N]).subs(givens) <= 0):
        return Scene(scene_id, givens, (
            Quantity('a', sp.Integer(0), '0', 'A stays at rest: static friction holds'),
            Quantity('T', stick[T], 'm*g', 'string tension'),
            Quantity('N', stick[N], 'M*g', 'normal force on A'),
            Quantity('F_fr', stick[f], 'm*g',
                     'static friction on A, magnitude: it balances T and is NOT mu_s*N'),
            Quantity('F_fr_limit', mu_s * stick[N], 'mu_s*M*g', 'static friction limit mu_s*N'),
        ))

    # Slip toward the pulley: kinetic friction mu_k N on A opposes the motion.
    s = solve_unique([Eq(M * a, T - mu_k * N), Eq(N, M * g), Eq(m * a, m * g - T)], [a, T, N])
    require(s[a].subs(givens) > 0, f'{scene_id}: the slip direction must match the acceleration')
    quantities = [
        Quantity('a', s[a], '(m - mu_k*M)*g/(M + m)', 'acceleration of each block, B moving down'),
        Quantity('T', s[T], 'M*m*g*(1 + mu_k)/(M + m)', 'string tension'),
        Quantity('N', s[N], 'M*g', 'normal force on A'),
    ]
    if mu_k_value:
        quantities.append(Quantity('F_fr', mu_k * s[N], 'mu_k*M*g',
                                   'kinetic friction on A, magnitude (it points away from the pulley)'))
    return Scene(scene_id, givens, tuple(quantities))


def t02a_table_frictionless() -> Scene:
    return _table_with_hanging_mass('t02a_table_frictionless', 0, 0)


def t02b_table_kinetic() -> Scene:
    return _table_with_hanging_mass('t02b_table_kinetic', R(1, 5), R(1, 5))


def t02c_table_static() -> Scene:
    return _table_with_hanging_mass('t02c_table_static', R(3, 10), R(3, 10))


def t03_load_hits_floor() -> Scene:
    """As t02, with B starting h above the floor. Phase 1: both move. B hits the floor (restitution
    e), the string goes slack, and A slides to a stop on friction alone."""
    M, m, g, h, t = _pos('M m g h t')
    mu_s, mu_k, e = _nonneg('mu_s mu_k e')
    a, T, N = _real('a T N_A')
    givens = {M: 4, m: 2, g: G, h: R(1, 2), mu_s: R(1, 5), mu_k: R(1, 5), e: 0}

    # Phase 1. Holding A would need static friction m g > mu_s M g, so A slips toward the pulley.
    require((m * g - mu_s * M * g).subs(givens) > 0, 't03: A must start slipping')
    p1 = solve_unique([Eq(M * a, T - mu_k * N), Eq(N, M * g), Eq(m * a, m * g - T)], [a, T, N])
    a1 = p1[a]
    t_hit = positive_root(Eq(h, a1 * t**2 / 2), t, givens)
    v_hit = a1 * t_hit

    # Impact: B's normal velocity reverses and scales by e. Hypothesis: zero string impulse. Then A
    # keeps v_hit toward the pulley and B moves up at e*v_hit, so the string's gap g = L0 - L opens
    # at rate v_A,toward pulley - v_B,down = v_hit (1 + e) > 0. A string can only pull, so a zero
    # impulse with an opening gap is the consistent (complementary) outcome: the string goes slack.
    require((v_hit * (1 + e)).subs(givens) > 0, 't03: the string must go slack at the impact')

    # Phase 2 (e = 0: B rests on the floor). T = 0; kinetic friction alone decelerates A. The gap
    # keeps opening while A moves, so the string stays slack.
    a2 = solve_unique([Eq(M * a, -mu_k * N), Eq(N, M * g)], [a, N])[a]
    tau = positive_root(Eq(v_hit + a2 * t, 0), t, givens)
    slide = v_hit * tau + a2 * tau**2 / 2
    # Once stopped, no horizontal force acts on A: static friction 0 <= mu_s N holds, A stays.

    k = '(1 + (m - mu_k*M)/(mu_k*(M + m)))'
    return Scene('t03_load_hits_floor', givens, (
        Quantity('a', a1, '(m - mu_k*M)*g/(M + m)', 'acceleration before the impact, B moving down'),
        Quantity('T1', p1[T], 'M*m*g*(1 + mu_k)/(M + m)', 'string tension before the impact'),
        Quantity('t_impact', t_hit, 'sqrt(2*h*(M + m)/((m - mu_k*M)*g))', 'time B hits the floor'),
        Quantity('v_impact', v_hit, 'sqrt(2*g*h*(m - mu_k*M)/(M + m))', 'speed of B (and A) at the impact'),
        Quantity('a2', a2, '-mu_k*g', 'acceleration of A along its motion after the impact'),
        Quantity('T2', sp.Integer(0), '0', 'string tension after the impact: the string is slack'),
        Quantity('t_stop', t_hit + tau, f'sqrt(2*h*(M + m)/((m - mu_k*M)*g))*{k}', 'time A stops'),
        Quantity('path_A', h + slide, f'h*{k}', 'total distance A travels'),
    ))


def t14_two_strings() -> Scene:
    m, g, alpha, beta = _pos('m g alpha beta')
    T1, T2 = _real('T1 T2')
    givens = {m: 2, g: G, alpha: sp.pi / 6, beta: sp.pi / 3}
    # Equilibrium of the hanging body. String 1 pulls up-left at alpha above the horizontal,
    # string 2 up-right at beta.
    s = solve_unique([Eq(T2 * sp.cos(beta) - T1 * sp.cos(alpha), 0),
                      Eq(T1 * sp.sin(alpha) + T2 * sp.sin(beta) - m * g, 0)], [T1, T2])
    require(s[T1].subs(givens) > 0 and s[T2].subs(givens) > 0, 't14: both strings must be taut')
    return Scene('t14_two_strings', givens, (
        Quantity('T30', s[T1], 'm*g*cos(beta)/sin(alpha + beta)',
                 'tension in the string at 30 deg to the horizontal'),
        Quantity('T60', s[T2], 'm*g*cos(alpha)/sin(alpha + beta)',
                 'tension in the string at 60 deg to the horizontal'),
    ))


def t19c_bouncing_block() -> Scene:
    h, g, t, H = _pos('h g t H')
    e = sp.Symbol('e', nonnegative=True)
    k = sp.Symbol('k', integer=True, nonnegative=True)
    givens = {h: 1, g: G, e: R(4, 5)}
    # Free fall of the bottom face through h from rest, frictionless floor.
    t1 = positive_root(Eq(h, g * t**2 / 2), t, givens)
    v1 = g * t1
    # Newton's restitution law: each impact reverses the normal velocity and scales it by e, so the
    # k-th rebound starts at e^k v1 and its flight lasts 2 e^k v1 / g. The flights form a
    # geometric series that converges for e < 1: infinitely many impacts in finite time (Zeno).
    series = sp.summation(2 * e**k * v1 / g, (k, 1, sp.oo))
    if isinstance(series, sp.Piecewise):
        series, converges = series.args[0]
        require(converges.subs(givens), 't19c: the bounce series must converge')
    # Energy: the first rebound rises to H with m g H = m (e v1)^2 / 2.
    h1 = positive_root(Eq(g * H, (e * v1) ** 2 / 2), H, givens)
    return Scene('t19c_bouncing_block', givens, (
        Quantity('t_impact1', t1, 'sqrt(2*h/g)', 'time of the first impact'),
        Quantity('v_impact1', v1, 'sqrt(2*g*h)', 'speed just before the first impact'),
        Quantity('v_rebound1', e * v1, 'e*sqrt(2*g*h)', 'speed just after the first impact'),
        Quantity('h_bounce1', h1, 'e**2*h', 'height of the bottom face at the top of the first bounce'),
        Quantity('t_impact2', t1 + 2 * e * v1 / g, 'sqrt(2*h/g)*(1 + 2*e)', 'time of the second impact'),
        Quantity('t_rest', t1 + series, 'sqrt(2*h/g)*(1 + e)/(1 - e)',
                 'time the impacts accumulate and the block comes to rest; DESIGN 3.5 accepts the '
                 "engine's Zeno cutoff within 1e-6 s of this value"),
    ))


def x01_block_slides_to_stop() -> Scene:
    M, g, v0, t = _pos('M g v0 t')
    mu_s, mu_k = _nonneg('mu_s mu_k')
    a, N = _real('a N_A')
    givens = {M: 1, g: G, v0: 2, mu_s: R(1, 5), mu_k: R(1, 5)}
    # Sliding along +x (the direction of v0): kinetic friction opposes the motion.
    s = solve_unique([Eq(M * a, -mu_k * N), Eq(N, M * g)], [a, N])
    tau = positive_root(Eq(v0 + s[a] * t, 0), t, givens)
    # After the stop no horizontal force acts, so static friction 0 <= mu_s N holds: it stays.
    return Scene('x01_block_slides_to_stop', givens, (
        Quantity('a', s[a], '-mu_k*g', 'acceleration along v0 while sliding'),
        Quantity('F_fr', -mu_k * s[N], '-mu_k*M*g', 'kinetic friction, signed along v0'),
        Quantity('N', s[N], 'M*g', 'normal force'),
        Quantity('t_stop', tau, 'v0/(mu_k*g)', 'time the block stops (and sticks)'),
        Quantity('s_stop', v0 * tau + s[a] * tau**2 / 2, 'v0**2/(2*mu_k*g)',
                 'path length until the stop'),
    ))


def _pushed_block(scene_id: str, force) -> Scene:
    """Block at rest on the floor, pushed by a constant horizontal force F along +x."""
    M, g, F = _pos('M g F')
    mu_s, mu_k = _nonneg('mu_s mu_k')
    a, N, f = _real('a N_A f')
    givens = {M: 1, g: G, F: force, mu_s: R(1, 5), mu_k: R(1, 10)}
    # Stick hypothesis: a = 0 and static friction f (signed along +x) balances F; holds iff |f| <= mu_s N.
    stick = solve_unique([Eq(0, F + f), Eq(N, M * g)], [f, N])
    if bool((sp.Abs(stick[f]) - mu_s * stick[N]).subs(givens) <= 0):
        return Scene(scene_id, givens, (
            Quantity('a', sp.Integer(0), '0', 'the block stays at rest'),
            Quantity('F_fr', stick[f], '-F', 'static friction, signed along F'),
            Quantity('N', stick[N], 'M*g', 'normal force'),
            Quantity('F_fr_limit', mu_s * stick[N], 'mu_s*M*g', 'static friction limit mu_s*N'),
        ))
    # Slip along +F from t = 0 with kinetic friction opposing it.
    s = solve_unique([Eq(M * a, F - mu_k * N), Eq(N, M * g)], [a, N])
    require(s[a].subs(givens) > 0, f'{scene_id}: the slip direction must match the acceleration')
    return Scene(scene_id, givens, (
        Quantity('a', s[a], '(F - mu_k*M*g)/M', 'acceleration along F; it slips from t = 0'),
        Quantity('F_fr', -mu_k * s[N], '-mu_k*M*g', 'kinetic friction, signed along F'),
        Quantity('N', s[N], 'M*g', 'normal force'),
    ))


def x02a_force_below_static() -> Scene:
    return _pushed_block('x02a_force_below_static', R(3, 2))


def x02b_force_above_static() -> Scene:
    return _pushed_block('x02b_force_above_static', R(5, 2))


def x03_whirl_slack() -> Scene:
    """Small block on a string of length L from a fixed point, given v0 horizontally at the bottom.
    phi is the string's angle from the downward vertical; the block is at height L(1 - cos phi)."""
    L, v0, g, m = _pos('L v0 g m')
    c, T, w = _real('c T w')  # c = cos(phi), w = v^2
    phi = sp.Symbol('phi', real=True)
    givens = {L: 1, v0: 6, g: G}  # m is not given: it must cancel
    # Energy: m w / 2 = m v0^2 / 2 - m g L (1 - c).
    v2 = solve_unique([Eq(m * w / 2, m * v0**2 / 2 - m * g * L * (1 - c))], [w])[w]
    # Radial Newton's law toward the pivot. Gravity's component toward the pivot is -m g cos(phi):
    # T - m g c = m w / L. The string goes slack where T = 0.
    tension = solve_unique([Eq(T - m * g * c, m * v2 / L)], [T])[T]
    c_slack = solve_unique([Eq(tension, 0)], [c])[c]
    require(-1 < c_slack.subs(givens) < 0, 'x03: slack must happen above the horizontal, below the top')
    # Time from the bottom: dphi/dt = v / L, and v stays > 0 up to the slack point.
    t_slack = sp.Integral(L / sp.sqrt(v2.subs(c, sp.cos(phi))), (phi, 0, sp.acos(c_slack)))
    return Scene('x03_whirl_slack', givens, (
        Quantity('cos_phi_slack', c_slack, '(2*g*L - v0**2)/(3*g*L)',
                 'cos of the angle from the downward vertical where the string goes slack', ODE),
        Quantity('v_slack', sp.sqrt(v2.subs(c, c_slack)), 'sqrt((v0**2 - 2*g*L)/3)',
                 'speed when the string goes slack', ODE),
        Quantity('h_slack', L * (1 - c_slack), 'L + (v0**2 - 2*g*L)/(3*g)',
                 'height above the bottom point when the string goes slack', ODE),
        Quantity('t_slack', t_slack,
                 'Integral(L/sqrt(v0**2 - 2*g*L*(1 - cos(phi))), (phi, 0, acos((2*g*L - v0**2)/(3*g*L))))',
                 'time from the start until the string goes slack', ODE),
    ))


def x04_slides_off_table() -> Scene:
    """Frictionless table top H above the floor; the block slides at v0 toward the edge and falls
    once its trailing edge has passed the edge (rotation locked). Times are from that moment."""
    H, v0, g, t = _pos('H v0 g t')
    e = sp.Symbol('e', nonnegative=True)
    givens = {H: R(4, 5), v0: 2, g: G, e: 0}
    # Projectile: horizontal velocity v0, vertical velocity 0 at the edge; the bottom falls H.
    t_fall = positive_root(Eq(H, g * t**2 / 2), t, givens)
    vy = -g * t_fall
    # Frictionless impact with restitution e: v_x is kept, v_y becomes -e v_y.
    speed_after = sp.sqrt(v0**2 + (e * vy) ** 2)
    return Scene('x04_slides_off_table', givens, (
        Quantity('t_fall', t_fall, 'sqrt(2*H/g)', 'free-fall time from leaving the edge to the floor'),
        Quantity('dx_fall', v0 * t_fall, 'v0*sqrt(2*H/g)', 'horizontal distance flown'),
        Quantity('vy_landing', vy, '-sqrt(2*g*H)', 'vertical velocity just before landing (y up)'),
        Quantity('v_after_landing', speed_after, 'v0',
                 'speed along the floor after landing: e = 0 and the floor is frictionless'),
    ))


SCENES = (
    t01_atwood,
    t02a_table_frictionless,
    t02b_table_kinetic,
    t02c_table_static,
    t03_load_hits_floor,
    t14_two_strings,
    t19c_bouncing_block,
    x01_block_slides_to_stop,
    x02a_force_below_static,
    x02b_force_above_static,
    x03_whirl_slack,
    x04_slides_off_table,
)
