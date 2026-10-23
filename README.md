# Traductor simultáneo ES ↔ EN: probador de fluidez (Fase 1)

Página local para validar si la traducción simultánea español ↔ inglés es lo bastante rápida y fluida para usarla en reuniones. Hablas al micrófono (o cargas un audio de prueba), ves lo que dijiste con la traducción debajo, escuchas la voz traducida en tus audífonos y la página mide la latencia de cada fragmento.

La especificación completa está en [`SPEC.md`](SPEC.md). Hay dos proveedores, que se eligen en el selector de la página:

| Proveedor | Cómo funciona | Glosario | Cuándo usarlo |
| --- | --- | --- | --- |
| **OpenAI `gpt-realtime-translate`** | Un solo modelo de voz a voz por WebRTC. Espera a tener la idea completa antes de hablar (en las pruebas, unos 3–5 s). | No lo acepta: solo corrige subtítulos. | Traducción más pulida; presentaciones largas. |
| **Soniox** (`stt-rt-v5` + `tts-rt-v2`) | Transcribe y traduce palabra por palabra; cada pedazo traducido se manda a la voz apenas se confirma. | Sí: se envía como términos de traducción. | Conversación más simultánea. |

## Instalación (menos de 10 minutos)

Necesitas Node.js 20 o superior, Google Chrome, audífonos y la API key de al menos un proveedor: OpenAI (con $5–10 de saldo alcanza para todas las pruebas) y/o Soniox.

```bash
git clone https://github.com/nexo-tch/traductor-simultaneo-.git
cd traductor-simultaneo-
npm install
cp .env.example .env        # en Windows: copy .env.example .env
```

Abre `.env` (en la Mac: `open -e .env`) y pega tus keys después de `OPENAI_API_KEY=` y/o `SONIOX_API_KEY=`. Las keys se quedan en tu computador: el navegador nunca las ve; solo recibe llaves temporales. `PROVIDER` elige el proveedor que aparece seleccionado al abrir la página.

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
| **Fuente → Audio de prueba** | Procesa un WAV, MP3, OGG (notas de voz de WhatsApp) o M4A como si fuera el micrófono, para comparar con exactamente el mismo audio. |
| **Vista** | Original + traducción, solo traducción o solo original. |
| **Glosario** | Términos del negocio (ver más abajo). |
| **Exportar JSON / CSV** | Descarga la sesión con textos, marcas de tiempo, latencias y aciertos del glosario. |
| **Ajustes** | Nombre de quien habla, sensibilidad del detector de voz, silencio que cierra un fragmento, salto de voz atrasada. |

### Cómo leer las métricas

Cada entrada del panel es una **intervención**: lo que dices hasta que haces una pausa de 1.5 s o más (ajustable en *Ajustes*). La traducción se asigna a la intervención hasta que la voz traducida se calla.

- **Retraso tras terminar de hablar** (la medida principal; *Último*, *p50* y *p95*): cuánto **sigue sonando** la traducción después de que terminas una intervención. Es lo que espera quien escucha antes de poder responder. Cada entrada lo muestra en pequeño (por ejemplo, "+2.4 s").
- Si vuelves a hablar antes de que termine la traducción, la entrada muestra "≥" y ese valor es solo un mínimo. Esas no entran en p50/p95; el JSON las cuenta aparte en `colasInterrumpidas`.
- **Arranque** (pasa el mouse sobre la latencia de una entrada): cuánto tarda la traducción en empezar a sonar desde que empiezas a hablar.
- **Ahora**: cuánto lleva sonando la traducción desde que te callaste. Si pasa del umbral de *Ajustes* (5 s por defecto), la voz se salta hasta alcanzarte; los subtítulos conservan todo. Mientras hablas vale 0, porque no se puede saber cuánto falta.

Los colores siguen la meta del spec: ámbar por encima de 1.5 s y rojo por encima de 2.5 s.

Las intervenciones de más de 30 s sin una pausa larga se cortan en la siguiente pausa corta. Esas no tienen retraso medible y en el JSON salen con `corte_forzado: true`.

### Glosario

Con **Soniox**, el glosario se envía al empezar como términos de traducción (`translation_terms`) y como palabras a reconocer (`terms`): corrige la voz y los subtítulos.

