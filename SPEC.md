# Spec: traductor simultáneo para reuniones

Oct 22, 2026 · @cami

## 1. Contexto y objetivo

Construir un traductor simultáneo español ↔ inglés para reuniones, donde cada persona habla en su idioma y los demás escuchan y leen la traducción casi en tiempo real (meta: 1–2 s de retraso), sin que nadie tenga que hacer pausas.

**Problema.** En las reuniones del equipo hay personas que hablan solo español y otras solo inglés. La traducción de voz nativa de Google Meet ("Speech translation") aparece como no disponible en nuestra cuenta de Workspace (en *Premium or unavailable features*), y aun si estuviera activa, da poco control: no hay transcripción bilingüe lado a lado, ni un interruptor inmediato, ni glosario propio.

**Objetivo del producto.** Que en una reunión de Google Meet cada participante pueda:

- **Escuchar** la traducción en su idioma por sus audífonos, con el original de fondo a bajo volumen.
- **Leer** lo que dijo cada persona en su idioma original y, debajo, la traducción.
- **Apagar o encender** la voz traducida al instante si nota que se está equivocando, sin perder los subtítulos.

**Primer paso (este documento lo detalla):** un *probador de fluidez* local para validar latencia, calidad y sensación de fluidez en 1–2 días, antes de invertir en la integración con Meet.

**Cómo usar este documento con Claude Code.** Exportarlo a Markdown y guardarlo en la raíz del repositorio como `SPEC.md`. La sección 13 tiene las instrucciones de trabajo para Claude Code. Las secciones 4, 5, 8 y 9 son los requisitos que debe cumplir la Fase 1; la sección 11 define cómo se acepta.

## 2. Usuarios y escenarios

El usuario principal es un equipo de trabajo con personas monolingües (solo español o solo inglés) que se reúnen por Google Meet.

| Rol | Qué necesita |
| --- | --- |
| Hablante en español | Hablar de corrido, sin pausas ni esperar al traductor, y confiar en que el otro entiende. |
| Oyente que solo habla inglés | Escuchar la traducción con poco retraso y poder leerla si algo no se entendió. |
| Oyente bilingüe o que entiende algo | Leer original y traducción lado a lado, detectar errores y apagar la voz traducida cuando no la necesita. |
| Organizador de la reunión | Activar la traducción para la reunión y, si hace falta, apagarla para todos. |

**Escenarios clave:**

1. **Reunión interna de seguimiento** (2–6 personas, 30–60 min): una persona presenta en español durante varios minutos sin pausas; los angloparlantes escuchan la traducción y hacen preguntas en inglés, que los demás escuchan en español.
2. **Conversación rápida de ida y vuelta**: turnos cortos alternando idiomas; la traducción no debe pisar al siguiente que habla.
3. **Reunión con cliente**: vocabulario del negocio (nombres de clientes, productos, siglas); los errores en esos términos son los más costosos.
4. **Detección de error en vivo**: un oyente bilingüe nota una mala traducción, apaga la voz traducida o mantiene una tecla para oír el original, y marca el error para corregir el glosario.

En la Fase 1 solo se simula el escenario 1 (una persona hablando en español, traducción al inglés), más la dirección inversa si el proveedor lo permite sin esfuerzo adicional.

## 3. Alcance por fases

El producto se construye en tres fases; **Claude Code debe empezar solo por la Fase 1** y no avanzar a la siguiente sin que la anterior pase sus criterios de aceptación (sección 11).

| Fase | Qué es | Para qué sirve | Esfuerzo estimado |
| --- | --- | --- | --- |
| **1. Probador de fluidez** | Página web local: hablas al micrófono, ves original + traducción en vivo y escuchas la voz traducida, con medidor de latencia. | Validar latencia, calidad y fluidez con números reales. | 1–2 días |
| **2. Enlace de oyente** | Un servidor reenvía la traducción; cada oyente abre un enlace en su navegador y escucha/lee en su idioma. | Probar con varias personas reales sin compartir pantalla. | 3–5 días |
| **3. Extensión de Chrome en Meet** | Captura el micrófono de cada hablante y muestra un panel lateral bilingüe dentro de Meet, con todos los controles. | Uso diario en reuniones reales. | 2–4 semanas |

