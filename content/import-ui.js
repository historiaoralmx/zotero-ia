/* global Zotero, ZIA, Components, document, window, busy, ctrl, AbortController */
(function () {
  const $ = id => document.getElementById(id);
  const select = $("import-destination"), fileButton = $("import-document"), folderButton = $("importPDFDir");
  const status = $("import-status"), results = $("import-results");
  const element = (tag, text) => {const e = document.createElementNS("http://www.w3.org/1999/xhtml", tag);if (text !== undefined) e.textContent = text;return e;};
  function collections() {
    const previous = Number(select.value);
    let native = null;
    try {const pane = Zotero.getActiveZoteroPane();native = pane?.getSelectedCollections?.()[0] || pane?.getSelectedCollection?.();} catch (_) {}
    const wanted = previous || native?.id;
    select.replaceChildren();
    const placeholder = element("option", "Elige la colección de destino");placeholder.value = "";select.appendChild(placeholder);
    for (const library of Zotero.Libraries.getAll().filter(l => ["user", "group"].includes(l.libraryType) && l.editable !== false && l.filesEditable !== false)) {
      const group = element("optgroup");group.label = library.name || Zotero.Libraries.getName(library.libraryID);
      for (const c of Zotero.Collections.getByLibrary(library.libraryID, true).filter(c => !c.deleted)) {
        const path = [c.name], seen = new Set([c.id]);let parent = c.parentID;
        while (parent && !seen.has(parent)) {seen.add(parent);const p = Zotero.Collections.get(parent);if (!p) break;path.unshift(p.name);parent = p.parentID;}
        const option = element("option", path.join(" / "));option.value = String(c.id);group.appendChild(option);
      }
      select.appendChild(group);
    }
    select.value = [...select.options].some(o => Number(o.value) === wanted) ? String(wanted) : "";
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
