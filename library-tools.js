/* global Zotero, ZoteroIA */
(function (Z) {
  "use strict";
  const S = Z.safe;
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const ids = values => {
    if (!Array.isArray(values) || !values.length || values.length > 100 || values.some(id => !Number.isInteger(id) || id <= 0))
      throw Error("Indica entre 1 y 100 IDs de referencias válidos.");
    return [...new Set(values)];
  };
  const regular = async (id, deleted = false) => {
    const item = await Zotero.Items.getAsync(Number(id));
    if (!item || !item.isRegularItem() || (!deleted && item.deleted)) throw Error("La referencia no existe o está en la papelera.");
    return item;
  };
  const collection = id => {
    const c = Zotero.Collections.get(Number(id));
    if (!c || c.deleted) throw Error("La colección destino no existe o está en la papelera.");
    return c;
  };
  const typeItem = type => {
    if (typeof type !== "string" || !Zotero.ItemTypes.getID(type)) throw Error("Tipo de referencia inválido. Consulta ver_esquema_referencia.");
    const item = new Zotero.Item(type);
    if (!item.isRegularItem()) throw Error("Usa un tipo bibliográfico; las notas y los adjuntos tienen sus propias herramientas.");
    return item;
  };
  const fieldValues = (item, fields = {}) => {
    if (!object(fields)) throw Error("Los campos deben ser un objeto de nombres y textos.");
    const result = {};
    for (const [field, value] of Object.entries(fields)) {
      const fid = Zotero.ItemFields.getID(field);
      if (!fid || !Zotero.ItemFields.isValidForType(fid, item.itemTypeID)) throw Error("Campo no admitido para este tipo: " + field + ". Consulta ver_esquema_referencia.");
      if (typeof value !== "string" || value.length > 100000) throw Error("Valor inválido para " + field);
      result[field] = value;
    }
    return result;
  };
  const creatorValues = (item, values = []) => {
    if (!Array.isArray(values) || values.length > 200) throw Error("Lista de creadores inválida.");
    return values.map(value => {
      if (!object(value)) throw Error("Creador inválido.");
      const role = value.creatorType || "author";
      if (!Zotero.CreatorTypes.isValidForItemType(Zotero.CreatorTypes.getID(role), item.itemTypeID)) throw Error("Tipo de creador no admitido: " + role);
      const text = key => {
        if (value[key] !== undefined && typeof value[key] !== "string") throw Error("Nombre de creador inválido.");
        const name = String(value[key] || "").trim();
        if (name.length > 2000) throw Error("Nombre de creador demasiado largo.");
        return name;
      };
      const name = text("name"), firstName = text("firstName"), lastName = text("lastName");
      if (name && (firstName || lastName)) throw Error("Usa nombre institucional o nombre y apellido, sin mezclarlos.");
      if (!name && !lastName) throw Error("Falta el apellido o el nombre institucional del creador.");
      return name ? {creatorType: role, name} : {creatorType: role, firstName, lastName};
    });
  };
  const tagValues = (values = []) => {
    if (!Array.isArray(values) || values.length > 200 || values.some(t => typeof t !== "string" || !t.trim() || t.trim().length > 200)) throw Error("Etiquetas inválidas.");
    return [...new Set(values.map(t => t.trim()))].map(tag => ({tag, type: 0}));
  };
  const creatorSchema = {type: "array", items: {type: "object", properties: {creatorType: {type: "string"}, firstName: {type: "string"}, lastName: {type: "string"}, name: {type: "string", description: "Solo para autores institucionales o de campo único"}}}};
  const fieldsSchema = {type: "object", additionalProperties: {type: "string"}, description: "Nombres internos de campos de Zotero; usa ver_esquema_referencia si desconoces los válidos"};
  const listSchema = {type: "array", items: {type: "integer"}, minItems: 1, maxItems: 100};
  const apply = async (patches, label, opts, routine) => {
    Z.checkAbort(opts?.signal);
    const plan = await S.create(patches, label);
    return S.apply(plan.id, opts, routine);
  };
  Z.libraryTools = {
    async assertTrashChange(item, deleted) {
      if (deleted) return;
      // Restoring a merged-away item makes Zotero modify other items' merge
      // relations. Keep this special native workflow out of a single-item undo.
      const relations = Zotero.Relations;
      if (relations?.getByPredicateAndObject) {
        const merging = await relations.getByPredicateAndObject("item", relations.replacedItemPredicate, Zotero.URI.getItemURI(item));
        if (merging.length) throw Error("Esta referencia forma parte de una fusión. Restáurala desde la papelera de Zotero para revisar también las referencias relacionadas.");
      }
    },
    prepareRecord(patch) {
      const item = typeItem(patch.itemType), c = patch.collectionID == null ? null : collection(patch.collectionID);
      const fields = fieldValues(item, patch.fields);
      const provisional = !String(fields.title || "").trim();
      if (provisional) fields.title = Zotero.ItemTypes.getLocalizedString(patch.itemType) + " (pendiente de completar)";
      const creators = creatorValues(item, patch.creators), tags = tagValues(patch.tags);
      // Exercise Zotero's own validation before persisting a proposal or writing data.
      for (const [field, value] of Object.entries(fields)) item.setField(field, value);
      item.setCreators(creators);item.setTags(tags);
      return {itemType: patch.itemType, libraryID: c?.libraryID || Zotero.Libraries.userLibraryID,
        collectionID: c?.id || null, collectionKey: c?.key || null,
        fields, creators, tags, provisional};
    },
  };
  Object.assign(Z.tools, {
    ver_esquema_referencia: {
      description: "Consulta los tipos de referencia de esta instalación de Zotero, o los campos y roles de creador válidos para un tipo. No modifica nada.",
      parameters: {type: "object", properties: {tipo: {type: "string"}}},
      async run({tipo} = {}) {
        if (!tipo) return {tipos: Zotero.ItemTypes.getTypes().filter(t => !["note", "attachment", "annotation"].includes(t.name)).map(t => ({tipo: t.name, nombre: Zotero.ItemTypes.getLocalizedString(t.id)}))};
        const item = typeItem(tipo);
        return {tipo, campos: Zotero.ItemFields.getItemTypeFields(item.itemTypeID).map(id => ({campo: Zotero.ItemFields.getName(id), nombre: Zotero.ItemFields.getLocalizedString(id)})),
          creadores: Zotero.CreatorTypes.getTypesForItemType(item.itemTypeID).map(t => ({creatorType: t.name, nombre: Zotero.CreatorTypes.getLocalizedString(t.id)}))};
      },
    },
    crear_referencia: {
      escribe: true, managesApproval: true,
      description: "Crea directamente un registro bibliográfico de cualquier tipo de Zotero, incluso una tesis vacía o elemento contenedor sin PDF, DOI ni ISBN. tipo usa el nombre interno (thesis, book, journalArticle, etc.). Si no hay título se marca pendiente de completar. Solo incluye datos proporcionados o verificados; no inventes metadatos. Ubica el registro en coleccion_id si se indica.",
      parameters: {type: "object", properties: {tipo: {type: "string"}, titulo: {type: "string"}, coleccion_id: {type: "integer"}, campos: fieldsSchema, creadores: creatorSchema, etiquetas: {type: "array", items: {type: "string"}}}, required: ["tipo"]},
      async run(a, opts = {}) {
        if (a.campos?.title !== undefined && a.titulo !== undefined && a.campos.title !== a.titulo) throw Error("Se indicaron dos títulos distintos.");
        const result = await apply([{type: "createItem", itemType: a.tipo, collectionID: a.coleccion_id,
          fields: {...(a.campos || {}), ...(a.titulo !== undefined ? {title: a.titulo} : {})}, creators: a.creadores, tags: a.etiquetas}], "Crear referencia bibliográfica", opts, {name: "crear_referencia", args: a});
        const op = result.changes?.find(p => p.type === "createItem");
        return {...result, tipo: op?.after.itemType, titulo: op?.after.fields.title, coleccion_id: op?.after.collectionID, registro_provisional: op?.after.provisional};
      },
    },
    consultar_referencia: {
      description: "Consulta campos, creadores, etiquetas, colecciones, notas y adjuntos de una referencia, incluido su estado en la papelera. No lee el texto completo ni modifica datos.",
      parameters: {type: "object", properties: {item_id: {type: "integer"}}, required: ["item_id"]},
      async run({item_id}) {
        const item = await regular(item_id, true);
        const entries = async values => Promise.all(values.map(async id => {const v = await Zotero.Items.getAsync(id);return v ? {id, titulo: v.getField("title"), tipo: v.itemType, contenido_nota: v.isNote?.() ? v.getNote() : undefined, tipo_archivo: v.attachmentContentType} : {id, no_disponible: true};}));
        return {item_id: item.id, biblioteca: item.libraryID, en_papelera: !!item.deleted, datos: item.toJSON(), colecciones: item.getCollections(), notas: await entries(item.getNotes()), adjuntos: await entries(item.getAttachments())};
      },
    },
    listar_papelera: {
      description: "Lista referencias bibliográficas en la papelera, con IDs reales para restaurarlas. No vacía la papelera ni modifica datos. Por defecto consulta la biblioteca personal.",
      parameters: {type: "object", properties: {biblioteca_id: {type: "integer"}, consulta: {type: "string"}, desde: {type: "integer"}, limite: {type: "integer"}}},
      async run({biblioteca_id = Zotero.Libraries.userLibraryID, consulta = "", desde = 0, limite = 50} = {}) {
        if (!Zotero.Libraries.get(biblioteca_id)) throw Error("Biblioteca inexistente.");
        const items = await Zotero.Items.getDeleted(biblioteca_id, false);
        const query = String(consulta).trim().toLocaleLowerCase();
        const matches = items.filter(item => item.isRegularItem() && (!query || item.getField("title").toLocaleLowerCase().includes(query)));
        const start = Math.max(0, Number(desde) || 0), count = Math.max(1, Math.min(100, Number(limite) || 50));
        return {total: matches.length, desde: start, resultados: matches.slice(start, start + count).map(item => ({item_id: item.id, tipo: item.itemType, titulo: item.getField("title"), biblioteca_id: item.libraryID}))};
      },
    },
    editar_referencias: {
      escribe: true, managesApproval: true,
      description: "Edita los campos o creadores de referencias existentes mediante vista previa y confirmación, con historial para deshacer. No inventes datos ni sustituyas una identidad dudosa. Los creadores se reemplazan solo si se incluyen.",
      parameters: {type: "object", properties: {cambios: {type: "array", minItems: 1, maxItems: 100, items: {type: "object", properties: {item_id: {type: "integer"}, campos: fieldsSchema, creadores: creatorSchema}, required: ["item_id"]}}}, required: ["cambios"]},
      async run({cambios}, opts = {}) {
        if (!Array.isArray(cambios) || !cambios.length || cambios.length > 100) throw Error("Indica entre 1 y 100 referencias.");
        const patches = [];
        for (const row of cambios) {const item = await regular(row.item_id);patches.push({type: "item", id: item.id, fields: fieldValues(item, row.campos), ...(row.creadores !== undefined ? {creators: creatorValues(item, row.creadores)} : {})});}
        return apply(patches, "Editar referencias bibliográficas", opts);
      },
    },
    duplicar_referencia: {
      escribe: true, managesApproval: true,
      description: "Duplica los campos, creadores y etiquetas de una referencia en una colección. No copia sus PDF, notas ni relaciones. La nueva referencia tiene historial para deshacer.",
      parameters: {type: "object", properties: {item_id: {type: "integer"}, coleccion_id: {type: "integer"}}, required: ["item_id", "coleccion_id"]},
      async run(a, opts = {}) {
        const item = await regular(a.item_id), c = collection(a.coleccion_id);
        if (item.libraryID !== c.libraryID) throw Error("Para duplicar entre bibliotecas usa la función nativa de Zotero; esta herramienta duplica dentro de la misma biblioteca.");
        const data = item.toJSON(), fields = {};
        for (const id of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {const name = Zotero.ItemFields.getName(id);if (typeof data[name] === "string") fields[name] = data[name];}
        return apply([{type: "createItem", itemType: item.itemType, collectionID: c.id, fields, creators: item.getCreatorsJSON(), tags: item.getTags().map(t => t.tag)}], "Duplicar referencia", opts, {name: "duplicar_referencia", args: a});
      },
    },
    quitar_etiquetas: {
      escribe: true, managesApproval: true,
      description: "Quita únicamente las etiquetas indicadas, conservando las demás y los metadatos. Requiere aprobar la vista previa y permite deshacer.",
      parameters: {type: "object", properties: {item_ids: listSchema, etiquetas: {type: "array", items: {type: "string"}}}, required: ["item_ids", "etiquetas"]},
      async run({item_ids, etiquetas}, opts = {}) {
        const remove = tagValues(etiquetas).map(t => t.tag), patches = [];
        for (const id of ids(item_ids)) {const item = await regular(id);patches.push({type: "item", id, tags: item.getTags().filter(t => !remove.includes(t.tag))});}
        return apply(patches, "Quitar etiquetas", opts);
      },
    },
    quitar_de_coleccion: {
      escribe: true, managesApproval: true,
      description: "Retira referencias de una colección sin borrarlas de la biblioteca ni de otras colecciones. Requiere vista previa y permite deshacer.",
      parameters: {type: "object", properties: {item_ids: listSchema, coleccion_id: {type: "integer"}}, required: ["item_ids", "coleccion_id"]},
      async run({item_ids, coleccion_id}, opts = {}) {
        const c = collection(coleccion_id), patches = [];
        for (const id of ids(item_ids)) {const item = await regular(id);if (item.libraryID !== c.libraryID) throw Error("La colección pertenece a otra biblioteca.");patches.push({type: "item", id, collections: item.getCollections().filter(cid => cid !== c.id)});}
        return apply(patches, "Retirar referencias de una colección", opts);
      },
    },
    mover_referencias: {
      escribe: true, managesApproval: true,
      description: "Mueve referencias de una colección origen a otra de la misma biblioteca. Conserva las demás pertenencias y los adjuntos. Requiere vista previa y permite deshacer.",
      parameters: {type: "object", properties: {item_ids: listSchema, origen_id: {type: "integer"}, destino_id: {type: "integer"}}, required: ["item_ids", "origen_id", "destino_id"]},
      async run({item_ids, origen_id, destino_id}, opts = {}) {
        const origin = collection(origen_id), dest = collection(destino_id), patches = [];
        if (origin.libraryID !== dest.libraryID) throw Error("Origen y destino deben pertenecer a la misma biblioteca.");
        for (const id of ids(item_ids)) {const item = await regular(id), current = item.getCollections();if (item.libraryID !== dest.libraryID || !current.includes(origin.id)) throw Error("La referencia no pertenece a la colección origen.");patches.push({type: "item", id, collections: [...new Set([...current.filter(cid => cid !== origin.id), dest.id])]});}
        return apply(patches, "Mover referencias entre colecciones", opts);
      },
    },
    relacionar_referencias: {
      escribe: true, managesApproval: true,
      description: "Vincula dos referencias de la misma biblioteca con la función Relacionado de Zotero, sin afirmar que se citan o que coinciden teóricamente. Conserva relaciones previas. Requiere vista previa y permite deshacer.",
      parameters: {type: "object", properties: {item_a: {type: "integer"}, item_b: {type: "integer"}}, required: ["item_a", "item_b"]},
      async run({item_a, item_b}, opts = {}) {
        const a = await regular(item_a), b = await regular(item_b);
        if (a.id === b.id || a.libraryID !== b.libraryID) throw Error("Elige dos referencias distintas de la misma biblioteca.");
        const patch = (item, other) => {const relations = Z.research.clone(item.getRelations()), old = relations["dc:relation"] || [];relations["dc:relation"] = [...new Set([...(Array.isArray(old) ? old : [old]), Zotero.URI.getItemURI(other)])];return {type: "item", id: item.id, relations};};
        return apply([patch(a, b), patch(b, a)], "Relacionar referencias", opts);
      },
    },
  });
  for (const [name, deleted, label] of [["enviar_referencias_a_papelera", true, "Enviar referencias a la papelera"], ["restaurar_referencias", false, "Restaurar referencias de la papelera"]]) {
    Z.tools[name] = {escribe: true, managesApproval: true,
      description: label + ". Requiere aprobar los registros exactos y guarda historial para deshacer. No elimina definitivamente ni vacía la papelera.",
      parameters: {type: "object", properties: {item_ids: listSchema}, required: ["item_ids"]},
      run: ({item_ids}, opts = {}) => apply(ids(item_ids).map(id => ({type: "setDeleted", id, deleted})), label, opts)};
  }
  Z.agentGroups.registros = {pattern: /referenc|registro|contenedor|tesis|libro|art[ií]culo|(?:ítem|item|elemento).*(?:crea|nuevo)|(?:crea|nuevo|nueva).*(?:ítem|item|elemento)/i,
    names: ["ver_esquema_referencia", "crear_referencia", "consultar_referencia"]};
  Z.agentGroups.gestion = {pattern: /edita|modifica|cambia|mueve|mover|quita|retira|papelera|restaura|duplic|relaciona/i,
    names: ["consultar_referencia", "editar_referencias", "duplicar_referencia", "quitar_etiquetas", "quitar_de_coleccion", "mover_referencias", "relacionar_referencias", "listar_papelera", "enviar_referencias_a_papelera", "restaurar_referencias"]};
})(ZoteroIA);
