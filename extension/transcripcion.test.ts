import { describe, expect, it } from "vitest";
import { Transcripcion } from "./transcripcion";

describe("Transcripcion", () => {
  it("separa por idioma y lleva la traducción a la entrada en el otro idioma", () => {
    const tr = new Transcripcion("es", () => 0);
    tr.original("Hi everyone,", "en", 0);
    tr.original(" let's start.", "en-US", 800);
    tr.traduccion("Hola a todos,");
    tr.original("Perfecto, empecemos.", "es", 1500);
    tr.traduccion(" empecemos.");

    expect(tr.entradas).toHaveLength(2);
    const [ingles, espanol] = tr.entradas;
    expect(ingles).toMatchObject({ idioma: "en", original: "Hi everyone, let's start.", traduccion: "Hola a todos, empecemos." });
    expect(espanol).toMatchObject({ idioma: "es", original: "Perfecto, empecemos.", traduccion: "" });
  });

  it("una pausa larga abre otra entrada aunque sea el mismo idioma", () => {
    const tr = new Transcripcion("es", () => 0);
    tr.original("First point.", "en", 0);
    tr.original(" Second point.", "en", 3000);
    expect(tr.entradas.map((e) => e.original)).toEqual(["First point.", "Second point."]);
  });

  it("entrega solo lo que cambió", () => {
    const tr = new Transcripcion("en", () => 0);
    tr.original("Hola", "es", 0);
    expect(tr.tomarCambios()).toHaveLength(1);
    expect(tr.tomarCambios()).toHaveLength(0);
    tr.traduccion("Hello");
    expect(tr.tomarCambios()[0].traduccion).toBe("Hello");
  });
});
