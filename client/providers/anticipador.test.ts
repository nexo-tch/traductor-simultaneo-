import { describe, expect, it } from "vitest";
import { Anticipador, prefijoEstable } from "./anticipador";

describe("prefijoEstable", () => {
  it("devuelve las palabras que no cambiaron, sin la última", () => {
    // "to" ya va seguida de otra palabra y no cambió: es estable. "fix" queda pendiente.
    expect(prefijoEstable(" I'm trying to", " I'm trying to fix")).toBe(" I'm trying to");
    expect(prefijoEstable(" I'm trying to fix", " I'm trying to fix")).toBe(" I'm trying to");
    expect(prefijoEstable(" the subscrip", " the subscription")).toBe(" the");
    expect(prefijoEstable("", " Well")).toBe("");
  });
});

describe("Anticipador", () => {
  it("dice lo estable antes de la confirmación y no lo repite al confirmarse", () => {
    const a = new Anticipador();
    expect(a.actualizar("", " Well, today")).toBe("");
    expect(a.actualizar("", " Well, today I'm")).toBe(" Well, today");
    expect(a.actualizar("", " Well, today I'm trying to")).toBe(" I'm");
    // Se confirma una parte; la cola provisional sigue
    expect(a.actualizar(" Well, today I'm trying", " to fix")).toBe(" trying");
    expect(a.actualizar("", " to fix one")).toBe(" to fix");
    // Se confirma todo: lo que faltaba se dice y se reinicia
    expect(a.actualizar(" to fix one of the bugs.", "")).toBe(" one of the bugs.");
    expect(a.correcciones).toBe(0);
  });

  it("si se corrige algo ya dicho, sigue desde lo último dicho sin repetir", () => {
    const a = new Anticipador();
    a.actualizar("", " what the system is doing is splitting");
    expect(a.actualizar("", " what the system is doing is splitting that")).toBe(" what the system is doing is splitting");
    // Soniox corrige "splitting" por "prorating": "splitting" ya se dijo
    expect(a.actualizar(" what the system is doing is prorating that subscription.", "")).toBe(" that subscription.");
    expect(a.correcciones).toBe(1);
  });

  it("no cuenta como corrección un cambio solo de mayúsculas o puntuación", () => {
    const a = new Anticipador();
    a.actualizar("", " when it shouldn't what");
    expect(a.actualizar("", " when it shouldn't what should")).toBe(" when it shouldn't what");
    expect(a.actualizar(" When it shouldn't, what should happen", "")).toBe(" should happen");
    expect(a.correcciones).toBe(0);
  });
});
