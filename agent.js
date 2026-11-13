/* global Zotero, ZoteroIA, Services */
// Agente: herramientas sobre la biblioteca de Zotero + bucle de "tool calling" (formato OpenAI)

ZoteroIA.md2html = function (md) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Format source tokens, never generated tags, code contents or link attributes.
  const inline = (s, depth=0) => {
    if(depth>=8)return esc(s);
    const tokens=/`([^`]+)`|\[([^\]]+)\]\(((?:https?:\/\/|zotero:\/\/(?:open-pdf|select)\/)[^\s)]+)\)|\*\*(.+?)\*\*|\*([^*]+)\*/g;
    let html="",end=0,m;
    while((m=tokens.exec(s))){
      html+=esc(s.slice(end,m.index));
      if(m[1]!==undefined)html+="<code>"+esc(m[1])+"</code>";
      else if(m[2]!==undefined)html+='<a href="'+esc(m[3]).replace(/"/g,"&quot;")+'">'+esc(m[2])+"</a>";
      else if(m[4]!==undefined)html+="<b>"+inline(m[4],depth+1)+"</b>";
      else html+="<i>"+inline(m[5],depth+1)+"</i>";
      end=tokens.lastIndex;
    }
    return html+esc(s.slice(end));
  };
  const lines = String(md).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").split("\n");
  let out = [], i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r));
      out.push("<table border='1'>" + body.map((r, k) => "<tr>" + cells(r).map(c => (k ? "<td>" : "<th>") + inline(c) + (k ? "</td>" : "</th>")).join("") + "</tr>").join("") + "</table>");
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`);
    else if (/^\s*[-*]\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push("<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>"); i++; }
      out.push("<ul>" + items.join("") + "</ul>"); continue;
    }
    else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) out.push("<hr/>");
    else if (l.trim()) out.push("<p>" + inline(l) + "</p>");
    i++;
  }
  return out.join("\n");
};

ZoteroIA.renderMarkdown = function (element, markdown) {
  const text=String(markdown??"");
  try { element.innerHTML=this.md2html(text); }
  catch (_) { element.textContent=text; }
};

ZoteroIA.withAbort = function(promise,signal) {
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{
  const abort=()=>{const error=new Error("Tarea detenida por el usuario");error.name="AbortError";reject(error);};
  if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
 });
};
ZoteroIA.checkAbort = function(signal) { if(signal?.aborted) { const e=new Error("Tarea detenida por el usuario"); e.name="AbortError"; throw e; } };
ZoteroIA.creatorData = c => ({creatorType:c.creatorType, firstName:c.firstName||"", lastName:c.lastName||c.name||"", fieldMode:c.name?1:(c.fieldMode||0)});
ZoteroIA.creatorSignature = creators => JSON.stringify(creators.map(ZoteroIA.creatorData));
ZoteroIA.datePrecision = value => {
 const text=String(value||"").trim();
 const iso=text.match(/^\d{4}(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?$/);
 if(iso)return iso[2]?3:iso[1]?2:1;
 if(/^\d{1,2}[/.-]\d{4}$/.test(text))return 2;
 if(/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(text))return 3;
 // Preserve nonstandard dates rather than silently discard their precision.
 return text?4:0;
};
// File-backed journal; initialized before the agent window can use it.
ZoteroIA.initJournal = async function() {
 const journal=this.taskJournal;
 journal.path=PathUtils.join(Zotero.getProfileDirectory().path,"zotero-ia-tasks.json");
 try { journal.cache=JSON.parse(await IOUtils.readUTF8(journal.path)); if(!Array.isArray(journal.cache))journal.cache=[]; }
 catch(e) { if(e.name!=="NotFoundError") { Zotero.debug("Zotero IA: historial no legible; se conserva el archivo"); return; } journal.cache=journal.loadLegacy(); }
 await journal.save(journal.cache);
 if(Services.prefs.prefHasUserValue(journal.key))Services.prefs.clearUserPref(journal.key);
};

ZoteroIA.summarize = function (item) {
  const creators = item.getCreatorsJSON().filter(c=>c.creatorType==="author").map(c => c.lastName || c.name || "").filter(Boolean);
  return {
    id: item.id,
    tipo: item.itemType,
    titulo: item.getField("title"),
    autores: creators.slice(0, 4).join("; ") + (creators.length > 4 ? " et al." : ""),
    año: Zotero.Date.strToDate(item.getField("date") || "").year || "",
    etiquetas: item.getTags().map(t => t.tag).slice(0, 10),
  };
};

// v1.0: utilidades de auditoría, sin modificar registros.
ZoteroIA.auditCollectionItems = function (coleccion_id, limite=250) {
  let col;
  if (coleccion_id) col=Zotero.Collections.get(Number(coleccion_id));
  else {
    const pane=Zotero.getActiveZoteroPane();
    const cs=pane && pane.getSelectedCollections ? pane.getSelectedCollections() : [];
    col=cs && cs[0];
  }
  if (!col) throw new Error("Selecciona una colección en Zotero o indica coleccion_id.");
  const all=col.getChildItems().filter(it=>it.isRegularItem());
  const selected=all.slice(0,Math.max(1,Math.min(1000,Number(limite)||250)));
  return {col,all,selected};
};
ZoteroIA.auditItem = function(item) {
  const required=["title","date"];
  if (["journalArticle","conferencePaper"].includes(item.itemType)) required.push("publicationTitle");
  if (item.itemType==="bookSection") required.push("bookTitle");
  if (["book","bookSection"].includes(item.itemType)) required.push("publisher");
  const missing=required.filter(f=>{try {return !String(item.getField(f)||"").trim();} catch(_) {return false;}});
  const creators=item.getCreatorsJSON()||[];
  if (!creators.some(c=>c.creatorType==="author")) missing.push("author");
  const attachments=(item.getAttachments?item.getAttachments():[]).map(id=>Zotero.Items.get(id)).filter(Boolean);
  const pdfs=attachments.filter(a=>a.attachmentContentType==="application/pdf");
  return {id:item.id,titulo:item.getField("title")||"(sin título)",tipo:item.itemType,campos_faltantes:missing,pdf_adjunto:pdfs.length>0,pdf_ids:pdfs.map(p=>p.id)};
};


// v1.4: metadatos comprobados por DOI. No utiliza Gemini como fuente bibliográfica.
ZoteroIA.metadataAudit = {
  normalizeDOI(value) { return String(value||"").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:\s*/i,"").trim(); },
  norm(value) { return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," "); },
  field(it,f) { try { return String(it.getField(f)||"").trim(); } catch (_) { return ""; } },
  historyKey:"extensions.zotero-ia.metadataCorrectionHistory",
  history() { try { const h=JSON.parse(Services.prefs.getStringPref(this.historyKey,"[]")); return Array.isArray(h)?h:[]; } catch(_) { return []; } },
  saveHistory(h) { Services.prefs.setStringPref(this.historyKey,JSON.stringify(h.slice(-200))); },
  async getCrossref(doi) {
    const url="https://api.crossref.org/works/"+encodeURIComponent(doi);
    try {
      const response=await Zotero.HTTP.request("GET",url,{responseType:"json",timeout:12000,headers:{Accept:"application/json"}});
      const payload=typeof response.response==="string"?JSON.parse(response.response):response.response;
      if (!payload||!payload.message||this.normalizeDOI(payload.message.DOI).toLowerCase()!==doi.toLowerCase()) throw new Error("Crossref devolvió un DOI diferente");
      return payload.message;
    } catch(e) {
      const code=Number(e.status||e.statusCode||e.response?.status||0);
      throw new Error(code===404?"DOI no encontrado en Crossref":code===429?"Límite temporal de Crossref (429)":code===403?"Crossref rechazó la petición (403)":"No se pudo consultar Crossref: "+String(e.message||e).slice(0,110));
    }
  },
  candidates(it,m) {
    const first=a=>Array.isArray(a)?String(a[0]||"").trim():"";
    const data={title:first(m.title),publicationTitle:first(m["container-title"]),volume:String(m.volume||""),issue:String(m.issue||""),pages:String(m.page||""),DOI:String(m.DOI||"")};
    const typ=it.itemType;
    const allowed=typ==="journalArticle"?["title","publicationTitle","volume","issue","pages","DOI"]:typ==="conferencePaper"?["title","publicationTitle","pages","DOI"]:typ==="bookSection"?["title","pages","DOI"]:typ==="book"?["title","DOI"]:["title","DOI"];
    const dateParts=(m.published&&m.published["date-parts"]||m.issued&&m.issued["date-parts"]||[])[0]||[];
    if (dateParts[0]&&["journalArticle","conferencePaper","bookSection","book"].includes(typ)){data.date=dateParts.filter(x=>Number.isInteger(x)).map((x,i)=>i?String(x).padStart(2,"0"):String(x)).join("-");allowed.push("date");}
    return allowed.filter(f=>data[f]&&Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(f),it.itemTypeID)).map(f=>({campo:f,actual:this.field(it,f),propuesto:data[f]}));
  },
  async verify(it) {
    if(!it||!it.isRegularItem())throw new Error("La entrada no es una referencia bibliográfica");
    const doi=this.normalizeDOI(this.field(it,"DOI"));
    if(!/^10\.\d{4,9}\/\S+$/i.test(doi))return {item_id:it.id,titulo:this.field(it,"title"),estado:"SIN_DOI_VERIFICABLE",cambios:[],advertencia:"No se modifica un registro sin DOI verificable"};
    const record=await this.getCrossref(doi);
    const title=this.field(it,"title"),remote=String((record.title||[])[0]||"");
    const localNorm=this.norm(title), remoteNorm=this.norm(remote);
    // Reject blank, extremely short and partial titles; DOI alone is not evidence of matching identity.
    const localTokens=localNorm.split(" ").filter(Boolean), remoteTokens=remoteNorm.split(" ").filter(Boolean);
    const common=new Set(localTokens.filter(w=>remoteTokens.includes(w)));
    const overlap=common.size / Math.max(localTokens.length,remoteTokens.length,1);
    const validIdentity=localNorm.length>=12 && remoteNorm.length>=12 && localTokens.length>=3 && remoteTokens.length>=3 &&
      (localNorm===remoteNorm || (overlap>=0.85 && Math.abs(localTokens.length-remoteTokens.length)<=2));
    const differences=this.candidates(it,record).filter(x=>x.actual!==x.propuesto).map(x=>({ ...x,accion:!validIdentity?"REVISION_IDENTIDAD":!x.actual?"COMPLETAR":"REVISION_DISCREPANCIA"}));
    const authors=(record.author||[]).map(a=>[a.given,a.family].filter(Boolean).join(" ")).slice(0,12);
    const localAuthors=(it.getCreatorsJSON()||[]).filter(c=>c.creatorType==="author").map(c=>[c.firstName,c.lastName].filter(Boolean).join(" ")).slice(0,12);
    return {item_id:it.id,titulo:title,doi,fuente:"https://api.crossref.org/works/"+encodeURIComponent(doi),estado:validIdentity?"DOI_Y_TITULO_COMPATIBLES":"IDENTIDAD_DUDOSA",cambios:differences,autores_fuente:authors,autores_locales:localAuthors,advertencia:"Autores y discrepancias en campos ya completos requieren revisión; Crossref puede contener errores depositados por editores."};
  }
};