**Prueba en reunión real durante la Fase 1 (sin construir nada más):** el hablante comparte en Meet la pestaña del probador **con audio**. El colega angloparlante oye la traducción y ve los subtítulos en la pantalla compartida. Suma latencia por pasar por Meet, pero alcanza para juzgar la experiencia.

**Fuera de alcance (todas las fases, salvo decisión explícita):**

- Idiomas distintos de español e inglés.
- Zoom, Microsoft Teams y otras plataformas.
- App móvil nativa.
- Clonación de voz del hablante (posible a futuro, solo con consentimiento explícito).
- Grabación y almacenamiento del audio de las reuniones.
- Entrenamiento de modelos propios.

## 4. Requisitos funcionales – Fase 1

La Fase 1 entrega una página web que corre en `localhost` y cumple estos requisitos. Prioridad: **Debe** = obligatorio para aceptar la fase; **Debería** = incluir si no retrasa la entrega.

| ID | Requisito | Prioridad |
| --- | --- | --- |
| RF-01 | Botón **Empezar / Detener** que pide permiso de micrófono y empieza a enviar audio en streaming. | Debe |
| RF-02 | Selector de dirección: Español → Inglés (por defecto) e Inglés → Español. | Debe |
| RF-03 | Transcripción del idioma original en vivo, mostrando texto parcial mientras se habla y texto confirmado al cerrar cada fragmento. | Debe |
| RF-04 | Traducción en vivo de cada fragmento, mostrada debajo del original correspondiente. | Debe |
| RF-05 | Voz traducida reproducida por los audífonos a medida que llegan los fragmentos, sin esperar a que termine la frase completa. | Debe |
| RF-06 | Interruptor **Voz traducida: encendida/apagada**. Al apagarla, el audio se corta en menos de 150 ms y los subtítulos siguen funcionando. | Debe |
| RF-07 | **Medidor de latencia por fragmento**: tiempo desde que termina de hablarse el fragmento hasta el primer texto traducido y hasta el primer audio traducido. Muestra el último valor, p50 y p95 de la sesión. | Debe |
| RF-08 | **Glosario** editable (10–20 términos: nombres de clientes, productos, siglas) que se envía al proveedor como contexto o instrucción para que los traduzca bien o los deje sin traducir. | Debe |
| RF-09 | Historial de la sesión en pantalla: lista de fragmentos (hora, original, traducción, latencia). | Debe |
| RF-10 | Exportar la sesión a un archivo (JSON o CSV) con original, traducción y latencias, para analizar las pruebas. | Debe |
| RF-11 | Atajo de teclado **mantener presionado** (por ejemplo, barra espaciadora fuera de campos de texto) para silenciar la voz traducida mientras se presiona. | Debería |
| RF-12 | Selector de proveedor (ver sección 7), para comparar con el mismo audio. | Debería |
| RF-13 | Modo **audio de prueba**: cargar un archivo de audio grabado (WAV/MP3) y procesarlo como si fuera el micrófono, para comparar proveedores con exactamente el mismo audio. | Debería |
| RF-14 | Control de velocidad de la voz traducida y aceleración automática cuando hay retraso acumulado (sección 8). | Debería |
| RF-15 | Indicador de estado de conexión (conectado, reconectando, error con mensaje claro). | Debe |

En la Fase 1 **no** se requiere: detección automática de idioma, varios hablantes, cuentas de usuario ni despliegue en la nube.

## 5. Requisitos de interfaz

