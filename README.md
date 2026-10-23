# Traductor simultáneo ES ↔ EN: probador de fluidez (Fase 1)

Página local para validar si la traducción simultánea español ↔ inglés es lo bastante rápida y fluida para usarla en reuniones. Hablas al micrófono (o cargas un audio de prueba), ves lo que dijiste con la traducción debajo, escuchas la voz traducida en tus audífonos y la página mide la latencia de cada fragmento.

La especificación completa está en [`SPEC.md`](SPEC.md). Proveedor actual: **OpenAI `gpt-realtime-translate`** por WebRTC.

## Instalación (menos de 10 minutos)

Necesitas Node.js 20 o superior, Google Chrome, audífonos y una API key de OpenAI con saldo (con $5–10 alcanza para todas las pruebas).

```bash
git clone https://github.com/nexo-tch/traductor-simultaneo-.git
cd traductor-simultaneo-
npm install
cp .env.example .env        # en Windows: copy .env.example .env
```

Abre `.env` y pega tu key después de `OPENAI_API_KEY=`. La key se queda en tu computador: el navegador nunca la ve; solo recibe un token temporal.

```bash
npm run dev
```

Abre <http://localhost:5173> en Chrome, conecta los audífonos y pulsa **Empezar**. La primera vez Chrome pide permiso para usar el micrófono.

## Uso

| Control | Qué hace |
| --- | --- |
| **Empezar / Detener** | Abre el micrófono y conecta con el proveedor. |
| **Dirección** | Español → Inglés o Inglés → Español. |
| **Voz traducida: encendida/apagada** | Corta la voz al instante; los subtítulos siguen. |
| **Barra espaciadora** (mantener) | Silencia la voz mientras la mantienes presionada (fuera de campos de texto). |
| **Volumen de la voz** | Volumen de la voz traducida. |
| **Fuente → Audio de prueba** | Procesa un WAV/MP3 como si fuera el micrófono, para comparar con exactamente el mismo audio. |
| **Vista** | Original + traducción, solo traducción o solo original. |
| **Glosario** | Términos del negocio (ver más abajo). |
| **Exportar JSON / CSV** | Descarga la sesión con textos, marcas de tiempo, latencias y aciertos del glosario. |
| **Ajustes** | Nombre de quien habla, sensibilidad del detector de voz, silencio que cierra un fragmento, salto de voz atrasada. |

### Cómo leer las métricas

Para cada fragmento se mide desde que **termina de pronunciarse** hasta que pasa algo con su traducción:

- **Latencia de voz** (la principal, la que muestran *Último*, *p50* y *p95*): hasta que **empieza a sonar** la traducción. Puede salir **negativa**: el modelo es simultáneo y a veces empieza a traducir una frase larga antes de que termine.
- **Latencia de texto**: hasta el primer texto traducido.
- **Termina de sonar**: hasta que la traducción del fragmento termina de sonar. Pasa el mouse sobre la latencia de una entrada para verla.
- **Retraso**: cuánto lleva esperando el fragmento más antiguo cuya traducción no ha terminado. Si pasa del umbral de *Ajustes* (5 s por defecto), la voz se salta hasta alcanzar lo más reciente; los subtítulos conservan todo.

Los colores del medidor siguen la meta del spec: ámbar por encima de 1.5 s y rojo por encima de 2.5 s.

Un fragmento marcado con **fin aproximado** (en el JSON, `fin_aproximado: true`) se cortó por puntuación mientras seguías hablando sin pausa. Ahí el fin del habla es la llegada del texto, que llega unos cientos de ms tarde, así que la latencia real es algo mayor que la medida.

### Glosario

`gpt-realtime-translate` **no acepta glosario ni instrucciones** (lo dice la guía oficial). Por eso el glosario se usa para dos cosas:

1. **Medir**: para cada término que aparece en el original, revisa si la traducción del modelo trae la forma esperada. El porcentaje sale en el panel del glosario y en el resumen del JSON. Es el criterio del 90%.
2. **Corregir los subtítulos**: en *Variantes a corregir* pones las formas erróneas que ves (por ejemplo `Nexus`), y en pantalla se reemplazan por la forma correcta. **La voz no se corrige.**

*Traducción deseada* vacía significa "no traducir". El glosario se guarda en el navegador; *Guardar archivo* y *Cargar archivo* lo llevan a un JSON.

### Plan de pruebas (SPEC.md, 11.2)

1. **Grabaciones de referencia**: guarda 3–5 audios de 1–2 minutos en `test-audio/`; esa carpeta no se sube al repositorio.
2. **Audio de prueba**: elige *Fuente → Audio de prueba*, carga el archivo, pulsa *Empezar* y exporta al final.
3. **En vivo**: habla 5 minutos seguidos y revisa p50, p95 y que el *Retraso* no pase de 5 s.
4. **En Meet**: en la reunión, *Presentar → Una pestaña*, elige esta pestaña y deja activado **Compartir audio de la pestaña**. Tu colega oye la voz traducida y ve los subtítulos.
5. **Glosario**: carga los 10–20 términos, lee un texto que los use todos y revisa el porcentaje.