Con **OpenAI**, `gpt-realtime-translate` **no acepta glosario ni instrucciones** (lo dice la guía oficial).

Con los dos proveedores, el glosario además sirve para:

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

1. **Con OpenAI, el glosario solo corrige subtítulos y mide aciertos** (RF-08). El modelo no acepta glosario, instrucciones ni guías de pronunciación. Por eso, y porque espera de 3 a 5 s antes de hablar, se agregó Soniox como segundo proveedor (paso 10 del spec).
2. **WebRTC directo, sin acelerar la voz** (RF-14, 8.3). Con WebRTC la voz llega como pista en vivo y no hay cola que se pueda acelerar. El "descarte" de la 8.3 se hace silenciando la voz hasta que la traducción alcanza lo más reciente. Si las pruebas muestran que el retraso sí se acumula, la opción es recibir el audio por WebSocket a través del servidor, a cambio de un salto extra de red.
3. **La unidad es la intervención y la medida principal es el retraso tras terminar de hablar** (`client/metrics/registro.ts`). El proveedor manda el texto como un flujo continuo, sin identificador de fragmento, y la traducción va unos segundos detrás. En la primera prueba real, emparejar frases cortas con su traducción asignaba cada traducción a la frase siguiente, y la latencia del spec ("fin del fragmento → empieza a sonar su traducción") salía con valores negativos sin sentido. Por eso:
   - El panel agrupa por intervenciones (pausas de 1.5 s o más), donde el original y la traducción sí coinciden.
   - La medida principal es cuánto sigue sonando la traducción después de que la persona se calla. No depende de emparejar textos y es lo que espera quien escucha. Se compara con las mismas metas del spec (p50 ≤ 1.5 s, p95 ≤ 2.5 s).
   - El modelo a veces se calla a mitad de frase esperando contexto. Si la traducción no termina en punto, se espera un silencio de 2 s (en vez de 0.6 s) antes de darla por terminada.
4. **El idioma de origen lo detecta el modelo.** El selector de dirección solo fija el idioma de destino. Si alguien habla en el idioma de destino, el modelo no lo traduce y la voz queda en silencio en ese tramo.
5. **La voz no se puede elegir**: el modelo imita el tono de quien habla.
6. **Métrica adicional**: el *arranque* (inicio del habla → primer audio traducido). Las marcas de tiempo del spec (11.1) se exportan completas por intervención.
7. **Columna extra en el glosario**: *Variantes a corregir*, para poder corregir los subtítulos.
8. **Express en vez de Fastify**, con Vite como middleware: un solo proceso y un solo comando (`npm run dev`).
9. **Reducción de ruido `near_field`** en la sesión de OpenAI (micrófono cerca de la boca), igual que en la guía oficial.
10. **El primer audio se mide sobre la pista recibida**, aunque la voz esté silenciada. Si apagas la voz, la métrica dice cuándo *habría* sonado.

11. **Soniox va en dos piezas** (`client/providers/soniox.ts`): transcripción con traducción en streaming (`stt-rt-v5`, traducción `one_way`) y voz en streaming (`tts-rt-v2`). Detalles:
    - Las palabras traducidas que Soniox confirma se mandan a la voz apenas llegan. Cada frase es un stream de voz que se cierra en un punto final, cuando Soniox detecta el fin del habla, o tras 1.2 s sin texto nuevo.
    - El audio de la voz pasa por una cola propia (`client/audio/reproductor.ts`). Si la cola pasa de 2 s, las frases nuevas se generan a 1.2× (RF-14). Si pasa de 5 s, se descarta lo pendiente (8.3).
    - El audio del micrófono se manda en pedazos de 100 ms en WebM/Opus (lo que graba Chrome), sin convertir.
    - Se usa el SDK oficial `@soniox/client` 2.4.0 para no reimplementar su protocolo. Su web no era accesible al construirlo; la referencia fueron los tipos y ejemplos del SDK.
    - Voz por defecto: `Adrian` (la del ejemplo oficial). Se cambia en *Ajustes → Voz traducida* (la lista viene de Soniox) o con `SONIOX_VOICE` en `.env`.
    - *Ajustes → Voz traducida* controla la velocidad base (1.1× por defecto; se acelera un 15% extra si la voz se atrasa, hasta 1.3×), si se acortan las pausas entre palabras (`reduce_silence`), si el texto va a la voz por frases cortas (hasta una coma o 5 palabras, por defecto) o palabra por palabra, y los cortes de frase (abajo). Los cambios se guardan en el navegador.
    - **Cortes de frase y puntos falsos.** Con la detección de pausas de Soniox activada (`enable_endpoint_detection`), Soniox cierra una frase en cada micro-pausa y le pone punto, tanto al español como a la traducción. En una prueba real: *"con respecto a el. Modelo de suscripciones. Mi. Idea…"* → *"a solution that. Allows me to. Make…"*. Por eso viene apagada por defecto ("Solo en pausas largas"). Además:
      - La voz va en una sola frase continua mientras llega texto, y solo se cierra tras 1 s sin texto nuevo. Antes se cerraba en cada punto, y la voz bajaba la entonación y hacía una pausa a mitad de la idea.
      - Un punto al final de un pedazo se guarda. Si sigue llegando texto, se lee como coma; si no, se lee como punto. Los subtítulos muestran el texto tal como lo entrega Soniox.
      - Sin cortes por pausa, Soniox deja las últimas palabras sin confirmar hasta que se vuelve a hablar: en una prueba, el final del audio nunca se tradujo. Por eso, si la cola sin confirmar no cambia en 0.9 s, se le pide a Soniox que la confirme (`finalize`). Es más largo que las micro-pausas normales al hablar (0.25–0.85 s en las pruebas).
