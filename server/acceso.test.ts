import { describe, expect, it } from "vitest";
import { codigoValido, LimitePorIp } from "./acceso";

describe("acceso", () => {
  it("sin código configurado no exige nada; con código, solo el exacto", () => {
    expect(codigoValido("", undefined)).toBe(true);
    expect(codigoValido("abc123", "abc123")).toBe(true);
    expect(codigoValido("abc123", "abc12")).toBe(false);
    expect(codigoValido("abc123", undefined)).toBe(false);
  });

  it("limita los pedidos por IP dentro de la ventana", () => {
    let t = 0;
    const limite = new LimitePorIp(2, 60000, () => t);
    expect([limite.permitir("a"), limite.permitir("a"), limite.permitir("a")]).toEqual([true, true, false]);
    expect(limite.permitir("b")).toBe(true);
    t = 60000;
    expect(limite.permitir("a")).toBe(true);
  });
});
