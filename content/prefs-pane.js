/* global Zotero, ZoteroIA */
ZoteroIA.initPrefs = function (document) {
  const Z = Zotero.ZoteroIA;
  const self = {
    P: "extensions.zotero-ia.",
    fields: ["baseURL", "apiKey", "model", "maxChars", "systemPrompt", "openalexKey"],
    presets: {
      local: {baseURL: "http://localhost:11434/v1", model: "qwen3"},
      gemini: {baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.6-flash"},
      zai: {baseURL: "https://api.z.ai/api/paas/v4", model: "glm-4.7-flash"},
      openai: {baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini"},
      claude: {baseURL: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5"},
      deepseek: {baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat"},
      openrouter: {baseURL: "https://openrouter.ai/api/v1", model: "openrouter/auto"},
    },
    keyHelp: {
      gemini: ["Google AI Studio → API Keys", "https://aistudio.google.com/apikey"],
      zai: ["z.ai → API Keys (Standard)", "https://z.ai/manage-apikey/apikey-list"],
      openai: ["platform.openai.com/api-keys", "https://platform.openai.com/api-keys"],
      claude: ["console.anthropic.com → API Keys", "https://console.anthropic.com/settings/keys"],
      deepseek: ["platform.deepseek.com → API keys", "https://platform.deepseek.com/api_keys"],
      openrouter: ["openrouter.ai/keys", "https://openrouter.ai/keys"],
    },
    el(id) { return document.getElementById("zia-" + id); },
    pref(k) { const value=Zotero.Prefs.get(this.P + k, true); return k==="provider"&&value==="anthropic"?"claude":value; },
    init() {
      for (const f of this.fields) {
        this.el(f).value = String(this.pref(f) ?? "");
        this.el(f).addEventListener("input", () => this.save());
      }
      for (const c of document.querySelectorAll(".zia-card")) {
        c.addEventListener("click", () => { if (!this.busy) this.choose(c.dataset.mode); });
        c.addEventListener("keydown", ev => {
          if (!this.busy && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); this.choose(c.dataset.mode); }
        });
      }
      this.el("free").addEventListener("change", () => this.chooseFree(this.el("free").value));
      this.el("paid").addEventListener("change", () => this.choosePaid(this.el("paid").value));
      this.el("detected-model").addEventListener("change", () => {
        this.el("model").value = this.el("detected-model").value;
        this.save(); this.renderPolicy();
      });
      this.el("free-confirmed").checked = this.pref("freeTierConfirmed") === true;
      this.el("free-confirmed").addEventListener("change", () => {
        Zotero.Prefs.set(this.P + "freeTierConfirmed", this.el("free-confirmed").checked, true);
        if (!this.el("free-confirmed").checked) Z.modelPolicy.invalidate();
        this.renderPolicy();
      });
      this.el("test").addEventListener("click", () => this.test());
      this.el("detect").addEventListener("click", () => this.detect());
      document.getElementById("zotero-ia-prefs").addEventListener("click", ev => {
        const a = ev.target.closest && ev.target.closest("a[href]");
        if (a) { ev.preventDefault(); Zotero.launchURL(a.href); }
      });
      const provider = this.pref("provider") || "";
      this.el("key-row").hidden = true;
      if (provider) {
        const mode = provider === "local" ? "local" : Z.modelPolicy.restricted() ? "gemini" : "paid";
        this.show(mode);
        if (mode === "gemini") this.el("free").value = provider;
        if (mode === "paid") { this.el("paid").value = provider; this.renderPaidHelp(provider); }
      }
      this.renderPolicy();
    },
    show(mode) {
      for (const c of document.querySelectorAll(".zia-card")) c.classList.toggle("on", c.dataset.mode === mode);
      for (const m of ["local", "gemini", "paid"]) this.el("steps-" + m).hidden = m !== mode;
      this.el("key-row").hidden = mode === "local";
    },
    choose(mode) {
      this.show(mode);
      if (mode === "paid") return this.choosePaid(this.el("paid").value);
      if (mode === "gemini") return this.chooseFree(this.el("free").value);
      this.applyPreset("local", false);
    },
    chooseFree(name) { this.applyPreset(name, true); },
    choosePaid(name) { this.renderPaidHelp(name); this.applyPreset(name, false); },
    renderPaidHelp(name) {
      const h = this.keyHelp[name], box = this.el("paid-help");
      box.textContent = "";
      if (!h) return;
      const p = document.createElementNS("http://www.w3.org/1999/xhtml", "p");
      const a = document.createElementNS("http://www.w3.org/1999/xhtml", "a");
      a.href = h[1]; a.textContent = h[0];
      p.append("Consigue tu clave en ", a, ", cópiala y pégala abajo.");
      box.appendChild(p);
    },
    applyPreset(name, restricted) {
      const p = this.presets[name];
      if (!p) return;
      const previous = this.pref("provider"), current = this.el("model").value;
      if (previous !== name) {
        this.el("apiKey").value = "";
        this.el("free-confirmed").checked = false;
        Zotero.Prefs.set(this.P + "freeTierConfirmed", false, true);
      }
      Zotero.Prefs.set(this.P + "provider", name, true);
      Zotero.Prefs.set(this.P + "freeModelsOnly", restricted, true);
      Zotero.Prefs.set(this.P + "fallbackModels", "", true);
      this.el("baseURL").value = p.baseURL;
      this.el("model").value = restricted ? (previous === name && Z.modelPolicy.service().allowed.includes(current) ? current : "") : p.model;
      Z.modelPolicy.invalidate();
      this.el("test-details").textContent = "";
      this.save();
      this.el("test-result").textContent = previous && previous !== name ? "Proveedor cambiado. Pega la clave del nuevo proveedor; no se reutiliza la clave anterior." : "";
      this.renderPolicy();
    },
    save() {
      let credentialsChanged = false;
      for (const f of this.fields) {
        let value = this.el(f).value;
        if (f === "maxChars") value = parseInt(value, 10) || 0;
        if (["apiKey", "baseURL", "model", "openalexKey"].includes(f)) value = String(value).trim();
        if (["apiKey", "baseURL"].includes(f) && String(this.pref(f) ?? "") !== value) credentialsChanged = true;
        Zotero.Prefs.set(this.P + f, value, true);
      }
      if (credentialsChanged) {
        Z.modelPolicy.invalidate();
        this.el("test-details").textContent = "";
        this.el("free-confirmed").checked = false;
        Zotero.Prefs.set(this.P + "freeTierConfirmed", false, true);
        this.el("test-result").textContent = "La clave o la conexión ha cambiado. Vuelve a pulsar «Comprobar conexión».";
      }
      this.renderPolicy();
    },
    renderPolicy() {
      const restricted = Z.modelPolicy.restricted(), provider = this.pref("provider");
      this.el("diagnostics").hidden = !this.el("test-details").textContent;
      this.el("free-gemini").hidden = provider !== "gemini";
      this.el("free-zai").hidden = provider !== "zai";
      this.el("free-policy").hidden = !restricted;
      this.el("gemini-confirm-row").hidden = provider !== "gemini";
      this.el("detect").hidden = !restricted;
      this.el("baseURL").readOnly = restricted;
      this.el("model").readOnly = restricted;
      this.el("test").textContent = restricted ? "Comprobar conexión" : "Probar conexión";
      const select = this.el("detected-model"), selected = this.pref("model") || "";
      select.textContent = "";
      const add = (value, label) => {
        const option = document.createElementNS("http://www.w3.org/1999/xhtml", "option");
        option.value = value; option.textContent = label; select.appendChild(option);
      };
      add("", "El plugin elegirá uno al comprobar la conexión");
      for (const m of Z.modelPolicy.catalog) add(m, m + (Z.modelPolicy.current() && Z.modelPolicy.verified.includes(m) ? " · comprobado" : " · sin comprobar"));
      select.value = Z.modelPolicy.catalog.includes(selected) ? selected : "";
      this.el("policy-status").textContent = !restricted ? "" : Z.modelPolicy.current() && Z.modelPolicy.verified.includes(selected)
        ? "Listo para comenzar. Modelos alternativos preparados: " + Z.modelPolicy.verified.filter(m => m !== selected).length + ". Si uno falla, el plugin intentará otro de los comprobados."
        : "Falta comprobar la conexión. Pulsa «Comprobar conexión» para que el plugin elija un modelo compatible.";
    },
    setBusy(value) {
      this.busy = value;
      for (const e of document.querySelectorAll("#zotero-ia-prefs input, #zotero-ia-prefs select, #zotero-ia-prefs button, #zotero-ia-prefs textarea")) e.disabled = value;
      for (const c of document.querySelectorAll(".zia-card")) c.setAttribute("aria-disabled", String(value));
    },
    async detect() {
      if (this.busy) return;
      this.save(); this.setBusy(true);
      const out = this.el("test-result");
      out.className = ""; out.textContent = "Consultando el catálogo del proveedor…";
      try {
        const models = await Z.modelPolicy.detect();
        out.textContent = "Modelos detectados: " + models.join(", ") + ". Falta comprobar acceso y herramientas.";
      } catch (e) { out.className = "zia-bad"; out.textContent = "✘ " + e.message; }
      finally { this.setBusy(false); this.renderPolicy(); }
    },
    async test() {
      if (this.busy) return;
      this.save(); this.setBusy(true);
      const out = this.el("test-result");
      out.className = ""; this.el("test-details").textContent = "";
      try {
        if (Z.modelPolicy.restricted()) {
          const result = await Z.modelPolicy.prepare(message => { out.textContent = "Comprobando la conexión y preparando la IA…"; this.el("test-details").textContent = message; });
          this.el("model").value = result.model;
          out.className = "zia-ok";
          this.el("test-details").textContent = result.results.map(r => (r.ok ? "✔ " : "✘ ") + r.model + (r.ok ? ": conexión y herramientas comprobadas" : ": " + r.error)).join("\n")
            + "\nSeleccionado: " + result.model + ". Respaldos comprobados: " + (result.backups.join(", ") || "ninguno") + ".\nEsta prueba no modifica tu biblioteca. Los límites y pagos se administran en tu cuenta del proveedor.";
          out.textContent = "✔ Conexión lista. Ya puedes trabajar con Zotero IA.";
        } else {
          out.textContent = "Probando el modelo seleccionado (máximo 20 segundos)…";
          const t0 = Date.now();
          await Z.chat([{role: "user", content: "Responde solo: OK"}], {testOnly: true});
          out.className = "zia-ok";
          out.textContent = "✔ Conexión comprobada: " + Z.lastModel + " (" + Math.round((Date.now() - t0) / 1000) + " s). Esta prueba no comprueba herramientas, cuota futura ni facturación.";
        }
      } catch (e) { out.className = "zia-bad"; out.textContent = "✘ " + e.message; }
      finally { this.setBusy(false); this.renderPolicy(); }
    },
  };
  self.init();
  return self;
};
