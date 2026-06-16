import { describe, it, expect } from "vitest";
import {
  forecastMove,
  renderForecast,
  brierScore,
  reliabilityCurve,
  calibrationReport,
  type CalibrationPair,
} from "../../server/services/autopilot/forecast";

describe("autopilot forecast — honest, history-grounded prediction", () => {
  it("HONESTY: no track record ⇒ 0.5 prior at 'none' confidence, and says so", () => {
    const f = forecastMove({ successes: 0, failures: 0 });
    expect(f.successProb).toBe(0.5);
    expect(f.confidence).toBe("none");
    expect(f.n).toBe(0);
    expect(renderForecast(f)).toMatch(/no track record|first try/i);
    expect(renderForecast(f)).not.toMatch(/\d+%/); // never quotes a fake percentage
  });

  it("Laplace-smooths the real rate and scales confidence with evidence", () => {
    expect(forecastMove({ successes: 1, failures: 0 }).confidence).toBe("low");
    expect(forecastMove({ successes: 5, failures: 2 }).confidence).toBe("medium");
    const strong = forecastMove({ successes: 18, failures: 2 });
    expect(strong.confidence).toBe("high");
    expect(strong.successProb).toBeCloseTo(19 / 22, 5);
  });

  it("reports the typical (median) cost from history when available", () => {
    expect(forecastMove({ successes: 3, failures: 1, costSamplesUsd: [1, 5, 3] }).medianCostUsd).toBe(3);
    expect(forecastMove({ successes: 3, failures: 1 }).medianCostUsd).toBeNull();
  });

  it("renderForecast quotes the real n + rounded rate at decent evidence", () => {
    const line = renderForecast(forecastMove({ successes: 8, failures: 2, costSamplesUsd: [2, 4] }));
    expect(line).toMatch(/based on 10 similar past runs/i);
    expect(line).toMatch(/~75% have gone well/);
    expect(line).toMatch(/\$3\.00/);
  });
});

describe("autopilot calibration — does the system's confidence match reality?", () => {
  const pairs = (specs: Array<[number, 0 | 1]>): CalibrationPair[] => specs.map(([predicted, actual]) => ({ predicted, actual }));

  it("brierScore is null on no data, 0 for perfect prediction, higher when wrong", () => {
    expect(brierScore([])).toBeNull();
    expect(brierScore(pairs([[1, 1], [0, 0]]))).toBe(0);
    expect(brierScore(pairs([[1, 0], [0, 1]]))).toBe(1); // maximally wrong
  });

  it("flags OVER-CONFIDENCE specifically (predicts more than it delivers) — the safety direction", () => {
    // claims ~0.9 success but only delivers ~0.5 → over-confident
    const over = Array.from({ length: 20 }, (_, i) => ({ predicted: 0.9, actual: (i % 2) as 0 | 1 }));
    expect(calibrationReport(over).grade).toBe("over-confident");
  });

  it("a well-calibrated track record grades well", () => {
    // predictions match outcomes closely
    const good: CalibrationPair[] = [
      ...Array.from({ length: 10 }, () => ({ predicted: 0.9, actual: 1 as const })),
      ...Array.from({ length: 1 }, () => ({ predicted: 0.9, actual: 0 as const })),
      ...Array.from({ length: 9 }, () => ({ predicted: 0.1, actual: 0 as const })),
      ...Array.from({ length: 1 }, () => ({ predicted: 0.1, actual: 1 as const })),
    ];
    expect(calibrationReport(good).grade).toBe("well-calibrated");
  });

  it("stays 'unproven' below the minimum sample size (no premature claim)", () => {
    expect(calibrationReport(pairs([[0.8, 1], [0.8, 1]])).grade).toBe("unproven");
  });

  it("reliabilityCurve buckets predictions and reports actual rate per bucket", () => {
    const curve = reliabilityCurve(pairs([[0.05, 0], [0.95, 1], [0.92, 1]]), 5);
    expect(curve).toHaveLength(5);
    expect(curve[0].n).toBe(1); // the 0.05 prediction
    expect(curve[4].n).toBe(2); // the 0.95/0.92 predictions
    expect(curve[4].actualRate).toBe(1);
  });
});
