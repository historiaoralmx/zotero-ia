/* global Zotero, ZoteroIA, crypto, TextEncoder */
// A catalog is evidence of existence, never evidence of a zero-price account.
// Only the user's provider account can enforce that no billing is enabled.
(function (Z) {
  "use strict";
  const policyVersion = "2026-11-19";
  const services = {
    gemini: {
      base: "https://generativelanguage.googleapis.com/v1beta/openai",
      // Exact IDs with Standard Free Tier input/output pricing checked on the date above.
      // Never allow floating *-latest aliases or infer a price from a model's name.
      allowed: ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
      pricing: "https://ai.google.dev/gemini-api/docs/pricing",
    },
    zai: {
      base: "https://api.z.ai/api/paas/v4",
      allowed: ["glm-4.7-flash", "glm-4.5-flash"],
      pricing: "https://docs.z.ai/guides/overview/pricing",
    },
  };
  // Verify old proofs against the exact old policy, then keep only its still-allowed models.
  // Adding a new model to the policy must never mark it as tested for an existing key.
  const previousPolicy = {
    version: "2026-11-06",
    gemini: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"],
    zai: ["glm-4.7-flash", "glm-4.5-flash"],
  };
  const fail = message => { const error = new Error(message); error.name = "ModelPolicyError"; throw error; };
  const read = key => String(Z.pref(key) || "").trim();
  const binding = () => JSON.stringify([read("provider"), read("baseURL").replace(/\/+$/, ""), read("apiKey"), Z.pref("freeModelsOnly") !== false]);
  const P = Z.modelPolicy = {
    policyVersion,
    busy: false,
    catalog: [],
    verified: [],
    results: [],
    checkedAt: 0,
    restricted() { return !!services[read("provider")] && Z.pref("freeModelsOnly") !== false; },
    service() { return services[read("provider")]; },
    context() { return binding(); },
    assertUnchanged(original) { if (original !== binding()) fail("La configuración cambió durante la consulta. Repite la comprobación con la clave y el proveedor actuales."); },
    invalidate() { this.catalog = []; this.verified = []; this.results = []; this.checkedAt = 0; this._binding = ""; this._catalogBinding = ""; Z._dead = {};Zotero.Prefs.set(Z.P+"modelProof","",true); },
    current() { return this._binding === binding() && this.checkedAt > 0 && this.verified.length>0; },
    async fingerprint(models=this.verified,checkedAt=this.checkedAt,policy=policyVersion,allowed=this.service()?.allowed){const text=JSON.stringify([policy,binding(),Z.pref("freeTierConfirmed")===true,allowed,models,checkedAt]);return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,"0")).join("");},
    async saveProof(){
      if(!this.current())return;
      const original=binding(),models=this.verified.slice(),checkedAt=this.checkedAt,fingerprint=await this.fingerprint(models,checkedAt);this.assertUnchanged(original);
      Zotero.Prefs.set(Z.P+"modelProof",JSON.stringify({version:1,policyVersion,fingerprint,models,checkedAt}),true);
    },
    async restore(){
      if(!this.restricted())return false;
      const original=binding();
      try{
        this.assertContext();const proof=JSON.parse(String(Z.pref("modelProof")||"null"));
        const legacy=proof?.policyVersion===previousPolicy.version;
        const allowed=legacy?previousPolicy[read("provider")]:this.service().allowed;
        if(!proof||proof.version!==1||(!legacy&&proof.policyVersion!==policyVersion)||!Array.isArray(proof.models)||!proof.models.length||proof.models.some(m=>!allowed.includes(m))||!Number.isFinite(proof.checkedAt)||proof.checkedAt<=0||proof.checkedAt>Date.now()+60000||proof.fingerprint!==await this.fingerprint(proof.models,proof.checkedAt,proof.policyVersion,allowed))return false;
        const verified=[...new Set(proof.models)].filter(model=>this.service().allowed.includes(model));
        if(!verified.length)return false;
        this.assertUnchanged(original);this.verified=verified;this.results=this.verified.map(model=>({model,ok:true}));this.checkedAt=proof.checkedAt;this._binding=original;
        if(legacy){
          if(!verified.includes(read("model")))Zotero.Prefs.set(Z.P+"model",verified[0],true);
          try{await this.saveProof();}catch(_){Zotero.debug?.("Zotero IA: no se pudo actualizar la comprobación guardada.");}
        }
        return true;
      }catch(_){return false;}
    },
    async rejectModel(model){
      this.verified=this.verified.filter(m=>m!==model);
      if(!this.verified.length){this.invalidate();return;}
      if(read("model")===model)Zotero.Prefs.set(Z.P+"model",this.verified[0],true);
      await this.saveProof();
    },
    assertContext() {
      const service = this.service();
      if (!service || read("baseURL").replace(/\/+$/, "") !== service.base)
        fail("El modo con nivel gratuito requiere la dirección oficial del proveedor. Vuelve a seleccionarlo en Ajustes → Zotero IA.");
      if (!read("apiKey")) fail("Pega tu clave API en Ajustes → Zotero IA.");
      if (read("provider") === "gemini" && Z.pref("freeTierConfirmed") !== true)
        fail("Para usar Gemini gratis, confirma que no activaste pagos para esta clave. Puedes revisar cómo hacerlo en Ajustes → Zotero IA.");
    },
    models(main, options = {}) {
      if (!this.restricted()) return null;
      this.assertContext();
      if (options.policyProbe) {
        const candidate = options.probeModel;
        if (!this.busy || this._catalogBinding !== binding() || !this.catalog.includes(candidate) || !this.service().allowed.includes(candidate))
          fail("Modelo de prueba no autorizado por la lista permitida y el catálogo.");
        return [candidate];
      }
      if (!this.current()) fail("Falta la comprobación de conexión con esta configuración. Abre Ajustes → Zotero IA y pulsa «Comprobar conexión».");
      if (!this.service().allowed.includes(main) || !this.verified.includes(main))
        fail("El modelo seleccionado no está comprobado para este modo. Elige uno de la lista en Ajustes → Zotero IA.");
      return [main].concat(options.testOnly ? [] : this.verified.filter(m => m !== main));
    },
    async detect() {
      if (!this.restricted()) fail("La detección protegida se utiliza con Gemini o Z.ai en el modo con nivel gratuito.");
      const service = this.service(), original = binding();
      // Catalog reads do not generate content. Require no billing confirmation yet.
      if (read("baseURL").replace(/\/+$/, "") !== service.base) fail("Selecciona de nuevo el proveedor para utilizar su dirección oficial.");
      if (!read("apiKey")) fail("Pega primero tu clave API.");
      if (this._binding && this._binding !== original) this.invalidate();
      this.catalog = [];
      this._catalogBinding = "";
      if (read("provider") === "zai") {
        // Z.ai's documented completion API accepts a model ID directly. Its catalog
        // is not a reliable prerequisite for access to the free legacy Flash models.
        // These are candidates, not verified models; prepare() must test each one.
        this.catalog = service.allowed.slice();
        this._catalogBinding = original;
        return this.catalog.slice();
      }
      const found = new Set();
      let token = "", pages = 0;
      do {
        const gemini = read("provider") === "gemini";
        const url = gemini
          ? "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000" + (token ? "&pageToken=" + encodeURIComponent(token) : "")
          : service.base + "/models";
        let response;
        try {
          response = await Zotero.HTTP.request("GET", url, {
            headers: gemini ? {"x-goog-api-key": read("apiKey")} : {Authorization: "Bearer " + read("apiKey")},
            responseType: "json", timeout: 12000, successCodes: false,
          });
        } catch (_) { fail("No se pudo consultar el catálogo. Revisa internet y vuelve a intentar; no se probaron modelos desconocidos."); }
        if (original !== binding()) fail("La configuración cambió durante la detección. Repite la comprobación.");
        if ([401, 403].includes(response.status)) this.invalidate();
        if (response.status < 200 || response.status >= 300) fail(Z.friendlyError(response.status, "No se pudo consultar el catálogo del proveedor.", ""));
        const data = response.response || {};
        for (const m of (gemini ? data.models : data.data) || []) {
          if (gemini && !m.supportedGenerationMethods?.includes("generateContent")) continue;
          const name = String(m.name || m.id || "").replace(/^models\//, "");
          if (service.allowed.includes(name)) found.add(name);
        }
        token = gemini ? String(data.nextPageToken || "") : "";
        if (++pages > 10 && token) fail("Catálogo incompleto. Repite la detección; no se guardaron resultados parciales.");
      } while (token);
      this.catalog = service.allowed.filter(m => found.has(m));
      this._catalogBinding = original;
      if (!this.catalog.length) fail("El catálogo no incluye modelos de la lista con nivel gratuito revisada el " + policyVersion + ". Revisa el acceso de tu proyecto o actualiza el plugin. No se cambiará a un modelo de pago.");
      return this.catalog.slice();
    },
    async prepare(onProgress = () => {}, {selectedOnly = false} = {}) {
      if (this.busy) fail("Ya hay una comprobación en curso.");
      this.assertContext();
      const main = read("model");
      if (selectedOnly && !this.service().allowed.includes(main))
        fail("Elige primero un modelo de la lista para comprobarlo.");
      this.busy = true;
      const original = binding();
      const previous = this.current() ? this.verified.slice() : [];
      const previousCheckedAt = this.checkedAt;
      const successful = [];
      const retained = [];
      this.results = [];
      try {
        onProgress(read("provider") === "zai" ? "Preparando los modelos gratuitos para comprobar…" : "Consultando los modelos disponibles…");
        await this.detect();
        if (selectedOnly && !this.catalog.includes(main))
          fail("El modelo elegido no aparece disponible con esta clave. Elige otro modelo y vuelve a comprobarlo.");
        const candidates = selectedOnly ? [main] : [...new Set([main, ...this.catalog])].filter(m => this.catalog.includes(m));
        // A single-model check must not erase previously verified, untested backups.
        const untouched = selectedOnly ? previous.filter(m => m !== main && this.catalog.includes(m)) : [];
        for (const candidate of candidates) {
          if (original !== binding()) fail("La configuración cambió durante la prueba. Vuelve a comprobarla.");
          onProgress("Probando conexión y herramientas: " + candidate + "…");
          try {
            const tools = [{type: "function", function: {
              name: "zia_comprobar", description: "Prueba de conexión sin leer ni modificar la biblioteca. Devuelve exactamente el argumento codigo solicitado.",
              parameters: {type: "object", properties: {codigo: {type: "string", enum: ["taller"]}}, required: ["codigo"], additionalProperties: false},
            }}];
            const messages = [{role: "user", content: "Prueba técnica: llama a zia_comprobar con codigo taller. No respondas con texto antes de llamar."}];
            const options = {testOnly: true, policyProbe: true, probeModel: candidate};
            const answer = await Z.chatRaw(messages, tools, options);
            const calls = answer.tool_calls || [];
            const call = calls.length === 1 && calls[0];
            let args;
            try { args = JSON.parse(call?.function?.arguments || "null"); } catch (_) {}
            if (!call?.id || call.function?.name !== "zia_comprobar" || args?.codigo !== "taller")
              throw new Error("La conexión respondió, pero no superó la prueba de herramientas del agente.");
            // Verify the full OpenAI-compatible function-call round trip. No Zotero tool is executed.
            const final = await Z.chatRaw([...messages, answer, {role: "tool", tool_call_id: call.id, content: '{"resultado":"OK"}'}, {role: "user", content: "La prueba terminó. Responde solamente OK, sin llamar más herramientas."}], tools, options);
            if (!String(final.content || "").trim() || final.tool_calls?.length)
              throw new Error("No completó la respuesta después de la herramienta.");
            if (original !== binding()) fail("La configuración cambió durante la prueba.");
            successful.push(candidate);
            this.results.push({model: candidate, ok: true});
          } catch (e) {
            if (original !== binding()) fail("La configuración cambió durante la prueba. Vuelve a comprobarla.");
            if ([401, 403].includes(e.status)) throw e;
            const keepPrevious = e.temporary === true && previous.includes(candidate) && this.current();
            if (keepPrevious) retained.push(candidate);
            this.results.push({model: candidate, ok: false, retained: keepPrevious, temporary: e.temporary === true, error: String(e.message || e)});
          }
          onProgress(this.results.map(r => (r.ok ? "✔ " : "✘ ") + r.model + (r.ok ? ": conexión y herramientas comprobadas" : ": " + r.error)).join("\n"));
        }
        if (!successful.length && !retained.length) {
          const results = this.results.slice();
          if (untouched.length) {
            this.assertContext();
            this.assertUnchanged(original);
            this.verified = untouched;
            await this.saveProof();
          } else this.invalidate();
          this.results = results;
          if (results.every(result => result.temporary)) {
            const error = new Error("El servicio de IA está temporalmente saturado o no respondió a tiempo. Espera unos minutos y vuelve a comprobar la conexión.");
            error.name = "ModelCheckTemporaryError";
            throw error;
          }
          fail("Ningún modelo superó la comprobación.\n" + results.map(r => r.model + ": " + r.error).join("\n"));
        }
        this.assertContext();
        this.assertUnchanged(original);
        this.verified = [...successful, ...retained, ...untouched];
        // A fresh round trip supersedes an earlier temporary failure for this model.
        for (const model of successful) if (Z._dead) delete Z._dead[model];
        this._binding = original;
        this.checkedAt = successful.length ? Date.now() : previousCheckedAt;
        const selected = successful.includes(main) ? main : successful[0] || (retained.includes(main) ? main : retained[0]);
        Zotero.Prefs.set(Z.P + "model", selected, true);
        // Explicit legacy fallbacks cannot leak into the restricted model pool.
        Zotero.Prefs.set(Z.P + "fallbackModels", "", true);
        try{await this.saveProof();}catch(_){Zotero.debug?.("Zotero IA: no se pudo conservar la comprobación; será necesario repetirla al reiniciar.");}
        return {model: read("model"), backups: this.verified.filter(m => m !== read("model")), results: this.results.slice(), checkedAt: this.checkedAt, retained: retained.length > 0};
      } finally { this.busy = false; }
    },
  };
})(ZoteroIA);
