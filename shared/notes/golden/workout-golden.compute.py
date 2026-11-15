#!/usr/bin/env python3
"""
The arithmetic record for the workout NPV golden case (Notes V2 Leg 2, spec §7.2
test 7). Computed INDEPENDENTLY of shared/notes/workoutEngine.ts: Python, exact
Decimal arithmetic, written from the stated conventions rather than from the
engine's code. Its output is workout-golden.expected.json; the engine must match
it to the cent (tests/unit/workoutEngine.test.ts).

Run:  python3 -I shared/notes/golden/workout-golden.compute.py > shared/notes/golden/workout-golden.expected.json

Conventions (identical to the engine's stated CONVENTIONS):
  period t = t months after as-of; interest = balance * rate/12, rounded to cent;
  discounted = net * (1 + d/12)^-t, rounded half away from zero; NPV = sum of
  rounded discounted lines.
"""
import json
from decimal import Decimal as D, getcontext, ROUND_HALF_UP

getcontext().prec = 50


def rnd(x):
    x = D(x)
    s = -1 if x < 0 else 1
    return int(s * abs(x).quantize(D(1), rounding=ROUND_HALF_UP))


def interest(bal, bps):
    return rnd(D(bal) * D(bps) / D(10000) / D(12))


def disc(net, bps, t):
    return rnd(D(net) / (D(1) + D(bps) / D(10000) / D(12)) ** t)


def amort_payment(p, bps, n):
    j = D(bps) / D(10000) / D(12)
    if j == 0:
        return rnd(D(p) / D(n))
    return rnd(D(p) * j / (D(1) - (D(1) + j) ** (-n)))


INPUTS = {
    "asOf": "2026-11-01",
    "discountRateBps": 1200,
    "note": {"upbCents": 1_000_000, "rateBps": 900, "paymentCents": 87_453, "remainingTermMonths": 12, "arrearsCents": 174_906},
    "collateralValueCents": 1_200_000,
    "servicingMonthlyCents": 2_500,
    "modification": {"rateBps": 600, "termMonths": 12, "arrearsTreatment": "capitalize", "principalForbearanceCents": 100_000, "principalReductionCents": 50_000},
    "forbearance": {"months": 3, "reducedPaymentCents": 30_000},
    "deedInLieu": {"timelineMonths": 3, "costs": [
        {"label": "DIL legal and title", "amountCents": 150_000, "timing": "upfront"},
        {"label": "Taxes and insurance", "amountCents": 10_000, "timing": "monthly"},
    ]},
    "foreclosure": {"timelineMonths": 9, "costs": [
        {"label": "Attorney and filing", "amountCents": 400_000, "timing": "upfront"},
        {"label": "Carrying costs", "amountCents": 15_000, "timing": "monthly"},
        {"label": "Sale costs", "amountCents": 72_000, "timing": "at_resolution"},
    ]},
    "chargeOffHold": {"recoveryCents": 300_000, "horizonMonths": 6, "costs": []},
}
d = INPUTS["discountRateBps"]


def stream(bal, bps, n, pay_for, servicing, at_last=None):
    """Per-period net flows: borrower pays pay_for(t); full balance due at n."""
    nets = {}
    for t in range(1, n + 1):
        i = interest(bal, bps)
        due = bal + i
        pay = due if t == n else min(pay_for(t), due)
        bal -= pay - i
        net = pay - servicing
        if t == n and at_last:
            net += at_last
        nets[t] = nets.get(t, 0) + net
        if t != n and bal <= 0:
            if at_last:
                nets[n] = nets.get(n, 0) + at_last
            break
    return nets


def npv(nets):
    lines = {t: disc(v, d, t) for t, v in sorted(nets.items())}
    return sum(lines.values()), lines


def add(nets, t, v):
    nets[t] = nets.get(t, 0) + v


n = INPUTS["note"]
out = {}

# 1. hold / perform
h = stream(n["upbCents"], n["rateBps"], n["remainingTermMonths"], lambda t: n["paymentCents"], INPUTS["servicingMonthlyCents"])
add(h, 1, n["arrearsCents"])
out["hold_perform"] = npv(h)

# 2. modification: capitalize arrears, carve out forbearance + reduction
m = INPUTS["modification"]
bearing = n["upbCents"] + n["arrearsCents"] - m["principalForbearanceCents"] - m["principalReductionCents"]
mp = amort_payment(bearing, m["rateBps"], m["termMonths"])
mo = stream(bearing, m["rateBps"], m["termMonths"], lambda t: mp, INPUTS["servicingMonthlyCents"], at_last=m["principalForbearanceCents"])
out["modification"] = npv(mo)

# 3. forbearance: reduced payment for 3 periods, then recorded payment; arrears at period 4
f = INPUTS["forbearance"]
fb = stream(n["upbCents"], n["rateBps"], n["remainingTermMonths"],
            lambda t: f["reducedPaymentCents"] if t <= f["months"] else n["paymentCents"], INPUTS["servicingMonthlyCents"])
add(fb, f["months"] + 1, n["arrearsCents"])
out["forbearance"] = npv(fb)


def dispo(spec, value, T):
    nets = {}
    add(nets, T, value)
    for c in spec["costs"]:
        if c["timing"] == "upfront":
            add(nets, 1, -c["amountCents"])
        elif c["timing"] == "at_resolution":
            add(nets, T, -c["amountCents"])
        else:
            for t in range(1, T + 1):
                add(nets, t, -c["amountCents"])
    return nets


out["deed_in_lieu"] = npv(dispo(INPUTS["deedInLieu"], INPUTS["collateralValueCents"], INPUTS["deedInLieu"]["timelineMonths"]))
out["foreclosure"] = npv(dispo(INPUTS["foreclosure"], INPUTS["collateralValueCents"], INPUTS["foreclosure"]["timelineMonths"]))
c = INPUTS["chargeOffHold"]
out["charge_off_hold"] = npv(dispo(c, c["recoveryCents"], c["horizonMonths"]))

# Sensitivity spot checks (value x1.2 / timeline x1.25 on foreclosure; timeline x0.75 on DIL)
fc = INPUTS["foreclosure"]
sens = {
    "foreclosure_value1.2_timeline1.25": npv(dispo(fc, rnd(D(INPUTS["collateralValueCents"]) * D("1.2")), max(1, rnd(D(fc["timelineMonths"]) * D("1.25")))))[0],
    "deed_in_lieu_value0.8_timeline0.75": npv(dispo(INPUTS["deedInLieu"], rnd(D(INPUTS["collateralValueCents"]) * D("0.8")), max(1, rnd(D(INPUTS["deedInLieu"]["timelineMonths"]) * D("0.75")))))[0],
}

print(json.dumps({
    "inputs": INPUTS,
    "modifiedPaymentCents": mp,
    "npvCents": {k: v[0] for k, v in out.items()},
    "discountedLines": {k: {str(t): x for t, x in v[1].items()} for k, v in out.items()},
    "sensitivity": sens,
}, indent=2))
