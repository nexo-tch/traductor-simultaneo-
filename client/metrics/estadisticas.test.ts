import { describe, expect, it } from "vitest";
import { formatoSegundos, percentil, resumir } from "./estadisticas";

describe("estadísticas", () => {
  it("calcula percentiles con interpolación", () => {
    expect(percentil([], 50)).toBeNull();
    expect(percentil([1000], 95)).toBe(1000);
    expect(percentil([400, 100, 300, 200], 50)).toBe(250);
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], 95)).toBe(20);
  });

  it("resume y formatea", () => {
    expect(resumir([900, 1100])).toEqual({ n: 2, ultimo: 1100, p50: 1000, p95: 1090 });
    expect(formatoSegundos(900, true)).toBe("+0.9 s");
    expect(formatoSegundos(-300, true)).toBe("−0.3 s");
    expect(formatoSegundos(null)).toBe("—");
  });
});