ZoteroIA.tools = {
  traducir_documento: {
    description:"Traduce con el proveedor IA configurado el texto recuperado del PDF o el resumen de un ítem. No modifica el original. Permite guardar la traducción como nota hija opcionalmente. Para textos extensos, procesar fragmentos sucesivos; señalar truncamiento.",
    parameters:{type:"object",properties:{item_id:{type:"integer"},idioma_destino:{type:"string",description:"Idioma de destino; por defecto español"},desde:{type:"integer"},caracteres:{type:"integer"},guardar_nota:{type:"boolean"}},required:["item_id"]},
    // Even when the argument suggests writing, request approval for the note.
    escribe:true,
    resumen:a=>"Traducir documento "+a.item_id+(a.guardar_nota?" y guardar nota":" (sin guardar)"),
    async run({item_id,idioma_destino="español",desde=0,caracteres=7000,guardar_nota=false}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const item=await Zotero.Items.getAsync(Number(item_id));
      if(!item)throw new Error("No existe el documento indicado.");
      let att=item.isAttachment()?item:(item.isRegularItem()?await item.getBestAttachment():null);
      let full="";
      if(att){try{full=String(await att.attachmentText||"");}catch(e){throw new Error("No puedo extraer texto de este adjunto: "+e.message);}}
      if(!full.trim()&&item.isRegularItem())full=String(item.getField("abstractNote")||"");
      if(!full.trim())throw new Error("No hay texto accesible para traducir. No implica necesariamente que necesite OCR.");
      const start=Math.max(0,Math.floor(Number(desde)||0));const max=Math.max(1000,Math.min(10000,Math.floor(Number(caracteres)||7000)));
      if(start>=full.length) return {item_id,fin:true,total_caracteres:full.length};
      const segment=full.slice(start,start+max);
      const content=await ZoteroIA.chat([{role:"system",content:"Traduce fielmente al "+idioma_destino+" el texto proporcionado. Respeta nombres, citas, referencias y estructura. No añadas comentarios, no inventes información ni omitas deliberadamente contenido. Devuelve solo la traducción."},{role:"user",content:segment}]);
      let noteId=null;
      if(guardar_nota){const parent=item.isRegularItem()?item:(item.parentItem||null);if(!parent)throw new Error("Se tradujo el fragmento, pero no se guardó: el PDF no tiene ítem padre. Primero crea su referencia bibliográfica.");const note=new Zotero.Item("note");note.libraryID=parent.libraryID;note.parentID=parent.id;const esc=t=>String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");note.setNote("<h2>Traducción al "+esc(idioma_destino)+" (fragmento "+start+"–"+(start+segment.length)+")</h2><p>Traducción automática; verificar frente al original.</p>"+content.split(/\n\s*\n/).map(x=>"<p>"+esc(x)+"</p>").join(""));ZoteroIA.checkAbort(signal);await note.saveTx();noteId=note.id;}
      return {item_id,idioma_destino,desde:start,siguiente_desde:start+segment.length,hay_mas:start+segment.length<full.length,total_caracteres:full.length,traduccion:content,nota_id:noteId,advertencia:"Traducción de un fragmento, no del PDF completo. El texto debe revisarse con el original."};
    }
  },
  listar_canales: {
    description:"Enumera los canales RSS ya suscritos en Zotero. Solo lectura; si la API de canales no está disponible, comunica el límite.",
    parameters:{type:"object",properties:{}},
    async run(_args={}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);if(!Zotero.Feeds||typeof Zotero.Feeds.getAll!=="function")return {disponible:false,mensaje:"No se encontró API nativa de canales. Abre Nuevo canal en Zotero para gestionar suscripciones."};const feeds=await Zotero.Feeds.getAll();return {canales:(Array.isArray(feeds)?feeds:Object.values(feeds||{})).map(f=>({id:f.id||null,nombre:f.name||f.getName?.()||"",url:f.url||""})).slice(0,300)};}
  },
  suscribir_canal_rss: {
    description:"Suscribe un canal RSS/Atom en Zotero usando su API local. Verifica XML y duplicados antes de guardar y comprueba la suscripción después. No crea una colección bibliográfica ni publica nada.",
    parameters:{type:"object",properties:{url:{type:"string",description:"URL HTTPS pública del feed RSS o Atom"},nombre:{type:"string",description:"Nombre del canal"}},required:["url"]},
    escribe:true,
    resumen: a=>"Suscribir canal RSS «"+(a.nombre||a.url)+"» en Zotero",
    async run({url,nombre}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const u=new URL(String(url||""));
      if(u.protocol!=="https:"||u.username||u.password)throw new Error("Se requiere una URL HTTPS pública sin credenciales.");
      const host=u.hostname.toLowerCase();
      if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal")||host==="::1"||host==="0.0.0.0"||/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))throw new Error("No se permiten direcciones locales o privadas.");
      if(!Zotero.Feed||!Zotero.Feeds||typeof Zotero.Feeds.getAll!=="function")throw new Error("Esta versión de Zotero no expone la API de canales requerida. No se realizó ninguna suscripción.");
      const all=await Zotero.Feeds.getAll();
      const current=Array.isArray(all)?all:Object.values(all||{});
      const existing=current.find(f=>String(f.url||"").replace(/\/$/,"")===u.href.replace(/\/$/,""));
      if(existing)return {estado:"YA_EXISTE",nombre:existing.name||"",url:existing.url,id:existing.id};
      const request=await Zotero.HTTP.request("GET",u.href,{responseType:"text",timeout:15000});
      const xml=String(request.responseText||request.response||"").slice(0,2000000);
      const doc=new DOMParser().parseFromString(xml,"application/xml");
      if(doc.querySelector("parsererror")||!doc.documentElement||!["rss","feed","RDF"].includes(doc.documentElement.localName))throw new Error("La dirección no devuelve un RSS/Atom válido. No se creó el canal.");
      const title=String(nombre||doc.querySelector("channel > title")?.textContent||doc.querySelector("feed > title")?.textContent||host).trim().slice(0,180);
      if(!title)throw new Error("No se pudo determinar el título del canal.");
      let feed;
      try{
        feed=new Zotero.Feed();
        feed.name=title;feed.url=u.href;
        feed.refreshInterval=60;feed.cleanupReadAfter=30;feed.cleanupUnreadAfter=90;
        ZoteroIA.checkAbort(signal);await feed.saveTx();
      }catch(e){throw new Error("No se pudo guardar el canal mediante Zotero.Feed: "+e.message+". No se confirmó su creación.");}
      const after=await Zotero.Feeds.getAll();
      const saved=(Array.isArray(after)?after:Object.values(after||{})).find(f=>f.id===feed.id||f.url===u.href);
      if(!saved)throw new Error("La API respondió, pero no se pudo verificar el canal en Zotero. Comprueba la sección Canales antes de volver a intentarlo.");
      return {estado:"SUSCRITO_XML_VALIDO",xml_valido:true,suscripcion_guardada:true,entradas_xml:doc.querySelectorAll("item, entry").length,lectura_entradas_zotero_verificada:false,id:saved.id,nombre:saved.name||title,url:saved.url||u.href,nota:"Canal guardado en Zotero y XML válido. No se ha verificado que contenga entradas recientes ni que Zotero pueda actualizarlas."};
    }
  },
  revisar_canal_url: {
    description:"Lee un canal RSS/Atom conocido a partir de su URL, sin registrarlo. Devuelve artículos y enlaces verificables para que el investigador decida. No es un buscador general ni descubre páginas automáticamente.",
    parameters:{type:"object",properties:{url:{type:"string"},limite:{type:"integer"}},required:["url"]},
    async run({url,limite=20}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const parsed=new URL(String(url));if(parsed.protocol!=="https:")throw new Error("Por seguridad solo se admiten canales HTTPS.");
      if(/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i.test(parsed.hostname))throw new Error("No se permiten direcciones de red privada.");
      const response=await Zotero.HTTP.request("GET",parsed.href,{responseType:"text",timeout:15000});
      const doc=new DOMParser().parseFromString(String(response.responseText||response.response||""),"application/xml");
      if(doc.querySelector("parsererror"))throw new Error("La URL no devuelve XML RSS/Atom válido.");
      const entries=[...doc.getElementsByTagName("item")];if(!entries.length)entries.push(...doc.getElementsByTagName("entry"));
      if(!entries.length)throw new Error("No se encontraron entradas RSS/Atom.");
      const value=(el,name)=>{const e=[...el.childNodes].find(n=>n.localName===name);return e?e.textContent.trim():"";};
      return {url:parsed.href,resultados:entries.slice(0,Math.min(50,Math.max(1,Number(limite)||20))).map(e=>{const link=[...e.childNodes].find(n=>n.localName==="link");return {titulo:value(e,"title"),fecha:value(e,"pubDate")||value(e,"updated")||value(e,"published"),enlace:link?.getAttribute?.("href")||value(e,"link")||"",descripcion:(value(e,"description")||value(e,"summary")||"").replace(/<[^>]*>/g,"").slice(0,700)};}),nota:"Información obtenida del RSS. No equivale a revisar el texto completo de las publicaciones."};
    }
  },
  detectar_rss_sitio: {
    description:"Detecta canales RSS/Atom publicados por una web. Informa bloqueos HTTP sin exponer HTML de verificación. Ante bloqueo prueba direcciones convencionales en el mismo sitio, sin eludir protecciones. Una URL de feed no equivale a una suscripción.",
    parameters:{type:"object",properties:{url:{type:"string"}},required:["url"]},
    async run({url}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const site=new URL(String(url||""));
      if(site.protocol!=="https:"||site.username||site.password)throw new Error("Es necesaria una URL HTTPS pública.");
      const host=site.hostname.toLowerCase();
      if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal")||/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))throw new Error("No se permiten direcciones de red privada.");
      const requested=site.href;
      const candidates=[];const seen=new Set();
      const add=(link,source)=>{try{const u=new URL(link,requested);if(u.protocol!=="https:"||u.hostname!==host||seen.has(u.href))return;seen.add(u.href);candidates.push({url:u.href,origen:source});}catch(_){}};
      let blocked=false,reason="",pageRead=false;
      try{
        const r=await Zotero.HTTP.request("GET",requested,{responseType:"text",timeout:12000});
        const ct=String(r.getResponseHeader?.("Content-Type")||"").toLowerCase();
        const body=String(r.responseText||r.response||"").slice(0,500000);
        if(/<\s*(rss|feed|rdf:RDF)\b/i.test(body.slice(0,2000))){add(requested,"Feed directo");}
        else if(/html/i.test(ct)||/<html/i.test(body.slice(0,1500))){
          pageRead=true;
          const doc=new DOMParser().parseFromString(body,"text/html");
          for(const el of [...doc.querySelectorAll('link[rel~="alternate"]')]){
            const type=el.getAttribute("type")||"";
            if(/(?:rss|atom|xml)/i.test(type))add(el.getAttribute("href"),"Enlace anunciado por el sitio");
          }
        }
      }catch(e){
        const status=Number(e.status||e.statusCode||e.response?.status||0);
        const msg=String(e.message||"");
        blocked=status===403||status===429||/\b(403|429)\b/.test(msg);
        reason=blocked?"El servidor rechazó la consulta automática (HTTP "+(status||(/429/.test(msg)?429:403))+"). No significa que el sitio carezca de RSS.":"No se pudo consultar la página: "+(status?"HTTP "+status:"error de conexión, acceso o tiempo de espera")+".";
      }
      // Direcciones habituales, solo dentro del mismo sitio: nunca intentamos saltar desafíos anti-bot.
      const base=site.origin;
      for(const path of ["/feed","/feed/","/rss","/rss.xml","/feed.xml","/atom.xml"]){add(base+path,"Ruta convencional sin verificar");}
      const found=[],tried=[];
      for(const candidate of candidates.slice(0,12)){
        try{
          const r=await Zotero.HTTP.request("GET",candidate.url,{responseType:"text",timeout:6000});
          const xml=String(r.responseText||r.response||"").slice(0,200000);
          const doc=new DOMParser().parseFromString(xml,"application/xml");
          const name=doc.documentElement?.localName;
          if(!doc.querySelector("parsererror")&&["rss","feed","RDF"].includes(name)){
            const title=doc.querySelector("channel > title, feed > title")?.textContent?.trim()||"Canal RSS/Atom";
            found.push({titulo:title.slice(0,200),url:candidate.url,origen:candidate.origen,xml_valido:true,entradas_xml:doc.querySelectorAll("item, entry").length,lectura_entradas_verificada:false});
          }else tried.push({url:candidate.url,estado:"No es RSS/Atom válido"});
        }catch(e){const code=Number(e.status||e.statusCode||e.response?.status||0);tried.push({url:candidate.url,estado:code?"HTTP "+code:"No accesible"});}
      }
      return {sitio:requested,acceso_pagina:blocked?"BLOQUEADO":pageRead?"OK":reason?"NO_DISPONIBLE":"OK",motivo:reason||undefined,canales:found,probados:tried.slice(0,12),advertencia:found.length?"Estos canales respondieron como RSS/Atom válido. Suscríbete mediante suscribir_canal_rss si el usuario lo pidió.":"No se verificó ningún canal en las rutas probadas. Esto no demuestra que no existan. No afirmes que el sitio carece de RSS ni que se hizo una búsqueda web exhaustiva."};
    }
  },

  verificar_metadatos: {
    description:"Contrasta registros de Zotero con los metadatos de Crossref por DOI, SIN modificar nada. Acepta IDs de ítems o la colección seleccionada; hasta 20 por llamada. Informa discrepancias, autores y fuente consultada.",
    parameters:{type:"object",properties:{item_ids:{type:"array",items:{type:"integer"}},coleccion_id:{type:"integer"},limite:{type:"integer",description:"Máximo 20 por petición"}}},
    async run({item_ids,coleccion_id,limite=10}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      let items=[];
      if(Array.isArray(item_ids)&&item_ids.length){items=item_ids.slice(0,20).map(id=>Zotero.Items.get(Number(id))).filter(it=>it&&it.isRegularItem());}
      else {const collection=ZoteroIA.auditCollectionItems(coleccion_id,Math.min(20,Math.max(1,limite)));items=collection.selected;}
      const results=[];
      for(const it of items){try{results.push(await ZoteroIA.metadataAudit.verify(it));}catch(e){results.push({item_id:it.id,estado:"ERROR_CONSULTA",error:String(e.message||e).slice(0,180)});}}
      return {revisados:results.length,resultados:results,advertencia:"La verificación no escribe en Zotero. Los datos de Crossref no constituyen garantía absoluta de exactitud."};
    }
  },
  corregir_metadatos: {
    escribe:true,
    description:"CORRIGE y SOBRESCRIBE metadatos bibliográficos existentes cotejándolos con Crossref por DOI, incluidos títulos, autores, fecha y datos editoriales. En coincidencias de título, reemplaza automáticamente los campos discordantes cuando el usuario lo solicita. Nunca cambia registros cuyo título no concuerda suficientemente con Crossref. Crea historial reversible. Máximo 20 registros.",
    parameters:{type:"object",properties:{item_ids:{type:"array",items:{type:"integer"},description:"Hasta 20 ítems de Zotero"},corregir_autores:{type:"boolean",description:"Reemplazar autores y editores de la fuente cuando sean fiables. Predeterminado false"}},required:["item_ids"]},
    resumen:a=>"Corregir metadatos en "+(a.item_ids||[]).length+" registros usando Crossref; autoría: "+(a.corregir_autores===true?"SÍ, reemplazar autores (requiere aprobación)":"NO modificar autores"),
    async run({item_ids,corregir_autores=false}, {signal,confirm}={}){
      const audit=ZoteroIA.metadataAudit;
      if(!Array.isArray(item_ids)||!item_ids.length||item_ids.length>20)throw new Error("Indica entre 1 y 20 IDs de referencias.");
      const reports=[],hist=audit.history();
      for(const id of item_ids){
        const it=Zotero.Items.get(Number(id));
        if(!it||!it.isRegularItem()){reports.push({item_id:id,estado:"ITEM_INVALIDO"});continue;}
        try {
          const v=await audit.verify(it);
          if(v.estado==="SIN_DOI_VERIFICABLE"){reports.push({item_id:id,estado:v.estado,advertencia:"No existe DOI verificable; no se inventaron datos."});continue;}
          if(v.estado==="IDENTIDAD_DUDOSA"){reports.push({item_id:id,estado:"IDENTIDAD_DUDOSA_REVISION_MANUAL",titulo_actual:v.titulo,doi:v.doi,fuente:v.fuente,advertencia:"Título incompatible con DOI. Verifica y corrige manualmente el DOI o el título antes de reintentar. Esta versión no sobrescribe identidades dudosas."});continue;}
          if(v.estado!=="DOI_Y_TITULO_COMPATIBLES"){reports.push({item_id:id,estado:v.estado});continue;}
          const record=await audit.getCrossref(v.doi);
          const changes=[];
          for(const c of audit.candidates(it,record)){
            if(c.campo==="DOI"||!c.propuesto||c.propuesto.length>1000||audit.norm(c.actual)===audit.norm(c.propuesto))continue;
            // Nunca sustituir una fecha más específica por otra de menor granularidad.
            if(c.campo==="date" && c.actual){
              
              if(ZoteroIA.datePrecision(c.actual)>ZoteroIA.datePrecision(c.propuesto))continue;
            }
            // Fecha exacta o edición preexistente se modifica solo cuando el valor de fuente es inequívoco.
            changes.push({campo:c.campo,anterior:c.actual,nuevo:c.propuesto});
          }
          // Autoría se sustituye con los autores del registro depositado, manteniendo otros creadores que no son autores.
          let creatorsChange=null;
          if(corregir_autores && Array.isArray(record.author) && record.author.length && record.author.length<=100){
            const remote=record.author.filter(a=>a&&a.family&&String(a.family).trim()).map(a=>({creatorType:"author",firstName:String(a.given||"").trim(),lastName:String(a.family||"").trim()}));
            if(remote.length===record.author.length){
              const existing=it.getCreatorsJSON()||[];
              const nonAuthors=existing.filter(c=>c.creatorType!=="author");
              // Nunca cambiar editores ni otros roles; preservar las autorías existentes solo si son del mismo tipo.
              const proposed=[...remote,...nonAuthors];
              const signature=c=>[c.creatorType||"",c.firstName||"",c.lastName||"",c.name||""].map(x=>audit.norm(x)).join("|");
              if(existing.map(signature).join(";")!==proposed.map(signature).join(";"))creatorsChange={anteriores:JSON.parse(JSON.stringify(existing)),nuevos:proposed};
            }
          }
          if(!changes.length&&!creatorsChange){reports.push({item_id:id,estado:"YA_COINCIDE",fuente:v.fuente});continue;}
          const oldCreators=creatorsChange?creatorsChange.anteriores:null;
          ZoteroIA.checkAbort(signal);
          if(typeof confirm!=="function")throw new Error("La corrección requiere aprobación de los valores antes/después");
          const before=ZoteroIA.creatorSignature(it.getCreatorsJSON());
          const preview=changes.map(c=>c.campo+": "+JSON.stringify(c.anterior)+" → "+JSON.stringify(c.nuevo));
          const creatorText=cs=>cs.map(c=>(c.creatorType==="author"?"Autor":c.creatorType==="editor"?"Editor":c.creatorType)+": "+(c.name||[c.firstName,c.lastName].filter(Boolean).join(" "))).join("; ");
          if(creatorsChange)preview.push("Creadores: "+creatorText(oldCreators)+" → "+creatorText(creatorsChange.nuevos));
          const approved=await confirm("Corregir el ítem "+it.id+"\n"+preview.join("\n"));
          ZoteroIA.checkAbort(signal);
          if(approved!==true){reports.push({item_id:id,estado:"RECHAZADO"});continue;}
          if(changes.some(c=>audit.field(it,c.campo)!==c.anterior)||before!==ZoteroIA.creatorSignature(it.getCreatorsJSON()))throw new Error("El registro cambió después de preparar la propuesta; vuelve a revisarlo");
          try {
            await Zotero.DB.executeTransaction(async()=>{
            for(const c of changes)it.setField(c.campo,c.nuevo);
            if(creatorsChange)it.setCreators(creatorsChange.nuevos);
            ZoteroIA.checkAbort(signal);await it.save();
            const saved=Zotero.Items.get(it.id);
            if(changes.some(c=>audit.field(saved,c.campo)!==c.nuevo))throw new Error("Los campos guardados no coinciden con los cambios solicitados.");
          if(creatorsChange && ZoteroIA.creatorSignature(saved.getCreatorsJSON())!==ZoteroIA.creatorSignature(creatorsChange.nuevos)) throw new Error("La autoría no coincide con la propuesta después del guardado. Revisar manualmente.");
            });
          } catch(e){
            // Descartar cambios en memoria antes de salir si el guardado falla.
            try{for(const c of changes)it.setField(c.campo,c.anterior);if(oldCreators)it.setCreators(oldCreators);}catch(_){}
            throw e;
          }
          const entry={id:Date.now()+"-"+it.id,item_id:it.id,item_key:it.key,library_id:it.libraryID,fecha:new Date().toISOString(),doi:v.doi,fuente:v.fuente,cambios:changes};
          if(creatorsChange)entry.creadores=creatorsChange;
          hist.push(entry);
          reports.push({item_id:id,estado:"CORREGIDO",fuente:v.fuente,cambios:changes,autores_modificados:!!creatorsChange,autores_anteriores:oldCreators||undefined,autores_nuevos:creatorsChange?.nuevos});
        }catch(e){reports.push({item_id:id,estado:"ERROR",error:String(e.message||e).slice(0,220)});}
      }
      audit.saveHistory(hist);
      return {resultados:reports,total_corregidos:reports.filter(r=>r.estado==="CORREGIDO").length,advertencia:"Los cambios se guardaron con historial para revertir_metadatos. Crossref es una fuente bibliográfica externa, pero puede contener datos erróneos. No se cambiaron registros sin DOI ni títulos incompatibles. Estos últimos requieren revisión manual."};
    }
  },
  revertir_metadatos: {
    escribe:true,
    description:"Revierte los últimos cambios de metadatos (también autores) realizados por Zotero IA, solo si siguen coincidiendo exactamente con lo que escribió la IA.",
    parameters:{type:"object",properties:{item_id:{type:"integer"}},required:["item_id"]},
    resumen:a=>"Revertir la última corrección bibliográfica del ítem "+a.item_id,
    async run({item_id}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const audit=ZoteroIA.metadataAudit,h=audit.history(),idx=h.map(x=>x.item_id).lastIndexOf(Number(item_id));
      if(idx<0)return {estado:"SIN_HISTORIAL"};
      const entry=h[idx],it=Zotero.Items.get(Number(item_id));
      if(!it||it.key!==entry.item_key||it.libraryID!==entry.library_id)throw new Error("La identidad del ítem cambió; no se revierte.");
      const reverted=[],skipped=[];
      for(const c of entry.cambios){if(audit.field(it,c.campo)!==c.nuevo){skipped.push(c.campo);continue;}it.setField(c.campo,c.anterior);reverted.push(c.campo);}
      let creatorsReverted=false;
      if(entry.creadores){
        const same=ZoteroIA.creatorSignature(it.getCreatorsJSON()||[])===ZoteroIA.creatorSignature(entry.creadores.nuevos);
        if(same){it.setCreators(entry.creadores.anteriores);creatorsReverted=true;}else skipped.push("creadores");
      }
      if(reverted.length||creatorsReverted){
        ZoteroIA.checkAbort(signal);await it.saveTx();
        const saved=Zotero.Items.get(Number(item_id));
        if(reverted.some(f=>audit.field(saved,f)!==entry.cambios.find(c=>c.campo===f).anterior))throw new Error("La reversión no se verificó; revisa el registro.");
        if(creatorsReverted && ZoteroIA.creatorSignature(saved.getCreatorsJSON())!==ZoteroIA.creatorSignature(entry.creadores.anteriores)) throw new Error("La reversión de autores no coincidió exactamente; revisa el registro.");
      }
      if(!skipped.length){h.splice(idx,1);}else {entry.cambios=entry.cambios.filter(c=>skipped.includes(c.campo));if(creatorsReverted)delete entry.creadores;}
      audit.saveHistory(h);
      return {estado:"REVISION_COMPLETADA",campos_revertidos:reverted,autores_revertidos:creatorsReverted,campos_no_revertidos:skipped};
    }
  },
  auditar_coleccion: {
    description: "Audita una colección SIN modificarla. Detecta metadatos mínimos incompletos, ítems sin PDF y PDF independientes (sin referencia padre). Devuelve informe y IDs para acciones posteriores.",
    parameters:{type:"object",properties:{coleccion_id:{type:"integer"},limite:{type:"integer",description:"Máximo 1000, por defecto 250"}}},
    async run({coleccion_id,limite=250}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const {col,all,selected}=ZoteroIA.auditCollectionItems(coleccion_id,limite);
      const records=selected.map(it=>ZoteroIA.auditItem(it));
      const attachments=(col.getChildItems()||[]).filter(it=>it.isAttachment&&it.isAttachment());
      const loose=attachments.filter(it=>!it.parentID && (it.attachmentContentType==="application/pdf" || /\.pdf$/i.test(it.getField("title")||""))).map(a=>({id:a.id,nombre:a.getField("title")||"PDF independiente"}));
      const incomplete=records.filter(r=>r.campos_faltantes.length);
      const missingPDF=records.filter(r=>!r.pdf_adjunto);
      return {coleccion:{id:col.id,nombre:col.name},total:all.length,analizados:records.length,restantes:all.length-records.length,
       referencias_bibliograficas:all.length,adjuntos_en_coleccion:attachments.length,metadatos_incompletos:incomplete.length,sin_pdf:missingPDF.length,pdf_independientes:loose.length,
       items_incompletos:incomplete.slice(0,100),items_sin_pdf:missingPDF.map(r=>({id:r.id,titulo:r.titulo})).slice(0,100),pdf_sin_referencia:loose.slice(0,100),
       advertencia:"Los PDF independientes no son referencias bibliográficas completas. La auditoría distingue referencias y adjuntos. La ausencia de DOI no implica error. No se modificó la biblioteca."};
    }
  },
  examinar_pdf_independiente: {
    description:"Lee texto REAL indexado de un PDF independiente de Zotero para proponer sus metadatos. Devuelve el comienzo del documento; si no hay texto indexado intenta reindexar. La falta de texto recuperado no permite concluir que requiere OCR. Solo lectura. Para procesar lotes identifica primero los IDs mediante auditar_coleccion.",
    parameters:{type:"object",properties:{pdf_id:{type:"integer"}},required:["pdf_id"]},
    async run({pdf_id}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const it=await Zotero.Items.getAsync(Number(pdf_id));
      if(!it||!it.isAttachment()||it.parentID||it.attachmentContentType!=="application/pdf")throw new Error("El ID indicado no es un PDF independiente.");
      let extracted="", error=null, reindexado=false;
      try{extracted=String(await it.attachmentText||"");}catch(e){error=String(e.message||e);}
      // Una cadena vacía NO demuestra que el PDF sea escaneado. Zotero puede no haberlo indexado.
      if(extracted.trim().length<100 && Zotero.Fulltext && typeof Zotero.Fulltext.indexItems==="function") {
        try {await Zotero.Fulltext.indexItems([it.id]);reindexado=true;extracted=String(await it.attachmentText||"");error=null;}
        catch(e){error=String(e.message||e);}
      }
      const text=extracted.replace(/\u0000/g,"").trim();
      const available=text.length>=100;
      return {pdf_id:it.id,nombre:it.getField("title")||"",texto_disponible:available,caracteres:text.length,fragmento:text.slice(0,15000),reindexado,estado:available?"TEXTO_RECUPERADO":"EXTRACCION_NO_DISPONIBLE",error,
        advertencia:available?"Texto obtenido del índice del PDF. Verificar título, autor, fecha y páginas en el documento.":"No se ha recuperado texto desde Zotero. Esto NO demuestra que el PDF necesite OCR: puede ser un problema de indexación, acceso al archivo o extracción. No clasificarlo como escaneado ni inferir metadatos."};
    }
  },
  crear_referencia_desde_pdf: {
    description:"Crea una referencia padre para un PDF INDEPENDIENTE ya examinado. Requiere título documental comprobado, tipo, y evidencia literal breve del PDF que sustente el título. Autor y fecha son opcionales: no inventar. Mantiene el PDF original como adjunto de la nueva referencia. Solicita aprobación al usuario.",
    parameters:{type:"object",properties:{pdf_id:{type:"integer"},tipo:{type:"string",enum:["book","journalArticle","bookSection","thesis","report","document"]},titulo:{type:"string"},evidencia_titulo:{type:"string"},autores:{type:"array",items:{type:"string"}},anio:{type:"string"},editorial:{type:"string"}},required:["pdf_id","tipo","titulo","evidencia_titulo"]},
    escribe:true,
    resumen:a=>`Crear referencia «${a.titulo}» para PDF ${a.pdf_id} (${a.tipo}). Autor y año únicamente si están verificados`,
    async run({pdf_id,tipo,titulo,evidencia_titulo,autores=[],anio="",editorial=""}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const pdf=await Zotero.Items.getAsync(Number(pdf_id));
      if(!pdf||!pdf.isAttachment()||pdf.parentID||pdf.attachmentContentType!=="application/pdf")throw new Error("PDF no independiente; no se modificó nada.");
      const content=String(await pdf.attachmentText||"");
      if(content.trim().length<100)throw new Error("Zotero no devolvió texto suficiente para verificar los datos. No se creó referencia. Comprueba la indexación; no significa que haga falta OCR.");
      const norm=x=>String(x).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
      const evidence=norm(evidencia_titulo);
      if(evidence.length<12||!norm(content.slice(0,24000)).includes(evidence))throw new Error("La evidencia textual no coincide con el PDF. Revisa el documento antes de crear el registro.");
      const cleanTitle=String(titulo||"").trim();if(cleanTitle.length<5)throw new Error("Título insuficiente.");
      const validTypes=new Set(["book","journalArticle","bookSection","thesis","report","document"]);
      if(!validTypes.has(tipo))throw new Error("Tipo bibliográfico no admitido.");
      const parent=new Zotero.Item(tipo);parent.libraryID=pdf.libraryID;
      parent.setField("title",cleanTitle);
      const creatorType=tipo==="book"?"author":"author";
      const names=(Array.isArray(autores)?autores:[]).filter(a=>typeof a==="string"&&a.trim()).slice(0,15).map(name=>({creatorType,fieldMode:1,lastName:name.trim()}));
      if(names.length)parent.setCreators(names);
      if(/^\d{4}$/.test(String(anio)))parent.setField("date",String(anio));
      if(editorial && ["book","bookSection","report"].includes(tipo))parent.setField("publisher",String(editorial).slice(0,300));
      for(const cid of pdf.getCollections())parent.addToCollection(cid);
      ZoteroIA.checkAbort(signal);await parent.saveTx();
      try{pdf.parentID=parent.id;ZoteroIA.checkAbort(signal);await pdf.saveTx();}
      catch(e){try{ZoteroIA.checkAbort(signal);await parent.eraseTx();}catch(_){} throw new Error("No se pudo vincular el PDF. Se intentó revertir el nuevo elemento: "+e.message);}
      return {ok:true,padre_id:parent.id,pdf_id:pdf.id,titulo:cleanTitle,estado:"CREADO_Y_VINCULADO",advertencia:"Registro creado desde texto extraído; revisa los metadatos, especialmente autores, tipo y fecha."};
    }
  },
  reconocer_pdf_coleccion: {
    description:"Reconoce mediante Zotero los PDF INDEPENDIENTES de una colección seleccionada o indicada. Procesa hasta 10 por llamada, no archivos PDF ya asociados a una referencia. Ejecuta reconocimiento nativo, informa cuántos adquirieron referencia padre y cuáles siguen pendientes. Si no hay colección seleccionada, solicita escogerla.",
    parameters:{type:"object",properties:{coleccion_id:{type:"integer"},limite:{type:"integer",description:"Máximo 10 PDF por lote"}}},
    escribe:true,
    resumen:a=>"Intentar reconocer PDF independientes de la colección "+(a.coleccion_id||"seleccionada")+" (máximo 10)",
    async run({coleccion_id,limite=10}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const {col}=ZoteroIA.auditCollectionItems(coleccion_id,1);
      const pdfs=col.getChildItems().filter(it=>it.isAttachment&&it.isAttachment()&&!it.parentID&&(it.attachmentContentType==="application/pdf"||/\.pdf$/i.test(it.getField("title")||"")));
      const batch=pdfs.slice(0,Math.max(1,Math.min(10,Number(limite)||10)));
      if(!batch.length)return {coleccion:col.name,procesados:0,identificados:0,pendientes:0,mensaje:"No hay archivos PDF independientes en esta colección."};
      const engine=Zotero.RecognizeDocument||Zotero.RecognizePDF;
      if(!engine||typeof engine.recognizeItems!=="function")throw new Error("Esta instalación no expone recognizeItems. Los PDF siguen intactos; usa Reconocer metadatos de PDF en Zotero.");
      const errores=[];
      try{await engine.recognizeItems(batch);}catch(e){errores.push(String(e&&e.message||e));}
      // Se comprueba el estado de cada adjunto, no se infiere éxito de la llamada.
      const identificados=[],pendientes=[];
      for(const it of batch){const current=await Zotero.Items.getAsync(it.id);if(current&&current.parentID)identificados.push({pdf_id:it.id,padre_id:current.parentID});else pendientes.push({pdf_id:it.id,nombre:it.getField('title')});}
      return {coleccion:col.name,procesados:batch.length,identificados:identificados.length,pendientes:pendientes.length,items_identificados:identificados,items_pendientes:pendientes,errores,advertencia:"El reconocimiento puede continuar en Zotero después del retorno de la función. Comprueba de nuevo si el proceso sigue activo. No se crean referencias inventadas."};
    }
  },
  recuperar_metadatos_pdf: {
    description: "Solicita al motor NATIVO de Zotero reconocer metadatos de PDF independientes (sin referencia padre), identificados por ID. No reconstruye metadatos de registros ya existentes ni inventa referencias. Puede crear una referencia padre.",
    parameters:{type:"object",properties:{pdf_ids:{type:"array",items:{type:"integer"},description:"IDs de PDFs independientes, máximo 10"}},required:["pdf_ids"]},
    escribe:true,
    resumen:a=>"Reconocer metadatos mediante Zotero para "+(a.pdf_ids||[]).length+" PDF independientes (puede crear referencias)",
    async run({pdf_ids}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      if(!Array.isArray(pdf_ids)||!pdf_ids.length||pdf_ids.length>10)throw new Error("Indica entre 1 y 10 IDs de PDF independientes.");
      const list=[];
      for(const id of pdf_ids){const item=Zotero.Items.get(Number(id));
        if(!item||!item.isAttachment()||item.parentID||item.attachmentContentType!=="application/pdf")throw new Error("ID "+id+": no es PDF independiente reconocible.");
        list.push(item);
      }
      const engine=Zotero.RecognizeDocument||Zotero.RecognizePDF;
      if(!engine||typeof engine.recognizeItems!=="function")throw new Error("Esta versión de Zotero no expone RecognizeDocument.recognizeItems; no se modificó nada.");
      await engine.recognizeItems(list);
      return {solicitados:list.map(i=>i.id),resultado:"Se invocó el reconocimiento nativo de Zotero. Revisa las nuevas referencias; Zotero puede dejar PDF sin reconocer.",advertencia:"El reconocimiento puede usar servicios de Zotero y no garantiza datos completos."};
    }
  },
  buscar_pdf_disponible: {
    description:"Busca y adjunta PDF mediante Zotero, comprueba que existan localmente y ofrece la página de la referencia si no se consiguen. Si se solicita una sola referencia, abre esa página al fallar. Zotero Connector requiere pulsar su botón en el navegador; no lo acciona el plugin.",
    parameters:{type:"object",properties:{item_ids:{type:"array",items:{type:"integer"},description:"IDs de referencias sin PDF, máximo 10"}},required:["item_ids"]},
    escribe:true,
    resumen:a=>"Buscar PDF disponibles para "+(a.item_ids||[]).length+" referencias mediante Zotero",
    async run({item_ids}, {signal}={}) {
      return ZoteroIA.pdfs.find(item_ids,{signal});
    }
  },
  buscar_biblioteca: {
    description: "Busca ítems en la biblioteca del usuario por palabras (título, autor, año, etiquetas, notas y texto completo de PDFs). Devuelve id, título, autores, año.",
    parameters: { type: "object", properties: { consulta: { type: "string" }, limite: { type: "integer", description: "máx. resultados, por defecto 25" } }, required: ["consulta"] },
    async run({ consulta, limite = 25 }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const s = new Zotero.Search();
      s.libraryID = Zotero.Libraries.userLibraryID;
      s.addCondition("quicksearch-everything", "contains", consulta);
      s.addCondition("itemType", "isNot", "attachment");
      s.addCondition("itemType", "isNot", "note");
      const ids = await s.search();
      const items = await Zotero.Items.getAsync(ids.slice(0, limite));
      return { total: ids.length, resultados: items.map(i => ZoteroIA.summarize(i)) };
    },
  },
  listar_colecciones: {
    description: "Lista todas las colecciones (carpetas) de la biblioteca con su id y número de ítems.",
    parameters: { type: "object", properties: {} },
    async run(_args={}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const libs = [Zotero.Libraries.userLibraryID].concat(Zotero.Groups.getAll().map(g => g.libraryID));
      const out = [];
      for (const lib of libs) {
        for (const c of Zotero.Collections.getByLibrary(lib, true)) {
          out.push({ id: c.id, nombre: c.name, padre: c.parentID || null, biblioteca: Zotero.Libraries.getName(lib), items: c.getChildItems(true).length });
        }
      }
      return out;
    },
  },
  items_de_coleccion: {
    description: "Devuelve los ítems de una colección (por id).",
    parameters: { type: "object", properties: { coleccion_id: { type: "integer" } }, required: ["coleccion_id"] },
    async run({ coleccion_id }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const c = Zotero.Collections.get(coleccion_id);
      if (!c) throw new Error("No existe la colección " + coleccion_id);
      return c.getChildItems().filter(i => i.isRegularItem()).map(i => ZoteroIA.summarize(i));
    },
  },
  mapa_conocimiento: {
    description: "Construye un mapa de conocimiento INTERACTIVO de una colección con publicaciones, autores y conceptos respaldados por etiquetas. Solo relaciona datos explícitos: autoría, pertenencia a colección y etiquetas. No inventa citas, acuerdos ni contradicciones; explica que requieren lectura y verificación de textos. Si no se proporciona coleccion_id usa la colección seleccionada.",
    parameters: { type: "object", properties: { coleccion_id: {type:"integer"}, limite: {type:"integer", description:"Máximo 150 publicaciones; por defecto 80"} } },
    async run({ coleccion_id, limite = 80 }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      if (!coleccion_id) {
        const pane = Zotero.getActiveZoteroPane();
        let selected = [];
        try { selected = pane.getSelectedCollections() || []; } catch (_) {}
        if (!selected.length) throw new Error("Selecciona una colección en Zotero o indica su ID.");
        coleccion_id = selected[0].id;
      }
      const col = Zotero.Collections.get(Number(coleccion_id));
      if (!col) throw new Error("Colección inexistente: " + coleccion_id);
      const all = col.getChildItems().filter(it => it.isRegularItem());
      const items = all.slice(0, Math.max(1, Math.min(150, Number(limite) || 80)));
      const nodes = [], edges = [], existing = new Set(), edgeKeys = new Set();
      const node = (id, type, label, extra = {}) => {
        if (!existing.has(id)) { existing.add(id); nodes.push(Object.assign({id,type,label},extra)); }
      };
      const edge = (from,to,type,source) => {
        const key = [from,to,type].join("|");
        if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({from,to,type,source}); }
      };
      for (const item of items) {
        const pid = "p:"+item.id;
        const summary = ZoteroIA.summarize(item);
        node(pid,"publication",summary.titulo || "Sin título",{item_id:item.id,year:summary.año,kind:summary.tipo});
        const creators = item.getCreatorsJSON() || [];
        for (const cr of creators.filter(c=>c.creatorType==="author").slice(0,12)) {
          const name = ([cr.firstName,cr.lastName].filter(Boolean).join(" ") || cr.name || "").trim();
          if (!name) continue;
          const aid = "a:"+name.toLocaleLowerCase().normalize("NFKC");
          node(aid,"author",name);
          edge(aid,pid,"autoría",pid);
        }
        for (const tag of (item.getTags() || []).slice(0,15)) {
          const value=String(tag.tag||"").trim();
          if (!value) continue;
          const tid="c:"+value.toLocaleLowerCase().normalize("NFKC");
          node(tid,"concept",value);
          edge(pid,tid,"etiqueta",pid);
        }
      }
      return { tipo:"mapa_conocimiento", coleccion:{id:col.id,nombre:col.name}, total_items:all.length, incluidos:items.length, truncado:items.length<all.length, nodes, edges,
        limites:["Autores proceden de metadatos; conceptos proceden exclusivamente de etiquetas.","No se han inferido debates, contradicciones, metodologías ni citas entre autores.","Una etiqueta compartida no prueba acuerdo conceptual."] };
    }
  },
  seleccion_actual: {
    description: "Devuelve los ítems que el usuario tiene seleccionados ahora en Zotero y la colección abierta.",
    parameters: { type: "object", properties: {} },
    async run(_args={}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const zp = Zotero.getActiveZoteroPane();
      // Zotero 10: los getters singulares lanzan error; se usan los plurales
      let col = null;
      try {
        if (typeof zp.getSelectedCollections === "function") col = (zp.getSelectedCollections() || [])[0] || null;
        else col = zp.getSelectedCollection();
      } catch (e) {
        try { const row = zp.collectionsView && zp.collectionsView.selectedTreeRow; col = row && row.isCollection() ? row.ref : null; } catch (e2) {}
      }
      return { coleccion: col ? { id: col.id, nombre: col.name } : null, items: zp.getSelectedItems().filter(i => i.isRegularItem()).map(i => ZoteroIA.summarize(i)) };
    },
  },
  leer_item: {
    description: "Lee un ítem: metadatos completos, notas y el texto completo del PDF/adjunto. Usa 'desde' para leer partes siguientes de textos largos.",
    parameters: { type: "object", properties: { item_id: { type: "integer" }, para_que: { type: "string", description: "Qué necesitas sacar de este documento (p. ej. 'tesis, método y fuentes'). Si lo das, analiza por partes el texto recuperado, con avance reanudable y evidencia. Puede pausarse por los límites; no equivale a verificar cada contenido del PDF." }, desde: { type: "integer", description: "carácter inicial, por defecto 0 (solo sin para_que)" }, max_caracteres: { type: "integer", description: "por defecto 40000 (solo sin para_que)" } }, required: ["item_id"] },
    async run({ item_id, para_que, desde = 0, max_caracteres = 40000 }, {signal,confirm,meterId}={}) { ZoteroIA.checkAbort(signal);
      if (para_que) {
        const it = await Zotero.Items.getAsync(item_id);
        if (!it) throw new Error("No existe el ítem " + item_id);
        const r = await ZoteroIA.ask(it, "Extrae del documento, de forma concisa y con páginas cuando sea posible: " + para_que,null,{mode:"full",signal,meterId});
        return { item: ZoteroIA.summarize(r.ctx.parent), evidencias:r.ctx.evidence||[], cobertura:r.ctx.coverage||null, leido_completo: false, texto_recuperado_completo:!!r.ctx.coverage?.allRecoveredTextProcessed, texto_indexado_procesado: !!r.ctx.text, paginas_verificadas:false, alcance:"Se procesó el texto recuperado; no se verificó la cobertura de todas las páginas", partes: r.ctx.parts || 1, sin_texto_completo: !r.ctx.text, notas: r.answer };
      }
      const item = await Zotero.Items.getAsync(item_id);
      if (!item) throw new Error("No existe el ítem " + item_id);
      const meta = {};
      for (const f of ["title", "date", "publicationTitle", "bookTitle", "publisher", "place", "pages", "DOI", "ISBN", "url", "abstractNote", "archive", "archiveLocation"]) {
        try { const v = item.getField(f); if (v) meta[f] = v; } catch (e) {}
      }
      meta.editores = item.getCreatorsJSON().filter(c=>c.creatorType==="editor");
      meta.autores = item.getCreatorsJSON().filter(c=>c.creatorType==="author").map(c => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name);
      const notas = item.isRegularItem() ? (await Zotero.Items.getAsync(item.getNotes())).map(n => Zotero.Utilities.unescapeHTML(n.getNote()).slice(0, 3000)) : [];
      let texto = "", largo = 0;
      const att = item.isAttachment() ? item : await item.getBestAttachment();
      if (att) { try { const t = (await att.attachmentText) || ""; largo = t.length; texto = t.slice(desde, desde + max_caracteres); } catch (e) {} }
      return { meta, notas, texto_largo_total: largo, desde, hay_mas: desde + max_caracteres < largo, siguiente_desde: desde + max_caracteres < largo ? desde + max_caracteres : null, paginas_verificadas:false, texto: texto || "(extracción no disponible; no se determinó la causa)" };
    },
  },
  analizar_coleccion_lote: {
    description:"Analiza por partes el texto recuperado de hasta cinco documentos pendientes de una colección. Guarda el avance y evidencia; puede pausarse por los límites de consumo. No certifica que se haya recuperado cada contenido del PDF.",
    parameters:{type:"object",properties:{coleccion_id:{type:"integer"},objetivo:{type:"string"},limite:{type:"integer",minimum:1,maximum:5}},required:["coleccion_id","objetivo"]},
    async run({coleccion_id,objetivo,limite=3},opts={}){
      const Z=ZoteroIA,R=Z.research,project=Z.projects?.match([coleccion_id]),columns=Z.matrixColumns.normalize(project?.columns);
      let run=[...R.runs].reverse().find(r=>r.objective===objetivo&&r.collections.length===1&&r.collections[0].id===coleccion_id&&R.stable(Z.matrixColumns.forRun(r))===R.stable(columns)&&(!project||r.projectId===project.id));
      if(!run)run=await R.createRun([coleccion_id],objetivo);const limit=Math.max(1,Math.min(5,limite));
      const result=await R.process(run.id,{...opts,maxItems:limit});return {tarea_id:result.id,columnas:Z.matrixColumns.forRun(result),total:result.items.length,procesados:result.rows.length,proximo_desde:result.rows.length,terminado:result.status==="completed",fichas:result.rows.slice(-limit),estado:result.status};
    }
  },
  ver_avance_coleccion: {
    description:"Consulta el avance guardado de una colección sin volver a solicitar análisis.",
    parameters:{type:"object",properties:{coleccion_id:{type:"integer"}},required:["coleccion_id"]},
    async run({coleccion_id}){const run=[...ZoteroIA.research.runs].reverse().find(r=>r.collections.some(c=>c.id===coleccion_id));return run?{tarea_id:run.id,estado:run.status,total:run.items.length,proximo_desde:run.rows.length,fichas_guardadas:run.rows.length}:{mensaje:"Sin tarea persistente guardada"};}
  },
  crear_nota: {
    escribe: true,
    description: "Crea una nota en Zotero con contenido en Markdown (admite títulos, listas y tablas). Si se da item_id es nota hija de ese ítem; si se da coleccion_id queda como nota suelta en esa colección.",
    parameters: { type: "object", properties: { titulo: { type: "string" }, markdown: { type: "string" }, item_id: { type: "integer" }, coleccion_id: { type: "integer" } }, required: ["titulo", "markdown"] },
    resumen: a => `Crear nota «${a.titulo}»` + (a.item_id ? ` en el ítem ${a.item_id}` : a.coleccion_id ? ` en la colección ${a.coleccion_id}` : ""),
    async run({ titulo, markdown, item_id, coleccion_id }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const note = new Zotero.Item("note");
      let lib = Zotero.Libraries.userLibraryID;
      if (item_id) { const p = await Zotero.Items.getAsync(item_id); lib = p.libraryID; note.parentID = p.id; }
      else if (coleccion_id) { lib = Zotero.Collections.get(coleccion_id).libraryID; }
      note.libraryID = lib;
      note.setNote("<h1>" + titulo.replace(/</g, "&lt;") + "</h1>" + ZoteroIA.md2html(markdown) + "<p><i>Generado por Zotero IA</i></p>");
      if (coleccion_id && !item_id) note.addToCollection(coleccion_id);
      ZoteroIA.checkAbort(signal);await note.saveTx();
      return { ok: true, nota_id: note.id };
    },
  },
  agregar_etiquetas: {
    escribe: true,
    description: "Agrega etiquetas a uno o varios ítems.",
    parameters: { type: "object", properties: { item_ids: { type: "array", items: { type: "integer" } }, etiquetas: { type: "array", items: { type: "string" } } }, required: ["item_ids", "etiquetas"] },
    resumen: a => `Etiquetar ${a.item_ids.length} ítem(s) con: ${a.etiquetas.join(", ")}`,
    async run({ item_ids, etiquetas }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      await Zotero.DB.executeTransaction(async () => {
        for (const it of await Zotero.Items.getAsync(item_ids)) { for (const t of etiquetas) it.addTag(t); ZoteroIA.checkAbort(signal);await it.save(); }
      });
      return { ok: true };
    },
  },
  crear_coleccion: {
    escribe: true,
    description: "Crea una colección nueva (opcionalmente dentro de otra).",
    parameters: { type: "object", properties: { nombre: { type: "string" }, padre_id: { type: "integer" } }, required: ["nombre"] },
    resumen: a => `Crear colección «${a.nombre}»`,
    async run({ nombre, padre_id }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const c = new Zotero.Collection();
      c.libraryID = padre_id ? Zotero.Collections.get(padre_id).libraryID : Zotero.Libraries.userLibraryID;
      c.name = nombre;
      if (padre_id) c.parentID = padre_id;
      ZoteroIA.checkAbort(signal);await c.saveTx();
      return { ok: true, coleccion_id: c.id };
    },
  },
  renombrar_coleccion: {
    escribe: true,
    description: "Renombra una colección existente, sin alterar sus documentos ni subcolecciones. Usa listar_colecciones para localizar la colección por su nombre.",
    parameters: { type: "object", properties: { coleccion_id: { type: "integer" }, nuevo_nombre: { type: "string" } }, required: ["coleccion_id", "nuevo_nombre"] },
    resumen: a => `Renombrar colección ${a.coleccion_id} como «${a.nuevo_nombre}»`,
    async run({ coleccion_id, nuevo_nombre }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      if (!Number.isSafeInteger(coleccion_id) || coleccion_id < 1) throw new Error("ID de colección inválido");
      const c = Zotero.Collections.get(coleccion_id);
      if (!c || c.deleted) throw new Error("Colección inexistente");
      if (!Zotero.Libraries.isEditable(c.libraryID)) throw new Error("Biblioteca de solo lectura");
      const name = String(nuevo_nombre || "").trim();
      if (!name || name.length > 255) throw new Error("Nombre vacío o demasiado largo");
      const anterior = c.name;
      c.name = name;
      ZoteroIA.checkAbort(signal);await c.saveTx();
      return { ok: true, coleccion_id: c.id, nombre_anterior: anterior, nuevo_nombre: name };
    },
  },
  eliminar_coleccion: {
    escribe: true,
    description: "Envía SOLO la colección y sus subcolecciones a la papelera, NUNCA los ítems bibliográficos. Requiere aprobación única. Antes localiza el ID con listar_colecciones. No la ejecutes si el nombre es ambiguo.",
    parameters: { type: "object", properties: { coleccion_id: { type: "integer" } }, required: ["coleccion_id"] },
    resumen: a => {
      const c = Zotero.Collections.get(a.coleccion_id);
      return c ? `Enviar a la papelera la colección «${c.name}» (ID ${c.id}) y sus subcolecciones; se conservan los documentos en la biblioteca` : `Enviar a la papelera la colección ${a.coleccion_id}`;
    },
    async run({ coleccion_id }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      if (!Number.isSafeInteger(coleccion_id) || coleccion_id < 1) throw new Error("ID de colección inválido");
      const c = Zotero.Collections.get(coleccion_id);
      if (!c || c.deleted) throw new Error("La colección ya no existe");
      if (!Zotero.Libraries.isEditable(c.libraryID)) throw new Error("Biblioteca de solo lectura");
      const original = { id: c.id, nombre: c.name, biblioteca: c.libraryID };
      if(typeof c.trash!=="function"||Zotero.Libraries.hasTrash?.(c.libraryID)===false)throw Error("Esta biblioteca o versión de Zotero no ofrece una papelera de colecciones compatible. Usa la interfaz de Zotero; el plugin no realizará un borrado definitivo.");
      ZoteroIA.checkAbort(signal);c.deleted=true;
      try{await c.saveTx();}catch(e){try{await c.reload(null,true);}catch(_){}throw e;}
      if(!Zotero.Collections.get(c.id)?.deleted)throw Error("No se pudo comprobar el envío de la colección a la papelera.");
      return { ok: true, estado:"EN_PAPELERA", coleccion_eliminada: original, referencias_conservadas: true, aviso: "La colección y sus subcolecciones están en la papelera de Zotero. Las referencias permanecen en la biblioteca; puedes restaurar las colecciones desde Zotero." };
    },
  },
  agregar_a_coleccion: {
    escribe: true,
    description: "Agrega ítems existentes a una colección (no los mueve ni borra).",
    parameters: { type: "object", properties: { item_ids: { type: "array", items: { type: "integer" } }, coleccion_id: { type: "integer" } }, required: ["item_ids", "coleccion_id"] },
    resumen: a => `Agregar ${a.item_ids.length} ítem(s) a la colección ${a.coleccion_id}`,
    async run({ item_ids, coleccion_id }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      await Zotero.DB.executeTransaction(async () => {
        for (const it of await Zotero.Items.getAsync(item_ids)) { it.addToCollection(coleccion_id); ZoteroIA.checkAbort(signal);await it.save(); }
      });
      return { ok: true };
    },
  },
  buscar_google: {
    description: "Busca información pública en Google Search mediante Grounding oficial de Gemini. Usa esta herramienta preferentemente para páginas, tesis, libros y repositorios. Devuelve enlaces respaldados por Google y consumo reportado por Gemini. No uses Google para textos privados.",
    parameters: {type:"object",properties:{consulta:{type:"string"}},required:["consulta"]},
    async run({consulta}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const query=String(consulta||"").trim();
      if(!query)throw new Error("La consulta está vacía");
      if(ZoteroIA.pref("provider")!=="gemini") return {disponible:false,motivo:"Google Search requiere seleccionar Gemini como proveedor; usa buscar_web como alternativa."};
      if(ZoteroIA.modelPolicy?.restricted()) return {disponible:false,motivo:"Google Search Grounding está desactivado en el modo con nivel gratuito porque puede requerir facturación. Usa buscar_web o la búsqueda de bibliografía en OpenAlex."};
      const key=String(ZoteroIA.pref("apiKey")||"").trim();
      if(!key) return {disponible:false,motivo:"No hay clave Gemini configurada"};
      const model=String(ZoteroIA.pref("model")||"gemini-3.6-flash").trim();
      // Use the official native Gemini API, not its OpenAI-compatible endpoint.
      const endpoint="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent";
      let response;
      try {
        response=await Zotero.HTTP.request("POST",endpoint,{
          headers:{"Content-Type":"application/json","x-goog-api-key":key},
          body:JSON.stringify({generationConfig:{maxOutputTokens:ZoteroIA.research?.settings().output||1800},contents:[{role:"user",parts:[{text:"Busca en Google esta consulta. Prioriza fuentes institucionales, académicas y repositorios primarios. Identifica enlaces verificables y no inventes resultados: "+query}]}],tools:[{google_search:{}}]}),
          responseType:"json",timeout:35000,successCodes:false
        });
      }catch(e){return {disponible:false,motivo:"Fallo de conexión con Gemini Grounding: "+String(e.message||e).slice(0,200)};}
      const payload=response.response||{};
      if(response.status<200||response.status>=300){
        const msg=(payload.error&&payload.error.message)||"Error HTTP "+response.status;
        return {disponible:false,http_status:response.status,motivo:String(msg).slice(0,320),aviso:"El proyecto podría requerir cuota o facturación para Grounding. No se hicieron búsquedas de respaldo en Google."};
      }
      const candidate=(payload.candidates||[])[0]||{};
      const metadata=candidate.groundingMetadata||{};
      const sources=[];const seen=new Set();
      for(const chunk of metadata.groundingChunks||[]){
        const w=chunk.web;if(!w||!w.uri||seen.has(w.uri))continue;
        seen.add(w.uri);sources.push({titulo:w.title||"Resultado Google",url:w.uri,fuente:"Google Search Grounding",verificado:false});
      }
      const text=(candidate.content&&candidate.content.parts||[]).filter(x=>typeof x.text==="string").map(x=>x.text).join("\n");
      const usage=payload.usageMetadata||{};
      return {disponible:true,consulta:query,modelo:model,resultado:text,fuentes:sources,consultas_google:metadata.webSearchQueries||[],consumo:{tokens_total:Number.isFinite(usage.totalTokenCount)?usage.totalTokenCount:null,tokens_entrada:usage.promptTokenCount||0,tokens_salida:usage.candidatesTokenCount||0,consultas_reportadas:(metadata.webSearchQueries||[]).length},advertencia:"Las fuentes provienen de Grounding; verifica su página y los metadatos antes de importar o citar. Google puede cobrar búsquedas según la cuenta; Zotero IA no controla esa facturación."};
    }
  },
  buscar_web: {
    description: "Busca en internet general y repositorios, incluso tesis sin DOI. Consulta Bing RSS y DuckDuckGo HTML; prueba varias formulaciones de la búsqueda, informa las fuentes fallidas y devuelve enlaces reales. La ausencia de resultados NO demuestra que un documento no exista. Si el usuario aporta institución, busca también con site: del dominio sugerido.",
    parameters: {type:"object",properties:{consulta:{type:"string",description:"Título exacto, autor o consulta general"},limite:{type:"integer",description:"Máximo 15 resultados"}},required:["consulta"]},
    async run({consulta,limite=10}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const q=String(consulta||"").trim();
      if(!q) throw new Error("Escribe una consulta de búsqueda.");
      // Google Search first for Gemini users. Do not issue multiple paid searches
      // invisibly: each call is one explicit agent tool invocation.
      let googleFailure=null;
      if(ZoteroIA.pref("provider")==="gemini" && !ZoteroIA.modelPolicy?.restricted()){
        const g=await ZoteroIA.tools.buscar_google.run({consulta:q});
        if(g.disponible&&g.fuentes&&g.fuentes.length){
          return {consulta:q,total:g.fuentes.length,resultados:g.fuentes.slice(0,Math.max(1,Math.min(15,Number(limite)||10))),respuesta_google:g.resultado,diagnostico:{buscadores:["Google Search (Gemini Grounding)"],consultas:g.consultas_google,consumo:g.consumo},advertencia:g.advertencia};
        }
        googleFailure=g.disponible?"Google no proporcionó fuentes verificables":g.motivo;
      }
      const limit=Math.max(1,Math.min(15,Number(limite)||10));
      const decode=s=>String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
        .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{try{return String.fromCodePoint(v[0].toLowerCase()==="x"?parseInt(v.slice(1),16):parseInt(v,10))}catch{return ""}})
        .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      const field=(item,name)=>{const m=item.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+name+">","i"));return m?decode(m[1]):""};
      const safeUrl=(raw)=>{try {const u=new URL(raw);return (u.protocol==="https:"||u.protocol==="http:")?u.toString():null} catch{return null}};
      const results=[];const errors=[];const seen=new Set();
      const add=(title,url,excerpt,origin)=>{const address=safeUrl(url);if(!address||!title||seen.has(address))return;seen.add(address);results.push({titulo:decode(title),url:address,resumen:decode(excerpt).slice(0,500),fuente:origin,verificado:false});};
      // The first attempt uses exact keywords, the second uses a shortened phrase.
      const trimmed=q.replace(/[“”«»"]/g,"").replace(/\([^)]*\)/g,"").trim();
      const words=trimmed.split(/\s+/).filter(Boolean);
      const short=words.length>12?words.slice(0,12).join(" "):trimmed;
      const queries=[q];if(short!==q)queries.push(short);
      for(const query of queries.slice(0,3)){
        if(results.length>=limit)break;
        try {
          const url="https://www.bing.com/search?format=rss&q="+encodeURIComponent(query)+"&count="+limit;
          const r=await Zotero.HTTP.request("GET",url,{responseType:"text",timeout:13000,successCodes:false});
          if(r.status!==200)throw new Error("HTTP "+r.status);
          const xml=String(r.responseText||r.response||"");
          const entries=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
          if(!entries.length) errors.push("Bing RSS sin resultados XML para «"+query+"»");
          for(const e of entries){add(field(e[1],"title"),field(e[1],"link"),field(e[1],"description"),"Bing RSS");}
        }catch(e){errors.push("Bing RSS: "+String(e.message||e));}
        if(results.length>=limit)break;
        try {
          const url="https://html.duckduckgo.com/html/?q="+encodeURIComponent(query);
          const r=await Zotero.HTTP.request("GET",url,{responseType:"text",timeout:13000,successCodes:false,headers:{"Accept":"text/html"}});
          if(r.status!==200)throw new Error("HTTP "+r.status);
          const html=String(r.responseText||r.response||"");
          const re=/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
          let match;
          while((match=re.exec(html))&&results.length<limit){
            const h=(match[1].match(/href\s*=\s*["']([^"']+)["']/i)||[])[1];if(!h)continue;
            let link=decode(h);
            if(link.startsWith("//"))link="https:"+link;
            try {const u=new URL(link);if(u.searchParams.has("uddg"))link=u.searchParams.get("uddg");} catch{}
            const excerpt=html.slice(match.index+match[0].length,match.index+match[0].length+1200);
            const snippet=(excerpt.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)||[])[1]||"";
            add(match[2],link,snippet,"DuckDuckGo HTML");
          }
          if(!html.includes("result__a"))errors.push("DuckDuckGo no devolvió resultados reconocibles para «"+query+"»");
        }catch(e){errors.push("DuckDuckGo: "+String(e.message||e));}
      }
      return {consulta:q,total:results.length,resultados:results.slice(0,limit),diagnostico:{buscadores:["Bing RSS","DuckDuckGo HTML"],consultas:queries,incidencias:googleFailure?["Google Search: "+googleFailure,...errors]:errors},advertencia:results.length?"Enlaces web preliminares; abre cada registro para verificar metadatos antes de citar o importar.":"NO SE ENCONTRARON RESULTADOS EN LOS BUSCADORES CONSULTADOS. Esto no implica que la obra no exista. Solicita una URL de repositorio o prueba un buscador externo."};
    }
  },
  buscar_literatura: {
    description: "Busca literatura académica NUEVA en internet (OpenAlex: artículos, libros, capítulos y tesis de todas las disciplinas e idiomas). Devuelve título, autores, año, revista, DOI, citas, si hay PDF libre, un resumen y si el usuario YA lo tiene en su biblioteca. Usa términos en el idioma de la literatura buscada; puedes buscar en varios idiomas.",
    parameters: { type: "object", properties: {
      consulta: { type: "string", description: "palabras clave" },
      desde_año: { type: "integer" }, hasta_año: { type: "integer" },
      idioma: { type: "string", description: "código ISO de 2 letras, p. ej. es, en, pt, fr" },
      solo_acceso_abierto: { type: "boolean" },
      orden: { type: "string", enum: ["relevancia", "mas_citados", "mas_recientes"] },
      limite: { type: "integer", description: "por defecto 15, máx. 50" },
    }, required: ["consulta"] },
    async run({ consulta, desde_año, hasta_año, idioma, solo_acceso_abierto, orden = "relevancia", limite = 15 }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const f = [];
      if (desde_año) f.push("from_publication_date:" + desde_año + "-01-01");
      if (hasta_año) f.push("to_publication_date:" + hasta_año + "-12-31");
      if (idioma) f.push("language:" + idioma.toLowerCase());
      if (solo_acceso_abierto) f.push("is_oa:true");
      const sort = { mas_citados: "cited_by_count:desc", mas_recientes: "publication_date:desc" }[orden];
      let url = "https://api.openalex.org/works?search=" + encodeURIComponent(consulta)
        + "&per_page=" + Math.min(limite, 50) + (f.length ? "&filter=" + f.join(",") : "") + (sort ? "&sort=" + sort : "");
      const key = String(ZoteroIA.pref("openalexKey") || "").trim();
      if (key) url += "&api_key=" + encodeURIComponent(key);
      const xhr = await Zotero.HTTP.request("GET", url, { responseType: "json", timeout: 60000, successCodes: false });
      if (xhr.status === 429) throw new Error("OpenAlex: límite de búsquedas alcanzado por hoy. Se puede ampliar con una clave gratuita de OpenAlex en Ajustes → Zotero IA → Opciones avanzadas.");
      if (xhr.status !== 200) throw new Error("OpenAlex respondió " + xhr.status);
      const data = xhr.response;
      const res = [];
      for (const w of data.results || []) {
        const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : "";
        let abs = "";
        if (w.abstract_inverted_index) {
          const pos = [];
          for (const [word, idx] of Object.entries(w.abstract_inverted_index)) for (const i of idx) pos[i] = word;
          abs = pos.join(" ").slice(0, 700);
        }
        res.push({
          openalex_id: w.id ? w.id.split("/").pop() : "",
          titulo: w.display_name || w.title,
          autores: (w.authorships || []).slice(0, 5).map(a => a.author && a.author.display_name).filter(Boolean).join("; ") + ((w.authorships || []).length > 5 ? " et al." : ""),
          año: w.publication_year,
          tipo: w.type,
          fuente: w.primary_location && w.primary_location.source ? w.primary_location.source.display_name : "",
          doi, citas: w.cited_by_count, idioma: w.language,
          pdf_libre: w.open_access && w.open_access.oa_url ? w.open_access.oa_url : "",
          resumen: abs,
          ya_en_biblioteca: doi ? await ZoteroIA.hasDOI(doi) : false,
        });
      }
      return { total_encontrados: data.meta && data.meta.count, resultados: res };
    },
  },
  guardar_publicacion: {
    escribe: true,
    description: "Guarda en la biblioteca del usuario publicaciones encontradas con buscar_literatura. Usa el DOI cuando exista (metadatos oficiales vía traductores de Zotero); si no hay DOI, crea el ítem con los datos de OpenAlex. Opcionalmente las coloca en una colección.",
    parameters: { type: "object", properties: {
      publicaciones: { type: "array", items: { type: "object", properties: { openalex_id: { type: "string" }, doi: { type: "string" }, titulo: { type: "string" } } } },
      coleccion_id: { type: "integer" },
    }, required: ["publicaciones"] },
    resumen: a => `Guardar ${a.publicaciones.length} publicación(es) en tu biblioteca:\n` + a.publicaciones.map(p => "• " + (p.titulo || p.doi || p.openalex_id)).join("\n"),
    async run({ publicaciones, coleccion_id }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const out = [];
      for (const p of publicaciones) {
        try {
          if (p.doi && await ZoteroIA.hasDOI(p.doi)) { out.push({ titulo: p.titulo, estado: "ya estaba en la biblioteca" }); continue; }
          let saved = null;
          if (p.doi) {
            try {
              const t = new Zotero.Translate.Search();
              t.setIdentifier({ DOI: p.doi });
              const tr = await t.getTranslators();
              if (tr.length) { t.setTranslator(tr); saved = (await t.translate({ libraryID: Zotero.Libraries.userLibraryID, collections: coleccion_id ? [coleccion_id] : false }))[0]; }
            } catch (e) { Zotero.debug("[Zotero IA] DOI falló, uso OpenAlex: " + e); }
          }
          if (!saved && p.openalex_id) saved = await ZoteroIA.itemFromOpenAlex(p.openalex_id, coleccion_id, signal);
          out.push(saved ? { titulo: saved.getField("title"), id: saved.id, estado: "guardado" } : { titulo: p.titulo, estado: "no se pudo guardar" });
        } catch (e) { out.push({ titulo: p.titulo, estado: "error: " + e.message }); }
      }
      return out;
    },
  },
  agregar_por_identificador: {
    escribe: true,
    description: "Agrega a la biblioteca un libro o artículo real a partir de su DOI, ISBN, PMID o arXiv ID, usando los traductores oficiales de Zotero (metadatos verificados).",
    parameters: { type: "object", properties: { identificador: { type: "string" }, coleccion_id: { type: "integer" } }, required: ["identificador"] },
    resumen: a => `Agregar a la biblioteca: ${a.identificador}`,
    async run({ identificador, coleccion_id }, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
      const ids = Zotero.Utilities.extractIdentifiers(identificador);
      if (!ids.length) throw new Error("No reconozco un DOI/ISBN/PMID/arXiv en: " + identificador);
      const t = new Zotero.Translate.Search();
      t.setIdentifier(ids[0]);
      const tr = await t.getTranslators();
      if (!tr.length) throw new Error("Ningún traductor encontró ese identificador");
      t.setTranslator(tr);
      const items = await t.translate({ libraryID: Zotero.Libraries.userLibraryID, collections: coleccion_id ? [coleccion_id] : false });
      return { ok: true, agregados: items.map(i => ZoteroIA.summarize(i)) };
    },
  },
};

