// Prefijo estable (SPEC.md 8.2): decide qué parte de la traducción se puede
// decir antes de que el proveedor la confirme.
//
// Se dice lo confirmado más las palabras provisionales que no cambiaron entre
// dos actualizaciones seguidas, dejando siempre pendiente la última (puede
// estar a medio reconocer). Si después el proveedor corrige algo que ya se
// dijo, no se puede borrar: se busca dónde quedó lo último dicho y se sigue
// desde ahí, sin repetir.

/** Palabras con su espacio inicial, tal como las manda el proveedor (" the", " bug"). */
function palabras(texto: string): string[] {
  return texto.match(/\s*\S+/g) ?? [];
}

/** Para comparar: sin mayúsculas, puntuación ni espacios. */
function normal(palabra: string): string {
  return palabra.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/** Palabras iniciales que no cambiaron entre dos versiones del texto provisional, sin la última. */
export function prefijoEstable(anterior: string, actual: string): string {
  const a = palabras(anterior);
  const b = palabras(actual);
  let iguales = 0;
  while (iguales < a.length && iguales < b.length && a[iguales] === b[iguales]) iguales++;
  return b.slice(0, Math.min(iguales, b.length - 1)).join("");
}

export class Anticipador {
  private confirmado = "";
  private provisionalAnterior = "";
  /** Palabras ya enviadas a la voz, normalizadas. */
  private dicho: string[] = [];
  /** Veces que el proveedor corrigió algo que ya se había dicho. */
  correcciones = 0;
  /** Detalle de la última corrección, para diagnóstico. */
  ultimaCorreccion = "";

  /** Recibe lo nuevo confirmado y la cola provisional actual; devuelve el texto que ya se puede decir. */
  actualizar(confirmadoNuevo: string, provisional: string): string {
    this.confirmado += confirmadoNuevo;
    const estable = this.confirmado + prefijoEstable(this.provisionalAnterior, provisional);
    this.provisionalAnterior = provisional;
    const decir = this.avanzar(palabras(estable));
    // Sin nada pendiente, todo lo dicho está confirmado: se empieza de cero para no acumular texto.
    if (!provisional.trim()) this.reiniciar();
    return decir;
  }

  reiniciar(): void {
    this.confirmado = "";
    this.provisionalAnterior = "";
    this.dicho = [];
  }

  private avanzar(estable: string[]): string {
    const n = this.dicho.length;
    const coincide = n <= estable.length && this.dicho.every((p, i) => p === normal(estable[i]));
    let desde = n;
    if (!coincide) {
      desde = this.realinear(estable);
      this.correcciones++;
      this.ultimaCorreccion = `dicho: «${this.dicho.join(" ")}» · ahora: «${estable.join("").trim()}»`;
    }
    const nuevas = estable.slice(desde);
    this.dicho = estable.map(normal);
    if (desde > estable.length) this.dicho = this.dicho.slice(0, estable.length);
    return nuevas.join("");
  }

  /** Busca en el texto corregido dónde quedó lo último que se dijo, para seguir desde ahí. */
  private realinear(estable: string[]): number {
    const norm = estable.map(normal);
    for (let largo = Math.min(3, this.dicho.length); largo >= 1; largo--) {
      const cola = this.dicho.slice(-largo);
      for (let i = norm.length - largo; i >= 0; i--) {
        if (cola.every((p, j) => p === norm[i + j])) return i + largo;
      }
    }
    // Sin coincidencias: se sigue después de tantas palabras como ya se dijeron (puede saltar o repetir algo).
    return Math.min(this.dicho.length, estable.length);
  }
}