La interfaz debe dejar claro en todo momento qué se dijo, qué se tradujo y si la voz traducida está sonando. El mismo diseño del panel se reutiliza en las Fases 2 y 3.

**Barra superior (controles):**

- Botón Empezar / Detener, grande y con estado visible (grabando = indicador activo).
- Selector de dirección (ES → EN / EN → ES).
- Interruptor de voz traducida, con estado inequívoco (encendida / apagada), no solo un ícono.
- Volumen de la voz traducida y, en Fases 2–3, del audio original.
- Indicador de conexión y medidor de latencia (último, p50, p95).

**Panel de transcripción bilingüe (centro):**

- Una entrada por fragmento o intervención: **nombre de quien habla** (en Fase 1, fijo), **texto original**, y **debajo la traducción**.
- Texto **parcial** (aún en proceso) en color gris; pasa a color sólido cuando queda confirmado.
- Desplazamiento automático hacia lo más reciente; si el usuario sube para leer algo anterior, se pausa el desplazamiento y aparece un botón "Ir a lo más reciente".
- Tres modos de vista: original + traducción (por defecto), solo traducción, solo original.
- En Fases 2–3: un color por hablante y un indicador de quién se está traduciendo en ese momento.
- Cada entrada muestra su latencia en pequeño (por ejemplo, "+0.9 s").

**Panel de glosario (lateral o pestaña):** lista editable de términos con columnas *término original*, *traducción deseada* (vacío = no traducir) y *nota*. Se guarda en el navegador o en un archivo local.

**Estados que hay que diseñar:** sin permiso de micrófono (con instrucciones para darlo), sin API key configurada, conectando, reconectando, error del proveedor (mensaje claro de qué pasó y qué hacer), sesión vacía antes de empezar.

**Accesibilidad y legibilidad:** texto de la traducción de al menos 18 px, buen contraste en tema claro y oscuro, todos los controles usables con teclado. La página debe funcionar bien al compartirse en Meet (texto grande y legible en pantalla compartida).

## 6. Arquitectura técnica (Fase 1)

El navegador envía el audio directo al proveedor por WebRTC y recibe de vuelta los eventos (texto parcial y final, traducción y fragmentos de voz). El servidor local solo guarda la API key y entrega tokens efímeros, así la key nunca llega al navegador y el audio no da un salto extra.

```
Micrófono ──audio──▶ Probador (navegador) ──audio en trozos (WebRTC)──▶ Proveedor de IA
                         ▲   │                                              │
                         │   └──── texto + voz por fragmento ◀──────────────┘
                         │
           token efímero │
                         │
                  Servidor local (API key en .env)
                         
Probador ──▶ Panel bilingüe (pantalla) + voz traducida (audífonos)
```

Flujo: el micrófono entrega audio al probador, que lo envía en trozos pequeños al proveedor; el proveedor devuelve texto y voz por fragmento; el probador los muestra en el panel bilingüe y reproduce la voz en los audífonos. Si el proveedor no soporta tokens efímeros, el servidor local hace de puente por WebSocket (suma algo de latencia; medirlo).

**Componentes:**

| Componente | Responsabilidad |
| --- | --- |
| Captura de audio | `getUserMedia` con cancelación de eco y supresión de ruido; trozos de 20–100 ms; modo archivo de prueba. |
| Adaptador de proveedor | Conecta, envía audio, traduce los eventos del proveedor a la interfaz común (sección 7). |
| Cola de voz | Reproduce fragmentos en orden, mide el retraso acumulado y aplica aceleración o descarte (sección 8.3). |
| Panel bilingüe | Muestra original y traducción por fragmento, parcial y final. |
| Métricas | Marcas de tiempo por fragmento, p50/p95, exportación. |
| Servidor local | API key, tokens efímeros, archivos estáticos. |

En la Fase 3 la misma estructura se mueve a una extensión de Chrome: la captura corre en la máquina de cada hablante y el panel se muestra dentro de Meet (sección 10).

