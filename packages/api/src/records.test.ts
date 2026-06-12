import { describe, expect, it } from "vitest";
import { aggregateRollup } from "./records.js";

describe("aggregateRollup", () => {
  it("count is the value count, regardless of magnitudes", () => {
    expect(aggregateRollup("count", [5, 5, 5])).toBe(3);
    expect(aggregateRollup("count", [])).toBe(0);
  });

  it("sum / avg / min / max over numbers", () => {
    const nums = [2, 4, 9];
    expect(aggregateRollup("sum", nums)).toBe(15);
    expect(aggregateRollup("avg", nums)).toBe(5);
    expect(aggregateRollup("min", nums)).toBe(2);
    expect(aggregateRollup("max", nums)).toBe(9);
  });

  it("empty input is 0 for every numeric agg (no linked rows ⇒ 0, not NaN)", () => {
    for (const agg of ["sum", "avg", "min", "max"] as const) {
      expect(aggregateRollup(agg, [])).toBe(0);
    }
  });

  it("avg can be fractional", () => {
    expect(aggregateRollup("avg", [1, 2])).toBe(1.5);
  });
});
