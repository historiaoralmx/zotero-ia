/* global Zotero, Services */
var ZoteroIA;
var sectionID = null;
var chromeHandle = null;
var prefPaneID = null;
var selectionTranslationHandler = null;
var selectionTranslationCache = new Map();
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
        gemini: "gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
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
        const reasoning=/^(?:o[134](?:-|$)|gpt-[56](?:[.-]|$))/i.test(m);
        if(this.research){if(reasoning||this._completionTokenModels?.has(m))payload.max_completion_tokens=this.research.settings().output;else payload.max_tokens=this.research.settings().output;}
        // Claude newer models reject temperatures below 1; omit when using Anthropic.
        if (!reasoning&&!/claude/i.test(m) && this.pref("provider") !== "claude"&&!this._defaultTemperatureModels?.has(base+"/"+m)) payload.temperature = 0.2;
        if (this.pref("provider") === "gemini" && !this._noEffort) payload.reasoning_effort = "low";
        if (tools && tools.length) payload.tools = tools;
        for (let attempt = 0; attempt < (testOnly ? 1 : 2); attempt++) {
          checkAbort();
          if (protectedContext) this.modelPolicy.assertUnchanged(protectedContext);
          try {
            xhr = await this.requestModel("POST", base + "/chat/completions", {
              headers, body: JSON.stringify(payload), responseType: "json", timeout: testOnly ? 20000 : 45000, successCodes: false,
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
        if (lastNetErr && /timed out|timeout/i.test(String(lastNetErr.message))) throw this.providerError("El servicio de IA no respondió a tiempo (probé " + models.join(", ") + "). Intenta en unos minutos.");
        throw this.providerError("No hay conexión con el servicio de IA. Revisa tu internet e intenta de nuevo.");
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
        throw this.providerError(this.friendlyError(xhr.status, raw, model));
      }
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      if (!msg) throw this.providerError("Respuesta vacía del modelo");
      checkAbort();
      this.lastModel = model;
      this.lastLatencyMs = Date.now() - t0;
      this.lastFallback = model !== main;
      const clean = { role: "assistant", content: msg.content || "" };
      if (msg.tool_calls && msg.tool_calls.length) clean.tool_calls = msg.tool_calls;
      return clean;
    },

    providerError(message) { const error = new Error(message); error.name = "ProviderError"; return error; },
    requestModel(method,url,options) { return Zotero.HTTP.request(method,url,options); },
    waitAbortable(ms,signal) {
      return new Promise((resolve,reject)=>{
        const stop=()=>{clearTimeout(timer);reject(new Error("Tarea detenida por el usuario"));};
        const timer=setTimeout(()=>{signal?.removeEventListener("abort",stop);resolve();},ms);
        if(signal?.aborted)stop();else signal?.addEventListener("abort",stop,{once:true});
      });
    },
    friendlyError(status, raw, model) {
      const configuredKey = String(this.pref("apiKey") || "");
      if (configuredKey) raw = String(raw || "").split(configuredKey).join("[clave ocultada]");
      const tech = raw ? " (Detalle: " + raw.slice(0, 160) + ")" : "";
      if (status === 401 || /invalid.*api.?key|api.?key.*invalid|unauthor/i.test(raw))
        return "La clave no es válida o no autoriza esta API. Revisa la clave y el proveedor en Ajustes → Zotero IA." + tech;
      if (status === 403 || /permission/i.test(raw))
        return "Tu proyecto no tiene permiso para este modelo o función. Revisa el acceso y el nivel del proyecto; cambiar la clave no siempre lo resuelve." + tech;
      if (status === 429 && /quota|exceeded/i.test(raw) && /free|tier|generativelanguage|gemini/i.test(raw + " " + this.pref("baseURL")))
        return "El proveedor indica un límite de cuota para este modelo. Puede ser por minuto, por día o por falta de acceso al nivel gratuito. Consulta los límites de tu proyecto en AI Studio; no se ha activado facturación." + tech;
      if (status === 402 || /credit|balance|billing|quota|insufficient/i.test(raw))
        return "Tu cuenta no tiene saldo, crédito o cuota disponible en ese servicio." + tech;
      if (status === 429) return "Llegaste al límite de uso por ahora. Espera un minuto (o hasta mañana en planes gratuitos) e intenta de nuevo." + tech;
      if (status === 404 || /model.*(not found|does not exist)|not found.*model/i.test(raw))
        return "El modelo «" + model + "» no existe o ya no está disponible para esta clave. " + (this.pref("provider") === "local" ? "Descárgalo en Ollama con: ollama pull " + model : "Vuelve a detectar y comprobar los modelos en Ajustes → Zotero IA.") + tech;
      if (/tool|function/i.test(raw)) return "Este modelo no sabe usar herramientas, que el Agente necesita. Prueba otro modelo (por ejemplo qwen3 en Ollama)." + tech;
      if (status >= 500 || /high demand|overloaded|unavailable/i.test(raw)) return "El servicio de IA está saturado en este momento (lo intenté varias veces). Espera unos minutos o, en Opciones avanzadas, cambia a otro modelo." + tech;
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
  // Traducción contextual en el menú nativo de selección del lector PDF.
  // El texto se entrega únicamente a la API configurada por el usuario.
  selectionTranslationHandler = ({ doc, params, append }) => {
    const text = String(params && params.annotation && params.annotation.text || "").trim();
    if (!text || text.length > 5000 || !ZoteroIA.isConfigured()) return;
    const box = doc.createElement("div");
    box.style.cssText = "box-sizing:border-box;max-width:360px;min-width:190px;padding:8px 10px;margin:4px 0;border:1px solid var(--material-border, #cbd5dd);border-radius:8px;background:var(--material-background, #fff);color:var(--fill-primary, #222);font:12px/1.5 system-ui,sans-serif;white-space:normal;";
    const line = doc.createElement("div");
    line.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px";
    const heading=doc.createElement("strong");heading.textContent="Zotero IA · Español";
    const retry=doc.createElement("button");retry.type="button";retry.textContent="Traducir";retry.title="Traducir solo cuando lo solicites";
    retry.style.cssText="cursor:pointer;border:1px solid #aebdc8;background:transparent;border-radius:5px;padding:3px 9px;color:inherit";
    const body=doc.createElement("div");body.style.cssText="max-height:180px;overflow:auto;overflow-wrap:anywhere;user-select:text";
    // Una selección nunca inicia una solicitud a Gemini: el usuario debe pulsar Traducir.
    body.textContent="Selecciona Traducir para consultar tu proveedor de IA.";
    line.appendChild(heading);line.appendChild(retry);box.appendChild(line);box.appendChild(body);append(box);
    let active=true;
    const translate = async (force=false) => {
      const cacheKey = String(ZoteroIA.pref("model")) + "|" + text;
      if(!force && selectionTranslationCache.has(cacheKey)) {body.textContent=selectionTranslationCache.get(cacheKey);return;}
      body.textContent="Traduciendo…";retry.disabled=true;retry.textContent="Traduciendo…";
      try {
        const result=await ZoteroIA.chat([
          {role:"system",content:"Traduce fielmente al español el texto académico proporcionado. Conserva nombres propios, referencias y citas. Responde únicamente con la traducción, sin comentarios."},
          {role:"user",content:text}
        ]);
        if (!result || typeof result!=="string") throw new Error("Traducción vacía");
        if (selectionTranslationCache.size>=120) selectionTranslationCache.delete(selectionTranslationCache.keys().next().value);
        selectionTranslationCache.set(cacheKey,result);
        if (active && box.isConnected) body.textContent=result;
      } catch(e) {if(active && box.isConnected) body.textContent="No se pudo traducir: "+(e.message||String(e));}
      finally {if(active && box.isConnected) {retry.disabled=false;retry.textContent="Traducir";}}
    };
    retry.addEventListener("click",ev=>{ev.preventDefault();ev.stopPropagation();translate(false);});
    // No hay llamadas de red al seleccionar texto. Solo al pulsar Traducir.
  };
  if (Zotero.Reader && Zotero.Reader.registerEventListener) {
    Zotero.Reader.registerEventListener("renderTextSelectionPopup",selectionTranslationHandler,id);
  }
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
  Zotero.ZoteroIA = ZoteroIA;
  Services.scriptloader.loadSubScript(rootURI + "models.js", { Zotero, ZoteroIA, crypto, TextEncoder });
  Services.scriptloader.loadSubScript(rootURI + "agent.js", { Zotero, ZoteroIA, Services, IOUtils, PathUtils, DOMParser, XMLSerializer, URL });
  Services.scriptloader.loadSubScript(rootURI + "content/prefs-pane.js", { Zotero, ZoteroIA, Services });

  await ZoteroIA.initJournal();
  for(const module of ["columns.js","research.js","reading.js","safe-changes.js","exports.js","export-links.js","answers.js","pdfs.js","projects.js","inciteful.js"]) {
    Services.scriptloader.loadSubScript(rootURI+module,{Zotero,ZoteroIA,Services,IOUtils,PathUtils,DOMParser,XMLSerializer,URL,crypto,TextEncoder,TextDecoder,ChromeUtils});
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
        .zia-launch {display:flex;align-items:center;justify-content:center;gap:7px;width:100%;min-height:36px;margin:0 0 7px;border:1px solid var(--accent-blue, AccentColor);border-radius:8px;background:var(--accent-blue, AccentColor);color:HighlightText;font-size:12px;font-weight:650;cursor:pointer;}
        .zia-launch:hover {background:var(--accent-blue, AccentColor);}
        .zia-launch:focus-visible {outline:2px solid var(--accent-blue, AccentColor);outline-offset:2px;}
        .zia-card {display:flex;flex-direction:column;gap:10px;padding:10px 9px 12px;box-sizing:border-box;font:menu;color:var(--fill-primary,inherit);}
        .zia-card-head {display:flex;align-items:center;gap:8px;min-width:0;}
        .zia-mark {width:28px;height:28px;border-radius:9px;background:color-mix(in srgb, var(--accent-blue, AccentColor) 12%, transparent);color:var(--accent-blue, AccentColor);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
        .zia-head-copy {display:flex;flex-direction:column;min-width:0;gap:2px;}
        .zia-heading {font-size:13px;font-weight:650;letter-spacing:-.15px;}
        .zia-subtitle {font-size:11px;opacity:.65;line-height:1.3;}
        .zia-quick-row {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;}
        .zia-quick {min-width:0;min-height:32px;padding:5px 3px;border:1px solid var(--material-border, #d4d9df);border-radius:7px;background:var(--material-background,transparent);font-size:11px;line-height:1.2;cursor:pointer;white-space:normal;text-align:center;color:inherit;}
        .zia-quick:hover {background:color-mix(in srgb, var(--accent-blue, AccentColor) 12%, transparent);border-color:var(--accent-blue, AccentColor);}
        .zia-q {width:100%;min-height:75px;resize:vertical;box-sizing:border-box;padding:9px 10px;border:1px solid var(--material-border,#cbd2db);border-radius:8px;background:var(--material-background,transparent);color:inherit;font:inherit;font-size:12px;line-height:1.5;outline-offset:2px;}
        .zia-q:focus {border-color:var(--accent-blue, AccentColor);outline:1px solid var(--accent-blue, AccentColor);}
        .zia-q::placeholder {opacity:.6;}
        .zia-actions {display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
        .zia-send {flex:1 1 100px;min-height:32px;padding:6px 10px;border:1px solid var(--accent-blue, AccentColor);border-radius:7px;background:var(--accent-blue, AccentColor);color:HighlightText;font-weight:600;font-size:12px;cursor:pointer;}
        .zia-send:hover {background:var(--accent-blue, AccentColor);}
        .zia-send:disabled {opacity:.55;cursor:default;}
        .zia-note {flex:1 1 120px;min-height:32px;padding:6px 8px;border:1px solid var(--material-border,#cbd2db);border-radius:7px;background:var(--material-background,transparent);color:inherit;font-size:12px;cursor:pointer;}
        .zia-note:disabled {opacity:.5;cursor:default;}
        .zia-out {white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font-size:12px;line-height:1.55;max-height:340px;overflow-y:auto;padding:10px;border-radius:8px;border:1px solid var(--material-border,#d5dbe2);background:var(--material-background,transparent);}
        .zia-out:empty {display:none;}
        .zia-hint {font-size:10px;opacity:.6;text-align:right;}
        .zia-setup {border:1px solid var(--material-border, #c5a77a);background:var(--material-background, Canvas);color:var(--fill-primary, CanvasText);border-radius:8px;padding:10px;margin:4px 9px;}
      </html:style>
      <html:div style="padding:10px 9px 0"><html:button class="zia-launch" title="Abrir la ventana del agente autónomo Zotero IA">✦  Abrir agente Zotero IA</html:button></html:div>
      <html:div class="zia-setup" style="display:none">
        <html:div style="font-size:12px;line-height:1.45;margin-bottom:8px">Configura un modelo de IA para analizar tus documentos.</html:div>
        <html:button class="zia-setup-btn">Configurar IA</html:button>
      </html:div>
      <html:div class="zia-main zia-card">
        <html:div class="zia-card-head">
          <html:div class="zia-mark">✦</html:div>
          <html:div class="zia-head-copy"><html:div class="zia-heading">Asistente de lectura</html:div><html:div class="zia-subtitle">Consulta el documento seleccionado</html:div></html:div>
        </html:div>
        <html:div class="zia-quick-row">
          <html:button class="zia-quick" data-q="Resume este documento en un párrafo: tema, argumento central, fuentes y conclusiones.">Resumen</html:button>
          <html:button class="zia-quick" data-q="¿Cuál es la pregunta de investigación, la metodología y las fuentes que usa este documento?">Método y fuentes</html:button>
          <html:button class="zia-quick" data-q="Haz una ficha de lectura académica de este documento: referencia, tesis, argumentos principales, conceptos clave, citas textuales relevantes con página, y valoración crítica.">Ficha de lectura</html:button>
        </html:div>
        <html:textarea class="zia-q" rows="3" aria-label="Pregunta sobre el documento" placeholder="Pregunta algo sobre este documento…"></html:textarea>
        <html:div class="zia-actions">
          <html:button class="zia-send">Preguntar  ↗</html:button>
          <html:button class="zia-note" disabled="true">Guardar nota</html:button>
        </html:div>
        <html:div class="zia-hint">Ctrl + Enter para enviar</html:div>
        <html:div class="zia-out" aria-live="polite"></html:div>
      </html:div>`,
    onInit: ({ body }) => {
      body.querySelector(".zia-launch").addEventListener("click", () => openAgent());
      const q = body.querySelector(".zia-q");
      const out = body.querySelector(".zia-out");
      out.addEventListener("click",event=>ZoteroIA.handleResultLink(event,e=>{const msg=out.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml","p");msg.textContent=e.message;out.appendChild(msg);}));
      const send = body.querySelector(".zia-send");
      const noteBtn = body.querySelector(".zia-note");
      let last = null,epoch=0,readingController=null;
      body.querySelector(".zia-setup-btn").addEventListener("click", () => ZoteroIA.openPrefs());
      body._ziaCheck = () => {
        const ok = ZoteroIA.isConfigured();
        body.querySelector(".zia-setup").style.display = ok ? "none" : "block";
        body.querySelector(".zia-main").style.display = ok && body._ziaItem && (body._ziaItem.isRegularItem() || body._ziaItem.isAttachment()) ? "flex" : "none";
      };

      const run = async (question,mode="passages") => {
        if(mode==="passages"&&/^(?:resume|resumir|haz(?:me)? (?:un resumen|una ficha)|elabora (?:un resumen|una ficha)|analiza (?:todo|el documento)|lee (?:todo|el documento))/i.test(question.trim()))mode="full";
        const item = body._ziaItem;
        if (!item || !question.trim()||send.disabled) return;
        const current=++epoch,Controller=body.ownerDocument?.defaultView?.AbortController||globalThis.AbortController;readingController=new Controller();
        send.disabled = true;
        noteBtn.disabled = true;
        out.textContent = "Pensando…";
        try {
          const { answer, ctx } = await ZoteroIA.ask(item, question, (i, n, done) => {
            if(current===epoch)out.textContent = done ? "Lectura de los fragmentos recuperados completada…" : "Procesando fragmentos: " + i + " / " + n + "…";
          },{mode,signal:readingController.signal});
          if(current!==epoch||body._ziaItem?.id!==item.id)return;
          ZoteroIA.renderMarkdown(out,answer);
          last = { parent: ctx.parent, question, answer };
          noteBtn.disabled = false;
        } catch (e) {
          if(current===epoch)out.textContent = "Error: " + e.message;
        } finally {
          if(current===epoch)send.disabled = false;
        }
      };

      send.addEventListener("click", () => run(q.value));
      q.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(q.value);
      });
      for (const b of body.querySelectorAll(".zia-quick")) {
        b.addEventListener("click", () => { if(send.disabled)return;q.value = b.dataset.q; run(b.dataset.q,"full"); });
      }
      noteBtn.addEventListener("click", async () => {
        if (!last) return;
        try {
          await ZoteroIA.saveNote(last.parent, last.question, last.answer);
          noteBtn.disabled = true;
          noteBtn.textContent = "✔ Nota guardada";
          setTimeout(() => { noteBtn.textContent = "Guardar nota"; }, 2000);
        } catch (e) { out.textContent += "\n\nError al guardar: " + e.message; }
      });
      body._ziaReset = () => {epoch++;readingController?.abort();out.textContent = "";last = null;noteBtn.disabled = true;send.disabled=false;};
    },
    onItemChange: ({ body, item, setEnabled }) => {
      body._ziaItem = item;
      if (body._ziaCheck) body._ziaCheck();
      setEnabled(true); // La sección permite abrir el agente incluso sin un documento seleccionado.
      if (body._ziaReset) body._ziaReset();
      if (body._ziaCheck) body._ziaCheck();
    },
    onRender: ({ body, item }) => { if (item) body._ziaItem = item; if (body._ziaCheck) body._ziaCheck(); },
  });

  for (const win of Zotero.getMainWindows()) onMainWindowLoad({ window: win });
  log("iniciado " + version);
}

function openAgent() {
  const w = Services.wm.getMostRecentWindow("zotero-ia:agent");
  if (w) { w.focus(); return; }
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
  if (selectionTranslationHandler && Zotero.Reader && Zotero.Reader.unregisterEventListener) {
    try { if (selectionReadingHandler) Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", selectionReadingHandler); } catch(e) { log("No se pudo retirar la lectura académica: " + e); }
    try { Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", selectionTranslationHandler); } catch(e) { log("No se pudo retirar el traductor: " + e); }
  }
  selectionTranslationHandler = null;
  selectionTranslationCache.clear();
  if (sectionID) Zotero.ItemPaneManager.unregisterSection(sectionID);
  for (const win of Zotero.getMainWindows()) onMainWindowUnload({ window: win });
  const w = Services.wm.getMostRecentWindow("zotero-ia:agent");
  if (w) w.close();
  if (chromeHandle) { chromeHandle.destruct(); chromeHandle = null; }
  try { await ZoteroIA?.projects?.pending; await ZoteroIA?.research?.writeQueue; await ZoteroIA?.taskJournal?.pending; } catch(e) { log("Guardado pendiente al cerrar: "+e); }
  delete Zotero.ZoteroIA;
  ZoteroIA = undefined;
}
