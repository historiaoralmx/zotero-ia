/* global Zotero, ZoteroIA, URL, IOUtils */
// Native PDF retrieval and explicit browser handoff. No browser-extension automation.
(function () {
  const Z = ZoteroIA;
  const httpURL = value => {
    try {
      const url = new URL(String(value || "").trim());
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch (_) { return null; }
  };
  Z.openResultURL = async function (value) {
    const raw = String(value || "").trim();
    if (/^zotero:\/\/(?:open-pdf|select)\//i.test(raw)) return Z.research.openURL(raw);
    const url = httpURL(raw);
    if (!url) throw new Error("Este enlace no es una dirección web válida.");
    if (typeof Zotero.launchURL !== "function") throw new Error("No se pudo abrir el navegador desde esta versión de Zotero.");
    await Zotero.launchURL(url);
  };
  Z.handleResultLink = function (event, onError = () => {}) {
    if (event.defaultPrevented || (event.button !== undefined && event.button !== 0)) return false;
    const link = event.target?.closest?.("a[href]");
    if (!link) return false;
    event.preventDefault();
    Promise.resolve().then(() => Z.openResultURL(link.getAttribute("href"))).catch(onError);
    return true;
  };
  const itemFor = id => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID de referencia inválido.");
    const item = Zotero.Items.get(id);
    if (!item || item.deleted || !item.isRegularItem()) throw new Error("ID " + id + ": no es una referencia bibliográfica disponible.");
    return item;
  };
  function publicationURL(item) {
    // Use the saved identifier, never a journal homepage invented by the model.
    const raw = String(item.getField("DOI") || item.getExtraField?.("DOI") || "").trim();
    const doi = Zotero.Utilities?.cleanDOI ? Zotero.Utilities.cleanDOI(raw) : raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
    if (doi && /^10\.\d{4,9}\/\S+$/i.test(doi)) return httpURL("https://doi.org/" + encodeURIComponent(doi).replace(/%2F/gi, "/"));
    return httpURL(item.getField("url"));
  }
  async function localPDFs(item) {
    const found = [];
    for (const id of item.getAttachments()) {
      const a = Zotero.Items.get(id);
      if (!a || a.deleted || a.parentID !== item.id || a.attachmentContentType !== "application/pdf") continue;
      // A remote entry or a broken file link is not a downloaded PDF.
      try {
        let exists = false;
        if (typeof a.fileExists === "function") exists = await a.fileExists();
        else if (typeof a.getFilePathAsync === "function" && typeof IOUtils.exists === "function") {
          const path = await a.getFilePathAsync();
          exists = !!path && await IOUtils.exists(path);
        }
        if (exists) found.push(id);
      } catch (_) { /* A failed existence check must not become a success. */ }
    }
    return found;
  }
  const P = Z.pdfs = {
    publicationURL,
    async status(id) {
      const item = itemFor(id), attachments = await localPDFs(item);
      return {item_id:id, titulo:item.getField("title") || "Referencia " + id,
        pdf_ids:attachments, estado:attachments.length ? "PDF_DISPONIBLE" : "SIN_PDF_LOCAL",
        pagina_url:publicationURL(item), pagina_abierta:false};
    },
    async openPublication(id) {
      const url = publicationURL(itemFor(id));
      if (!url) throw new Error("Esta referencia no tiene DOI ni URL válidos. Añade la dirección del artículo en Zotero.");
      await Z.openResultURL(url);
      return url;
    },
    async find(ids, {signal} = {}) {
      Z.checkAbort(signal);
      if (!Array.isArray(ids) || !ids.length || ids.length > 10) throw new Error("Indica entre 1 y 10 IDs de referencias.");
      const items = [...new Set(ids)].map(itemFor); // Validate the entire batch before writing.
      const before = new Map();
      for (const item of items) { Z.checkAbort(signal); before.set(item.id, await localPDFs(item)); }
      const pending = items.filter(item => !before.get(item.id).length);
      let nativeError = null;
      if (pending.length) {
        try {
          const A = Zotero.Attachments || {};
          if (typeof A.addAvailableFiles === "function") await A.addAvailableFiles(pending);
          else if (typeof A.addAvailablePDFs === "function") await A.addAvailablePDFs(pending);
          else if (typeof A.addAvailableFile === "function" || typeof A.addAvailablePDF === "function") {
            const findOne = A.addAvailableFile || A.addAvailablePDF;
            for (const item of pending) { Z.checkAbort(signal); await findOne.call(A, item); }
          } else {
            const pane = Zotero.getActiveZoteroPane?.();
            if (typeof pane?.findAvailablePDFs !== "function") throw new Error("La búsqueda nativa de PDF no está disponible en esta versión.");
            await pane.findAvailablePDFs(pending);
          }
        } catch (e) {
          if (signal?.aborted || e.name === "AbortError") throw e;
          nativeError = e.message || "No se pudo completar la búsqueda nativa.";
        }
      }
      Z.checkAbort(signal);
      const results = [];
      for (const item of items) {
        Z.checkAbort(signal);
        const row = await P.status(item.id);
        if (row.pdf_ids.length) row.estado = before.get(item.id).length ? "PDF_YA_EXISTIA" : "PDF_ADJUNTADO";
        else if (nativeError) row.incidencia = nativeError;
        results.push(row);
      }
      // For one requested item, proceed directly to its page. Batches retain one
      // explicit button per item instead of opening up to ten browser tabs.
      if (results.length === 1 && !results[0].pdf_ids.length && results[0].pagina_url) {
        Z.checkAbort(signal);
        try { await P.openPublication(results[0].item_id); results[0].pagina_abierta = true; }
        catch (e) { results[0].error_apertura = e.message; }
      }
      return {tipo:"busqueda_pdf", solicitados:items.map(i => i.id),
        pdf_encontrado:results.filter(r => r.pdf_ids.length).map(r => r.item_id), resultados:results,
        siguiente_paso:"Si falta el PDF, abre la página y pulsa Zotero Connector en el navegador. El Connector puede crear otra referencia: mueve su PDF a la referencia original antes de comprobarlo aquí. No se fusionan registros automáticamente.",
        advertencia:"Solo se confirma un PDF cuando está adjunto a la referencia y su archivo existe localmente. Abrir una página no equivale a descargarla."};
    },
    render(doc, parent, result) {
      if (result?.tipo !== "busqueda_pdf") return;
      const el = (tag, text) => { const e = doc.createElementNS("http://www.w3.org/1999/xhtml", tag); if (text !== undefined) e.textContent = text; return e; };
      const action = (box, label, run, feedback) => {
        const b = el("button", label); b.type = "button"; b.style.margin = "4px 6px 4px 0";
        b.addEventListener("click", async () => { b.disabled = true; try { await run(); } catch (e) { feedback.textContent = e.message; } finally { b.disabled = false; } });
        box.appendChild(b); return b;
      };
      parent.appendChild(el("strong", "PDF y páginas de las referencias"));
      for (const row of result.resultados || []) {
        const card = el("section"); card.style.cssText = "margin:10px 0;padding:10px;border:1px solid #b4c4c8;border-radius:8px;overflow-wrap:anywhere";
        card.appendChild(el("strong", row.titulo + " · ID " + row.item_id));
        const state = el("p", row.pdf_ids.length ? (row.estado === "PDF_YA_EXISTIA" ? "El PDF ya estaba disponible en esta referencia." : "PDF adjuntado y archivo local comprobado.") : "No se consiguió adjuntar un PDF local.");
        card.appendChild(state);
        const feedback = el("p", row.error_apertura || row.incidencia || ""); feedback.setAttribute("aria-live", "polite");
        if (!row.pdf_ids.length) {
          if (row.pagina_url) {
            card.appendChild(el("p", (row.pagina_abierta ? "Página abierta. " : "") + "En el navegador, pulsa Zotero Connector para intentar guardar el artículo y su PDF. Si se crea otra referencia, mueve el PDF a esta referencia original."));
            action(card, "Abrir página de la referencia", async () => { await P.openPublication(row.item_id); feedback.textContent = "Página abierta. Pulsa Zotero Connector en el navegador."; }, feedback);
            const link = el("a", row.pagina_url); link.setAttribute("href", row.pagina_url); card.appendChild(link);
          } else card.appendChild(el("p", "Falta un DOI o una URL válidos en la referencia. Añade la dirección del artículo en Zotero."));
          action(card, "Comprobar si ya está el PDF", async () => {
            const current = await P.status(row.item_id);
            state.textContent = current.pdf_ids.length ? "PDF adjunto a esta referencia y archivo local comprobado." : "Todavía no hay un PDF local adjunto a esta referencia. Si Connector lo guardó en otra, mueve el PDF a la referencia original.";
            feedback.textContent = "Comprobación terminada; no consume IA.";
          }, feedback);
        }
        action(card, "Ver referencia en Zotero", async () => {
          itemFor(row.item_id);
          const pane = Zotero.getActiveZoteroPane?.();
          if (typeof pane?.selectItem !== "function") throw new Error("Abre la ventana principal de Zotero para seleccionar esta referencia.");
          await pane.selectItem(row.item_id);
        }, feedback);
        card.appendChild(feedback); parent.appendChild(card);
      }
    }
  };
})();
