/* global Zotero, ZIA, window, document, busy, ctrl, chatHistory, add, checkSetup, AbortController */
(function () {
  const $ = id => document.getElementById(id);
  let closed = false, paused = false, ready = document.readyState === "complete";
  const element = (tag, text) => {const e = document.createElementNS("http://www.w3.org/1999/xhtml", tag);e.textContent = text;return e;};
  const keyFor = request => request.key || request.itemID + ":" + request.question;
  async function read(request) {
    const key = keyFor(request);
    ZIA.documentActionActive = key;
    busy = true;ctrl = new AbortController();
    $("send").disabled = true;$("stop").disabled = false;
    ZIA.workspace.show("chat");ZIA.workspace.setActivity("chat");
    let status = "Lectura terminada.", output = null;
    try {
      const item = await Zotero.Items.getAsync(request.itemID);
      if (!item || item.deleted || !(item.isRegularItem() || item.isAttachment())) throw Error("El documento seleccionado ya no está disponible.");
      const prompt = request.question + "\nDocumento seleccionado: ID " + item.id + " · " + item.getField("title");
      $("welcome")?.remove();
      add("u", prompt, true);chatHistory.push({role: "user", content: request.question + "\nDocumento seleccionado: item_id=" + item.id});
      output = add("a", "Preparando la lectura del documento…", true);
      const result = await ZIA.ask(item, request.question, (done, total, complete) => {
        if (closed) return;
        const progress = complete ? "Preparando el resultado…" : "Leyendo el texto recuperado: " + done + " / " + total + " fragmentos…";
        output.textContent = progress;$("st").textContent = progress;ZIA.workspace.activity();
      }, {mode: "full", signal: ctrl.signal, meterId: ZIA.research.id("reading")});
      ZIA.checkAbort(ctrl.signal);
      if (closed) return;
      ZIA.renderMarkdown(output, result.answer);
      chatHistory.push({role: "assistant", content: result.answer});
      const actions = add("t", "", true);
      const view = element("button", "Ver documento en Zotero");view.type = "button";
      view.addEventListener("click", async () => {try {await Zotero.getActiveZoteroPane().selectItem(item.id);} catch (error) {ZIA.workspace.note(error.message);}});
      actions.appendChild(view);
      if (result.ctx?.parent?.isRegularItem() && result.ctx.text && (!ZIA.citationNotes || result.ctx.readingID)) {
        const save = element("button", "Guardar lectura como nota");save.type = "button";
        save.addEventListener("click", async () => {
          if (save.disabled) return;save.disabled = true;
          try {
            const parent = await Zotero.Items.getAsync(result.ctx.parent.id);
            if (!parent || parent.deleted || !parent.isRegularItem()) throw Error("La referencia original ya no está disponible.");
            const saved=await ZIA.saveNote(parent, request.question, result.answer,{readingResult:result});
            if(saved?.status==="rejected"){save.disabled=false;ZIA.workspace.note("No se guardó la nota.");return;}
            save.textContent = "Nota guardada";
            if(saved?.citas_nativas)ZIA.workspace.note("Nota guardada con citas de Zotero. En Word usa Zotero → Insertar nota y elígela.");
          }
          catch (error) {save.disabled = false;ZIA.workspace.note("No se pudo guardar la nota: " + error.message);}
        });
        actions.appendChild(save);
      }
    } catch (error) {
      paused = true;
      if(ctrl?.signal.aborted)ZIA.documentRequests=[];
      status = ctrl?.signal.aborted ? "Lectura detenida. Se conserva el avance completado." : error.message;
      if (!closed) {
        output?.remove();
        chatHistory.push({role: "assistant", content: "La lectura no se completó: " + status});
        add("e", status, true);
        if (error.name === "BudgetLimitError") ZIA.workspace.budgetNotice(error.budget, () => {paused=false;ZIA.documentRequests.unshift(request);drain();}, "Continuar lectura");
        else ZIA.workspace.providerNotice?.(error);
      }
    } finally {
      busy = false;ctrl = null;
      if (ZIA.documentActionActive === key) ZIA.documentActionActive = null;
      if (!closed) {$("send").disabled = false;$("stop").disabled = true;$("st").textContent = status;ZIA.workspace.note(status);}
    }
  }
  function drain() {
    if (closed || paused || !ready || busy || ZIA.documentActionActive || !ZIA.isConfigured() || !ZIA.documentRequests?.length) return;
    const request = ZIA.documentRequests.shift();
    void read(request);
  }
  const api = ZIA.documentActions = {drain};
  window.addEventListener("load", () => {ready = true;drain();});
  window.addEventListener("zia-document-request", () => {paused=false;drain();});
  window.addEventListener("focus", drain);
  window.addEventListener("unload", () => {
    closed = true;
    if (ZIA.documentActions === api) {delete ZIA.documentActions;ZIA.documentActionActive = null;ZIA.documentRequests=[];}
  });
  drain();
})();