ZoteroIA.hasDOI = async function (doi) {
  doi = String(doi).toLowerCase().trim();
  if (!doi) return false;
  const s = new Zotero.Search();
  s.libraryID = Zotero.Libraries.userLibraryID;
  s.addCondition("DOI", "is", doi);
  const ids = await s.search();
  if (ids.length) return true;
  // DOI guardado en "Extra" (p. ej. libros o capítulos)
  const s2 = new Zotero.Search();
  s2.libraryID = Zotero.Libraries.userLibraryID;
  s2.addCondition("extra", "contains", doi);
  return (await s2.search()).length > 0;
};

ZoteroIA.itemFromOpenAlex = async function (oaid, coleccion_id, signal) {
  const xhr = await Zotero.HTTP.request("GET", "https://api.openalex.org/works/" + encodeURIComponent(oaid), { responseType: "json", timeout: 60000 });
  const w = xhr.response;
  const typeMap = { article: "journalArticle", book: "book", "book-chapter": "bookSection", dissertation: "thesis", preprint: "preprint", review: "journalArticle" };
  const item = new Zotero.Item(typeMap[w.type] || "journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  const set = (f, v) => { if (!v) return; try { item.setField(f, v); } catch (e) {} };
  set("title", w.display_name || w.title);
  set("date", w.publication_date || String(w.publication_year || ""));
  const src = w.primary_location && w.primary_location.source;
  if (src) { set("publicationTitle", src.display_name); set("bookTitle", src.display_name); set("publisher", src.host_organization_name); }
  if (w.biblio) { set("volume", w.biblio.volume); set("issue", w.biblio.issue); if (w.biblio.first_page) set("pages", w.biblio.first_page + (w.biblio.last_page ? "-" + w.biblio.last_page : "")); }
  if (w.doi) set("DOI", w.doi.replace(/^https?:\/\/doi\.org\//i, ""));
  set("language", w.language);
  set("url", (w.open_access && w.open_access.oa_url) || w.doi || "");
  if (w.abstract_inverted_index) {
    const pos = [];
    for (const [word, idx] of Object.entries(w.abstract_inverted_index)) for (const i of idx) pos[i] = word;
    set("abstractNote", pos.join(" "));
  }
  set("extra", "OpenAlex: " + w.id);
  item.setCreators((w.authorships || []).map(a => {
    const n = (a.author && a.author.display_name) || "";
    // OpenAlex display_name does not delimit family names (compound Spanish surnames etc.).
    // Store one-field names instead of incorrectly inventing a surname boundary.
    return { lastName: n, fieldMode: 1, creatorType: "author" };
  }));
  if (coleccion_id) item.addToCollection(coleccion_id);
  ZoteroIA.checkAbort(signal);await item.saveTx();
  return item;
};


// Herramientas CSL 0.8: nunca modificar el estilo original.
ZoteroIA.cslEscape = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
ZoteroIA.cslValidate = function(xml) {
  // DOMParser must come from a live Zotero window. The removed hiddenDOMWindow
  // service fails on current Gecko builds with NS_ERROR_FAILURE.
  const mainWindow = Zotero.getMainWindow?.();
  const parserClass = mainWindow?.DOMParser ||
    mainWindow?.document?.defaultView?.DOMParser;
  if (!parserClass) throw new Error("No hay una ventana de Zotero disponible para validar el CSL. Abre la ventana principal e inténtalo otra vez.");
  const doc = new parserClass().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("El CSL no es XML válido");
  const root = doc.documentElement;
  if (!root || root.localName !== "style" || root.namespaceURI !== "http://purl.org/net/xbiblio/csl") throw new Error("No es un estilo CSL");
  if (!root.getElementsByTagNameNS(root.namespaceURI, "info").length || !root.getElementsByTagNameNS(root.namespaceURI, "citation").length) throw new Error("El CSL no contiene info o citation");
  return doc;
};
ZoteroIA.tools.listar_estilos_csl = {
  description: "Lista estilos de citación instalados en Zotero. Usa esta herramienta antes de crear un estilo personalizado.",
  parameters: {type:"object",properties:{}},
  async run(_args={}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
    await Zotero.Styles.init();
    return Zotero.Styles.getVisible().map(s=>({id:s.styleID, titulo:s.title, tipo:s.class || ""})).slice(0,500);
  }
};
// Obtiene el CSL desde la fuente real del estilo, sin asumir que style.file exista.
ZoteroIA.leerFuenteCSL = async function(style, id) {
  const attempts=[];
  const valid = xml => typeof xml === "string" && /<style\b/.test(xml) && /purl\.org\/net\/xbiblio\/csl/.test(xml);
  if (typeof style.getXML === "function") {
    try { const xml=await style.getXML(); if(valid(xml)) return {xml,origen:"Zotero.Styles.getXML"}; }
    catch(e){attempts.push("getXML: "+e.message);}
  }
  for (const candidate of [style.xml,style._xml,style.source]) {
    if(valid(candidate)) return {xml:candidate,origen:"objeto del estilo"};
  }
  const candidates=[];
  for (const f of [style.file,style._file,style.path]) {
    if(typeof f === "string") candidates.push(f);
    else if(f?.path) candidates.push(f.path);
  }
  // Los estilos de usuario suelen almacenarse en el subdirectorio styles del perfil.
  const slug=String(id).split("/").pop();
  if (/^[a-zA-Z0-9_-]+$/.test(slug)) {
    candidates.push(PathUtils.join(Zotero.getProfileDirectory().path,"styles",slug+".csl"));
  }
  for(const path of [...new Set(candidates)]) {
    try {
      const xml=await IOUtils.readUTF8(path);
      if(valid(xml)) return {xml,origen:"archivo local"};
    } catch(e) {attempts.push("archivo: "+e.message);}
  }
  // Solo consultar la biblioteca pública oficial; jamás exponer archivos locales o claves.
  if (/^https?:\/\/(?:www\.)?zotero\.org\/styles\/[a-zA-Z0-9_-]+$/.test(id)) {
    try {
      const response=await Zotero.HTTP.request("GET",id,{responseType:"text",timeout:12000});
      if(valid(response.responseText)) return {xml:response.responseText,origen:"repositorio Zotero"};
    } catch(e) {attempts.push("repositorio: "+e.message);}
  }
  throw new Error("No se pudo recuperar el código CSL del estilo «"+(style.title||id)+"». " +
    "Comprueba que esté instalado localmente o importa su archivo .csl. Detalles: "+attempts.join("; ").slice(0,350));
};

ZoteroIA.tools.crear_estilo_csl = {
  escribe: true,
  description: "Crea una COPIA personalizada de un estilo CSL instalado, nunca cambia el original. Acepta modificaciones soportadas: quitar DOI, quitar URL, cambiar idioma predeterminado. Devuelve archivo .csl guardado y opcionalmente lo instala en Zotero. NO afirmar que reproduce toda la norma editorial sin prueba de citas.",
  parameters: {type:"object",properties:{estilo_id:{type:"string",description:"ID completo obtenido de listar_estilos_csl"},nombre:{type:"string",description:"Título para el nuevo estilo"},quitar_doi:{type:"boolean"},quitar_url:{type:"boolean"},idioma:{type:"string",description:"Idioma CSL: es-ES, en-US, etc."},instalar:{type:"boolean",description:"Instalar en Zotero; si falla, conserva el archivo para instalación manual"}},required:["estilo_id","nombre"]},
  resumen:a=>`Crear copia CSL «${a.nombre}» basada en «${a.estilo_id}»` + (a.instalar?" e instalar":""),
  async run({estilo_id,nombre,quitar_doi=false,quitar_url=false,idioma,instalar=false}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
    await Zotero.Styles.init();
    const style=Zotero.Styles.get(estilo_id);
    if(!style) throw new Error("Estilo base no instalado: "+estilo_id);
    const name=String(nombre||"").trim();
    if(name.length<3||name.length>150) throw new Error("El título del estilo debe tener 3 a 150 caracteres");
    if(idioma && !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(idioma)) throw new Error("Código de idioma inválido");
    const source=await ZoteroIA.leerFuenteCSL(style, estilo_id);
    let xml=source.xml;
    ZoteroIA.cslValidate(xml);
    // Un estilo dependiente solo referencia a otro estilo; no tiene reglas editables.
    if (!/<citation\b/.test(xml) || !/<bibliography\b/.test(xml)) {
      throw new Error("El estilo elegido es dependiente y no contiene reglas completas. " +
        "Debes usar el estilo independiente del que depende para crear la copia.");
    }
    // Ediciones declarativas que preservan las macros y condiciones originales.
    const esc=ZoteroIA.cslEscape;
    const slug=name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,65);
    const suffix="-"+Date.now().toString(36);
    const newID="http://www.zotero.org/styles/zotero-ia-"+slug+suffix;
    xml=xml.replace(/(<info\b[^>]*>[\s\S]*?<title>)[\s\S]*?(<\/title>)/,(_,a,b)=>a+esc(name)+b)
      .replace(/(<info\b[^>]*>[\s\S]*?<id>)[\s\S]*?(<\/id>)/,(_,a,b)=>a+newID+b);
    if(!xml.includes(newID)) throw new Error("No pude generar un identificador independiente: estilo sin metadatos CSL editables");
    // Evitar sobrescribir el estilo base: los enlaces 'self' son sustituidos si existen.
    xml=xml.replace(/<link\b([^>]*\brel=["']self["'][^>]*)\/>/g,`<link rel="self" href="${newID}"/>`);
    if(idioma) xml=xml.replace(/<style\b([^>]*)>/, (m,attrs)=>`<style${attrs.replace(/\sdefault-locale=["'][^"']+["']/g,"")} default-locale="${idioma}">`);
    if(idioma && /^es(?:-|$)/i.test(idioma)) {
      const doc=new DOMParser().parseFromString(xml,"application/xml");
      const ns="http://purl.org/net/xbiblio/csl";
      for(const name of doc.getElementsByTagNameNS(ns,"name"))if(name.getAttribute("and")==="symbol")name.setAttribute("and","text");
      // CSL processors use the localized long form of 'and' when and="text".
      xml=new XMLSerializer().serializeToString(doc);
    }
    if(quitar_doi) xml=xml.replace(/<text\b(?=[^>]*\bvariable=["']DOI["'])[^>]*\/?>(?:<\/text>)?/g,"");
    if(quitar_url) xml=xml.replace(/<text\b(?=[^>]*\bvariable=["']URL["'])[^>]*\/?>(?:<\/text>)?/g,"");
    ZoteroIA.cslValidate(xml);
    const dir=PathUtils.join(Zotero.getProfileDirectory().path,"zotero-ia-csl");
    await IOUtils.makeDirectory(dir,{ignoreExisting:true});
    const path=PathUtils.join(dir,"zotero-ia-"+slug+suffix+".csl");
    await Zotero.File.putContentsAsync(path,xml);
    let installed=false,warning="";
    if(instalar) {
      try { await Zotero.Styles.install({string:xml},path,true); installed=true; }
      catch(e) { warning="Instalación automática no confirmada: "+e.message+". Instala el archivo en Configuración → Citar → Estilos → +"; }
    }
    return {ok:true,titulo:name,estilo_base:estilo_id,origen_fuente:source.origen,nuevo_id:newID,archivo:path,instalado:installed,advertencia:warning||"Validación XML estructural completada; falta validación CSL con esquema y revisión de ejemplos en el editor de Zotero.",cambios:{quitar_doi,quitar_url,idioma:idioma||"sin cambio"}};
  }
};


// 1.5.0: operaciones de investigación auditables, limitadas a la biblioteca local.
ZoteroIA.researchOps = {
  collection(id) { const c=Zotero.Collections.get(Number(id)); if(!c)throw new Error("Colección inexistente");return c; },
  items(id,limit=100) {const c=this.collection(id);const all=c.getChildItems().filter(x=>x.isRegularItem());return {c,all,items:all.slice(0,Math.max(1,Math.min(200,Number(limit)||100)))};},
  norm(s){return String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();},
  async text(it,limit=12000){const a=it.isAttachment()?it:await it.getBestAttachment();let t="";try{if(a)t=String(await a.attachmentText||"");}catch(_){}return {text:t.slice(0,limit),total:t.length,hasText:!!t.trim(),partial:t.length>limit};},
  safeTag(s){return String(s||"").trim().slice(0,80);}
};
ZoteroIA.tools.plan_organizacion = {
 description:"Analiza una colección y propone organización temática basada en títulos, resúmenes y etiquetas; NO modifica la biblioteca. Devuelve IDs para aplicar clasificación aprobada.",
 parameters:{type:"object",properties:{coleccion_id:{type:"integer"},limite:{type:"integer"}},required:["coleccion_id"]},
 async run({coleccion_id,limite=60}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const {c,all,items}=ZoteroIA.researchOps.items(coleccion_id,limite);return {coleccion:c.name,total:all.length,analizados:items.length,referencias:items.map(i=>({...ZoteroIA.summarize(i),resumen:String(i.getField("abstractNote")||"").slice(0,500)})),instruccion:"Propón categorías con evidencias visibles y IDs; no clasifiques por textos que no se leyeron."};}
};
ZoteroIA.tools.aplicar_organizacion = {
 escribe:true, description:"Añade etiquetas temáticas y asigna referencias a una colección existente tras recibir pares explícitos de IDs y etiquetas aprobados. No elimina ninguna colección ni mueve de forma exclusiva los ítems.",
 parameters:{type:"object",properties:{asignaciones:{type:"array",items:{type:"object",properties:{item_id:{type:"integer"},etiqueta:{type:"string"},coleccion_destino_id:{type:"integer"}},required:["item_id","etiqueta"]}}},required:["asignaciones"]},
 resumen:a=>"Clasificar "+(a.asignaciones||[]).length+" referencias (sin eliminar colecciones)",
 async run({asignaciones}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const out=[];for(const r of (asignaciones||[]).slice(0,100)){try{const it=await Zotero.Items.getAsync(Number(r.item_id));if(!it||!it.isRegularItem())throw Error("No es referencia");const tag=ZoteroIA.researchOps.safeTag(r.etiqueta);if(!tag)throw Error("Etiqueta vacía");it.addTag(tag);if(r.coleccion_destino_id){const c=ZoteroIA.researchOps.collection(r.coleccion_destino_id);if(c.libraryID!==it.libraryID)throw Error("Biblioteca diferente");it.addToCollection(c.id);}ZoteroIA.checkAbort(signal);await it.saveTx();out.push({id:it.id,estado:"CLASIFICADO",etiqueta:tag});}catch(e){out.push({id:r.item_id,estado:"ERROR",error:String(e.message||e)});}}return {resultados:out};}
};
ZoteroIA.tools.detectar_duplicados_avanzado = {
 description:"Detecta candidatos duplicados por DOI, ISBN o título+autor+año. Sin colección recorre todas las bibliotecas accesibles; informa cobertura. No fusiona ni elimina.",
 parameters:{type:"object",properties:{coleccion_id:{type:"integer"},limite:{type:"integer",description:"Máximo por biblioteca; sin valor analiza todos"}}},
 async run({coleccion_id,limite}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);
  const sources=coleccion_id?[{libraryID:ZoteroIA.researchOps.collection(coleccion_id).libraryID,items:ZoteroIA.researchOps.collection(coleccion_id).getChildItems()}]:await Promise.all(Zotero.Libraries.getAll().filter(l=>["user","group"].includes(l.libraryType)).map(async l=>({libraryID:l.libraryID,items:await Zotero.Items.getAll(l.libraryID,true,false)})));
  const coverage=[],matches=[];
  for(const source of sources){
   const all=source.items.filter(i=>i.isRegularItem()&&!i.deleted), items=limite?all.slice(0,Math.max(1,Math.floor(limite))):all,groups=new Map();
   coverage.push({biblioteca_id:source.libraryID,total:all.length,analizados:items.length,truncado:items.length<all.length});
   for(const it of items){
    const doi=ZoteroIA.metadataAudit.normalizeDOI(it.getField("DOI")||"").toLowerCase(),isbn=String(it.getField("ISBN")||"").replace(/[^0-9X]/gi,"");
    const title=ZoteroIA.researchOps.norm(it.getField("title")),author=ZoteroIA.researchOps.norm((it.getCreatorsJSON().find(c=>c.creatorType==="author")||{}).lastName||""),year=String(it.getField("date")||"").match(/\d{4}/)?.[0]||"";
    const key=doi?"doi:"+doi:isbn.length>=10?"isbn:"+isbn:title.length>=25&&author&&year?"title:"+title+"|"+author+"|"+year:null;
    if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(it);
   }
   for(const [criterio,g] of groups)if(g.length>1)matches.push({biblioteca_id:source.libraryID,criterio,items:g.map(it=>({id:it.id,titulo:it.getField("title"),pdf_ids:it.getAttachments().filter(id=>Zotero.Items.get(id)?.attachmentContentType==="application/pdf")}))});
  }
  return {cobertura:coverage,analizados:coverage.reduce((n,c)=>n+c.analizados,0),grupos:matches,advertencia:"Candidatos por metadatos. Las bibliotecas se analizan separadamente; no se fusionan registros ni se comparan bytes de adjuntos."};
 }
};
ZoteroIA.tools.revisar_bibliografia_citada = {
 description:"Extrae un fragmento final del texto indexado de un PDF, útil para examinar su bibliografía y compararla con la biblioteca. No afirma haber extraído referencias completas; identifica límites de indexación.",
 parameters:{type:"object",properties:{item_id:{type:"integer"},max_caracteres:{type:"integer"}},required:["item_id"]},
 async run({item_id,max_caracteres=16000}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const it=await Zotero.Items.getAsync(Number(item_id));if(!it)throw Error("Ítem inexistente");const x=await ZoteroIA.researchOps.text(it,1000000);if(!x.hasText)return {estado:"SIN_TEXTO_INDEXADO"};const n=Math.max(3000,Math.min(30000,Number(max_caracteres)||16000));return {item_id,texto_final:x.text.slice(-n),caracteres_indexados:x.total,recortado:x.total>n,cobertura_paginas:"NO_VERIFICADA",instruccion:"Identifica posibles referencias; para cotejar cada una utiliza buscar_biblioteca. No crees ítems sin comprobar su identidad."};}
};
ZoteroIA.tools.comparar_documentos = {
 description:"Prepara evidencia de varios documentos para comparación crítica por la IA, con indicación de texto recortado y ausencia de páginas verificadas.",
 parameters:{type:"object",properties:{item_ids:{type:"array",items:{type:"integer"}},caracteres_por_documento:{type:"integer"}},required:["item_ids"]},
 async run({item_ids,caracteres_por_documento=9000}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const out=[];for(const id of (item_ids||[]).slice(0,8)){const it=await Zotero.Items.getAsync(Number(id));if(!it||!it.isRegularItem()){out.push({id,estado:"NO_ES_REFERENCIA"});continue;}const x=await ZoteroIA.researchOps.text(it,Math.max(1000,Math.min(15000,Number(caracteres_por_documento)||9000)));out.push({id,titulo:it.getField("title"),texto:x.text,caracteres_indexados:x.total,recortado:x.partial,estado:x.hasText?"TEXTO_PARCIAL_O_INDEXADO":"SOLO_METADATOS"});}return {documentos:out,paginas_verificadas:false,advertencia:"Comparar únicamente la evidencia recuperada. No atribuir contradicciones sin comparar el mismo objeto de estudio."};}
};
ZoteroIA.tools.preparar_busqueda_semantica = {
 description:"Recupera fragmentos indexados de candidatos encontrados por búsqueda textual en la biblioteca; la IA puede evaluar pertinencia semántica, pero NO existe índice vectorial exhaustivo.",
 parameters:{type:"object",properties:{consulta:{type:"string"},limite:{type:"integer"}},required:["consulta"]},
 async run({consulta,limite=12}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const hits=await ZoteroIA.tools.buscar_biblioteca.run({consulta,limite:Math.min(20,Number(limite)||12)});const records=[];for(const r of hits.resultados){const it=await Zotero.Items.getAsync(r.id);const x=await ZoteroIA.researchOps.text(it,7000);records.push({id:r.id,titulo:r.titulo,fragmento:x.text,caracteres_indexados:x.total,recortado:x.partial});}return {total_candidatos:hits.total,resultados:records,cobertura:"Candidatos por búsqueda textual de Zotero; no búsqueda semántica exhaustiva ni páginas verificadas"};}
};
ZoteroIA.tools.plan_lecturas = {
 description:"Ordena un conjunto de lecturas según etiquetas y datos bibliográficos para que la IA proponga prioridades; no modifica registros.",
 parameters:{type:"object",properties:{coleccion_id:{type:"integer"},limite:{type:"integer"}},required:["coleccion_id"]},
 async run({coleccion_id,limite=75}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const {c,all,items}=ZoteroIA.researchOps.items(coleccion_id,limite);return {coleccion:c.name,total:all.length,registros:items.map(it=>({...ZoteroIA.summarize(it),resumen:String(it.getField("abstractNote")||"").slice(0,350),notas:it.getNotes().length,adjuntos:it.getAttachments().length})),advertencia:"Las notas no demuestran que un documento haya sido leído; consultar o registrar estado explícito."};}
};
ZoteroIA.tools.auditoria_integral = {
 description:"Diagnóstico NO destructivo de una colección: campos vacíos, PDF ausentes, PDF independientes y duplicados bibliográficos candidatos.",
 parameters:{type:"object",properties:{coleccion_id:{type:"integer"},limite:{type:"integer"}},required:["coleccion_id"]},
 async run({coleccion_id,limite=150}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const basic=await ZoteroIA.tools.auditar_coleccion.run({coleccion_id,limite});const dup=await ZoteroIA.tools.detectar_duplicados_avanzado.run({coleccion_id,limite});return {auditoria:basic,duplicados_candidatos:dup.grupos,advertencia:"No se han modificado documentos, no se compararon hashes, y los campos de DOI deben verificarse con Crossref por separado."};}
};
ZoteroIA.tools.vigilancia_rss_bibliografica = {
 description:"Enumera canales RSS activos como primer paso para revisar novedades y cotejar con biblioteca; no garantiza actualizaciones periódicas en segundo plano.",
 parameters:{type:"object",properties:{}},
 async run(_args={}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);const feeds=await ZoteroIA.tools.listar_canales.run({});return {canales:feeds,pasos:"Usa revisar_canal_url en feeds públicos y buscar_biblioteca para cotejar títulos. No crea suscripciones ni se ejecuta en segundo plano."};}
};
ZoteroIA.tools.mapa_intelectual_auditado = {
 description:"Obtiene datos del mapa existente y advierte que autores/etiquetas compartidos NO acreditan vínculos teóricos; exige evidencia de PDF para aseverar citas o controversias.",
 parameters:{type:"object",properties:{coleccion_id:{type:"integer"}},required:["coleccion_id"]},
 async run({coleccion_id}, {signal,confirm}={}) { ZoteroIA.checkAbort(signal);return {coleccion_id,estado:"REQUIERE_ANALISIS_DOCUMENTAL",advertencia:"Usa mapa_conocimiento para la red estructural y comparar_documentos para relaciones sustentadas en textos. No se crea automáticamente un grafo de citas que aún no han sido extraídas."};}
};

ZoteroIA.toolSpecs = function () {
  return Object.entries(this.tools)
    .filter(([name]) => name !== "buscar_google" || (this.pref("provider") === "gemini" && !this.modelPolicy?.restricted()))
    .map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }));
};

ZoteroIA.agentGroups = {
 organizar:{pattern:/colecci|carpeta|organiza|etiquet|renombra|elimina/i,names:["crear_coleccion","renombrar_coleccion","eliminar_coleccion","agregar_etiquetas","agregar_a_coleccion","plan_organizacion","aplicar_organizacion","items_de_coleccion"]},
 lectura:{pattern:/lee|leer|lectur|resum|analiz|compar|tesis|document|matriz|pasaje|evidencia/i,names:["leer_item","leer_con_evidencia","buscar_pasajes","crear_tarea_lectura","continuar_tarea_lectura","ver_tarea_lectura","analizar_coleccion_lote","ver_avance_coleccion","comparar_documentos","traducir_documento","plan_lecturas"]},
 metadatos:{pattern:/metadato|crossref|doi|isbn|autor[ií]a|duplicad|audita/i,names:["verificar_metadatos","corregir_metadatos","revertir_metadatos","auditar_coleccion","auditoria_integral","detectar_duplicados_avanzado","revisar_bibliografia_citada","agregar_por_identificador"]},
 pdf:{pattern:/pdf|adjunt|descarg|reconoc|archivo independiente/i,names:["examinar_pdf_independiente","crear_referencia_desde_pdf","reconocer_pdf_coleccion","recuperar_metadatos_pdf","buscar_pdf_disponible"]},
 buscar:{pattern:/internet|web|google|literatura|art[ií]culos|publicacion|publicaci[oó]n|referencias nuevas|busca.*(?:fuera|extern)/i,names:["buscar_web","buscar_literatura","buscar_google","guardar_publicacion","agregar_por_identificador"]},
 mapas:{pattern:/mapa|grafo|redes|sem[aá]ntic/i,names:["mapa_conocimiento","mapa_intelectual_auditado","preparar_busqueda_semantica"]},
 estilos:{pattern:/csl|estilo|chicago|apa|bibliograf[ií]a/i,names:["listar_estilos_csl","crear_estilo_csl"]},
 canales:{pattern:/rss|canal|suscri|vigilancia/i,names:["listar_canales","suscribir_canal_rss","revisar_canal_url","detectar_rss_sitio","vigilancia_rss_bibliografica"]},
 cambios:{pattern:/propuesta|deshacer|historial|revertir/i,names:["preparar_cambios","aplicar_cambios","deshacer_cambios","historial_cambios"]},
};
ZoteroIA.agentToolContext = function(history){
 const enabled=new Set(["descubrir_herramientas","listar_colecciones","buscar_biblioteca","seleccion_actual","crear_nota","ver_consumo_ia"]),known=new Set(enabled);
 const goal=String([...history].reverse().find(m=>m.role==="user")?.content||"");
 for(const group of Object.values(this.agentGroups)){for(const name of group.names)known.add(name);if(group.pattern.test(goal))for(const name of group.names)enabled.add(name);}
 // Preserve extensions registered by other modules even before a category exists.
 for(const name of Object.keys(this.tools))if(!known.has(name))enabled.add(name);
 for(const message of history.slice(-12))for(const call of message.tool_calls||[])if(this.tools[call.function?.name])enabled.add(call.function.name);
 return {enabled};
};
ZoteroIA.tools.descubrir_herramientas={
 description:"Habilita las herramientas de una categoría para el siguiente paso. Úsala si falta una acción; no modifica la biblioteca.",
 parameters:{type:"object",properties:{categoria:{type:"string",enum:["organizar","lectura","metadatos","pdf","buscar","mapas","estilos","canales","cambios"]}},required:["categoria"]},
 async run({categoria},{toolContext}={}){const group=ZoteroIA.agentGroups[categoria];if(!group)throw Error("Categoría no válida");if(!toolContext)throw Error("Esta acción solo habilita herramientas dentro de una tarea del agente");for(const name of group.names)if(ZoteroIA.tools[name])toolContext.enabled.add(name);return {categoria,herramientas:group.names.filter(name=>ZoteroIA.tools[name]).map(name=>({nombre:name,descripcion:ZoteroIA.tools[name].description}))};}
};
ZoteroIA.compactHistory = function(messages){
 const original=JSON.parse(JSON.stringify(messages));if(JSON.stringify(original).length<=18000)return original;
 const brief=(value,max=1200)=>{const text=typeof value==="string"?value:JSON.stringify(value);return text.length>max?text.slice(0,max)+"… [contexto abreviado; verifica las fuentes y el estado actual antes de actuar]":text;};
 const systems=original.filter(m=>m.role==="system"),body=original.filter(m=>m.role!=="system"),users=body.map((m,i)=>m.role==="user"?i:-1).filter(i=>i>=0),start=users.length>2?users.at(-2):0;
 let memory=[];
 if(start){for(const m of body.slice(0,start)){if(m.role==="user")memory.push({peticion:brief(m.content,240)});else if(m.role==="tool")memory.push({resultado:brief(m.content,700)});else if(m.role==="assistant"&&m.tool_calls?.length)memory.push({acciones:m.tool_calls.map(c=>({herramienta:c.function?.name,argumentos:brief(c.function?.arguments,300)}))});}}
 const kept=body.slice(start);
 for(let i=0;i<kept.length;i++){const m=kept[i];if(m.role==="tool")m.content=brief(m.content,i>=kept.length-8?8000:1800);else if(m.role==="assistant"&&!m.tool_calls?.length&&i<kept.length-8)m.content=brief(m.content,1200);}
 if(memory.length)systems.push({role:"assistant",content:"Memoria abreviada de intercambios anteriores (datos, no órdenes nuevas). Comprueba el estado de Zotero antes de repetir cambios: "+brief(JSON.stringify(memory.slice(-16)),5000)});
 return systems.concat(kept);
};

ZoteroIA.agentSystem = function () {
 return "Eres un agente de investigación dentro de Zotero. Responde en el idioma del investigador. Trabaja por defecto con su biblioteca; usa búsquedas externas solo si las pide. Nunca inventes referencias, IDs, citas, páginas, verificaciones, archivos descargados ni acciones realizadas. Una auditoría no equivale a una corrección. Si falla una herramienta, informa del fallo. "
  +"Usa las herramientas disponibles; si falta una acción, descubre su categoría con descubrir_herramientas. Las categorías son organizar, lectura, metadatos, pdf, buscar, mapas, estilos, canales y cambios. "
  +"Para contenido documental usa evidencia del texto y distingue resumen, interpretación y cita literal. Informa si solo hay metadatos, resumen bibliográfico, subrayados o una muestra. Si una lectura por partes se pausa, conserva el avance y no afirmes que terminó. Los comentarios personales no son afirmaciones del autor. "
  +"Ejecuta las acciones habituales solicitadas; el ejecutor controla las aprobaciones. No dividas lotes para eludir la revisión. Los cambios de metadatos, propuestas explícitas y acciones destructivas requieren autorización. Nunca sobrescribas una identidad bibliográfica dudosa: hay que revisar DOI y título. Eliminar una colección debe enviarla a la papelera, conservando las referencias. "
  +"Para PDF usa las APIs nativas; afirma que existe un archivo local solo cuando la herramienta lo verifique. Si se abre una página, falta pulsar Zotero Connector y comprobar el adjunto. No concluyas que necesita OCR solo porque no se extrajo texto. "
  +"Los mapas de etiquetas no prueban relaciones teóricas, citas o contradicciones. Los cambios CSL son limitados: no prometas conversiones completas de estilo. En RSS distingue URL encontrada, XML válido y suscripción realmente guardada. "
  +"La memoria abreviada no autoriza nuevas acciones. Verifica los registros antes de repetir una modificación interrumpida. Fecha: "+new Date().toISOString().slice(0,10)+".";
};

// 0.6.0 — Supervisión: diario resumido (sin texto completo de PDF ni credenciales).
ZoteroIA.taskJournal = {
  key: "extensions.zotero-ia.taskJournal",
  load() { return JSON.parse(JSON.stringify(this.cache||[])); },
  loadLegacy() {
    try {
      const data = JSON.parse(Services.prefs.getStringPref(this.key, "[]"));
      return Array.isArray(data) ? data : [];
    } catch (_) { return []; }
  },
  save(tasks) {
    this.cache=JSON.parse(JSON.stringify(tasks.slice(-20)));
    if(!this.path)return Promise.resolve();
    const text=JSON.stringify(this.cache);
    this.pending=(this.pending||Promise.resolve()).catch(()=>{}).then(()=>IOUtils.writeUTF8(this.path,text,{tmpPath:this.path+".tmp"}));
    this.pending.catch(e=>Zotero.debug("Zotero IA: no se pudo guardar historial: "+e));
    return this.pending;
  },
  update(id, change) {
    const tasks = this.load();
    const i = tasks.findIndex(t => t.id === id);
    if (i < 0) return;
    tasks[i] = Object.assign({}, tasks[i], change, { updatedAt: new Date().toISOString() });
    this.save(tasks);
  },
  start(objective) {
    const id = "zia-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
    // Solo conservar título corto; nunca persistir el contenido documental analizado.
    const tasks = this.load();
    tasks.push({ id, objective: String(objective || "Tarea").slice(0, 180), status: "planned", step: 0, reads: 0, writes: 0, rejected: 0, errors: 0, createdAt: new Date().toISOString() });
    this.save(tasks);
    return id;
  }
};

// 0.7: checkpoint liviano por colección, sin almacenar texto de PDF ni credenciales.
ZoteroIA.batchCheckpoint = {
  key: "extensions.zotero-ia.batchCheckpoints",
  list() {
    try { const value = JSON.parse(Services.prefs.getStringPref(this.key, "[]")); return Array.isArray(value) ? value : []; }
    catch (_) { return []; }
  },
  load(id) { return this.list().find(x => x.coleccion_id === Number(id)) || null; },
  save(record) {
    const previous = this.list().filter(x => x.coleccion_id !== record.coleccion_id);
    previous.push(record);
    Services.prefs.setStringPref(this.key, JSON.stringify(previous.slice(-15)));
  }
};

ZoteroIA.makeTaskPlan = function (objective) {
  const goal = String(objective || "Tarea de investigación").trim();
  return {
    objective: goal,
    stages: [
      "Localizar documentos y referencias pertinentes",
      "Leer y analizar la información accesible",
      "Preparar resultados y posibles cambios",
      "Solicitar autorización para cambios de metadatos, lotes grandes y operaciones de riesgo",
      "Presentar resultados, advertencias y operaciones realizadas"
    ]
  };
};

// history: arreglo de mensajes {role, content,...}; onEvent(tipo, datos); confirm(texto) -> bool
// 0.7.1: acciones ordinarias sin diálogos repetitivos. Política de seguridad
// centralizada en el ejecutor: las instrucciones del modelo NO la pueden omitir.
ZoteroIA.needsApproval = function (name, args) {
  const routine = new Set(["crear_nota", "crear_coleccion", "renombrar_coleccion", "agregar_por_identificador"]);
  if (routine.has(name)) return false;
  const batch=name==="guardar_publicacion"?args?.publicaciones:
    name==="aplicar_organizacion"?args?.asignaciones:
    ["agregar_etiquetas","agregar_a_coleccion"].includes(name)?args?.item_ids:null;
  if(Array.isArray(batch)&&batch.length>0&&batch.length<=20)return false;
  // Las escrituras nuevas son supervisadas por defecto (incluidas eliminaciones).
  return true;
};

ZoteroIA.runAgent = async function (history, { onEvent = () => {}, confirm, maxSteps = 20, signal }) {
  const objective = [...history].reverse().find(m => m.role === "user");
  const taskId = this.taskJournal.start(objective && objective.content);
  const counters = { reads: 0, writes: 0, rejected: 0, errors: 0 };
  onEvent("plan", { id: taskId, plan: this.makeTaskPlan(objective && objective.content) });
  this.taskJournal.update(taskId, { status: "running" });
  const messages = [{ role: "system", content: this.agentSystem() }].concat(JSON.parse(JSON.stringify(history)));
  const toolContext=this.agentToolContext(history),writeBudget={used:0};
  let pendingBatch=null;
  try {
  const fresh = new Set(); // resultados que el modelo todavía no ha visto
  for (let step = 0; step < maxSteps; step++) {
    ZoteroIA.checkAbort(signal);
    onEvent("pensando", { step });
    this.taskJournal.update(taskId, Object.assign({ step: step + 1 }, counters));
    const msg = await this.chatRaw(this.compactHistory(messages), this.toolSpecs().filter(spec=>toolContext.enabled.has(spec.function.name)), {signal,meterId:taskId});
    ZoteroIA.checkAbort(signal);
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) { this.taskJournal.update(taskId, Object.assign({ status: "completed" }, counters)); onEvent("respuesta", { text: msg.content || "" }); return this.compactHistory(messages).filter(m=>m.role!=="system"); }
    if (msg.content) onEvent("nota", { text: msg.content });
    // Reduce lo reenviado en cada paso: lo que el modelo ya procesó y es largo se acorta
    for (const m of messages) {
      if (m.role === "tool" && !fresh.has(m) && m.content.length > 12000) m.content = m.content.slice(0, 12000) + "…(acortado: ya lo procesaste antes)";
    }
    fresh.clear();
    const runOne = async (call) => {
      const name = call.function && call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch (e) { args = null; }
      const tool = this.tools[name];
      let result;
      if (!tool) result = { error: "Herramienta desconocida: " + name };
      else if (!args || typeof args !== "object" || Array.isArray(args)) result = { error: "Argumentos JSON inválidos" };
      else if (signal && signal.aborted) result = { error: "Tarea detenida" };
      else {
        onEvent("herramienta", { name, args });
        try {
          // No interrumpir para escrituras rutinarias. Mantener aprobación para
          // acciones desconocidas, destructivas o lotes de gran tamaño.
          const writeCost=Array.isArray(args.publicaciones)?args.publicaciones.length:Array.isArray(args.item_ids)?args.item_ids.length:1;
          if (tool.escribe && !tool.managesApproval && name!=="corregir_metadatos" && (this.needsApproval(name,args)||writeBudget.used+writeCost>20)) {
            if (typeof confirm !== "function") throw new Error("Esta operación requiere autorización y no hay diálogo disponible");
            this.taskJournal.update(taskId, Object.assign({ status: "waiting_approval" }, counters));
            const ok = await confirm((tool.resumen ? tool.resumen(args) : name) + "\nDetalles: " + JSON.stringify(args).slice(0, 2500));
            ZoteroIA.checkAbort(signal);
            this.taskJournal.update(taskId, { status: "running" });
            if (ok !== true) { counters.rejected++; result = { error: "El usuario rechazó esta acción." }; onEvent("rechazado", { name }); }
          }
          if (!result) {
            ZoteroIA.checkAbort(signal);
            if(tool.escribe&&!tool.managesApproval)writeBudget.used+=writeCost;
            result = await this.withAbort(tool.run(args, {signal,confirm:typeof confirm==="function"?text=>confirm(text,signal):undefined,meterId:taskId,toolContext,writeBudget}),signal);
            ZoteroIA.checkAbort(signal);
            if (tool.escribe) counters.writes++; else counters.reads++;
            onEvent("ejecutada", { name, write: !!tool.escribe, result: name === "crear_nota" ? { nota_id: result && result.nota_id } : (["mapa_conocimiento", "buscar_pdf_disponible"].includes(name) ? result : null) });
          }
        } catch (e) {
          ZoteroIA.checkAbort(signal);
          if(["BudgetLimitError","ProviderError","ModelPolicyError"].includes(e.name))throw e;
          counters.errors++;
          const raw=String(e && e.message || "Error desconocido");
          const status=Number(e && (e.status || e.statusCode || e.response?.status) || 0);
          const http=status || Number((raw.match(/\bHTTP\s*(403|429|404|500|502|503)\b/i)||[])[1]) || 0;
          const safe=(/<(?:!doctype|html|head|body|script|style)\b/i.test(raw)||raw.length>600)
            ? (http?"El sitio respondió HTTP "+http+". No se pudo consultar automáticamente; esto no demuestra que el canal no exista.":"El sitio rechazó o interrumpió la consulta. No se pudo verificar el canal RSS.")
            : raw;
          result={error:safe};onEvent("error",{name,message:safe});
        }
      }
      let content = JSON.stringify(result);
      if (content.length > 40000) content = content.slice(0, 40000) + "…(recortado)";
      return { role: "tool", tool_call_id: call.id, content };
    };
    // Las de solo lectura corren en paralelo (máx. 4 a la vez); las que modifican, una por una
    const results = new Array(calls.length);
    pendingBatch={calls,results};
    const reads = calls.map((c, i) => i).filter(i => { const t = this.tools[calls[i].function && calls[i].function.name]; return !t || !t.escribe; });
    let next = 0;
    const worker = async () => { while (next < reads.length) { const i = reads[next++]; results[i] = await runOne(calls[i]); } };
    // Con planes gratuitos (límite de solicitudes por minuto) se lee de 2 en 2
    const conc = this.modelPolicy?.restricted() ? 1 : ["gemini", "zai", "local"].includes(this.pref("provider")) ? 2 : 4;
    const settled=await Promise.allSettled(Array.from({ length: conc }, worker));
    const failed=settled.find(r=>r.status==="rejected");if(failed)throw failed.reason;
    ZoteroIA.checkAbort(signal);
    for (let i = 0; i < calls.length; i++) {
      ZoteroIA.checkAbort(signal);
      if (!results[i]) results[i] = await runOne(calls[i]);
    }
    ZoteroIA.checkAbort(signal);
    for (const r of results) { messages.push(r); fresh.add(r); }
    pendingBatch=null;
  }
  this.taskJournal.update(taskId, Object.assign({ status: "step_limit" }, counters));
  onEvent("respuesta", { text: "Llegué al límite de pasos. Pídeme que continúe si hace falta." });
  return this.compactHistory(messages).filter(m=>m.role!=="system");
  } catch (e) {
    if(e.name==="BudgetLimitError"){
      if(pendingBatch)for(let i=0;i<pendingBatch.calls.length;i++)messages.push(pendingBatch.results[i]||{role:"tool",tool_call_id:pendingBatch.calls[i].id,content:JSON.stringify({error:"Esta llamada no se completó por la pausa del límite interno. Antes de repetir una modificación, comprueba el estado real de Zotero: podría haberse completado parcialmente."})});
      e.history=JSON.parse(JSON.stringify(messages.slice(1)));e.agentTaskId=taskId;
    }
    this.taskJournal.update(taskId, Object.assign({ status: signal && signal.aborted ? "cancelled" : e.name==="BudgetLimitError"?"paused_budget":"failed", lastError: String(e.message).slice(0, 300) }, counters));
    throw e;
  }
};