13. **Experimental: hablar antes de que Soniox confirme** (*Ajustes → Voz traducida*, apagado por defecto; `client/providers/anticipador.ts`). Soniox confirma el español en tandas cada 2–5 s, pero manda la traducción provisional palabra por palabra. Con esta opción se dice el *prefijo estable* (SPEC 8.2): lo confirmado más las palabras provisionales que no cambiaron entre dos actualizaciones seguidas, dejando pendiente la última. La voz arranca ~1 s después de cada palabra en vez de esperar la tanda. Si Soniox corrige una palabra ya dicha, no se puede borrar: la voz sigue desde lo último dicho sin repetir, y el JSON lo registra como `correccion_ya_dicha` en `eventos`.
14. **Original de fondo con *ducking*** (SPEC 8.1), solo en el modo audio de prueba: el original suena al volumen de *Ajustes* (45% por defecto) y baja al 40% de ese valor (~18%) mientras suena la traducción, con transiciones de 60 ms. Así se oye como lo oiría quien escucha la interpretación. Con micrófono no aplica: quien habla oye su propia voz.
12. **Texto provisional**: Soniox manda palabras sin confirmar que luego puede corregir. Se muestran en gris al final del texto confirmado, y no se exportan.

Fuentes técnicas: [guía oficial de gpt-realtime-translate (OpenAI Cookbook)](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide) y su [demo de navegador](https://github.com/openai/openai-cookbook/tree/main/examples/voice_solutions/realtime_translation_guide/browser-translation-demo). Solo se usan los eventos documentados ahí (`session.input_transcript.delta`, `session.output_transcript.delta`, `error`); los demás se anotan una vez en la consola del navegador para revisarlos.

## Estado frente a los criterios de aceptación (SPEC.md, 11.3)

| Criterio | Estado |
| --- | --- |
| Requisitos **Debe** de la sección 4 | Implementados. RF-08 con la salvedad de la decisión 1. |
| Latencia p50 ≤ 1.5 s y p95 ≤ 2.5 s | **Pendiente**. Primera prueba real (2.5 min, medida a mano): la traducción sigue sonando unos 3–3.5 s después de cada intervención. |
| 5 minutos seguidos sin que el retraso pase de 5 s | **Pendiente**. En la primera prueba el retraso no creció con el tiempo. Se mide con *Ahora* y `retrasoMaximoMs` en el JSON. |
| Interruptor de voz en menos de 150 ms | Silencia el elemento de audio de inmediato. Falta confirmarlo de oído. |
| 90% de términos del glosario correctos | **Pendiente**: se mide en el panel del glosario. |
| El colega entiende la prueba en Meet | **Pendiente**. |
| La key no aparece en el navegador, el repositorio ni los logs | Cumplido: la key solo vive en `.env`, ignorado por git, y el servidor no la registra. |
| README para correrlo en menos de 10 minutos | Este documento. |