## Comandos

| Comando | Para qué |
| --- | --- |
| `npm run dev` | Servidor local con recarga automática (lo normal). |
| `npm test` | Pruebas unitarias (fragmentos, métricas, glosario). |
| `npm run typecheck` | Revisión de tipos. |
| `npm run build` y `npm start` | Versión compilada, sin recarga automática. |

## Estructura

```
server/          servidor local: guarda la key, emite tokens efímeros, sirve la página
client/
  providers/     interfaz común (tipos.ts) y un adaptador por proveedor (openai.ts)
  audio/         micrófono o archivo, detector de voz, reproducción de la voz traducida
  metrics/       registro de fragmentos y marcas de tiempo, p50/p95, exportación
  glosario/      lógica del glosario (corrección y medición)
  ui/            panel bilingüe y panel del glosario
  main.ts        une todo
test-audio/      grabaciones de referencia (no se suben)
```

Para agregar un proveedor, implementa `ProveedorTraduccion` (`client/providers/tipos.ts`) y regístralo en `client/providers/index.ts`; aparece solo en el selector.

## Decisiones

Desviaciones de `SPEC.md` y su motivo:

1. **El glosario solo corrige subtítulos y mide aciertos** (RF-08). El modelo no acepta glosario, instrucciones ni guías de pronunciación. Si los nombres de clientes fallan mucho, la alternativa es un segundo proveedor que sí lo acepte (paso 10 del spec).
2. **WebRTC directo, sin acelerar la voz** (RF-14, 8.3). Con WebRTC la voz llega como pista en vivo y no hay cola que se pueda acelerar. El "descarte" de la 8.3 se hace silenciando la voz hasta que la traducción alcanza lo más reciente. Si las pruebas muestran que el retraso sí se acumula, la opción es recibir el audio por WebSocket a través del servidor, a cambio de un salto extra de red.
3. **Los fragmentos los arma la app** (`client/metrics/registro.ts`). El proveedor manda el texto como un flujo continuo, sin identificador de fragmento ni marcas de tiempo. Se corta por pausas (detector de voz local, configurable en *Ajustes*) y por puntuación, y la traducción se asigna en orden. Las latencias son aproximadas.
4. **El idioma de origen lo detecta el modelo.** El selector de dirección solo fija el idioma de destino. Si alguien habla en el idioma de destino, el modelo no lo traduce y la voz queda en silencio en ese tramo.
5. **La voz no se puede elegir**: el modelo imita el tono de quien habla.
6. **Métricas adicionales**: además de la latencia de voz del spec (que puede ser negativa en traducción simultánea), se registran la latencia de texto y cuándo termina de sonar cada fragmento.
7. **Columna extra en el glosario**: *Variantes a corregir*, para poder corregir los subtítulos.
8. **Express en vez de Fastify**, con Vite como middleware: un solo proceso y un solo comando (`npm run dev`).
9. **Reducción de ruido `near_field`** en la sesión de OpenAI (micrófono cerca de la boca), igual que en la guía oficial.
10. **El primer audio se mide sobre la pista recibida**, aunque la voz esté silenciada. Si apagas la voz, la métrica dice cuándo *habría* sonado.

Fuentes técnicas: [guía oficial de gpt-realtime-translate (OpenAI Cookbook)](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide) y su [demo de navegador](https://github.com/openai/openai-cookbook/tree/main/examples/voice_solutions/realtime_translation_guide/browser-translation-demo). Solo se usan los eventos documentados ahí (`session.input_transcript.delta`, `session.output_transcript.delta`, `error`); los demás se anotan una vez en la consola del navegador para revisarlos.

## Estado frente a los criterios de aceptación (SPEC.md, 11.3)

| Criterio | Estado |
| --- | --- |
| Requisitos **Debe** de la sección 4 | Implementados. RF-08 con la salvedad de la decisión 1. |
| Latencia p50 ≤ 1.5 s y p95 ≤ 2.5 s | **Pendiente**: requiere la prueba con key real. |
| 5 minutos seguidos sin que el retraso pase de 5 s | **Pendiente**: se mide con *Retraso* y `retrasoMaximoMs` en el JSON. |
| Interruptor de voz en menos de 150 ms | Silencia el elemento de audio de inmediato. Falta confirmarlo de oído. |
| 90% de términos del glosario correctos | **Pendiente**: se mide en el panel del glosario. |
| El colega entiende la prueba en Meet | **Pendiente**. |
| La key no aparece en el navegador, el repositorio ni los logs | Cumplido: la key solo vive en `.env`, ignorado por git, y el servidor no la registra. |
| README para correrlo en menos de 10 minutos | Este documento. |
