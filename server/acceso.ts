// Protección del servidor cuando se publica en internet: código de acceso, límite de
// pedidos por IP y CORS solo para la extensión de Chrome. En local (sin CODIGO_ACCESO)
// no cambia nada.
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Compara en tiempo constante, para no filtrar el código por cuánto tarda la respuesta. */
export function codigoValido(esperado: string, recibido: unknown): boolean {
  if (!esperado) return true;
  if (typeof recibido !== "string") return false;
  const a = Buffer.from(esperado);
  const b = Buffer.from(recibido);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function exigirCodigo(esperado: string) {
  return (req: Request, res: Response, siguiente: NextFunction) => {
    if (codigoValido(esperado, req.get("x-codigo-acceso"))) return siguiente();
    res.status(401).json({
      codigo: "codigo_invalido",
      mensaje: "Código de acceso incorrecto. Revísalo en el panel, en Conexión.",
    });
  };
}

/** Ventana fija por IP: pocos pedidos de sesión por minuto bastan para un uso normal. */
export class LimitePorIp {
  private readonly cuentas = new Map<string, { inicio: number; n: number }>();

  constructor(
    private readonly maximo: number,
    private readonly ventanaMs: number,
    private readonly reloj: () => number = Date.now,
  ) {}

  permitir(ip: string): boolean {
    const ahora = this.reloj();
    const c = this.cuentas.get(ip);
    if (!c || ahora - c.inicio >= this.ventanaMs) {
      this.cuentas.set(ip, { inicio: ahora, n: 1 });
      if (this.cuentas.size > 10000) this.limpiar(ahora);
      return true;
    }
    c.n += 1;
    return c.n <= this.maximo;
  }

  private limpiar(ahora: number): void {
    for (const [ip, c] of this.cuentas) if (ahora - c.inicio >= this.ventanaMs) this.cuentas.delete(ip);
  }
}

export function limitar(limite: LimitePorIp) {
  return (req: Request, res: Response, siguiente: NextFunction) => {
    if (limite.permitir(req.ip ?? "")) return siguiente();
    res.status(429).json({ codigo: "limite_uso", mensaje: "Demasiados intentos. Espera un minuto." });
  };
}

/** La extensión pide los tokens desde chrome-extension://…; ningún otro sitio puede. */
export function corsExtension(req: Request, res: Response, siguiente: NextFunction) {
  const origen = req.get("origin");
  if (origen?.startsWith("chrome-extension://")) {
    res.set("Access-Control-Allow-Origin", origen);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Codigo-Acceso");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
  }
  siguiente();
}
