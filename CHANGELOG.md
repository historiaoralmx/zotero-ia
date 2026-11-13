# Historial de Zotero IA

Las notas anteriores describen versiones históricas; sus instrucciones y valores predeterminados pueden haber cambiado. Para la versión actual consulta LEEME.txt.

## 1.9.6 — Trabajos relacionados por citas

- Pestaña Relacionados con búsqueda directa en Inciteful Academic a partir de hasta cinco DOI o identificadores OpenAlex.
- Revisión de resultados, enlace a la publicación e importación explícita de referencias seleccionadas.
- La consulta de citas y la importación bibliográfica funcionan sin llamadas a un modelo de IA.

## 1.9.5 — Retirada de la función de voz

- Se elimina la función de dictado completa, incluidos los controles, mensajes, permisos, scripts y ejecutable de grabación.
- Se retira el envío de audio a Gemini y su consumo por transcripción.
- Se simplifica el área de escritura y se ajusta la barra de actividad a chat y análisis.
- Las demás funciones conservan su implementación.

## 1.9.4 — Grabador integrado y uso sencillo

- Se reemplaza la ejecución de PowerShell/C# por un pequeño grabador Win32 incluido en el XPI; no requiere instalación adicional.
- Extracción automática desde el XPI y comprobación SHA-256 antes de ejecutar el componente. Incluye su código C y las instrucciones de compilación.
- Hablar, Terminar, revisar y Enviar; avisos breves, Volver a intentar y acceso directo a los permisos del micrófono cuando procede.
- Los códigos quedan dentro de Detalles técnicos, cerrado por defecto; no se muestran instrucciones sobre componentes internos.
- Se mantienen el límite de un minuto, audio en memoria, cancelación, la clave propia de Gemini y el envío automático opcional.
- Validación del C compilado con llamadas al sistema simuladas, del binario PE/huella/DLL y del protocolo con la interfaz. Captura física de Windows pendiente de comprobación.

## 1.9.3 — Diagnóstico y estado del micrófono

- Inicialización del grabador dentro del manejo de errores del botón; un fallo de construcción permite reintentar sin bloquear el chat.
- Estado visible desde la adquisición del micrófono y aviso persistente en la barra de actividad, incluidos errores de configuración.
- Protocolo de preparación de Windows y errores diferenciados de componente, proceso, preparación y canal de control.
- El cierre de stdin ya no se interpreta como una solicitud de terminar: solo el token stop finaliza voluntariamente.
- Pruebas simuladas de adquisición, cancelación, errores, reintento y protocolo. Captura real pendiente de comprobación en Windows.

## 1.9.2 — Corrección del manifiesto de instalación

- Se restaura applications.zotero.update_url: Zotero lo exige al validar la instalación. Su eliminación en 1.9.1 causaba el aviso genérico de incompatibilidad.
- Se usa una URL HTTPS con dominio reservado .invalid para mantener la distribución manual sin confiar las actualizaciones a una cuenta o dominio no confirmado.
- Se mantiene el mismo identificador, los límites de compatibilidad y todo el código funcional de 1.9.1.
- Cuatro pruebas nuevas del contrato de instalación, extraído del código oficial de Zotero, incluyendo la reproducción del rechazo de 1.9.1 y la validación del manifiesto dentro del XPI.
- 284 pruebas automáticas. No se afirma haber realizado una instalación nativa en este entorno.

## 1.9.1 — Lectura por partes y estabilidad

- Resúmenes, fichas y matrices procesan por partes consecutivas todo el texto recuperado, con una síntesis incremental y evidencia validada. Las preguntas puntuales conservan la búsqueda por pasajes.
- Avance por documento guardado tras cada respuesta completada. Una nueva etapa explícita permite continuar una matriz con los mismos límites configurados, sin repetir las partes guardadas.
- Herramientas seleccionadas por tarea, descubrimiento de categorías y compresión de historial antiguo para reducir el costo fijo de cada paso. Se conservan las reglas de evidencia, identidad bibliográfica y autorización.
- Comprobación de modelos persistida mediante una huella de configuración, lista comprobada y fecha, sin copiar la clave API a ese registro. Se invalida por cambios de configuración o pérdida de acceso. Los errores de cuota no fuerzan una nueva comprobación.
- Los límites por minuto pasan a un respaldo comprobado disponible; se evita insistir inmediatamente sobre el modelo bloqueado.
- Eliminación de colecciones mediante la papelera nativa. Las bibliotecas/versiones que no ofrecen esta capacidad reciben un mensaje; no hay alternativa de borrado definitivo.
- Se retira la dirección de actualización no confirmada. La distribución y actualización de esta versión son manuales.
- Parámetros de temperatura y límite de salida adaptados para modelos de razonamiento compatibles con chat/completions; reintento acotado para temperatura no admitida.
- Respuestas del panel ligadas al ítem que inició la consulta; al cambiar de ítem se cancela la lectura pendiente. Se corrige la confirmación de importación después de detener una tarea anterior.
- Se elimina el sesgo específico de Durango/UJED de la búsqueda web general. Se activan los ajustes de instrucciones y tamaño de partes en las lecturas correspondientes.
- Revisión acumulada de escrituras rutinarias por tarea. Protección de archivos locales dañados de consumo, tareas e historial, sin sobrescribirlos ni impedir toda la inicialización.
- Se eliminan implementaciones de lectura sustituidas al arrancar. Las preguntas con evidencia, la lectura por partes y la ejecución de tareas tienen funciones diferenciadas.
- 280 pruebas automáticas con datos y respuestas simulados. No se certifica funcionamiento nativo ni acceso real a todos los proveedores.

## 1.9.0 — Evidencias, anotaciones y matrices adaptables

- Selección distribuida del inicio, desarrollo y final en lecturas generales o consultas con pocas coincidencias, con preferencia adicional por posibles secciones de método, discusión y conclusiones.
- Muestreo a lo largo del documento cuando se alcanza el límite de páginas o fragmentos; advertencias de cobertura parcial.
- Subrayados y comentarios del PDF utilizado se recuperan mediante las API de Zotero, con su origen diferenciado y la página de la anotación cuando está disponible.
- Los comentarios personales no pueden respaldar por sí solos campos de la matriz ni afirmaciones sobre el documento. Se conservan por separado para consulta.
- Entre 1 y 10 columnas por proyecto, con instrucciones opcionales por columna. Cada tarea conserva una copia independiente.
- Columnas aplicadas al análisis, tabla, ficha de lectura, Word, Excel y JSON. Las tareas anteriores conservan sus cinco columnas habituales.
- Respuestas incompletas del modelo quedan disponibles para reintento, sin presentarse como fichas completas.
- 243 pruebas automáticas con datos y respuestas simulados. Sin instalación nativa ni prueba de IA real en esta revisión.

