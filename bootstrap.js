/* global Zotero, Services */
var ZoteroIA;
var sectionID = null;
var chromeHandle = null;
var prefPaneID = null;
var selectionReadingHandler = null;

function log(msg) { Zotero.debug("[Zotero IA] " + msg); }

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;

  ZoteroIA = {
    id, rootURI,
    P: "extensions.zotero-ia.",
    pref(k) { const value=Zotero.Prefs.get(this.P + k, true); return k==="provider"&&value==="anthropic"?"claude":value; },

    // Llamada genérica a cualquier API compatible con OpenAI (chat/completions)
    async chatRaw(messages, tools, options = {}) {
      const t0 = Date.now();
      const testOnly = !!options.testOnly;
      const signal = options.signal;
      const meterId=options.meterId||this.research?.id("request");
      const checkAbort = () => { if (signal && signal.aborted) throw new Error("Tarea detenida por el usuario"); };
      checkAbort();
      const base = String(this.pref("baseURL") || "").trim().replace(/\/+$/, "");
      const key = String(this.pref("apiKey") || "").trim();
      const main = String(options.policyProbe ? options.probeModel || "" : this.pref("model") || "").trim();
      if (!base) throw this.providerError("Falta la dirección (URL) en Ajustes → Zotero IA");
      if (!main) throw this.providerError("Falta seleccionar y comprobar un modelo en Ajustes → Zotero IA");
      const headers = { "Content-Type": "application/json" };
      if (key) headers["Authorization"] = "Bearer " + key;
      // Modelo principal + respaldos (los del usuario y los predeterminados), sin los que ya fallaron de forma definitiva
      const DEFAULT_FALLBACKS = {
        gemini: "gemini-4-hydrogen,gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
        zai: "glm-4.7-flash,glm-4.5-flash",
      };
      this._dead = this._dead || {}; // modelo -> hasta cuándo se descarta (retirado o sin cuota diaria)
      const now = Date.now();
      const protectedModels = this.modelPolicy?.models(main, options);
      const protectedContext = protectedModels ? this.modelPolicy.context() : null;
      const list = protectedModels || [main]
        .concat(testOnly ? [] : String(this.pref("fallbackModels") || "").split(","))
        .concat(testOnly ? [] : String(DEFAULT_FALLBACKS[this.pref("provider")] || "").split(","))
        .map(x => x.trim()).filter(Boolean);
      let models = [...new Set(list)].filter(m => testOnly || !(this._dead[m] > now));
      if (!models.length) {
        if (protectedModels) throw this.providerError("Los modelos comprobados no tienen acceso o cuota disponible ahora. Revisa los límites de tu cuenta o cambia de proveedor en Ajustes → Zotero IA. No se probaron modelos fuera de la lista permitida.");
        models = [main];
      }
      let xhr = null, model = main, lastNetErr = null, lastFail = null;
      outer:
      for (const m of models) {
        checkAbort();
        model = m;
        const payload = { model: m, messages };
        // These hybrid Flash models can otherwise spend the small output budget
        // entirely on reasoning. Other providers/models keep their own defaults.
        if(this.pref("provider")==="zai"&&/^glm-4\.(?:5|7)-flash$/i.test(m))payload.thinking={type:"disabled"};
        const reasoning=/^(?:o[134](?:-|$)|gpt-[56](?:[.-]|$))/i.test(m);
        if(this.research){if(reasoning||this._completionTokenModels?.has(m))payload.max_completion_tokens=this.research.settings().output;else payload.max_tokens=this.research.settings().output;}
        // Claude newer models reject temperatures below 1; omit when using Anthropic.
        const fixedSamplingGemini = /^gemini-(?:4(?:[.-]|$)|3\.[68]-flash(?:-|$))/i.test(m);
        if (!reasoning&&!fixedSamplingGemini&&!/claude/i.test(m) && this.pref("provider") !== "claude"&&!this._defaultTemperatureModels?.has(base+"/"+m)) payload.temperature = 0.2;
        if (this.pref("provider") === "gemini" && !this._noEffort) payload.reasoning_effort = "low";
        if (tools && tools.length) payload.tools = tools;
        for (let attempt = 0; attempt < (testOnly ? 1 : 2); attempt++) {
          checkAbort();
          if (protectedContext) this.modelPolicy.assertUnchanged(protectedContext);
          try {
            xhr = await this.requestModel("POST", base + "/chat/completions", {
              headers, body: JSON.stringify(payload), responseType: "json", timeout: 45000, successCodes: false,
              ...(signal ? {cancellerReceiver: cancel => {
                if(signal.aborted)cancel(); else signal.addEventListener("abort",cancel,{once:true});
              }} : {}),
            },{taskId:meterId,model:m,messages:{messages,tools}});
            lastNetErr = null;
          } catch (e) {
            xhr = null; lastNetErr = e;
            if(e.name==="BudgetLimitError" || e.name==="ModelPolicyError")throw e;
            checkAbort();
            if (/localhost|127\.0\.0\.1/.test(base)) throw this.providerError("No encuentro la IA en tu computadora. Abre Ollama (o LM Studio) y vuelve a intentar.");
            if (testOnly || attempt >= 1) continue outer; // la prueba no reintenta; el agente sí puede probar respaldo
            continue;
          }
          if (xhr.status >= 200 && xhr.status < 300) break outer;
          const body = JSON.stringify(xhr.response || "");
          lastFail = xhr;
          // Modelo retirado o inexistente: se descarta por esta sesión
          if (xhr.status === 404 || /no longer available|not found|does not exist/i.test(body)) { this._dead[m] = now + 864e5;if(protectedModels&&!options.policyProbe)await this.modelPolicy.rejectModel(m);continue outer; }
          if (xhr.status === 429) {
            if (testOnly) break outer;
            // Límite diario agotado: se descarta ese modelo por hoy
            if (/per ?day|PerDay|daily/i.test(body)) { this._dead[m] = now + 6 * 36e5; continue outer; }
            if(protectedModels&&models.some(other=>other!==m&&!(this._dead[other]>now))){this._dead[m]=now+60000;continue outer;}
            // Límite por minuto: esperar lo que indica el servicio (máx. 40 s) y reintentar el MISMO modelo
            const w = body.match(/retry in ([\d.]+)\s*s/i) || body.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
            const secs = Math.min(8, w ? parseFloat(w[1]) + 1 : 4 * (attempt + 1));
            if (this.onWait) { try { this.onWait(secs); } catch (e) {} }
            await this.waitAbortable(secs * 1000,signal);
            checkAbort();
            continue;
          }
          if ([500, 502, 503, 504].includes(xhr.status)) {
            if (testOnly) break outer;
            if (attempt >= 1) continue outer; // saturado dos veces: siguiente modelo
            await this.waitAbortable(3000,signal);
            checkAbort();
            continue;
          }
          break outer; // error definitivo (clave, petición): no tiene caso seguir
        }
      }
      if (xhr && (xhr.status < 200 || xhr.status >= 300) && lastFail) xhr = lastFail;
      checkAbort();
      if (!xhr) {
        if (lastNetErr && /timed out|timeout/i.test(String(lastNetErr.message))) throw this.providerError("El servicio de IA no respondió a tiempo (probé " + models.join(", ") + "). Intenta en unos minutos.", { temporary: true });
        throw this.providerError("No hay conexión con el servicio de IA. Revisa tu internet e intenta de nuevo.", { temporary: true });
      }
      let data = Array.isArray(xhr.response) ? xhr.response[0] : xhr.response;
      if(protectedModels&&[401,403].includes(xhr.status))this.modelPolicy.invalidate();
      if(xhr.status===400&&/temperature/i.test(JSON.stringify(data||""))&&/unsupported|not supported|default|does not support/i.test(JSON.stringify(data||""))&&!this._defaultTemperatureModels?.has(base+"/"+model)){
        this._defaultTemperatureModels=this._defaultTemperatureModels||new Set();this._defaultTemperatureModels.add(base+"/"+model);
        return this.chatRaw(messages,tools,{...options,meterId});
      }
      if(xhr.status===400 && /max_tokens/.test(JSON.stringify(data||"")) && /max_completion_tokens/.test(JSON.stringify(data||"")) && !this._completionTokenModels?.has(model)) {
        this._completionTokenModels=this._completionTokenModels||new Set();this._completionTokenModels.add(model);
        return this.chatRaw(messages,tools,{...options,meterId});
      }
      if (xhr.status === 400 && !this._noEffort && /reasoning/i.test(JSON.stringify(data || ""))) {
        this._noEffort = true;
        return this.chatRaw(messages, tools, options);
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const raw = data && data.error ? (data.error.message || JSON.stringify(data.error)) : "";
        throw this.providerError(this.friendlyError(xhr.status, raw, model, JSON.stringify(data||"")), {
          model,quotaKind:xhr.status===429&&/per[ _-]?day|daily|diari[oa]/i.test(JSON.stringify(data||""))?"daily":xhr.status===429?"temporary":null,
          status: xhr.status,
          temporary: [408, 429, 500, 502, 503, 504].includes(xhr.status)
        });
      }
      const choice = data?.choices?.[0];
      const msg = choice?.message;
      if (!msg) throw this.providerError("Respuesta vacía del modelo");
      checkAbort();
      const calls=msg.tool_calls;
      const malformedCalls=calls!=null&&(!Array.isArray(calls)||calls.some(call=>{
        if(!call?.id||typeof call.function?.name!=="string"||!call.function.name)return true;
        try{const args=typeof call.function.arguments==="string"?JSON.parse(call.function.arguments):call.function.arguments;
          return !args||typeof args!=="object"||Array.isArray(args);
        }catch(_){return true;}
      }));
      const incomplete=["length","max_tokens","model_context_window_exceeded","network_error"].includes(choice.finish_reason);
      const noAnswer=!calls?.length&&(typeof msg.content!=="string"||!msg.content.trim()||/^[\s\]})`,;]+$/.test(msg.content));
      if(incomplete||malformedCalls||noAnswer||choice.finish_reason==="tool_calls"&&!calls?.length){
        if(!options.testOnly&&!options.responseRepairAttempt){
          const instruction="La respuesta anterior llegó incompleta o sin contenido utilizable. Genera una respuesta completa y más breve, respetando el formato solicitado. Si necesitas herramientas, emite llamadas válidas con argumentos completos. No des por ejecutadas acciones nuevas.";
          const repaired=JSON.parse(JSON.stringify(messages));
          if(repaired[0]?.role==="system")repaired[0].content+="\n"+instruction;
          else repaired.unshift({role:"system",content:instruction});
          return this.chatRaw(repaired,tools,{...options,meterId,responseRepairAttempt:true});
        }
        throw this.providerError("La IA devolvió una respuesta incompleta o inválida. No se ejecutaron acciones a partir de esa respuesta; los pasos anteriores se conservan. Vuelve a intentarlo.",{finishReason:choice.finish_reason||"invalid_response"});
      }
      this.lastModel = model;
      this.lastLatencyMs = Date.now() - t0;
      this.lastFallback = model !== main;
      const clean = { role: "assistant", content: msg.content || "" };
      if (msg.tool_calls && msg.tool_calls.length) clean.tool_calls = msg.tool_calls.map(call => {
        const args = call?.function?.arguments;
        // Some compatible providers document parsed arguments rather than a JSON string.
        // Normalize at the transport boundary so preflight and agent use the same format.
        return args && typeof args === "object" && !Array.isArray(args)
          ? {...call, function: {...call.function, arguments: JSON.stringify(args)}} : call;
      });
      return clean;
    },

    providerError(message, details = {}) { return Object.assign(new Error(message), details, { name: "ProviderError" }); },
    requestModel(method,url,options) { return Zotero.HTTP.request(method,url,options); },
    waitAbortable(ms,signal) {
      return new Promise((resolve,reject)=>{
        const stop=()=>{clearTimeout(timer);reject(new Error("Tarea detenida por el usuario"));};
        const timer=setTimeout(()=>{signal?.removeEventListener("abort",stop);resolve();},ms);
        if(signal?.aborted)stop();else signal?.addEventListener("abort",stop,{once:true});
      });
    },
    friendlyError(status, raw, model, details = "") {
      const configuredKey = String(this.pref("apiKey") || "");
      if (configuredKey) raw = String(raw || "").split(configuredKey).join("[clave ocultada]");
      const tech = raw ? " (Detalle: " + raw.slice(0, 160) + ")" : "";
      if (status === 401 || /invalid.*api.?key|api.?key.*invalid|unauthor/i.test(raw))
        return "La clave no es válida o no autoriza esta API. Revisa la clave y el proveedor en Ajustes → Zotero IA." + tech;
      if (status === 403 || /permission/i.test(raw))
        return "Tu proyecto no tiene permiso para este modelo o función. Revisa el acceso y el nivel del proyecto; cambiar la clave no siempre lo resuelve." + tech;
      if (status === 429) {
        if (/per[ _-]?day|daily|diari[oa]/i.test(String(raw)+" "+details))
          return "La API indica que el modelo «"+model+"» alcanzó su límite diario. Elige otro modelo disponible en Configurar IA o espera a que se renueve la cuota. El avance guardado se conserva.";
        return "La API ha limitado el uso del modelo «"+model+"» por ahora. Espera un momento y vuelve a intentarlo, o elige otro modelo disponible en Configurar IA. El avance guardado se conserva.";
      }
      if (status === 402 || /credit|balance|billing|quota|insufficient/i.test(raw))
        return "Tu cuenta no tiene saldo, crédito o cuota disponible en ese servicio." + tech;
      if (status === 404 || /model.*(not found|does not exist)|not found.*model/i.test(raw))
        return "El modelo «" + model + "» no existe o ya no está disponible para esta clave. " + (this.pref("provider") === "local" ? "Descárgalo en Ollama con: ollama pull " + model : "Vuelve a detectar y comprobar los modelos en Ajustes → Zotero IA.") + tech;
      if (/tool|function/i.test(raw)) return "Este modelo no sabe usar herramientas, que el Agente necesita. Prueba otro modelo (por ejemplo qwen3 en Ollama)." + tech;
      if (status >= 500 || /high demand|overloaded|unavailable/i.test(raw)) return "El servicio de IA está saturado temporalmente. Espera unos minutos y vuelve a intentarlo." + tech;
      return "Algo salió mal (código " + status + ")." + tech;
    },

    isConfigured() { return !!this.pref("provider"); },

    openPrefs() { Zotero.Utilities.Internal.openPreferences(prefPaneID); },

    async chat(messages, options = {}) {
      const m = await this.chatRaw(messages, null, options);
      if (!m.content) throw this.providerError("Respuesta vacía del modelo");
      return m.content;
    },

    // Texto del documento: PDF/EPUB/HTML indexado por Zotero + metadatos
    async getContext(item) {
      let parent = item;
      let att = null;
      if (item.isAttachment()) {
        att = item;
        parent = item.parentItem || item;
      } else if (item.isRegularItem()) {
        att = await item.getBestAttachment();
      }
      const meta = [];
      if (parent.isRegularItem && parent.isRegularItem()) {
        meta.push("Título: " + parent.getField("title"));
        const creators = parent.getCreatorsJSON().filter(c=>c.creatorType==="author").map(c => [c.firstName, c.lastName].filter(Boolean).join(" ")).join("; ");
        if (creators) meta.push("Autores: " + creators);
        const date = parent.getField("date");
        if (date) meta.push("Fecha: " + date);
        const abs = parent.getField("abstractNote");
        if (abs) meta.push("Resumen: " + abs);
      }
      let text = "";
      if (att) {
        try { text = (await att.attachmentText) || ""; } catch (e) { log(e); }
      }
      return { parent, meta: meta.join("\n"), text, truncated: false, parts: 1, hasAttachment: !!att };
    },

    async saveNote(parent, question, answer) {
      if(this.safe)return this.safe.note(parent,question,answer);
      const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = "<h2>Zotero IA</h2><p><b>Pregunta:</b> " + esc(question) + "</p>"
        + ZoteroIA.md2html(answer)
        + "<p><i>Modelo: " + esc(String(this.pref("model"))) + "</i></p>";
      const note = new Zotero.Item("note");
      note.libraryID = parent.libraryID;
      if (parent.isRegularItem()) note.parentID = parent.id;
      note.setNote(html);
      await note.saveTx();
    },
  };
  // Zotero IA 1.3.0: lectura crítica contextual y fichas vinculadas.
  // Usa la selección nativa, sin fabricar coordenadas ni modificar el PDF.
  selectionReadingHandler = ({ reader, doc, params, append }) => {
    const selected = String(params?.annotation?.text || "").trim();
    if (!selected) return;
    const outer = doc.createElement("section");
    outer.style.cssText = "max-width:380px;padding:8px;border-top:1px solid #aab5bf;font:12px/1.45 system-ui,sans-serif;white-space:normal;color:inherit";
    const label = doc.createElement("strong"); label.textContent = "Zotero IA · Lectura académica";
    const actions = doc.createElement("div"); actions.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin:7px 0";
    const output = doc.createElement("div"); output.style.cssText = "max-height:240px;overflow:auto;white-space:pre-wrap;user-select:text;overflow-wrap:anywhere";
    output.addEventListener("click",event=>ZoteroIA.handleResultLink(event,e=>{const msg=doc.createElement("p");msg.textContent=e.message;output.appendChild(msg);}));
    let response = "";
    const button = (name, callback) => {
      const btn=doc.createElement("button"); btn.type="button"; btn.textContent=name;
      btn.style.cssText="padding:4px 6px;border:1px solid #9aabb8;border-radius:5px;background:transparent;color:inherit;cursor:pointer";
      btn.addEventListener("click",async event=>{event.preventDefault();event.stopPropagation();await callback(btn);});
      actions.appendChild(btn);return btn;
    };
    const analyze = async (purpose, btn) => {
      if (!ZoteroIA.isConfigured()) {output.textContent="Configura tu proveedor de IA en las preferencias de Zotero IA.";return;}
      btn.disabled=true;output.textContent="Analizando la selección…";
      try {
        response = await ZoteroIA.chat([
          {role:"system",content:"Eres un lector académico crítico. Trabaja EXCLUSIVAMENTE con el fragmento suministrado, no inventes páginas, autorías, fuentes ni contexto. Distingue lo que dice el texto de tu interpretación. Si no puedes determinar algo, dilo explícitamente. Redacta en español. Objetivo: "+purpose},
          {role:"user",content:"TEXTO SELECCIONADO (fuente primaria de esta respuesta):\n"+selected.slice(0,12000)}
        ]);
        ZoteroIA.renderMarkdown(output,response || "Respuesta vacía");
      } catch(e){output.textContent="Error de análisis: "+(e.message||String(e));}
      finally {btn.disabled=false;}
    };
    button("Análisis crítico", b=>analyze("Identifica afirmación central, evidencia explícita, supuestos y una observación crítica breve.",b));
    button("Ficha del fragmento", b=>analyze("Elabora ficha breve con idea central, conceptos, cita exacta breve y pregunta abierta. No asignes página sin evidencia.",b));
    button("Guardar nota", async btn=>{
      btn.disabled=true;
      try {
        const attachmentID=reader?._itemID || reader?.itemID;
        if (!attachmentID) throw new Error("No se pudo identificar el PDF activo");
        const attachment=await Zotero.Items.getAsync(attachmentID);
        if (!attachment || !attachment.isAttachment()) throw new Error("El lector no devolvió un adjunto válido");
        const parentID=attachment.parentID || null;
        const escape = value=>String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
        const note=new Zotero.Item("note");note.libraryID=attachment.libraryID;
        if(parentID)note.parentID=parentID;
        const content="<h2>Ficha de lectura · Zotero IA</h2><p><strong>Fragmento seleccionado (sin página verificada)</strong></p><blockquote>"+escape(selected).replace(/\n/g,"<br/>")+"</blockquote>"+(response?"<h3>Análisis generado por IA</h3>"+ZoteroIA.md2html(response):"<p><i>Sin análisis automático. Fragmento conservado literalmente.</i></p>")+"<p><i>Fuente: adjunto "+attachmentID+". La página y la posición no fueron verificadas; comprueba el PDF antes de citar.</i></p>";
        note.setNote(content);await note.saveTx();
        output.textContent="Nota creada (ID "+note.id+"). "+(parentID?"Vinculada a la referencia.":"El PDF no tiene referencia padre; nota independiente.");
      }catch(e){output.textContent="No se pudo guardar: "+(e.message||String(e));}
      finally{btn.disabled=false;}
    });
    const hint=doc.createElement("small");hint.textContent="Para resaltar usa los colores nativos de Zotero. No se generan subrayados sin posición comprobada.";
    hint.style.cssText="display:block;opacity:.8;margin-top:4px";
    outer.append(label,actions,output,hint);append(outer);
  };
  if (Zotero.Reader?.registerEventListener) {
    Zotero.Reader.registerEventListener("renderTextSelectionPopup",selectionReadingHandler,id);
  }
  ZoteroIA.openDocument = (itemID, question) => openAgent({kind:"document-action", itemID, question});
  Zotero.ZoteroIA = ZoteroIA;
  Services.scriptloader.loadSubScript(rootURI + "models.js", { Zotero, ZoteroIA, crypto, TextEncoder });
  Services.scriptloader.loadSubScript(rootURI + "agent.js", { Zotero, ZoteroIA, Services, IOUtils, PathUtils, DOMParser, XMLSerializer, URL });
  Services.scriptloader.loadSubScript(rootURI + "help.js", { Zotero, ZoteroIA, Services });
  Services.scriptloader.loadSubScript(rootURI + "content/prefs-pane.js", { Zotero, ZoteroIA, Services });

  await ZoteroIA.initJournal();
  for(const module of ["columns.js","research.js","reading.js","safe-changes.js","library-tools.js","pdf-metadata.js","reader-context.js","imports.js","exports.js","export-links.js","answers.js","citation-notes.js","word-export.js","native-reports.js","pdfs.js","projects.js","inciteful.js"]) {
    Services.scriptloader.loadSubScript(rootURI+module,{Zotero,ZoteroIA,Services,Components,IOUtils,PathUtils,DOMParser,XMLSerializer,URL,crypto,TextEncoder,TextDecoder,ChromeUtils});
  }
  await ZoteroIA.initResearch();
  await ZoteroIA.modelPolicy.restore();
  await ZoteroIA.projects.init();


  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  // Fluent files in locale/<locale> are registered automatically by Zotero.
  chromeHandle = aomStartup.registerChrome(manifestURI, [["content", "zotero-ia", rootURI + "content/"]]);

  prefPaneID = await Zotero.PreferencePanes.register({
    pluginID: id,
    src: "chrome://zotero-ia/content/preferences.xhtml",
    label: "Zotero IA",
  });

  sectionID = Zotero.ItemPaneManager.registerSection({
    paneID: "zotero-ia-section",
    pluginID: id,
    header: { l10nID: "zotero-ia-section-header", icon: "chrome://zotero-ia/content/icons/zia.svg" },
    sidenav: { l10nID: "zotero-ia-section-sidenav", icon: "chrome://zotero-ia/content/icons/zia.svg" },
    bodyXHTML: `
      <html:style>
        .zia-card {padding:10px;font:menu;color:var(--fill-primary,CanvasText);}
        .zia-launch {width:100%;min-height:36px;border:1px solid var(--accent-blue,AccentColor);border-radius:8px;background:var(--accent-blue,AccentColor);color:HighlightText;font-weight:600;cursor:pointer;}
        .zia-main {flex-direction:column;gap:9px;margin-top:12px;}
        .zia-heading {font-size:12px;font-weight:600;}
        .zia-subject {font-size:12px;line-height:1.45;overflow-wrap:anywhere;}
        .zia-caption {font-size:11px;line-height:1.45;opacity:.75;}
        .zia-quick-row {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;}
        .zia-quick,.zia-setup-btn {min-height:34px;padding:6px 4px;border:1px solid var(--material-border,#cbd2db);border-radius:7px;background:var(--material-background,Canvas);color:inherit;font:inherit;font-size:11px;white-space:normal;cursor:pointer;}
        .zia-quick:disabled {opacity:.5;cursor:default;}
        .zia-setup {margin-top:10px;font-size:11px;line-height:1.5;}
      </html:style>
      <html:div class="zia-card">
        <html:button class="zia-launch">Abrir asistente Zotero IA</html:button>
        <html:div class="zia-setup" style="display:none">Conecta tu IA para leer documentos. <html:button class="zia-setup-btn">Configurar IA</html:button></html:div>
        <html:div class="zia-main">
          <html:div class="zia-heading">Documento seleccionado</html:div>
          <html:div class="zia-subject"/>
          <html:div class="zia-quick-row">
            <html:button class="zia-quick" data-q="Resume este documento en un párrafo: tema, argumento central, fuentes y conclusiones.">Resumir</html:button>
            <html:button class="zia-quick" data-q="¿Cuál es la pregunta de investigación, la metodología y las fuentes que usa este documento?">Método y fuentes</html:button>
            <html:button class="zia-quick" data-q="Haz una ficha de lectura académica de este documento: tesis, método, fuentes, conceptos centrales y limitaciones.">Ficha de lectura</html:button>
          </html:div>
          <html:div class="zia-caption">La lectura se abre en el asistente, con avance, fuentes y opción de guardarla como nota.</html:div>
        </html:div>
      </html:div>`,
    onInit: ({ body }) => {
      body.querySelector(".zia-launch").addEventListener("click", () => openAgent());
      body.querySelector(".zia-setup-btn").addEventListener("click", () => ZoteroIA.openPrefs());
      body._ziaCheck = () => {
        const item=body._ziaItem,ok=ZoteroIA.isConfigured();
        const eligible=!!item&&!item.deleted&&(item.isRegularItem()||item.isAttachment());
        body.querySelector(".zia-setup").style.display=ok?"none":"block";
        body.querySelector(".zia-main").style.display=eligible?"flex":"none";
        body.querySelector(".zia-subject").textContent=eligible?item.getField("title")||"Documento sin título":"";
        for(const button of body.querySelectorAll(".zia-quick"))button.disabled=!ok||!eligible;
      };
      for(const button of body.querySelectorAll(".zia-quick"))button.addEventListener("click",()=>{
        const item=body._ziaItem;
        if(button.disabled||!item||item.deleted)return;
        ZoteroIA.openDocument(item.id,button.dataset.q);
      });
      body._ziaCheck();
    },
    onItemChange: ({ body, item, setEnabled }) => {
      body._ziaItem = item;
      if (body._ziaCheck) body._ziaCheck();
      setEnabled(true); // La sección permite abrir el agente incluso sin un documento seleccionado.
      if (body._ziaCheck) body._ziaCheck();
    },
    onRender: ({ body, item }) => { if (item) body._ziaItem = item; if (body._ziaCheck) body._ziaCheck(); },
  });

  for (const win of Zotero.getMainWindows()) onMainWindowLoad({ window: win });
  log("iniciado " + version);
}

function openAgent(request) {
  if(request?.kind==="document-action"&&Number.isSafeInteger(request.itemID)&&request.itemID>0&&typeof request.question==="string"&&request.question.trim()){
    const key=request.itemID+":"+request.question;
    ZoteroIA.documentRequests=ZoteroIA.documentRequests||[];
    if(ZoteroIA.documentActionActive!==key&&!ZoteroIA.documentRequests.some(r=>r.key===key))ZoteroIA.documentRequests.push({...request,key});
  }
  const w = Services.wm.getMostRecentWindow("zotero-ia:agent");
  if (w) { w.focus();w.dispatchEvent(new w.Event("zia-document-request"));return; }
  Services.ww.openWindow(null, "chrome://zotero-ia/content/agent.xhtml", "zotero-ia-agent", "chrome,resizable,centerscreen,width=1080,height=780", null);
}

function onMainWindowLoad({ window }) {
  window.MozXULElement.insertFTLIfNeeded("zotero-ia.ftl");
  const doc = window.document;
  const popup = doc.getElementById("menu_ToolsPopup");
  if (popup && !doc.getElementById("zotero-ia-menu")) {
    const mi = doc.createXULElement("menuitem");
    mi.id = "zotero-ia-menu";
    mi.setAttribute("label", "Agente Zotero IA");
    mi.setAttribute("key", "");
    mi.addEventListener("command", openAgent);
    popup.appendChild(mi);
  }
}

function onMainWindowUnload({ window }) {
  const mi = window.document.getElementById("zotero-ia-menu");
  if (mi) mi.remove();
  const l = window.document.querySelector('[href="zotero-ia.ftl"]');
  if (l) l.remove();
}

async function shutdown() {
  if (selectionReadingHandler && Zotero.Reader?.unregisterEventListener) {
    try { Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", selectionReadingHandler); } catch(e) { log("No se pudo retirar la lectura académica: " + e); }
  }
  selectionReadingHandler = null;
  if (sectionID) Zotero.ItemPaneManager.unregisterSection(sectionID);
  for (const win of Zotero.getMainWindows()) onMainWindowUnload({ window: win });
  const w = Services.wm.getMostRecentWindow("zotero-ia:agent");
  if (w) w.close();
  if (chromeHandle) { chromeHandle.destruct(); chromeHandle = null; }
  try { await ZoteroIA?.projects?.pending; await ZoteroIA?.research?.writeQueue; await ZoteroIA?.taskJournal?.pending; } catch(e) { log("Guardado pendiente al cerrar: "+e); }
  delete Zotero.ZoteroIA;
  ZoteroIA = undefined;
}
