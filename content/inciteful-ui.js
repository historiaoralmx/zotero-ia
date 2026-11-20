/* global Zotero, ZIA, window, document, busy, ctrl, AbortController */
(function () {
  const $ = id => document.getElementById(id);
  const searchButton = $("related-search");
  const refreshButton = $("related-refresh");
  const saveButton = $("related-save");
  const list = $("related-list");
  const status = $("related-status");
  let selection = { seeds: [], collection: null };
  let destination = null;
  let rows = [];

  function element(tag, text) {
    const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function updateButtons() {
    searchButton.disabled = busy || !selection.seeds.length;
    refreshButton.disabled = busy;
    saveButton.disabled = busy || !rows.some(row => row.checkbox.checked && !row.checkbox.disabled);
    for (const row of rows) row.pdfButton.disabled = busy || row.hasPDF;
  }

  function refreshSelection() {
    if (busy) return;
    const pane = Zotero.getActiveZoteroPane();
    const { seeds, omitted } = ZIA.inciteful.selectedSeeds(pane?.getSelectedItems() || []);
    let collection = null;
    try {
      collection = typeof pane?.getSelectedCollections === "function"
        ? pane.getSelectedCollections()?.[0]
        : pane?.getSelectedCollection?.();
    } catch (_) {}
    if (collection?.libraryID !== Zotero.Libraries.userLibraryID || collection?.deleted) collection = null;
    selection = { seeds, collection: collection ? { id: collection.id, name: collection.name } : null };
    const seedList = $("related-seeds");
    seedList.replaceChildren(...seeds.map(seed => element("li", seed.title + " · " + seed.id)));
    $("related-selection-note").textContent = seeds.length
      ? omitted ? "Referencias de partida: " + seeds.length + ". Omitidas: " + omitted + " (sin identificador, repetidas o fuera del límite de cinco)." : "Referencias de partida: " + seeds.length + "."
      : "Selecciona en Zotero hasta cinco referencias con DOI o identificador OpenAlex y pulsa Actualizar selección.";
    updateButtons();
  }

  function render(result, used) {
    rows = [];
    list.replaceChildren();
    const parts = [];
    if (result.snapshot) parts.push("Índice: " + result.snapshot);
    if (result.method) parts.push("Método: " + result.method);
    if (result.unresolved) parts.push("Referencias de partida no encontradas: " + result.unresolved);
    if (result.truncated) parts.push("El servicio recortó la respuesta.");
    $("related-source").textContent = parts.join(" · ");
    $("related-used").textContent = "Búsqueda a partir de " + used.seeds.map(seed => seed.id).join(", ") + ".";
    $("related-destination").textContent = "Destino al guardar: " + (destination?.name || "Mi biblioteca") + ".";
    for (const paper of result.papers) {
      const row = element("article");
      row.className = "workspace-card";
      const label = element("label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", updateButtons);
      label.append(checkbox, element("strong", paper.title));
      row.appendChild(label);
      const meta = [...paper.authors, paper.year, paper.journal, paper.doi].filter(Boolean).join(" · ");
      if (meta) row.appendChild(element("p", meta));
      const open = element("button", "Abrir publicación");
      open.type = "button";
      const outcome = element("p");
      outcome.setAttribute("role", "status");
      open.addEventListener("click", async () => {try {await Zotero.launchURL(paper.url);} catch (error) {outcome.textContent = error.message;}});
      const pdfButton = element("button", "Obtener PDF");pdfButton.type = "button";
      const pdfResult = element("div");
      const state = {paper, checkbox, outcome, pdfButton, hasPDF: false};
      pdfButton.addEventListener("click", () => run(async signal => {
        status.textContent = "Guardando la referencia y buscando su PDF…";
        outcome.textContent = "Buscando con Zotero y los enlaces de OpenAlex. No consume tokens de IA.";
        const result = await ZIA.inciteful.obtainPDF(paper, destination?.id, signal);
        state.hasPDF = result.busqueda.pdf_encontrado.includes(result.item_id);
        checkbox.checked = false;checkbox.disabled = true;
        pdfButton.textContent = state.hasPDF ? "PDF disponible" : "Obtener PDF";
        outcome.textContent = state.hasPDF ? "Referencia guardada y PDF local comprobado." : "Referencia guardada. No se consiguió el PDF; puedes abrir la página de la publicación abajo.";
        pdfResult.replaceChildren();ZIA.pdfs.render(document, pdfResult, result.busqueda);
        status.textContent = outcome.textContent;
      }));
      row.append(open, pdfButton, outcome, pdfResult);
      list.appendChild(row);
      rows.push(state);
    }
    $("related-results").hidden = !rows.length;
    updateButtons();
  }

  async function run(task) {
    if (busy) {
      status.textContent = "Termina o detén la tarea actual.";
      return;
    }
    const controller = new AbortController();
    ctrl = controller;
    busy = true;
    ZIA.workspace.setActivity("related");
    updateButtons();
    try {
      await task(controller.signal);
    } catch (error) {
      status.textContent = controller.signal.aborted ? "Tarea detenida." : error.message;
    } finally {
      if (ctrl === controller) ctrl = null;
      busy = false;
      updateButtons();
      ZIA.workspace.note(status.textContent);
    }
  }

  searchButton.addEventListener("click", () => run(async signal => {
    const used = selection;
    status.textContent = "Buscando trabajos relacionados en Inciteful…";
    const result = await ZIA.inciteful.search(used.seeds.map(seed => seed.id), signal);
    destination = used.collection;
    render(result, used);
    status.textContent = result.papers.length
      ? result.papers.length + " trabajos relacionados. Marca los que quieras guardar."
      : "Inciteful no encontró trabajos relacionados con esta selección.";
  }));

  saveButton.addEventListener("click", () => run(async signal => {
    const checked = rows.filter(row => row.checkbox.checked && !row.checkbox.disabled);
    let saved = 0;
    let duplicates = 0;
    let errors = 0;
    status.textContent = "Guardando referencias en Zotero…";
    for (const row of checked) {
      if (signal.aborted) break;
      try {
        const result = await ZIA.inciteful.savePaper(row.paper, destination?.id, signal);
        const done = ["guardado", "ya estaba en la biblioteca"].includes(result?.estado);
        row.outcome.textContent = result?.estado || "No se pudo guardar.";
        if (done) {
          row.checkbox.checked = false;
          row.checkbox.disabled = true;
          if (result.estado === "guardado") saved++;
          else duplicates++;
        } else errors++;
      } catch (error) {
        if (signal.aborted) break;
        row.outcome.textContent = error.message;
        errors++;
      }
    }
    status.textContent = (signal.aborted ? "Guardado detenido. " : "") +
      saved + " guardadas · " + duplicates + " ya en tu biblioteca · " + errors + " con error.";
  }));

  refreshButton.addEventListener("click", refreshSelection);
  ZIA.incitefulUI = { refreshSelection };
})();