## 1.8.3 — Revisión técnica

- Acciones habituales solicitadas sin diálogos repetitivos en lotes de hasta 20 registros; se conserva el historial reversible, la validación de concurrencia y la revisión de cambios de riesgo.
- Se elimina el parámetro ineficaz para sobrescribir títulos incompatibles con el DOI. Se mantiene su revisión manual.
- Formato Markdown con etiquetas equilibradas y salida de texto si el renderizado falla.
- Word y Excel omiten enlaces vacíos o no admitidos; las evidencias se conservan y las celdas de Excel respetan su longitud máxima.
- Se unifican Claude y el alias Anthropic. Se conserva el protocolo compatible con OpenAI.
- No se cambia el registro Fluent: Zotero registra automáticamente locale/<idioma>/*.ftl.
- Documentación histórica consolidada, conservando el código y todas las funciones anteriores.
- 200 pruebas automáticas con datos simulados. Sin prueba de instalación nativa ni peticiones reales de IA en esta revisión.


## 1.8.2

ZOTERO IA 1.8.2 — LÍMITE INTERNO Y CONTINUIDAD

El aviso Límite de la tarea alcanzado procede del control interno de Zotero IA.
No demuestra que la clave API haya fallado ni que se haya agotado la cuota del
proveedor. Cambiar la clave no modifica los límites del plugin.
Los valores predeterminados siguen siendo 20 solicitudes y 60 000 tokens por
tarea. Una orden del investigador puede requerir varias consultas al modelo.
No se aumentan los topes ni se modifica la facturación automáticamente.

CAMBIOS
- El aviso especifica si se alcanzó el número de solicitudes o el límite de
  tokens, e indica el consumo acumulado y la siguiente estimación.
- Revisar límites abre Ajustes y propone un margen en los campos pertinentes.
  Solo se aplica al pulsar Guardar límites. Los valores son globales para las
  tareas del plugin y no cambian las cuotas del servicio de IA.
- En el chat, Continuar en otra etapa inicia una nueva etapa con los mismos
  límites configurados y el contexto disponible de la conversación. Este botón
  no aparece cuando una sola consulta ya excede el límite total de tokens.
- Si el agente se pausa, conserva en memoria los resultados de las herramientas
  finalizadas. Las llamadas sin resultado se marcan como interrumpidas, para que
  el modelo revise el estado de Zotero antes de repetir una modificación.
  Esto no certifica que una herramienta interrumpida no haya realizado cambios
  parciales. No se repite automáticamente un lote de herramientas al pulsar
  el botón de continuidad.
- El contexto de conversación se conserva mientras la ventana siga abierta;
  no se promete guardar en disco todo el texto del chat. Las matrices y fichas
  de las tareas de lectura mantienen su guardado local anterior.
- Las tareas de lectura pausadas muestran su límite y el acceso a Revisar límite
  del plugin. Tras guardar un nuevo límite, se continúa desde Resultados.
- Los rechazos HTTP 4xx sin información de uso ya no retienen toda la estimación
  de tokens dentro del presupuesto local. Se conservan como intentos rechazados
  sin consumo confirmado; no se afirma que la facturación del proveedor sea cero.
- Las desconexiones y los errores de servidor sin datos mantienen una estimación
  conservadora. Se reconocen también los recuentos nativos de Gemini y los campos
  separados de entrada y salida. Un recuento reportado de cero se muestra como cero.
- El cierre de una consulta no puede ajustar dos veces el mismo ticket de consumo.

USO
Instala el XPI sobre la versión anterior y vuelve a abrir Zotero IA.
Si aparece la pausa, usa Revisar límites, revisa los valores y pulsa Guardar límites.
Para una matriz guardada, vuelve a Resultados y pulsa Continuar.
Para un chat pausado en esta versión, puedes usar Continuar en otra etapa.
Una conversación interrumpida en una versión anterior no puede reconstruirse
retroactivamente: comprueba las operaciones realizadas antes de volver a pedirlas.

VALIDACIÓN
175 pruebas automáticas con datos y respuestas simulados: 160 anteriores y
15 de contabilidad de tokens, rechazos, límites, errores de almacenamiento,
continuidad del agente, lecturas paralelas y controles del aviso.
Sintaxis JavaScript, XHTML, IDs únicos, manifiesto e integridad del XPI comprobados.
No se reprodujo la tarea de la captura con una clave real ni se probó gráficamente
en Zotero. Los límites del proveedor siguen siendo independientes de estos controles.


## 1.8.1

ZOTERO IA 1.8.1 — CRÉDITO DE AUTORÍA

La cabecera muestra «Hecho por Humanistyc» junto a Espacio de investigación.
El crédito está presente en las cinco secciones y se ajusta al ancho de la ventana.
La autoría del complemento también figura como Humanistyc en su manifiesto.

Instala este XPI sobre la versión anterior y vuelve a abrir Zotero IA.

Validación: XHTML, IDs únicos, manifiesto e integridad del XPI comprobados.
Cambio de presentación; no se modificaron los módulos JavaScript.


## 1.8.0

ZOTERO IA 1.8.0 — ESPACIO DE INVESTIGACIÓN

La ventana se organiza en cinco secciones con navegación permanente:

PROYECTOS
Crea un proyecto con nombre, pregunta u objetivo y colecciones de Zotero.
Los proyectos se guardan localmente entre sesiones. Al abrir uno, sus colecciones
y objetivo se preparan en Analizar. Puedes editarlo o eliminarlo desde Opciones
del proyecto. Eliminar un proyecto conserva las colecciones, referencias y tareas.
Para cambiar sus colecciones, edita el proyecto. Si una colección desaparece,
el análisis queda bloqueado hasta revisar el proyecto: no se reduce su alcance
silenciosamente. Puedes trabajar también mediante Analizar sin proyecto.

ANALIZAR
1. Selecciona las colecciones, o abre un proyecto que ya las tenga vinculadas.
2. Define el objetivo y pulsa Analizar y crear matriz.
También puedes buscar evidencia puntual escribiendo una pregunta y pulsando
Buscar pasajes. El progreso se muestra en la barra superior. Detener tarea
permanece accesible desde cualquier sección.

RESULTADOS
Consulta los análisis guardados, continúa una tarea o abre su matriz.
Todas las tareas incluye los análisis anteriores a esta versión. Solo del
proyecto activo muestra las tareas nuevas vinculadas a ese proyecto.
Las fichas, evidencias y exportaciones mantienen su funcionamiento anterior.
Los controles principales son Ver matriz y Continuar. Exportación, revisión,
reintento y eliminación de tareas quedan en Más opciones.
Pasajes y Matriz conservan sus contenidos al cambiar entre vistas o secciones.

ASISTENTE
El chat tiene su propio espacio. El cuadro de escritura y la voz aparecen
únicamente aquí; no ocupan espacio de la matriz ni de los formularios.
Ejemplos de tareas reúne los accesos a lectura, organización, mapas e importación.
Los ejemplos siguen disponibles después de empezar una conversación.
El asistente usa la selección o colección abierta en Zotero, según la instrucción;
seleccionar un proyecto no limita automáticamente todas las herramientas del chat
a sus colecciones. Para su análisis vinculado, usa la sección Analizar.
Limpiar chat inicia una conversación sin recargar la ventana ni limpiar proyectos
o resultados. Se conserva el borrador al navegar entre secciones.
La voz conserva las condiciones de 1.7.0: Windows con Gemini; aún no está disponible
en Mac. No se ha realizado una prueba de captura de voz con micrófono real.

AJUSTES
Abre la configuración del proveedor y revisa consumo, límites y caché.
El historial de propuestas y las operaciones para deshacer se consultan aquí.

PRESENTACIÓN
En ventanas amplias, la navegación aparece a la izquierda. En ventanas estrechas,
se coloca arriba. Cada sección ocupa el área de trabajo disponible y tiene su
propio desplazamiento. La tabla comparativa conserva su desplazamiento horizontal.
Se mantiene el tema de colores de Zotero y la navegación por teclado.

INSTALACIÓN
Instala este XPI sobre la versión anterior y vuelve a abrir la ventana Zotero IA.
Se abrirá Proyectos. Para recuperar un análisis anterior, entra en Resultados y
selecciona Todas las tareas.

VALIDACIÓN
160 pruebas automáticas con datos simulados: las 130 anteriores y 30 nuevas de
proyectos, persistencia, errores de guardado, navegación, tareas antiguas,
conservación de resultados, alcance, progreso y vinculación de análisis.
Sintaxis JavaScript, XHTML, IDs únicos, manifiesto e integridad del XPI comprobados.
No se hizo una prueba gráfica en Zotero ni una prueba en un Mac real. La validación
de estados de interfaz utiliza un DOM simulado; no certifica el aspecto final de
todos los controles nativos en Windows o macOS.


## 1.7.0

ZOTERO IA 1.7.0 — ÓRDENES POR VOZ INTEGRADAS

DISPONIBILIDAD
Esta primera versión de voz está preparada para Windows con Gemini configurado
y comprobado. El chat escrito conserva los proveedores anteriores.
No requiere otra clave de transcripción ni servicios de voz adicionales.
La voz utiliza el modelo Gemini seleccionado y, si es necesario, sus respaldos
comprobados. En modo gratuito conserva la lista permitida y las comprobaciones
de la configuración anterior. No habilita pagos ni añade modelos de pago.

USO
1. Instala este XPI sobre la versión anterior y vuelve a abrir Zotero IA.
2. Comprueba la conexión de Gemini desde Ajustes → Zotero IA.
3. Debajo del cuadro del chat, pulsa Hablar.
4. Cuando aparezca Grabando, di tu instrucción, por ejemplo:
   «Resume el documento seleccionado» o «Busca el PDF de la referencia 2266».
5. Pulsa Terminar para enviar el audio a Gemini y obtener la transcripción.
   El micrófono se cierra al terminar. Límite: un minuto por grabación.
6. Revisa el texto y pulsa Enviar. La orden utiliza el mismo agente y las mismas
   herramientas y aprobaciones que cuando escribes; la voz no altera esa política.
7. Si marcas Enviar la orden al terminar antes de grabar, el dictado se envía al
   agente automáticamente después de transcribirse. La opción comienza desmarcada.
8. Cancelar voz o el botón Detener interrumpen la captura o la transcripción.
   Cancelar conserva el texto que ya estuviera escrito. Cerrar la ventana cancela
   la grabación y descarta un resultado pendiente. Un dictado no se ejecuta solo
   por empezar a grabar.

AUDIO Y CUOTA
Al pulsar Terminar, o al alcanzar un minuto, el audio se envía al proyecto
Gemini de la clave configurada. Consume solicitudes y tokens de su cuota.
Los recuentos se integran en el consumo del plugin; la transcripción se cobra
o limita según el proyecto y el modelo del proveedor.
El plugin mantiene el audio en memoria y no crea archivos de grabación.
No conserva el audio en las tareas ni lo añade al historial. La transcripción
queda en el cuadro del chat y, si la envías, se trata como cualquier orden escrita.
No hay escucha permanente ni respuesta hablada en esta versión.

CAPTURA EN WINDOWS
La compilación de Zotero desactiva WebRTC; no se presupone que su ventana pueda
grabar mediante las API del navegador. En Windows se usa un componente incluido
en el plugin que accede al dispositivo predeterminado con WinMM a través de
Windows PowerShell y .NET. No requiere instalar Python, FFmpeg o una grabadora.
El proceso local solo recibe el código estático del grabador: no recibe la
clave API, instrucciones del chat ni documentos de la biblioteca.
La captura entrega audio WAV mono, 16 kHz, 16 bits; termina al pulsar el botón,
cancelar o alcanzar un minuto. No cambia las preferencias de seguridad de Zotero
ni la política de ejecución de PowerShell.
Requiere que Windows permita el micrófono para aplicaciones de escritorio y
que el componente PowerShell no esté bloqueado por la configuración del equipo.
Si falla, el plugin muestra una indicación y permite continuar escribiendo.

VALIDACIÓN Y ALCANCE
130 pruebas automáticas con datos simulados: las 71 de la versión anterior,
43 de transcripción, grabación y controles, y 16 del componente de Windows.
Incluyen cuotas, modelos permitidos, cambios de clave, cancelación, cierre de
procesos, resultados tardíos, texto previo, envío opcional y protocolo WAV.
Sintaxis JavaScript, XHTML, manifiesto e integridad del XPI comprobados.
No se ejecutó el componente PowerShell en Windows ni se probó un micrófono real
en Zotero. No se hicieron solicitudes reales de audio a Gemini. Antes de usar
la voz en el taller, realiza una prueba de captura, cancelación y transcripción
en el equipo de la demostración.

FUENTES TÉCNICAS
https://github.com/zotero/zotero/blob/main/app/win/mozconfig
https://ai.google.dev/gemini-api/docs/generate-content/audio
https://ai.google.dev/api/generate-content
https://learn.microsoft.com/en-us/windows/win32/multimedia/managing-waveform-audio-recording
https://firefox-source-docs.mozilla.org/toolkit/modules/subprocess/toolkit_modules/subprocess/index.html


## 1.6.7

ZOTERO IA 1.6.7 — ENLACES Y RECUPERACIÓN DE PDF

Los enlaces web de las respuestas se abren mediante el navegador predeterminado.
Los enlaces a referencias y evidencias de Zotero conservan su apertura interna.
Se aplica al chat, la vista de investigación, el panel del lector y las fichas
generadas a partir de una selección de texto.

BUSCAR UN PDF
1. Pide, por ejemplo: «Busca el PDF de la referencia 2266».
2. El plugin utiliza la búsqueda nativa de Zotero, incluida la API actual
   addAvailableFiles y alternativas para versiones anteriores.
3. Comprueba si hay un PDF adjunto a la referencia y si el archivo existe
   localmente. Un enlace, una instantánea o un archivo ausente no cuentan como PDF.
4. Si falla una búsqueda de una sola referencia y hay DOI o URL guardados,
   abre esa página en el navegador. Se prioriza el DOI cuando es válido.
   No se inventa una dirección de descarga ni se sustituye por una portada
   de revista obtenida de una respuesta de IA.
5. La tarjeta de resultado ofrece Abrir página de la referencia, Comprobar
   si ya está el PDF y Ver referencia en Zotero. Las comprobaciones y los
   botones no consumen IA.
6. En una búsqueda de varias referencias, cada resultado pendiente tiene su
   botón para abrir la página. No se abren muchas pestañas automáticamente.

CONTINUAR CON ZOTERO CONNECTOR
Usa un navegador compatible con Zotero Connector instalado y pulsa su botón
para guardar el artículo. El plugin abre la página; no pulsa el botón de la
extensión ni garantiza que la página permita recuperar el PDF.
Connector puede crear otra referencia. Si ocurre, mueve el PDF a la referencia
original antes de pulsar Comprobar si ya está el PDF. No se fusionan ni borran
referencias automáticamente. El comprobador revisa solo la referencia original.
Si falta un DOI o una URL válidos, añade la dirección del artículo en Zotero.
La apertura utiliza los identificadores guardados; no certifica que la URL esté
vigente ni que un DOI incorrecto corresponda al artículo.

INSTALACIÓN
Instala este XPI sobre la versión anterior desde Complementos de Zotero.
Vuelve a abrir la ventana de Zotero IA; si Zotero lo pide, reinícialo.
Conserva las funciones anteriores, incluida la matriz comparativa de 1.6.6.

VALIDACIÓN
71 pruebas automáticas superadas con datos simulados: 43 anteriores y 28 nuevas
de enlaces, descarga, archivos locales, estados parciales, compatibilidad,
cancelación, botones y entrega del resultado a la interfaz del agente.
Sintaxis JavaScript, XHTML (incluido el fragmento de preferencias con sus
espacios de nombres), manifiesto e integridad del XPI comprobados.
No se probó gráficamente en Zotero ni se descargó el artículo de la captura.
El PDF puede seguir requiriendo acceso institucional o no estar disponible.

REFERENCIAS TÉCNICAS CONSULTADAS
https://www.zotero.org/support/connector
https://forums.zotero.org/discussion/128498/outdated-documentation-on-connector-http-endpoints
https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/attachments.js
https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/utilities_internal.js


## 1.6.6

ZOTERO IA 1.6.6 — MATRIZ COMPARATIVA DE LECTURA

La vista Matriz muestra ahora una tabla: un documento por fila y columnas para
Tesis o argumento principal, Metodología, Fuentes utilizadas, Conceptos centrales
y Limitaciones. Los criterios se pueden comparar lado a lado.

USO
1. Instala esta versión sobre la anterior.
2. Abre Tareas, matrices y evidencias → Tareas guardadas → Ver matriz.
   Puedes abrir una tarea ya guardada: no necesitas volver a analizar los PDF.
3. Desplaza la tabla hacia la derecha para ver todas las columnas. El nombre del
   documento queda visible en la primera columna. La tabla tiene desplazamiento
   vertical y encabezados fijos.
4. Pulsa Leer completo si un texto está abreviado. Solo cambia su presentación;
   los datos guardados y los exportados conservan el texto completo.
5. Pulsa Ver ficha y evidencias junto al documento para consultar sus fragmentos
   y enlaces. Volver a la tabla te devuelve a la comparación.
6. Exportar a Excel o Exportar a Word utiliza las exportaciones existentes.

Los documentos pendientes, sin texto accesible o con incidencias se indican
por separado. No se presentan como análisis completos.
Cambiar entre Pasajes y Matriz conserva los resultados de ambas vistas.
Las fichas son análisis generados por IA; revisa las evidencias y el alcance de
la extracción. La tabla no añade ni inventa datos que no estuvieran en la ficha.

VALIDACIÓN
43 pruebas automáticas superadas con datos y respuestas simulados: 33 de modelos,
configuración y continuidad, más 10 de la tabla, fichas, evidencias, estados,
texto largo, exportaciones visibles y conservación de los resultados de pasajes.
Sintaxis JavaScript, XHTML, manifiesto e integridad del XPI comprobados.
No se hicieron consultas reales a proveedores ni una prueba gráfica en Zotero.


## 1.6.5

ZOTERO IA 1.6.5 — CONFIGURACIÓN CON LENGUAJE SENCILLO

Esta versión mantiene las protecciones y las pruebas de conexión de la 1.6.4.
Simplifica los textos de configuración para investigadores.

GEMINI GRATIS
1. Selecciona «Usar IA gratis» y Google Gemini.
2. Pega tu clave de Google AI Studio.
3. Marca «No he activado pagos para esta clave de Gemini» si corresponde.
   En «¿Cómo lo compruebo?» puedes abrir Google AI Studio: Free o Free Tier
   significa gratuito; Paid significa que el proyecto tiene pagos activados.
4. Pulsa «Comprobar conexión». El plugin elige un modelo compatible y prepara
   alternativas. Cuando termine, verás «Conexión lista. Ya puedes trabajar
   con Zotero IA».
5. Los resultados técnicos están en «Ver detalles de la conexión».

El plugin no puede consultar ni cambiar tus pagos en Google. Para utilizar
Gemini sin cargos, la clave debe pertenecer a un proyecto sin pagos activados.
Si cambias de clave, se repite la comprobación. Para Z.ai se mantiene la clave
Standard y los modelos permitidos de la versión anterior.

VALIDACIÓN
33 pruebas automáticas con respuestas simuladas superadas, incluida la
configuración, selección de modelos, herramientas, respaldos, pausado y
reanudación de tareas. Sintaxis JavaScript, XHTML y archivo XPI comprobados.
Los cambios de esta versión son de presentación; no modifican la biblioteca.


## 1.6.4

ZOTERO IA 1.6.4 — COMPROBACIÓN DE MODELOS PARA EL TALLER

Instala este XPI sobre la versión anterior desde Herramientas → Plugins →
Instalar complemento desde archivo. Conserva el identificador del complemento.
Esta actualización no cambia los archivos de tareas guardadas ni los de la biblioteca.

GEMINI CON NIVEL GRATUITO
1. Abre Ajustes → Zotero IA → Con nivel gratuito → Google Gemini.
2. Pega tu clave. En https://aistudio.google.com/projects revisa que el proyecto
   de ESA clave esté en Free Tier, sin facturación habilitada.
3. Marca la casilla que confirma esa comprobación. El plugin no puede consultar
   ni certificar tu facturación. Un modelo con nivel gratuito puede ser de pago
   si utilizas un proyecto con facturación activa.
4. Pulsa «Comprobar modelo y herramientas». El plugin consulta el catálogo,
   cruza los identificadores con su lista revisada y prueba hasta tres modelos.
   La prueba llama a una herramienta ficticia y procesa su resultado; no lee ni
   modifica referencias o documentos de tu biblioteca. Consume consultas breves.
5. Se selecciona un modelo que supere la prueba. Solo otros modelos comprobados
   de esa misma lista pueden servir de respaldo. Puedes elegir otro en la lista.
6. Repite la comprobación al reiniciar Zotero, cambiar clave/dirección/proveedor
   o después de 24 horas. Antes del taller, comprueba de nuevo el acceso.

Z.AI
Selecciona Z.ai en «Con nivel gratuito», pega una clave Standard de la API general
(no una clave Coding Plan) y pulsa «Comprobar modelo y herramientas».
Consulta los límites reales de tu cuenta en https://z.ai/manage-apikey/rate-limits.

PROTECCIONES
- No se usa cualquier modelo cuyo nombre contenga «flash»; se aceptan IDs exactos.
- No se usan alias «latest» ni se incorporan modelos nuevos sin revisión de precios.
- La detección del catálogo no certifica cuota, permisos ni facturación.
- Los respaldos introducidos en versiones antiguas no eluden la lista permitida.
- Google Search Grounding se desactiva en este modo para evitar esa función con
  facturación independiente. Siguen disponibles las herramientas de búsqueda
  local, OpenAlex y los buscadores web alternativos que ya incluye el plugin.
- Cambiar de proveedor borra la clave del proveedor anterior del formulario.
- Los errores distinguen acceso denegado, modelo retirado y cuota agotada.
- Una falla del proveedor pausa el análisis por lotes, conserva las fichas completas
  y deja los documentos pendientes para continuar después. No convierte la caída
  de la API en errores de cada documento.
- El modo «Otros proveedores → Gemini/Z.ai API de pago» es una elección explícita
  diferente, permite modelos manuales y puede generar cargos según tu cuenta.

LISTA REVISADA EL 6 DE NOVIEMBRE DE 2026
Gemini Standard con nivel gratuito: gemini-3.6-flash, gemini-3.5-flash-lite,
gemini-3.1-flash-lite, gemini-3.5-flash.
Z.ai con precio de entrada/salida gratuito: glm-4.7-flash, glm-4.5-flash.
Fuentes oficiales:
https://ai.google.dev/gemini-api/docs/pricing
https://ai.google.dev/api/models
https://ai.google.dev/gemini-api/docs/billing
https://docs.z.ai/guides/overview/pricing

VALIDACIÓN DE ESTA ENTREGA
33 pruebas automáticas con respuestas SIMULADAS pasaron: catálogo, permisos,
selección, herramientas y respuesta posterior, cambio de clave, modelos retirados,
cuotas, respaldos, errores, formulario y desactivación de Grounding.
Se validaron sintaxis JavaScript, XHTML, manifiesto e integridad del XPI.
No se usaron claves reales. No es una certificación de funcionamiento en tu
Zotero de Windows ni de disponibilidad, gratuidad o cuota futura de los proveedores.
La revisión gráfica en navegador no pudo ejecutarse en este entorno.

ENSAYO ANTES DE DISTRIBUIR A LOS ALUMNOS
Con tres PDF de texto seleccionable en una colección de prueba:
- Ejecuta la comprobación de modelo y herramientas.
- Solicita un resumen y verifica un pasaje en el original.
- Crea una ficha de lectura.
- Busca pasajes; abre una matriz y comprueba que conserva los resultados.
- Crea una tarea, pausa/continúa y exporta la matriz.
- Elimina una tarea de prueba mediante su botón y confirma el resultado.
- Pide crear una colección y una etiqueta; comprueba los cambios en Zotero.
Repite la comprobación de acceso el día del taller. Guarda ejemplos ya generados
para poder explicar el procedimiento si falla internet o el proveedor.


## 1.6.0

Zotero IA 1.6.0 - investigación con evidencias y tareas persistentes

En la ventana Agente Zotero IA, abrir "Tareas, matrices y evidencias".
Seleccionar una o varias colecciones. Se incluyen subcolecciones.
- Iniciar análisis reanudable conserva fichas y fragmentos después de cada documento.
- Continuar no repite fichas completas con la misma fuente. Reintentar incidencias permite recuperar fallos.
- Ver matriz distingue resumen, interpretación y cita; la página PDF solo aparece con extracción nativa verificable.
- Word y Excel exportan archivos DOCX/XLSX reales. Excel incluye la hoja Evidencias. JSON conserva los datos completos.
- Buscar pasajes usa BM25 local sobre el texto de las colecciones elegidas, sin solicitar servicios externos.
- Consumo y límites permite limitar solicitudes, tokens de tarea y tokens de respuesta. No es un cálculo monetario.
- Propuestas e historial permite revisar y deshacer cambios habituales de metadatos, etiquetas, pertenencia a colecciones, nombres y notas.

Las ediciones concurrentes bloquean propuestas y reversiones obsoletas. Las operaciones preparadas que fallan se conservan como "requiere revisión".
Las rutas nativas de reconocimiento de PDF, descargas, importaciones y eliminación de colecciones conservan su aprobación propia; no pertenecen al historial reversible general y no se presentan como reversibles.
Las respuestas de la IA no prueban por sí mismas que una afirmación sea correcta: comprobar los fragmentos enlazados.
La extracción depende de la API disponible en Zotero. Si no existe extracción estructurada se usa texto indexado sin inventar páginas. No se incorpora OCR nuevo ni un índice vectorial.
Los archivos de sesiones, caché y operaciones se guardan localmente en el perfil, bajo zotero-ia-research. Pueden contener fragmentos y notas: forman parte de tus datos locales.
La caché dura 30 días por respuesta y se invalida al cambiar fuente, pregunta, proveedor, modelo o límite de respuesta. No reutiliza llamadas con herramientas.
Por defecto: 20 solicitudes y 60000 tokens por tarea, 1800 por respuesta. Los tokens sin reporte del proveedor se contabilizan conservadoramente como estimados.


## 1.5.3

Zotero IA 1.5.3 — candidata de corrección, 1 de noviembre de 2026.
Base: XPI 1.5.2 instalado por el usuario. Consulte Informe_regresion_Zotero_IA_1.5.3.md.
Validada con datos ficticios en Zotero 10.0.7 y perfil aislado; no se probó en los ítems originales.
Incluye correcciones de roles de creadores, precisión de fecha, confirmación de metadatos,
rollback transaccional, cancelación, notas Markdown, historial en archivo, mapa y estados RSS.
No están aceptadas las 26 incidencias: quedan pruebas de interfaz, proveedores y biblioteca de grupo.
El instalador no ha sido instalado sobre la biblioteca principal. Usar un perfil de prueba.


## 1.5.0

Zotero IA 1.5.0. Nuevas herramientas: plan_organizacion, aplicar_organizacion, detectar_duplicados_avanzado, revisar_bibliografia_citada, comparar_documentos, preparar_busqueda_semantica, plan_lecturas, auditoria_integral, vigilancia_rss_bibliografica, mapa_intelectual_auditado. No incluye constructor de estados del arte ni analizador de fuentes históricas. Límites: búsqueda semántica es cribado de candidatos textuales, no índice vectorial; RSS no es tarea programada; grafo intelectual aún no extrae relaciones semánticas automáticamente; duplicados no hacen hash ni fusionan. Pruebas en Zotero pendientes.


## 1.4.1

Zotero IA 1.4.1
- corregir_metadatos: reemplaza campos existentes y autores contrastados con Crossref vía DOI.
- Si el título difiere materialmente del DOI, requiere permitir_titulo_discrepante=true y aprobación.
- revertir_metadatos: recupera campos y autores, siempre que no hayan sido modificados después.
- Sin DOI no se alteran datos; no se usa Gemini como fuente de metadatos.
- Máximo 20 registros por llamada.


## 1.4.0

Zotero IA 1.4.0
- verificar_metadatos: compara DOI y metadatos con Crossref, sin cambios.
- corregir_metadatos: completa campos vacíos verificados, máximo 20 ítems por llamada, sin reemplazar autores ni valores existentes.
- revertir_metadatos: revierte cambios verificados si no han sido editados después.
- NO verifica sin DOI, ni inventa metadatos.
- Se requiere conexión a Crossref; no necesita clave adicional.
- Test de sintaxis no sustituye pruebas de integración en Zotero.


## 1.3.1

Zotero IA 1.3.1
La traducción contextual se activa exclusivamente al pulsar Traducir; seleccionar texto no consume tokens. Se conserva la caché de traducciones y todas las acciones de lectura académica de 1.3.0.


## 1.3.0

Zotero IA 1.3.0\nSelecciona texto en el lector PDF para realizar análisis crítico, generar ficha y guardar una nota hija.\nEl subrayado se hace con los botones nativos de Zotero: aún no se automatiza la geometría de las anotaciones.\nNo se infieren números de página. Realiza pruebas con una copia de tu biblioteca.\n

## 1.2.3

Zotero IA 1.2.3: manejo de HTTP 403/429 en detección RSS sin mostrar código HTML, pruebas limitadas de rutas RSS convencionales, separación entre enlaces verificados y rutas fallidas. No evita protecciones anti-bot. Función pendiente de prueba en Zotero 10.


## 1.2.2

Zotero IA 1.2.2: agrega suscribir_canal_rss con validación de feed, detección de duplicados y comprobación de alta. Necesita prueba dentro de Zotero 10; si falla no simula éxito. No altera la traducción contextual.


## 1.2.1

Zotero IA 1.2.1: Traducción al español en el menú de selección de texto del lector PDF (Gemini o proveedor configurado). Caché de sesión, botón de reintento. No altera el PDF. Enviar selección a API externa implica transferencia de texto. Pendiente de prueba dentro de Zotero 10.


## 1.2.0

Zotero IA 1.2.0: Traducción por fragmentos con IA configurada, opción de guardar traducciones como notas hijas; listar canales suscritos, detectar enlaces RSS en páginas HTTPS, consultar novedades mediante RSS/Atom. Suscripción y actualizaciones automáticas siguen disponibles en interfaz nativa Zotero; no implementadas como herramienta agéntica en esta versión. Limitaciones: traducción del texto indexado, no remaquetación de PDF ni vista bilingüe. No probado dentro de Zotero 10.


## 1.1.4

Zotero IA 1.1.4: corrige la falsa clasificación de PDF como escaneados, intenta reindexar cuando no hay texto y devuelve diagnóstico explícito. Requiere prueba funcional en Zotero 10. No constituye implementación de un extractor alternativo de PDF.


## 1.1.3

NUEVO: examinar_pdf_independiente lee attachmentText; crear_referencia_desde_pdf crea elemento padre solo con evidencia literal y autorización. No hay OCR en esta versión. Revisar manualmente los campos propuestos por IA. No confirmado en Zotero 10.


## 1.1.2

Zotero IA 1.1.2: auditoría reconoce adjuntos PDF independientes, nueva herramienta reconocer_pdf_coleccion, informe de importación distingue PDF importado de referencia creada. Validación estática; pendiente prueba Zotero 10.


## 1.1.1

Zotero IA 1.1.1: reparación del selector de carpetas nsIFilePicker.init; usa BrowsingContext en lugar de Window. Instalación y funcionamiento pendientes de prueba dentro de Zotero 10.


## 1.1

Zotero IA 1.1: Selecciona una colección, abre la ventana del agente y pulsa Importar carpeta de PDF. Escoge una carpeta. Incluye subcarpetas (max 500 PDF), autorización única, informe. Archivos originales intactos. Usa reconocimiento nativo disponible; no inventa metadatos. Verificar en Zotero 10.


## 1.0.0

Zotero IA 1.0.0 — auditoría de colecciones (sin escrituras); recuperación de metadatos de PDFs independientes y búsqueda de PDFs con funciones nativas, sujetas a disponibilidad en la instalación. Las dos últimas requieren una confirmación por lote de máximo 10. No usar sobre biblioteca única sin copia de seguridad. Pruebas pendientes en Zotero 10.


## 0.9.9

Zotero IA 0.9.9: Grounding Google Search con clave Gemini individual. buscar_web prioriza Google y luego Bing RSS/DuckDuckGo si no hay fuentes; buscar_google retorna fuentes, consultas y tokens. Puede requerir facturación; no incluye una clave compartida. Sin garantía de disponibilidad ni prueba dentro de Zotero.


## 0.9.8

Búsqueda web mejorada: intenta Bing RSS y DuckDuckGo HTML, consultas abreviadas y dominio del repositorio UJED como estrategia cuando corresponda. Los errores se reportan; no confunde búsqueda fallida con inexistencia del documento. Requiere pruebas en Zotero 10.


## 0.9.7

Zotero IA 0.9.7: herramienta buscar_web con resultados web públicos vía RSS de Bing, sin API de pago. Distingue páginas web de resultados OpenAlex. La disponibilidad del endpoint RSS es externa y puede variar. No descarga automáticamente PDF ni importa tesis por URL. No se ha probado en ejecución real de Zotero 10.

## 0.9.6

0.9.6: vista inicial de publicaciones, aristas entre publicaciones que comparten autor o etiqueta, etiquetas en hover o foco, modo Todos para red completa. No equivalencia a Connected Papers ni inferencias semánticas. Pruebas en Zotero pendientes.

## 0.9.5

Zotero IA 0.9.5: distribución por fuerzas para la red 2D, etiquetas selectivas, mayor contraste, panel de nodo y foco de relaciones. No infiere similitudes documentales ni citas. Sin pruebas en Zotero 10.

## 0.9.4

Zotero IA 0.9.4 — mejora visual del mapa, filtro contextual, modo foco por selección de nodo, botón Limpiar foco y relaciones conservadas al filtrar. Pendiente de prueba en Zotero 10.

## 0.9.3

Zotero IA 0.9.3: botón 2D/3D, giro con arrastre, zoom, selección, filtros, expansión y exportación PNG. Vista 3D mediante proyección local Canvas (sin dependencias externas). Las conexiones corresponden exclusivamente a metadatos; no identifica debates ni contradicciones. Requiere prueba dentro de Zotero 10.


## 0.9.1

Zotero IA 0.9.1 — Controles de mapa: zoom, desplazamiento, ampliar, ajustar, exportar PNG y seleccionar nodos. Pendiente de prueba en Zotero 10.


## 0.9

Zotero IA 0.9.0 — Mapa de conocimiento
Abre el agente y usa «Explorar mapa de mi colección», con una colección seleccionada.
Representa autores, publicaciones y etiquetas de Zotero, con enlaces basados en metadatos y acceso a las referencias.
NO infiere citas bibliográficas, concordancias teóricas, debates, metodologías ni contradicciones; esas funciones requieren extracción y verificación documental.
Máximo 150 publicaciones; por defecto 80. No modifica la biblioteca.
Pruebas: sintaxis JS, validez XML y empaquetado. Falta prueba en Zotero 10.


## 0.8.3

Zotero IA 0.8.3: evita Services.appShell.hiddenDOMWindow en la validación CSL. Utiliza DOMParser desde la ventana principal. Requiere Zotero abierto. Validación dinámica dentro de Zotero 10 pendiente.


## 0.8.2

Zotero IA 0.8.2
Ventana principal: Enter envía; Shift+Enter crea una nueva línea. Se previene la inserción de un salto de línea al enviar. Se ignora Enter durante composición IME. Mantiene funciones de 0.8.1.


## 0.8.1

Zotero IA 0.8.1
Corrige el error de style.file indefinido en crear_estilo_csl.
Recupera XML desde el objeto de Zotero, archivo local o repositorio público oficial.
No implementa conversión integral APA/Chicago ni validación completa del esquema CSL.
Requiere prueba funcional en Zotero 10.


## 0.8

Zotero IA 0.8.0 — Estilos CSL

Herramientas: listar_estilos_csl y crear_estilo_csl.

Ejemplo: Lista mis estilos CSL instalados. Crea una copia de Chicago con nombre Mi Chicago, sin DOI y con idioma es-ES; solicita permiso para instalarla.

Alcance: edición controlada de título, ID, idioma, DOI y URL. No es un editor libre de todas las reglas CSL. Validación XML básica; no validación completa contra esquema CSL.

Los archivos generados se guardan en el perfil Zotero/zotero-ia-csl. Si falla la instalación automática, Configuración > Citar > Estilos > +.

No probado dentro de la aplicación Zotero 10.


## 0.7.6

Zotero IA 0.7.6 — HumanisTyC
Nuevas herramientas: renombrar_coleccion y eliminar_coleccion.
La eliminación exige confirmación única y conserva los registros bibliográficos; elimina la colección y sus subcolecciones.
No ejecutado dentro de Zotero 10; probar con colecciones sin valor antes de usar con proyectos reales.


## 0.7.5

Zotero IA 0.7.5 — HumanisTyC
- Gemini recomendado; demás proveedores opcionales.
- Prueba de conexión aislada: solo modelo seleccionado, una solicitud, timeout de 20 s.
- El agente conserva modelos de respaldo, con 2 intentos por modelo y timeout de 45 s.
- Esperas por límites por minuto acotadas a 8 s por intento.
- No se ha verificado funcionamiento dentro de Zotero 10. Hacer copia de seguridad y probar antes de producción.


## 0.7.4

Zotero IA 0.7.4 — actualización visual
- Ventana de agente rediseñada con colores y bordes de Zotero y modo claro/oscuro.
- Panel lateral utiliza el color de acento del sistema; preferencias visualmente armonizadas.
- Sin cambios intencionales en lógica del agente, herramientas, claves ni datos.
- Requiere prueba visual dentro de Zotero 10.


## 0.7.3

Zotero IA 0.7.3
Acceso desde la barra lateral derecha: icono IA. Al seleccionar la sección se muestra el botón Abrir agente Zotero IA.
La sección permanece disponible sin seleccionar un documento.
La función de lectura sigue dependiendo de seleccionar un ítem.
Instalar como actualización mediante Herramientas > Complementos.


## 0.7.2

Zotero IA 0.7.2 — rediseño del panel lateral de lectura. Se preservan herramientas y lógica de la versión 0.7.1.
Instalar desde Herramientas > Complementos > Instalar complemento desde archivo.
Pruebas: sintaxis e integridad del paquete; pendiente verificar renderizado en Zotero 10.


## 0.7.1

Zotero IA 0.7.1 — HumanisTyC

Sin diálogos de confirmación en crear notas, colecciones, importar por identificador, agregar hasta 100 etiquetas a ítems o vincular hasta 100 referencias a colecciones y guardar hasta 25 publicaciones. Para acciones de alto volumen y nuevas operaciones de escritura se sigue pidiendo autorización. No incorpora herramientas de eliminación; no se puede borrar desde el agente con esta versión.

Pruebas estáticas realizadas. Pendiente de probar en Zotero 10.


## 0.7

ZOTERO IA 0.7.0 — HumanisTyC

NUEVO: analizar_coleccion_lote (máximo 5 ítems por llamada; secuencial), ver_avance_coleccion, avance reducido por colección y dos accesos en la interfaz.
Se conserva la autorización obligatoria para operaciones de escritura de 0.6.1.

LIMITACIONES CONOCIDAS:
- Los checkpoints conservan posición de lectura, NO el contenido de las fichas. Para continuar un informe consolidado se requiere historial o regenerar los lotes anteriores.
- La lectura depende del texto extraíble de los adjuntos. No verifica automáticamente paginación ni citas.
- No implementa todavía un planificador persistente general o recuperación transaccional de notas.
- La tarea puede detenerse por límites del modelo o presupuesto de pasos.
- No se ha ejecutado una prueba de integración real en Zotero 10.

PRUEBA: crea una colección con 2-3 PDF, abre Zotero IA y elige Analizar colección por lotes. Verifica la advertencia para registros sin texto. Prueba una creación de nota solo en colección de ensayo y rechaza una escritura.


## 0.6

ZOTERO IA 0.6.0 — HUMANISTYC
==========================
INSTALACION
1. En Zotero 10, abrir Herramientas > Complementos.
2. Instalar complemento desde archivo y elegir zotero-ia-0.6.0.xpi.
3. Reiniciar Zotero si se solicita.
4. Abrir Zotero IA y probar primero sobre una biblioteca de prueba.

CAMBIOS 0.6
- Solicitud obligatoria de aprobacion antes de toda llamada a herramienta marcada como escritura, incluso si la preferencia antigua confirmWrites estaba desactivada.
- Las autorizaciones presentan nombre de herramienta y parametros resumidos.
- Se muestra un plan de trabajo orientativo al iniciar una tarea.
- Historial local resumido (ultimas 20 tareas, estado, lecturas, cambios y errores), sin contenido de PDFs.
- Estado de progreso y acciones rechazadas visibles.
- Validacion basica de JSON de argumentos y comprobacion de cancelacion antes de ejecutar las operaciones.
- Preserva proveedores y funcionalidades de 0.5.1.

LIMITACIONES
- Plan orientativo fijo: NO es todavia un planificador IA con subtareas dinamicas persistentes.
- El historial NO permite reanudar las llamadas de herramienta tras reiniciar Zotero.
- La cancelacion puede esperar hasta que termine la solicitud al proveedor o se responda una ventana de aprobacion.
- Los numeros de pagina extraidos de PDF deben verificarse en el original.
- Solo se ha validado sintaxis Javascript, estructura XPI y pruebas simuladas del ciclo de autorizacion. No hay prueba de instalacion dentro de Zotero 10 en este entorno.
- En la version 0.6, el resumen de la instruccion del usuario (max. 180 caracteres) queda almacenado localmente en preferencias; no se guardan credenciales ni textos PDF en el historial.

PRUEBAS RECOMENDADAS
1. Crear una biblioteca de prueba, poner la preferencia confirmWrites antigua en false y pedir crear una nota; debe solicitar permiso.
2. Rechazar una operacion y comprobar que no modifico la biblioteca.
3. Aprobar la operacion y comprobar que la nota o etiqueta fue creada.
4. Cerrar y abrir Zotero, comprobar resumen de tareas recientes.
5. Ensayar Detener durante una tarea sin escrituras pendientes.

Codigo fuente incluido en el paquete ZIP separado.

