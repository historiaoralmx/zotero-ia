/* global Zotero, ZoteroIA */
(function () {
  const endpoint = "https://incitefulmed.com/academic/mcp";
  const protocol = "2025-06-18";
  const seedLimit = 5;
  const resultLimit = 20;
  const clean = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";

  function doiOf(value) {
    const doi = ZoteroIA.metadataAudit.normalizeDOI(value);
    return /^10\.\d{4,9}\/[^\s<>"\\]{1,240}$/i.test(doi) ? doi.toLowerCase() : "";
  }

  function openAlexID(value) {
    const id = clean(value, 100).replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase();
    return /^W\d{1,20}$/.test(id) ? id : "";
  }

  function selectedSeeds(items) {
    const seeds = [];
    const seen = new Set();
    let omitted = 0;
    for (const item of items) {
      if (!item.isRegularItem()) { omitted++; continue; }
      const extra = item.getField("extra") || "";
      const url = item.getField("url") || "";
      const doi = doiOf(item.getField("DOI")) ||
        doiOf(extra.match(/^DOI:\s*(\S+)\s*$/im)?.[1]) || doiOf(url);
      const id = doi || openAlexID(extra.match(/^OpenAlex:\s*(\S+)\s*$/im)?.[1]) || openAlexID(url);
      if (!id || seen.has(id) || seeds.length >= seedLimit) { omitted++; continue; }
      seen.add(id);
      seeds.push({ id, title: item.getField("title") || id });
    }
    return { seeds, omitted };
  }

  function readReply(xhr, id) {
    const body = xhr.responseText || xhr.response || "";
    if (typeof body !== "string" || body.length > 500000) throw Error("Inciteful devolvió una respuesta inesperada.");
    let packets;
    try {
      const type = xhr.getResponseHeader("Content-Type") || "";
      packets = type.includes("text/event-stream")
        ? body.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/)
          .filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n"))
          .filter(Boolean).map(data => JSON.parse(data))
        : [JSON.parse(body)];
    } catch (_) {
      throw Error("No se pudo leer la respuesta de Inciteful.");
    }
    const packet = packets.find(packet => packet?.jsonrpc === "2.0" && packet.id === id);
    if (!packet || packet.error || !packet.result) throw Error("Inciteful no pudo completar la consulta.");
    return packet.result;
  }

  async function search(seedIDs, signal) {
    const seeds = [...new Set(seedIDs.map(id => doiOf(id) || openAlexID(id)).filter(Boolean))].slice(0, seedLimit);
    if (!seeds.length) throw Error("Selecciona referencias que tengan DOI o identificador OpenAlex.");
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

    async function post(method, params, id) {
      ZoteroIA.checkAbort(signal);
      const message = { jsonrpc: "2.0", method };
      if (params) message.params = params;
      if (id !== undefined) message.id = id;
      let cancelRequest;
      let xhr;
      try {
        xhr = await Zotero.HTTP.request("POST", endpoint, {
          headers: { ...headers }, body: JSON.stringify(message), responseType: "text",
          timeout: method === "tools/call" ? 60000 : 18000, successCodes: false, noCache: true,
          cancellerReceiver(cancel) {
            cancelRequest = cancel;
            if (signal?.aborted) cancel();
            else signal?.addEventListener("abort", cancel, { once: true });
          }
        });
      } catch (_) {
        ZoteroIA.checkAbort(signal);
        throw Error("No se pudo conectar con Inciteful. Intenta de nuevo en unos momentos.");
      } finally {
        if (cancelRequest) signal?.removeEventListener("abort", cancelRequest);
      }
      ZoteroIA.checkAbort(signal);
      if (xhr.status === 429) throw Error("Inciteful alcanzó su límite temporal. Intenta de nuevo más tarde.");
      if (xhr.status < 200 || xhr.status >= 300) throw Error("Inciteful no está disponible en este momento.");
      return xhr;
    }

    const hello = await post("initialize", {
      protocolVersion: protocol, capabilities: {},
      clientInfo: { name: "Zotero IA", version: "1.9.6" }
    }, 1);
    const init = readReply(hello, 1);
    if (init.protocolVersion !== protocol || !init.capabilities?.tools) {
      throw Error("La conexión con Inciteful requiere una actualización del plugin.");
    }
    headers["MCP-Protocol-Version"] = protocol;
    const session = hello.getResponseHeader("Mcp-Session-Id");
    if (session && /^[!-~]{1,256}$/.test(session)) headers["Mcp-Session-Id"] = session;
    await post("notifications/initialized");
    const response = await post("tools/call", {
      name: "find_similar_papers", arguments: { seeds, limit: resultLimit }
    }, 2);
    const result = readReply(response, 2);
    if (result.isError) throw Error("Inciteful no pudo buscar relacionados. Prueba de nuevo con otras referencias.");
    let data = result.structuredContent;
    if (!data) {
      try { data = JSON.parse(result.content?.find(part => part.type === "text")?.text || ""); }
      catch (_) { throw Error("No se pudieron leer los trabajos relacionados."); }
    }
    if (!Array.isArray(data?.rows)) throw Error("Inciteful no devolvió una lista de publicaciones.");
    const seen = new Set(seeds);
    const resolved = data.provenance?.seeds;
    for (const seed of Array.isArray(resolved) ? resolved : []) {
      const id = openAlexID(seed?.openalex_id);
      if (id) seen.add(id);
    }
    const papers = [];
    for (const row of data.rows.slice(0, resultLimit)) {
      const title = clean(row?.title, 500);
      const doi = doiOf(row?.doi);
      const id = openAlexID(row?.paper_id);
      if (!title || !(doi || id) || (doi && seen.has(doi)) || (id && seen.has(id))) continue;
      if (doi) seen.add(doi);
      if (id) seen.add(id);
      papers.push({
        title, doi, id,
        year: Number.isInteger(row.published_year) ? row.published_year : null,
        journal: clean(row.journal, 200),
        authors: Array.isArray(row.authors) ? row.authors.slice(0, 3).map(name => clean(name, 140)).filter(Boolean) : [],
        url: doi ? "https://doi.org/" + encodeURI(doi).replace(/[?#]/g, c => encodeURIComponent(c))
          : "https://openalex.org/" + id
      });
    }
    const unresolved = data.diagnostics?.unresolved_seeds;
    return {
      papers, truncated: data.truncated === true,
      unresolved: Array.isArray(unresolved) ? unresolved.length : 0,
      snapshot: clean(data.provenance?.graph_snapshot, 20),
      method: clean(data.provenance?.method, 140)
    };
  }

  async function savePaper(paper, collectionID, signal) {
    ZoteroIA.checkAbort(signal);
    const doi = doiOf(paper.doi);
    const id = openAlexID(paper.id);
    if (!(doi || id)) throw Error("La publicación no tiene un identificador válido.");
    if (id) {
      const search = new Zotero.Search();
      search.libraryID = Zotero.Libraries.userLibraryID;
      search.addCondition("extra", "contains", "openalex.org/" + id);
      const matches = await search.search();
      const items = matches.length ? await Zotero.Items.getAsync(matches) : [];
      if (items.some(item => openAlexID((item.getField("extra") || "").match(/^OpenAlex:\s*(\S+)\s*$/im)?.[1]) === id)) {
        return { estado: "ya estaba en la biblioteca" };
      }
    }
    ZoteroIA.checkAbort(signal);
    const collection = collectionID ? Zotero.Collections.get(collectionID) : null;
    if (collectionID && (!collection || collection.deleted || collection.libraryID !== Zotero.Libraries.userLibraryID)) {
      throw Error("La colección de destino ya no está disponible. Actualiza la selección.");
    }
    const [result] = await ZoteroIA.tools.guardar_publicacion.run({
      publicaciones: [{ doi, openalex_id: id, titulo: paper.title }],
      coleccion_id: collection?.id
    }, { signal });
    return result;
  }

  ZoteroIA.inciteful = { selectedSeeds, search, savePaper };
})();
