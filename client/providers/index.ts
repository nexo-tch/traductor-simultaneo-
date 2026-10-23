import { ProveedorOpenAI } from "./openai";
import type { ProveedorTraduccion } from "./tipos";

/** Proveedores disponibles en el selector (RF-12). Para agregar uno, implementa ProveedorTraduccion. */
export const PROVEEDORES: Record<string, { nombre: string; crear: () => ProveedorTraduccion }> = {
  openai: { nombre: "OpenAI gpt-realtime-translate", crear: () => new ProveedorOpenAI() },
};