## 7. Proveedores de IA

El proveedor principal de la Fase 1 es **OpenAI `gpt-realtime-translate`** (Realtime API), con una capa de abstracción que permita cambiarlo sin tocar la interfaz.

**Antes de escribir código, Claude Code debe leer la documentación oficial actual** del proveedor elegido (modelos, forma de conexión por WebRTC o WebSocket, tokens efímeros, parámetros de traducción, formato de eventos y precios). Los datos de esta sección se revisaron en octubre de 2026 y pueden haber cambiado.

| Opción | Qué hace | Precio aproximado | Cuándo usarla |
| --- | --- | --- | --- |
| **OpenAI gpt-realtime-translate** (principal) | Traducción voz a voz en streaming en un solo modelo; lanzado en mayo de 2026; 70+ idiomas de entrada, 13 de salida. | ~$0.034 por minuto de audio de entrada | Fase 1 por defecto. |
| **Palabra.ai** | API de traducción voz a voz por WebRTC o WebSocket; transcribe, traduce y sintetiza. | Cotizar | Comparación de calidad y latencia. |
| **Soniox** | Transcripción, traducción y voz en streaming bajo una misma API; la voz empieza antes de que termine la frase. | Cotizar | Comparación; buena opción de pipeline en cascada. |
| **Híbrido** | Transcripción por API + traducción con un LLM pequeño + voz local gratuita (Piper o Kokoro). | ~$0.40–0.60 por hora | Si se quiere bajar costos. Hay que programar la detección de voz y el corte de fragmentos. |
| **Local gratuito** | faster-whisper (o NVIDIA Parakeet/Canary) + opus-mt o un LLM pequeño open source + Piper/Kokoro. | $0 en API; costo de servidor | Pruebas sin gastar, o a futuro con mucho volumen en GPU propia. Más lento y menos preciso. |

**Capa de abstracción (obligatoria).** El resto de la app habla con una interfaz común, no con un proveedor. Como mínimo:

- Entrada: flujo de audio (micrófono o archivo), idioma de origen, idioma de destino, glosario.
- Eventos de salida: `transcripcion_parcial`, `transcripcion_final`, `traduccion_parcial`, `traduccion_final`, `audio_traducido` (fragmentos de audio), `error`, `estado_conexion`.
- Cada evento lleva un `id_fragmento` y marcas de tiempo, para poder medir la latencia por etapa (sección 9).

**Voz.** Si el proveedor no entrega voz, o para el modo económico, usar Kokoro (open source, bastante natural) o Piper (más robotizada, muy liviana). En la demo inicial se usó Piper corriendo en CPU sin costo.

