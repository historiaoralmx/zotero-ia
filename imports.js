/* global Zotero, ZoteroIA */
(function (Z) {
  "use strict";
  const permission = library => !library ? "Biblioteca no disponible" : library.editable === false ? "Solo lectura" : library.filesEditable === false ? "Sin permiso para añadir archivos" : "";
  const destination = (id, key) => {
    const c = Zotero.Collections.get(Number(id));
    if (!c || c.deleted || (key && c.key !== key)) throw Error("La colección de destino cambió o ya no está disponible.");
    const lib = Zotero.Libraries.get(c.libraryID);
    const reason = permission(lib);
    if (reason) throw Error("Esta biblioteca no permite importar archivos: " + reason + ". Puedes consultar sus documentos desde Analizar si están disponibles en Zotero.");
    return c;
  };
  async function makeParent(attachment, c, type, name) {
    const title = name.replace(/\.[^.]+$/, "").trim() || name;
    let parent;
    try {
      await Zotero.DB.executeTransaction(async () => {
        destination(c.id, c.key);
        if (attachment.parentID) throw Error("El documento ya tiene una referencia padre.");
        parent = new Zotero.Item(type);
        parent.libraryID = c.libraryID;
        parent.setField("title", title + " (por completar)");
        parent.setField("extra", "Registro provisional creado desde un archivo local. El título procede del nombre del archivo; autor, fecha y demás metadatos están pendientes de verificación.");
        parent.addToCollection(c.id);
        await parent.save();
        attachment.setCollections([]);
        attachment.parentID = parent.id;
        await attachment.save();
      });
      return parent;
    } catch (error) {
      try { await attachment.reload(null, true); } catch (_) {}
      throw error;
    }
  }
  Z.localImports = {
    validateDestination: destination,
    destinations() {
      return Zotero.Libraries.getAll().filter(l => ["user", "group"].includes(l.libraryType)).map(library => {
        const reason = permission(library);
        const collections = Zotero.Collections.getByLibrary(library.libraryID, true).filter(c => !c.deleted && c.libraryID === library.libraryID).map(c => {
          const path = [c.name], seen = new Set([c.id]);let parent = c.parentID;
          while (parent && !seen.has(parent)) {seen.add(parent);const p = Zotero.Collections.get(parent);if (!p || p.libraryID !== library.libraryID || p.deleted) break;path.unshift(p.name);parent = p.parentID;}
          return {id: c.id, name: c.name, path: path.join(" / ")};
        });
        return {libraryID: library.libraryID, name: library.name || Zotero.Libraries.getName(library.libraryID), canImport: !reason, reason, collections};
      });
    },
    async importFiles(files, {collectionID, fallbackType = "document", signal, onProgress = () => {}} = {}) {
      Z.checkAbort(signal);
      const c = destination(collectionID), original = {id: c.id, key: c.key, libraryID: c.libraryID};
      if (!["document", "thesis", "book", "journalArticle"].includes(fallbackType)) throw Error("Tipo de contenedor no válido.");
      if (!Array.isArray(files) || !files.length || files.length > 500) throw Error("Selecciona entre 1 y 500 archivos.");
      const unique = new Map();
      for (const file of files) {
        if (!file?.path || !file.exists() || !file.isFile()) throw Error("Algún archivo seleccionado no está disponible.");
        unique.set(file.path, file);
      }
      const summary = {total: unique.size, importados: 0, reconocidos: 0, provisionales: 0, errores: [], resultados: [], detenido: false};
      for (const file of unique.values()) {
        if (signal?.aborted) {summary.detenido = true;break;}
        const current = destination(original.id, original.key);
        if (current.libraryID !== original.libraryID) throw Error("La biblioteca de destino cambió.");
        const row = {archivo: file.leafName, item_id: null, adjunto_id: null, provisional: false};
        try {
          const attachment = await Zotero.Attachments.importFromFile({file, libraryID: c.libraryID, collections: [c.id], title: file.leafName});
          if (!attachment?.id) throw Error("Zotero no creó el adjunto.");
          summary.importados++;row.adjunto_id = attachment.id;
          const engine = Zotero.RecognizeDocument || Zotero.RecognizePDF;
          if (!signal?.aborted && attachment.attachmentContentType === "application/pdf" && typeof engine?.recognizeItems === "function") {
            try {await engine.recognizeItems([attachment]);} catch (_) {row.aviso = "Zotero no pudo recuperar los metadatos. Se crea un contenedor provisional.";}
          }
          const fresh = Zotero.Items.get(attachment.id);
          if (!fresh || fresh.deleted || fresh.libraryID !== c.libraryID) throw Error("El adjunto importado ya no está disponible en la biblioteca de destino.");
          let parent = fresh.parentID ? Zotero.Items.get(fresh.parentID) : null;
          destination(original.id, original.key);
          if (parent) {
            if (!parent.isRegularItem() || parent.deleted || parent.libraryID !== c.libraryID) throw Error("El reconocimiento devolvió una referencia padre no válida.");
            if (!parent.getCollections().includes(c.id)) {parent.addToCollection(c.id);await parent.saveTx();}
            summary.reconocidos++;
          } else {
            parent = await makeParent(fresh, c, fallbackType, file.leafName);
            row.provisional = true;summary.provisionales++;
          }
          row.item_id = parent.id;
        } catch (error) {
          row.error = error.message;
          summary.errores.push(file.leafName + ": " + error.message);
        }
        summary.resultados.push(row);
        summary.detenido = !!signal?.aborted;
        onProgress(summary);
        if (summary.detenido) break;
      }
      return summary;
    },
  };
})(ZoteroIA);
