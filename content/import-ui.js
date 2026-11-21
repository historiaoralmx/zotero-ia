/* global Zotero, ZIA, Components, document, window, busy, ctrl, AbortController */
(function () {
  const $ = id => document.getElementById(id);
  const select = $("import-destination"), fileButton = $("import-document"), folderButton = $("importPDFDir");
  const status = $("import-status"), results = $("import-results");
  const element = (tag, text) => {const e = document.createElementNS("http://www.w3.org/1999/xhtml", tag);if (text !== undefined) e.textContent = text;return e;};
  function collections() {
    const previous = Number(select.value);
    let native = null, activeLibraryID = null;
    try {const pane = Zotero.getActiveZoteroPane();native = pane?.getSelectedCollections?.()[0] || pane?.getSelectedCollection?.();activeLibraryID = pane?.getSelectedLibraryID?.() || native?.libraryID;} catch (_) {}
    const wanted = previous || native?.id;
    select.replaceChildren();
    const placeholder = element("option", "Elige la colección de destino");placeholder.value = "";select.appendChild(placeholder);
    const destinations = ZIA.localImports.destinations();
    for (const library of destinations) {
      const group = element("optgroup");group.label = library.name + (library.reason ? " · " + library.reason : "");
      for (const c of library.collections) {
        const option = element("option", c.path);option.value = String(c.id);option.disabled = !library.canImport;group.appendChild(option);
      }
      if (!library.collections.length) {const empty = element("option", "Sin colecciones de destino" + (library.reason ? " · " + library.reason : "; crea una colección en Zotero y pulsa Actualizar colecciones"));empty.value = "";empty.disabled = true;group.appendChild(empty);}
      select.appendChild(group);
    }
    select.value = [...select.options].some(o => !o.disabled && Number(o.value) === wanted) ? String(wanted) : "";
    const active = destinations.find(l => l.collections.some(c => c.id === wanted)) || destinations.find(l => l.libraryID === activeLibraryID);
    const blocked = destinations.filter(l => !l.canImport);
    const hint = $("import-permission-hint");
    hint.textContent = active && !active.canImport ? "«" + active.name + "»: " + active.reason + ". Por eso sus destinos aparecen deshabilitados para importar. Para leer o analizar sus documentos, ve a Analizar." : blocked.length ? "Los destinos deshabilitados indican que Zotero no permite añadir archivos en esa biblioteca. Sus documentos disponibles pueden consultarse desde Analizar." : "";
    hint.hidden = !hint.textContent;
  }
  async function choose(folder) {
    const C = Components.classes, I = Components.interfaces;
    const picker = C["@mozilla.org/filepicker;1"].createInstance(I.nsIFilePicker);
    picker.init(window.browsingContext, folder ? "Selecciona una carpeta con PDF" : "Selecciona documentos para Zotero", folder ? I.nsIFilePicker.modeGetFolder : I.nsIFilePicker.modeOpenMultiple);
    if (!folder) {picker.appendFilter("Documentos", "*.pdf;*.doc;*.docx;*.odt;*.txt;*.rtf;*.epub");picker.appendFilters(I.nsIFilePicker.filterAll);}
    if (await new Promise(resolve => picker.open(resolve)) !== I.nsIFilePicker.returnOK) return [];
    const files = [];
    if (!folder) {const all = picker.files;while (all.hasMoreElements()) files.push(all.getNext().QueryInterface(I.nsIFile));}
    else {
      const stack = [picker.file];
      while (stack.length) {
        const dir = stack.pop(), entries = dir.directoryEntries;
        while (entries.hasMoreElements()) {
          const file = entries.getNext().QueryInterface(I.nsIFile);
          if (file.isDirectory()) {if (!file.isSymlink()) stack.push(file);}
          else if (file.isFile() && /\.pdf$/i.test(file.leafName)) files.push(file);
          if (files.length > 500) throw Error("La carpeta contiene más de 500 PDF. Divide la importación.");
        }
      }
    }
    return files;
  }
  function showResult(result) {
    status.textContent = (result.detenido ? "Importación detenida. " : "") + result.importados + " archivos importados · " + result.reconocidos + " referencias reconocidas · " + result.provisionales + " contenedores por completar · " + result.errores.length + " incidencias.";
    $("import-results-details").hidden = !result.resultados.length;
    $("import-results-summary").textContent = "Ver archivos importados (" + result.resultados.length + ")";
    results.replaceChildren();
    for (const row of result.resultados) {
      const card = element("div");card.className = "workspace-card";
      card.appendChild(element("p", row.archivo + " · " + (row.error ? row.error + (row.adjunto_id ? " El archivo importado permanece en Zotero." : "") : row.provisional ? "Contenedor provisional creado; revisa sus datos." : "Referencia y archivo guardados.")));
      if (row.item_id || row.adjunto_id) {
        const button = element("button", "Ver en Zotero");button.type = "button";
        button.addEventListener("click", async () => {try {await Zotero.getActiveZoteroPane().selectItem(row.item_id || row.adjunto_id);} catch (error) {status.textContent = error.message;}});
        card.appendChild(button);
      }
      results.appendChild(card);
    }
  }
  async function run(folder) {
    if (busy) {status.textContent = "Termina o detén la tarea actual antes de importar.";return;}
    const id = Number(select.value), c = Zotero.Collections.get(id);
    if (!c || c.deleted) {status.textContent = "Elige una colección de destino. Si acabas de crearla, pulsa Actualizar colecciones.";return;}
    try {ZIA.localImports.validateDestination(id);} catch (error) {status.textContent = error.message;collections();return;}
    const destinationKey = c.key, fallbackType = $("import-type").value || "document";
    const controller = new AbortController();ctrl = controller;busy = true;
    for (const node of [fileButton, folderButton, select, $("import-refresh"), $("import-type")]) node.disabled = true;
    ZIA.workspace.setActivity("import");
    try {
      const files = await choose(folder);
      if (!files.length) {status.textContent = "No se seleccionaron documentos.";return;}
      if (Zotero.Collections.get(id)?.key !== destinationKey) throw Error("La colección de destino cambió. Vuelve a seleccionarla.");
      status.textContent = "Importando en «" + c.name + "»… Detener termina el archivo en curso y conserva el avance.";
      const result = await ZIA.localImports.importFiles(files, {collectionID: id, fallbackType, signal: controller.signal, onProgress: showResult});
      showResult(result);
    } catch (error) {status.textContent = controller.signal.aborted ? "Importación detenida; se conservan los archivos ya importados." : error.message;}
    finally {
      if (ctrl === controller) ctrl = null;busy = false;
      for (const node of [fileButton, folderButton, select, $("import-refresh"), $("import-type")]) node.disabled = false;
      ZIA.workspace.note(status.textContent);
    }
  }
  fileButton.addEventListener("click", () => run(false));
  folderButton.addEventListener("click", () => run(true));
  $("import-refresh").addEventListener("click", () => {if (!busy) collections();});
  ZIA.importUI = {collections};
  collections();
})();