**Fuentes:** [OpenAI gpt-realtime-translate (resumen de LiveLingo)](https://www.livelingo.io/guides/openai-live-translation) · [Palabra streaming API](https://docs.palabra.ai/docs/streaming_api) · [Soniox speech-to-speech](https://soniox.com/blog/speech-to-speech-translation)

## 8. Estrategia de traducción simultánea

La traducción debe ser **simultánea** (como un intérprete de conferencias), no consecutiva: el hablante nunca pausa y la traducción corre por un canal aparte, solapada con lo que sigue diciendo.

**8.1 Nunca hablar "en la sala"**

- La voz traducida **no** se reproduce en el audio principal de la reunión. Va por un canal aparte, al audífono de cada oyente.
- Cada oyente oye solo el idioma que necesita; el hablante nunca oye su propia traducción.
- El original sigue sonando de fondo a bajo volumen (*ducking*): ~16–25% del volumen mientras suena la traducción, ~45% cuando no. Ajustable por el oyente. (Aplica desde la Fase 2; en la Fase 1 el original es la propia voz del usuario.)

**8.2 Traducir por fragmentos estables, sin esperar pausas**

- Transcripción parcial en streaming: palabras a medida que se oyen.
- Confirmar solo el **prefijo estable**: las últimas palabras de un parcial suelen cambiar. Se traduce lo que coincide entre dos actualizaciones seguidas y se deja pendiente el resto, para no traducir algo que luego cambie.
- Cortar en **límites naturales** (comas, conectores como "y", "pero", "entonces", cambios de idea), no solo en silencios. Fragmentos objetivo de 3–6 palabras; español e inglés tienen un orden de palabras parecido.
- Si el proveedor es voz a voz (gpt-realtime-translate, Palabra), buena parte de esto ya viene resuelto; Claude Code debe usar la segmentación del proveedor y solo agregar lógica propia si las métricas muestran problemas.
- La detección de voz (VAD) es el ajuste que más afecta la calidad percibida: muy agresiva corta frases; muy lenta sube la latencia. Debe ser configurable.

**8.3 Que la traducción no se quede atrás**

- Medir el retraso acumulado (cola de audio traducido pendiente).
- Si pasa de ~2 s: acelerar la voz a 1.1–1.25x.
- Si sigue creciendo: pedir traducciones más concisas y eliminar muletillas ("o sea", "eh", "¿no?").
- Si pasa de un umbral alto (por ejemplo, 5 s): descartar lo pendiente en la voz y retomar desde lo más reciente; los subtítulos conservan todo.

**8.4 Varios hablantes y eco** (Fases 2–3)

- Audio separado por participante, con su propia traducción.
- Si dos hablan a la vez: priorizar en voz al que empezó primero y mostrar al otro en subtítulos.
- Una voz sintética distinta por hablante.
- Cancelación de eco activada en la captura del micrófono, y recomendación fuerte de usar audífonos, para que la voz traducida no vuelva a entrar por el micrófono y se traduzca otra vez.

## 9. Requisitos no funcionales

La meta de latencia es **p50 ≤ 1.5 s y p95 ≤ 2.5 s** desde que termina de pronunciarse un fragmento hasta que empieza a sonar su traducción. Bajar de ~800 ms no es realista sin sacrificar calidad.

**9.1 Presupuesto de latencia por etapa**

| Etapa | Objetivo (ms) |
| --- | --- |
| Captura y envío del audio (red) | 50–150 |
| Reconocimiento de voz en streaming | 200–400 |
| Traducción incremental | 100–300 |
| Síntesis de voz (primer audio) | 100–250 |
| Reproducción al oyente | 50–150 |

Reglas para cumplirlo:

- **Todo en streaming**: cada etapa pasa resultados parciales a la siguiente; nunca frases ni archivos completos.
- Audio en **trozos pequeños** (20–100 ms) por **WebRTC** (preferido entre navegador y proveedor) o WebSocket.
- Servidores y región del proveedor **cerca del equipo**: desde Colombia, costa este de EE. UU. (Virginia o Miami), ~50–80 ms de ida y vuelta. Evitar Europa y costa oeste.
- La traducción nunca se devuelve a la llamada de Meet; va directo al navegador del oyente.
- Instrumentar cada etapa desde el día uno (sección 11).

**9.2 Seguridad**

- La API key vive **solo** en un archivo `.env` local del servidor, incluido en `.gitignore`. Nunca en el código del navegador, en el repositorio ni en logs.
- El navegador obtiene un **token efímero** del servidor local para conectarse al proveedor (si el proveedor lo soporta); el servidor es lo único que conoce la key.
- Incluir un `.env.example` sin valores reales.

**9.3 Privacidad**

- Por defecto **no se guarda audio**. El historial de texto vive solo en la sesión hasta que el usuario lo exporte.
- Mostrar en la interfaz que el audio se envía al proveedor elegido.
- En fases con más personas: aviso visible a los participantes de que la reunión se está traduciendo, y considerar GDPR y la ley de protección de datos personales de Colombia antes de usarlo con clientes.

**9.4 Compatibilidad**

- Google Chrome actual en macOS y Windows (navegador objetivo de todas las fases).
- Uso con audífonos como configuración recomendada.

**9.5 Robustez**

- Reconexión automática si se cae la conexión, sin perder el historial.
- Errores del proveedor (key inválida, sin saldo, límite de uso) con un mensaje claro que diga qué pasó y cómo resolverlo.

## 10. Fases 2 y 3 en detalle

Estas fases quedan documentadas para orientar el diseño de la Fase 1 (que el código no las bloquee), pero **no se construyen todavía**.

**10.1 Fase 2 – Enlace de oyente**

- Un servidor (relay) recibe la traducción del hablante y la reenvía a los oyentes conectados.
- El hablante abre la sesión y obtiene un enlace; cada oyente lo abre en su navegador, elige su idioma y escucha y lee la traducción en su propio audífono.
- Mismo panel bilingüe de la Fase 1, con un color por hablante.
- Ducking del original controlado por cada oyente.
- Despliegue en la nube en la costa este de EE. UU.

**10.2 Fase 3 – Extensión de Chrome dentro de Google Meet**

La opción elegida es una **extensión de Chrome que captura el micrófono de cada hablante en su propio computador**, en paralelo a Meet, y envía el audio directo al servidor. Es la más rápida porque evita el viaje del audio por los servidores de Google (unos 200–500 ms) y entrega audio limpio y separado por persona. La desventaja aceptada: cada persona que habla debe tener la extensión instalada.

Comparación de formas de capturar el audio:

| Opción | Latencia | Audio por persona | Requiere instalar | Notas |
| --- | --- | --- | --- | --- |
| **Extensión de Chrome (micrófono local)** – elegida | La más baja | Sí | Sí, cada hablante | También resuelve el panel lateral con la misma pieza. |
| API de medios de Meet (oficial) | Baja | Sí | No | Estaba en vista previa para desarrolladores con acceso restringido; verificar disponibilidad. |
| Bot que entra a la reunión (tipo Palabra o Interprefy, o servicio como Recall.ai) | La más alta (+200–500 ms) | Normalmente mezclado | No | Funciona con cualquier reunión; separar hablantes agrega trabajo y errores. |

Alternativa para el panel: un **complemento oficial de Meet** (pestaña *Add-ons* del panel *Meeting tools*), que se abre como panel lateral. No captura audio por sí solo, así que necesitaría una de las opciones de captura de la tabla.

**Requisitos del panel lateral en Meet (Fase 3):**

- Transcripción bilingüe en vivo: nombre y color de quien habla, original, y debajo la traducción; parcial en gris, confirmado en sólido.
- Vista elegible por cada persona: original + traducción, solo traducción, solo original.
- **Interruptor de voz traducida**: al apagarla, el original sube de volumen al instante; los subtítulos siguen.
- **Mantener presionada una tecla** para oír el original mientras se presiona.
- **Control por persona**: apagar la traducción de un hablante específico.
- **Marcar un error** en una línea, escribir la corrección y agregarla al glosario de la empresa.
- **Control individual, no global**: apagar la traducción solo afecta a quien la apaga. El organizador tiene además un interruptor general.
- Detección automática de idioma por hablante.

## 11. Métricas, pruebas y criterios de aceptación

La Fase 1 se acepta cuando cumple las metas de latencia con audio real del equipo y un colega angloparlante confirma que entiende la traducción sin pedir que se repita.

**11.1 Métricas que se registran por fragmento**

- `t_fin_habla`: cuando termina de pronunciarse el fragmento (según el VAD o el evento del proveedor).
- `t_primer_texto_original`, `t_texto_original_final`.
- `t_primer_texto_traducido`, `t_texto_traducido_final`.
- `t_primer_audio_traducido`: cuando empieza a sonar en el audífono.
- Latencia principal = `t_primer_audio_traducido − t_fin_habla`. Se muestran último valor, p50 y p95.
- Retraso acumulado de la cola de voz.

**11.2 Plan de pruebas**

1. **Grabaciones de referencia**: 3–5 audios de 1–2 minutos con acento colombiano real: un monólogo sin pausas, una explicación con nombres de clientes y siglas, y audio con algo de ruido de fondo.
2. **Comparación de proveedores**: pasar las mismas grabaciones (modo audio de prueba, RF-13) por al menos dos proveedores y comparar latencia y errores.
3. **Prueba en vivo individual**: hablar al micrófono 5 minutos seguidos y revisar latencia y retraso acumulado.
4. **Prueba en Meet**: compartir la pestaña con audio en una reunión con un colega angloparlante, 10–15 minutos.
5. **Prueba de glosario**: un texto con los 10–20 términos del negocio; contar cuántos se traducen bien con y sin glosario.

**11.3 Criterios de aceptación de la Fase 1**

- [ ] Todos los requisitos marcados **Debe** de la sección 4 funcionan.
- [ ] Latencia p50 ≤ 1.5 s y p95 ≤ 2.5 s en las pruebas 3 y 4.
- [ ] Hablar 5 minutos seguidos sin pausas no hace que el retraso acumulado supere 5 s.
- [ ] El interruptor de voz corta el audio en menos de 150 ms.
- [ ] Al menos 90% de los términos del glosario salen correctos.
- [ ] El colega angloparlante entiende la prueba en Meet sin pedir que se repita más de 1–2 veces.
- [ ] La API key no aparece en el código del navegador, el repositorio ni los logs.
- [ ] Un `README` explica cómo instalar, configurar la key y correr el probador en menos de 10 minutos.

## 12. Costos estimados

Una reunión de 1 hora español ↔ inglés cuesta **$2–4 USD en API** bien optimizada con gpt-realtime-translate (~$0.034 por minuto de audio de entrada), y ~$0.40–0.60 con el modo híbrido. Las pruebas de la Fase 1 caben en $5–10 de crédito.

| Escenario | Cálculo | USD por hora |
| --- | --- | --- |
| API todo en uno, optimizada (solo se envía audio cuando alguien habla) | ~60 min de habla × $0.034 | ~2 |
| API todo en uno, simple (audio mezclado a 2 sesiones: ES→EN y EN→ES) | 2 × 60 min × $0.034 | ~4 |
| API todo en uno, ineficiente (5 streams por persona, con silencios) | 5 × 60 min × $0.034 | ~10 |
| Híbrido (transcripción por API + LLM pequeño + voz local) | ~$0.006/min de transcripción + centavos de traducción | ~0.40–0.60 |
| Todo propio en GPU | Servidor de ~$0.50–1.50 por hora, compartido entre reuniones | Centavos a escala; costo fijo si está ocioso |

**Lo que más mueve el costo:** no enviar silencio (detección de voz que corte el stream), el número de idiomas de destino, y separar streams por persona sin cortar silencios.

**Costos adicionales:** servicio de bot de reunión si se usa (cobran por hora de bot), servidores propios (centavos por reunión) y resumen al final con un LLM (menos de $0.10 por reunión).

Con 20 horas de reuniones bilingües al mes: ~$40–80 al mes con API, ~$10 con el modo híbrido. Los precios de Palabra y Soniox hay que cotizarlos con el volumen real.

## 13. Instrucciones para Claude Code

Construye solo la **Fase 1** (secciones 4, 5, 8, 9 y 11), en este orden, y deténte a pedir confirmación en los puntos marcados.

**13.1 Stack sugerido** (se puede ajustar si la documentación del proveedor recomienda otra cosa; justificar el cambio):

- **Servidor:** Node.js + TypeScript con Fastify o Express. Funciones: servir la página, guardar la API key, emitir tokens efímeros al navegador.
- **Cliente:** TypeScript con Vite, sin framework pesado (o React si el panel lo justifica). Conexión al proveedor por WebRTC si está soportado.
- **Audio:** Web Audio API (`getUserMedia` con `echoCancellation`, `noiseSuppression` y `autoGainControl` activados).
- **Configuración:** `.env` con `OPENAI_API_KEY`, `PROVIDER`, `SOURCE_LANG`, `TARGET_LANG`.

**13.2 Estructura sugerida del repositorio**

```
/server        servidor local: tokens efímeros, estáticos
/client        página del probador
  /providers   un adaptador por proveedor (interfaz común, sección 7)
  /audio       captura, reproducción, cola de voz y control de retraso
  /ui          panel bilingüe, controles, glosario, medidor
  /metrics     marcas de tiempo, p50/p95, exportación
/test-audio    grabaciones de referencia (no se suben si son reuniones reales)
SPEC.md        este documento
README.md      instalación y uso
.env.example
```

**13.3 Orden de trabajo**

1. Leer la documentación oficial actual de OpenAI Realtime / gpt-realtime-translate y resumir en 5–10 líneas cómo conectarse, qué eventos llegan y cómo se pasa el glosario. **Pausa: mostrar el resumen al usuario.**
2. Esqueleto: servidor local, `.env.example`, página con botón Empezar/Detener y estado de conexión.
3. Capa de abstracción de proveedores + adaptador de OpenAI.
4. Transcripción y traducción en el panel bilingüe (parcial en gris, final en sólido).
5. Voz traducida con interruptor y atajo de mantener presionado.
6. Métricas por fragmento, medidor p50/p95 y exportación.
7. Glosario.
8. Control de retraso (aceleración, descarte) y modo audio de prueba.
9. README y verificación contra los criterios de aceptación. **Pausa: reportar resultados de latencia al usuario.**
10. (Opcional, si el usuario lo pide) segundo adaptador: Palabra, Soniox o el modo local gratuito.

**13.4 Reglas de trabajo**

- No inventar parámetros de la API: si algo no está en la documentación, preguntar o probar.
- Nunca escribir la API key en el código, en commits ni en mensajes; la pone el usuario en `.env`.
- Commits pequeños por paso, con mensajes claros.
- Cada decisión técnica que se aparte de este documento se anota en una sección "Decisiones" del README.

**13.5 Definición de terminado (Fase 1)**

Todos los criterios de la sección 11.3 cumplidos, el README permite a otra persona correrlo en menos de 10 minutos, y hay un archivo exportado de una sesión real de prueba con sus latencias.

## 14. Decisiones abiertas y dependencias

**Lo que debe aportar el usuario antes de empezar:**

- [ ] Cuenta de OpenAI con API key y $5–10 de saldo (la key se pone en `.env`, nunca en el chat).
- [ ] Carpeta del proyecto en el computador y Node.js instalado.
- [ ] Chrome y audífonos.
- [ ] Lista de 10–20 términos del negocio: nombres de clientes, productos y siglas internas.
- [ ] 3–5 grabaciones de referencia de 1–2 minutos (o permiso para grabarlas en la primera prueba).
- [ ] Un colega angloparlante disponible para la prueba en Meet.

**Decisiones abiertas:**

- ¿OpenAI con API key desde el inicio, o empezar con la opción local gratuita (más lenta, voz robotizada) para no gastar mientras se valida? Recomendación: OpenAI, porque la prueba principal es de latencia y la opción local no es representativa.
- ¿Uso interno de la empresa o producto para vender? Cambia cuánto conviene construir frente a integrar, y las exigencias de privacidad.
- ¿Se pedirá al administrador de Google Workspace que active la traducción nativa de Meet en paralelo, para comparar?
- Para la Fase 3: confirmar si la API de medios de Meet está disponible para la cuenta, como alternativa a la extensión.
- Voz: ¿Kokoro o Piper para el modo económico? Requiere escuchar una comparación con la misma frase.
