import { describe, expect, it } from "vitest";
import { aplicarGlosario, contieneTermino, evaluarGlosario, type TerminoGlosario } from "./glosario";

const glosario: TerminoGlosario[] = [
  { original: "Nexo", traduccion: "", nota: "marca", variantes: "Nexus, Next" },
  { original: "cuenta de cobro", traduccion: "invoice", nota: "", variantes: "collection account" },
];

describe("glosario", () => {
  it("compara sin tildes ni mayúsculas y por palabra completa", () => {
    expect(contieneTermino("La GESTIÓN anual", "gestion")).toBe(true);
    expect(contieneTermino("Nexotech", "Nexo")).toBe(false);
  });

  it("corrige variantes conocidas en los subtítulos", () => {
    expect(aplicarGlosario("Nexus sent the collection account.", glosario)).toBe("Nexo sent the invoice.");
  });

  it("corrige un término que el modelo dejó sin traducir", () => {
    expect(aplicarGlosario("Send the cuenta de cobro today", glosario)).toBe("Send the invoice today");
  });

  it("evalúa solo los términos que aparecen en el original", () => {
    expect(evaluarGlosario("Nexo mandó la cuenta de cobro", "Nexus sent the invoice", glosario)).toEqual([
      { termino: "Nexo", esperado: "Nexo", correcto: false },
      { termino: "cuenta de cobro", esperado: "invoice", correcto: true },
    ]);
  });
});
