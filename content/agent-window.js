/* global Services, document, window */
// Zotero 10: se obtiene Zotero desde la ventana principal (el servicio XPCOM antiguo ya no existe)
var Zotero = (function () {
  const main = Services.wm.getMostRecentWindow("navigator:browser");
  if (main && main.Zotero) return main.Zotero;
  for (const w of Services.wm.getEnumerator(null)) { if (w.Zotero && w.Zotero.ZoteroIA) return w.Zotero; }
  throw new Error("No encuentro Zotero");
})();
var ZIA = Zotero.ZoteroIA;
var chatHistory = [];
var busy = false;
var ctrl = null;

const $ = id => document.getElementById(id);
const log = $("log");

async function savePNG(blob,name) {
 const fp=Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
 fp.init(window.browsingContext,"Guardar mapa PNG",fp.modeSave);fp.defaultString=name;fp.defaultExtension="png";
 fp.appendFilter("Imagen PNG","*.png");
 const result=await new Promise(resolve=>fp.open(resolve));
 if(result!==fp.returnOK&&result!==fp.returnReplace)return;
 await IOUtils.write(fp.file.path,new Uint8Array(await blob.arrayBuffer()));
}

function add(cls, html, isText, isMarkdown=false) {
  const d = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  d.className = cls;
  if (isMarkdown) ZIA.renderMarkdown(d,html);
  else if (isText) d.textContent = html;
  else { try { d.innerHTML = html; } catch (_) { d.textContent = html; } }
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

const LABELS = {
  mapa_conocimiento: () => "🕸 Construyendo mapa de conocimiento",
  buscar_web: a => `🌐 Buscando en internet: «${a.consulta}»`,
  auditar_coleccion: () => "📋 Auditando referencias y adjuntos de la colección",
  reconocer_pdf_coleccion: a => `📄 Reconociendo PDF independientes de la colección ${a.coleccion_id || 'seleccionada'}`,
  recuperar_metadatos_pdf: a => `📄 Reconociendo ${(a.pdf_ids||[]).length} PDF independientes`,
  buscar_pdf_disponible: a => `📎 Buscando PDF para ${(a.item_ids||[]).length} referencias`,
  buscar_biblioteca: a => `🔎 Buscando «${a.consulta}»`,
  listar_colecciones: () => "📁 Revisando colecciones",
  items_de_coleccion: () => "📁 Abriendo la colección",
  seleccion_actual: () => "👆 Viendo tu selección",
  leer_item: a => `📖 Leyendo un documento` + (a.desde ? " (continuación)" : ""),
  analizar_coleccion_lote: a => `📚 Analizando lote de colección ${a.coleccion_id} desde posición ${a.desde || 0} (máximo ${Math.min(5, a.limite || 3)} documentos)`,
  ver_avance_coleccion: a => `📍 Consultando avance de colección ${a.coleccion_id}`,
  crear_nota: a => `📝 Nota «${a.titulo}»`,
  agregar_etiquetas: a => `🏷 Etiquetas: ${(a.etiquetas || []).join(", ")}`,
  crear_coleccion: a => `➕ Colección «${a.nombre}»`,
  agregar_a_coleccion: () => "➕ Agregando a la colección",
  buscar_literatura: a => `🌍 Buscando literatura nueva: «${a.consulta}»` + (a.desde_año ? ` (desde ${a.desde_año})` : ""),
  guardar_publicacion: a => `💾 Guardando ${(a.publicaciones || []).length} publicación(es)`,
  agregar_por_identificador: a => `🌐 Trayendo los datos de ${a.identificador}`,
};

function openCreatedNote(id) {
  const main = Services.wm.getMostRecentWindow("navigator:browser");
  const pane = main && (main.ZoteroPane || (main.Zotero && main.Zotero.getActiveZoteroPane && main.Zotero.getActiveZoteroPane()));
  if (!pane || typeof pane.selectItem !== "function") { add("e", "No se pudo abrir la nota automáticamente. Busca el ID " + id + " en Zotero.", true); return; }
  try {
    if (main.focus) main.focus();
    Promise.resolve(pane.selectItem(Number(id))).catch(e => add("e", "No se pudo seleccionar la nota: " + e.message, true));
  } catch (e) { add("e", "No se pudo abrir la nota: " + e.message, true); }
}

function addCreatedNote(result) {
  const id = Number(result && result.nota_id);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const box = add("note-result", "");
  const msg = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
  msg.textContent = "✅ Nota creada (ID " + id + "). ";
  box.appendChild(msg);
  const b = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
  b.textContent = "Abrir nota en Zotero";
  b.addEventListener("click", () => openCreatedNote(id));
  box.appendChild(b);
  log.scrollTop = log.scrollHeight;
}

function renderKnowledgeMap(data) {
  if (!data || data.tipo !== "mapa_conocimiento") return;
  const root=add("graph-panel", "");
  const header=document.createElementNS("http://www.w3.org/1999/xhtml","div");
  header.className="graph-toolbar";
  const heading=document.createElementNS("http://www.w3.org/1999/xhtml","strong");
  heading.textContent="Mapa · "+data.coleccion.nombre;header.appendChild(heading);
  // Zotero/XUL occasionally renders HTML <select> with duplicate popup entries.
  // Use native XHTML buttons instead: deterministic filter events in Zotero 10.
  let activeFilter="publication";
  let focusNodeId=null;
  const filters=document.createElementNS("http://www.w3.org/1999/xhtml","div");
  filters.className="graph-filters";
  const filterButtons=new Map();
  for (const [value,label] of [["all","Todos"],["author","Autores"],["publication","Publicaciones"],["concept","Conceptos"]]) {
    const b=document.createElementNS("http://www.w3.org/1999/xhtml","button");
    b.type="button";b.textContent=label;b.setAttribute("aria-pressed",String(value===activeFilter));
    b.addEventListener("click",()=>{
      activeFilter=value;
      focusNodeId=null;clearFocusBtn.disabled=true;selected.textContent="";
      for(const [k,btn] of filterButtons)btn.setAttribute("aria-pressed",String(k===value));
      if(graphMode==="3d")draw3d();else draw();
    });
    filterButtons.set(value,b);filters.appendChild(b);
  }
  const clearFocusBtn=document.createElementNS("http://www.w3.org/1999/xhtml","button");
  clearFocusBtn.type="button";clearFocusBtn.textContent="Limpiar foco";clearFocusBtn.disabled=true;clearFocusBtn.className="graph-clear-focus";
  clearFocusBtn.addEventListener("click",()=>{focusNodeId=null;clearFocusBtn.disabled=true;if(graphMode==="3d")draw3d();else draw();});
  header.appendChild(clearFocusBtn);
  // Alternate between the original accessible SVG graph and a projected 3D graph.
  let graphMode="2d";
  const modes=document.createElementNS("http://www.w3.org/1999/xhtml","div");modes.className="graph-modes";
  const modeButtons=new Map();
  for (const [value,label] of [["2d","2D"],["3d","3D"]]) {
    const button=document.createElementNS("http://www.w3.org/1999/xhtml","button");
    button.type="button";button.textContent=label;button.setAttribute("aria-pressed",String(value===graphMode));
    button.addEventListener("click",()=>{graphMode=value;for(const [key,el] of modeButtons)el.setAttribute("aria-pressed",String(key===value));svg.style.display=value==="2d"?"block":"none";canvas3d.style.display=value==="3d"?"block":"none";if(value==="3d")draw3d();else draw();});
    modeButtons.set(value,button);modes.appendChild(button);
  }
  header.appendChild(modes);
  header.appendChild(filters);
  const controls=document.createElementNS("http://www.w3.org/1999/xhtml","div");controls.className="graph-controls";
  const makeButton=(label,description,callback)=>{const b=document.createElementNS("http://www.w3.org/1999/xhtml","button");b.type="button";b.textContent=label;b.title=description;b.addEventListener("click",callback);controls.appendChild(b);return b;};
  let camera={x:0,y:0,w:740,h:420};
  const view=()=>svg.setAttribute("viewBox",`${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
  const zoom=(factor)=>{if(graphMode==="3d"){view3d.distance=Math.max(280,Math.min(2600,view3d.distance/factor));draw3d();return;}const cx=camera.x+camera.w/2,cy=camera.y+camera.h/2;const w=Math.max(100,Math.min(2300,camera.w*factor)),h=w*420/740;camera={x:cx-w/2,y:cy-h/2,w,h};view();};
  makeButton("+","Acercar",()=>zoom(.8));makeButton("−","Alejar",()=>zoom(1.25));
  makeButton("Ajustar","Restablecer vista",()=>{camera={x:0,y:0,w:740,h:420};view();view3d={yaw:0.4,pitch:0.2,distance:900};if(graphMode==="3d")draw3d();});
  const expand=makeButton("Expandir","Ampliar mapa",()=>{root.classList.toggle("graph-expanded");expand.textContent=root.classList.contains("graph-expanded")?"Reducir":"Expandir";if(graphMode==="3d")requestAnimationFrame(draw3d);});
  makeButton("PNG","Guardar imagen PNG",()=>{
    try {if(graphMode==="3d"){canvas3d.toBlob(blob=>{if(blob)savePNG(blob,"zotero-ia-mapa-3d.png").catch(e=>selected.textContent="No se pudo guardar: "+e.message);},"image/png");return;}const copy=svg.cloneNode(true);copy.setAttribute("xmlns","http://www.w3.org/2000/svg");copy.setAttribute("width","1480");copy.setAttribute("height","840");
      // Export with explicit foreground so labels are visible independently of the Zotero theme.
      for(const t of copy.querySelectorAll("text"))t.setAttribute("fill","#253043");
      for(const l of copy.querySelectorAll("line"))l.setAttribute("stroke","#657386");
      const raw=new XMLSerializer().serializeToString(copy),blob=new Blob([raw],{type:"image/svg+xml;charset=utf-8"}),url=URL.createObjectURL(blob),img=new Image();
      img.onload=()=>{try{const canvas=document.createElementNS("http://www.w3.org/1999/xhtml","canvas");canvas.width=1480;canvas.height=840;const ctx=canvas.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,1480,840);ctx.drawImage(img,0,0,1480,840);canvas.toBlob(png=>{if(png){savePNG(png,"zotero-ia-mapa.png").catch(e=>selected.textContent="No se pudo guardar: "+e.message);}},"image/png");}catch(e){selected.textContent="No se pudo exportar: "+e.message;}finally{URL.revokeObjectURL(url);}};
      img.onerror=()=>{URL.revokeObjectURL(url);selected.textContent="No se pudo convertir el SVG a PNG";};img.src=url;
    }catch(e){selected.textContent="Error al exportar: "+e.message;}
  });
  header.appendChild(controls);root.appendChild(header);
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 740 420");svg.setAttribute("role","img");
  svg.setAttribute("aria-label","Red de autores, publicaciones y etiquetas");root.appendChild(svg);
  const canvas3d=document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
  canvas3d.className="graph-canvas3d";canvas3d.style.display="none";
  canvas3d.setAttribute("aria-label","Vista tridimensional de la red de conocimiento");
  canvas3d.setAttribute("role","img");root.appendChild(canvas3d);
  let view3d={yaw:0.4,pitch:0.2,distance:900};let drag3d=null;let projected3d=[];
  // Similarity here means shared Zotero metadata, not semantic similarity.
  function publicationGraph(){
    const publications=allNodes.filter(n=>n.type==='publication');
    const associations=new Map();
    for(const e of allEdges){
      const a=allNodesById.get(e.from),b=allNodesById.get(e.to);
      if(a&&b){
        if(a.type==='publication'&&b.type!=='publication'){
          if(!associations.has(b.id)) associations.set(b.id,new Set());
          associations.get(b.id).add(a.id);
        }else if(b.type==='publication'&&a.type!=='publication'){
          if(!associations.has(a.id)) associations.set(a.id,new Set());
          associations.get(a.id).add(b.id);
        }
      }
    }
    const pairs=new Map();
    for(const pubs of associations.values()){
      const ids=Array.from(pubs);
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
        const key=[ids[i],ids[j]].sort().join('|||');
        pairs.set(key,(pairs.get(key)||0)+1);
      }
    }
    const edges=[];
    for(const [key,weight] of pairs){const [from,to]=key.split('|||');edges.push({from,to,weight});}
    return {nodes:publications,edges,mode:'publications'};
  }
  function graphData(){
    let graph;
    if(activeFilter==='publication')graph=publicationGraph();
    else if(activeFilter==='all')graph={nodes:[...allNodes],edges:[...allEdges],mode:'all'};
    else{
      const seedIds=new Set(allNodes.filter(n=>n.type===activeFilter).map(n=>n.id));
      const relatedIds=new Set(seedIds),edges=[];
      for(const e of allEdges)if(seedIds.has(e.from)||seedIds.has(e.to)){
        edges.push(e);relatedIds.add(e.from);relatedIds.add(e.to);
      }
      graph={nodes:allNodes.filter(n=>relatedIds.has(n.id)),edges,mode:'filter'};
    }
    if(!focusNodeId)return graph;
    const ids=new Set([focusNodeId]);
    for(const e of graph.edges){if(e.from===focusNodeId)ids.add(e.to);if(e.to===focusNodeId)ids.add(e.from);}
    return {nodes:graph.nodes.filter(n=>ids.has(n.id)),edges:graph.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),mode:'focus'};
  }
  const nodePosition=(n,i,total)=>{
    // Stable sphere-like placement, reproducible across filter selections.
    const a=i*2.399963229728653,z=1-2*(i+.5)/Math.max(1,total);
    const r=Math.sqrt(Math.max(0,1-z*z));
    return [240*r*Math.cos(a),240*r*Math.sin(a),240*z];
  };
  const selectNode=(n)=>{
    focusNodeId=n.id;clearFocusBtn.disabled=false;
    while(selected.firstChild)selected.removeChild(selected.firstChild);
    const title=document.createElementNS("http://www.w3.org/1999/xhtml","strong");
    title.textContent=n.label+(n.year?" ("+n.year+")":"");selected.appendChild(title);
    selected.classList.add('graph-selection');
    const meta=document.createElementNS("http://www.w3.org/1999/xhtml","div");
    const neighbors=new Set();for(const e of graphData().edges){if(e.from===n.id)neighbors.add(e.to);if(e.to===n.id)neighbors.add(e.from);}
    meta.textContent=(n.type==='author'?'Autor':n.type==='publication'?'Publicación':'Concepto')+' · '+neighbors.size+' conexiones directas';selected.appendChild(meta);
    if(n.item_id){const b=document.createElementNS("http://www.w3.org/1999/xhtml","button");b.type="button";b.textContent="Abrir referencia en Zotero";b.addEventListener("click",()=>openCreatedNote(n.item_id));selected.appendChild(b);}
    if(graphMode==='3d')draw3d();else draw();
  };
  function draw3d(){
    if(graphMode!=="3d")return;
    const rect=canvas3d.getBoundingClientRect();const w=Math.max(320,Math.round(rect.width)),h=Math.max(260,Math.round(rect.height));
    const dpr=Math.min(2,window.devicePixelRatio||1);canvas3d.width=Math.round(w*dpr);canvas3d.height=Math.round(h*dpr);
    const ctx=canvas3d.getContext("2d");if(!ctx)return;ctx.scale(dpr,dpr);
    const theme=getComputedStyle(root);const dark=(theme.getPropertyValue("--zia-bg")||"").trim();
    ctx.fillStyle=dark||"#f6f8fb";ctx.fillRect(0,0,w,h);
    const graph=graphData();
    const nodes=graph.nodes, edges=graph.edges;
    const ca=Math.cos(view3d.yaw),sa=Math.sin(view3d.yaw),cp=Math.cos(view3d.pitch),sp=Math.sin(view3d.pitch);
    projected3d=nodes.map((n,i)=>{const [x,y,z]=nodePosition(n,i,nodes.length);
      const xx=x*ca-z*sa,zz=x*sa+z*ca,yy=y*cp-zz*sp,depth=y*sp+zz*cp;
      const scale=Math.min(w/680,h/580)*view3d.distance/(view3d.distance-depth);
      return {node:n,x:w/2+xx*scale,y:h/2+yy*scale,depth,scale};});
    const lookup=new Map(projected3d.map(p=>[p.node.id,p]));
    ctx.lineWidth=1.2;
    for(const edge of edges){const a=lookup.get(edge.from),b=lookup.get(edge.to);if(!a||!b)continue;const focus=(focusNodeId&&(edge.from===focusNodeId||edge.to===focusNodeId));ctx.strokeStyle=focus?"rgba(46,125,197,.60)":"rgba(115,138,153,.20)";ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    projected3d.sort((a,b)=>a.depth-b.depth);
    for(const p of projected3d){const color=palette[p.node.type]||"#7b8791";const focused=focusNodeId&&p.node.id===focusNodeId;const neighbor=focusNodeId&&edges.some(e=>(e.from===focusNodeId&&e.to===p.node.id)||(e.to===focusNodeId&&e.from===p.node.id));
      ctx.globalAlpha=focusNodeId?(focused||neighbor?1:.18):1;
      ctx.beginPath();ctx.arc(p.x,p.y,focused?Math.max(6,10*p.scale):Math.max(4,7*p.scale),0,2*Math.PI);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=focused?"rgba(29,59,91,.95)":"rgba(255,255,255,.8)";ctx.lineWidth=focused?2.4:1.5;ctx.stroke();
      ctx.font=(focused?"700 13px sans-serif":"12px sans-serif");ctx.fillStyle=dark.includes("#1")?"#f0f4f6":"#253443";
      const label=p.node.label.length>34?p.node.label.slice(0,34)+"…":p.node.label;ctx.fillText(label,Math.max(8,Math.min(p.x+10,w-ctx.measureText(label).width-8)),Math.max(14,Math.min(p.y+4,h-8)));
      ctx.globalAlpha=1;
    }
    info.textContent=`Vista 3D · ${nodes.length} nodos · ${edges.length} enlaces · Arrastra para girar · Ctrl/Meta + rueda para zoom. ${focusNodeId?"Foco activado: se muestran relaciones directas.":graph.mode==='filter'?"Filtro contextual: se muestran nodos relacionados.":"Las relaciones son de metadatos, no inferencias documentales."}`;
  }
  canvas3d.addEventListener("wheel",e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();view3d.distance=Math.max(350,Math.min(2000,view3d.distance*(e.deltaY>0?1.12:.89)));draw3d();},{passive:false});
  canvas3d.addEventListener("pointerdown",e=>{drag3d={x:e.clientX,y:e.clientY,yaw:view3d.yaw,pitch:view3d.pitch,moved:false};canvas3d.setPointerCapture(e.pointerId);});
  canvas3d.addEventListener("pointermove",e=>{if(!drag3d)return;const dx=e.clientX-drag3d.x,dy=e.clientY-drag3d.y;drag3d.moved=drag3d.moved||Math.abs(dx)+Math.abs(dy)>5;view3d.yaw=drag3d.yaw+dx*.008;view3d.pitch=Math.max(-1.45,Math.min(1.45,drag3d.pitch+dy*.008));draw3d();});
  canvas3d.addEventListener("pointerup",e=>{if(drag3d&&!drag3d.moved){const rect=canvas3d.getBoundingClientRect();const x=e.clientX-rect.left,y=e.clientY-rect.top;let best=null,dist=18;for(const p of projected3d){const d=Math.hypot(p.x-x,p.y-y);if(d<dist){dist=d;best=p;}}if(best)selectNode(best.node);}drag3d=null;});
  canvas3d.addEventListener("pointercancel",()=>drag3d=null);
  let drag=null;
  svg.addEventListener("wheel",e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom(e.deltaY<0?.85:1.18);},{passive:false});
  svg.addEventListener("pointerdown",e=>{if(e.target.closest && e.target.closest("g[role=button]"))return;drag={x:e.clientX,y:e.clientY,ox:camera.x,oy:camera.y};svg.setPointerCapture(e.pointerId);});
  svg.addEventListener("pointermove",e=>{if(!drag)return;const rect=svg.getBoundingClientRect();camera.x=drag.ox-(e.clientX-drag.x)*camera.w/rect.width;camera.y=drag.oy-(e.clientY-drag.y)*camera.h/rect.height;view();});
  svg.addEventListener("pointerup",()=>drag=null);svg.addEventListener("pointercancel",()=>drag=null);
  const info=document.createElementNS("http://www.w3.org/1999/xhtml","div");info.className="graph-info";root.appendChild(info);
  const selected=document.createElementNS("http://www.w3.org/1999/xhtml","div");selected.className="graph-info";root.appendChild(selected);
  const allNodes=data.nodes||[], allEdges=data.edges||[];
  const allNodesById=new Map(allNodes.map(n=>[n.id,n]));
  const palette={author:"#39856e",publication:"#397bb9",concept:"#ad7c32"};
  const make=(tag,attrs={})=>{const e=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [k,v] of Object.entries(attrs)) e.setAttribute(k,String(v));return e;};
  // Force-directed layout based only on recorded Zotero metadata relationships.
  // Positions are cached across filter/focus changes to avoid disorienting jumps.
  const positionCache=new Map();
  function layoutGraph(){
    const N=allNodes.length, W=740,H=420;
    if(!N)return;
    const seed=allNodes.map((n,i)=>{const a=i*2.3999632297;const r=32+Math.sqrt((i+.5)/N)*155;return {id:n.id,x:W/2+Math.cos(a)*r*1.75,y:H/2+Math.sin(a)*r,vx:0,vy:0};});
    const pos=new Map(seed.map(n=>[n.id,n]));
    const links=allEdges.map(e=>[pos.get(e.from),pos.get(e.to)]).filter(e=>e[0]&&e[1]);
    for(let step=0;step<155;step++){
      const cool=.48*(1-step/180);
      for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
        const a=seed[i],b=seed[j],dx=a.x-b.x,dy=a.y-b.y,d2=Math.max(180,dx*dx+dy*dy),d=Math.sqrt(d2);
        const force=3400/d2;
        a.vx+=dx/d*force;b.vx-=dx/d*force;a.vy+=dy/d*force;b.vy-=dy/d*force;
      }
      for(const [a,b] of links){const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),spring=(d-83)*.007;a.vx+=dx/d*spring;b.vx-=dx/d*spring;a.vy+=dy/d*spring;b.vy-=dy/d*spring;}
      for(const a of seed){a.vx+=(W/2-a.x)*.0009;a.vy+=(H/2-a.y)*.0009;a.x=Math.max(24,Math.min(W-24,a.x+a.vx*cool));a.y=Math.max(24,Math.min(H-24,a.y+a.vy*cool));a.vx*=.64;a.vy*=.64;}
    }
    for(const n of seed)positionCache.set(n.id,[n.x,n.y]);
  }
  layoutGraph();
  // Reposition only the publication nodes using their shared-metadata links.
  // This leaves the complete metadata graph available under "Todos".
  const publicationPositions=new Map();
  function layoutPublications(){
    const graph=publicationGraph(), N=graph.nodes.length;
    if(!N)return;
    const W=740,H=420;
    const points=graph.nodes.map((n,i)=>{const a=i*2.3999632297,r=30+125*Math.sqrt((i+.5)/N);return {id:n.id,x:W/2+Math.cos(a)*r*1.7,y:H/2+Math.sin(a)*r,vx:0,vy:0};});
    const lookup=new Map(points.map(p=>[p.id,p]));
    for(let iteration=0;iteration<200;iteration++){
      const cooling=.34*(1-iteration/240);
      for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
        const a=points[i],b=points[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.max(10,Math.hypot(dx,dy));
        const force=5600/(dist*dist);a.vx+=dx/dist*force;b.vx-=dx/dist*force;a.vy+=dy/dist*force;b.vy-=dy/dist*force;
      }
      for(const edge of graph.edges){const a=lookup.get(edge.from),b=lookup.get(edge.to);if(!a||!b)continue;
        const dx=b.x-a.x,dy=b.y-a.y,dist=Math.max(1,Math.hypot(dx,dy)),spring=(dist-130)*(.005+Math.min(edge.weight||1,5)*.001);
        a.vx+=dx/dist*spring;b.vx-=dx/dist*spring;a.vy+=dy/dist*spring;b.vy-=dy/dist*spring;
      }
      for(const p of points){p.vx+=(W/2-p.x)*.0008;p.vy+=(H/2-p.y)*.0008;p.x=Math.max(50,Math.min(W-110,p.x+p.vx*cooling));p.y=Math.max(40,Math.min(H-40,p.y+p.vy*cooling));p.vx*=.72;p.vy*=.72;}
    }
    for(const p of points)publicationPositions.set(p.id,[p.x,p.y]);
  }
  layoutPublications();
  function draw(){
    while(svg.firstChild)svg.removeChild(svg.firstChild);
    const graph=graphData(),nodes=graph.nodes,edges=graph.edges;
    const locations=activeFilter==='publication'?publicationPositions:positionCache;
    const neighbors=new Set();
    if(focusNodeId)for(const e of edges){if(e.from===focusNodeId)neighbors.add(e.to);if(e.to===focusNodeId)neighbors.add(e.from);}
    const edgeLayer=make('g',{'aria-hidden':'true'});svg.appendChild(edgeLayer);
    for(const e of edges){const a=locations.get(e.from),b=locations.get(e.to);if(!a||!b)continue;
      const direct=!!focusNodeId&&(e.from===focusNodeId||e.to===focusNodeId);
      edgeLayer.appendChild(make('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:direct?'#327e8b':'#7d9baa','stroke-opacity':direct?'.85':'.23','stroke-width':direct?'2.4':Math.min(2.2,1+(e.weight||1)*.2)}));
    }
    const degree=new Map();for(const e of allEdges){degree.set(e.from,(degree.get(e.from)||0)+1);degree.set(e.to,(degree.get(e.to)||0)+1);}
    for(const n of nodes){const pos=locations.get(n.id);if(!pos)continue;const [x,y]=pos;
      const focused=focusNodeId===n.id,related=neighbors.has(n.id),selectedType=activeFilter==='all'||n.type===activeFilter;
      const g=make('g',{tabindex:'0',role:'button','aria-label':n.label});
      g.style.cursor='pointer';g.setAttribute('opacity',focusNodeId&&!(focused||related)?'.16':(!selectedType&&!focusNodeId?'.63':'1'));
      const radius=Math.min(24,Math.max(9,9+Math.sqrt(degree.get(n.id)||0)*2.2));
      const c=make('circle',{cx:x,cy:y,r:focused?radius+3:radius,fill:palette[n.type]||'#78909c',stroke:focused?'#173f4e':'var(--zia-bg)','stroke-width':focused?'3':'2'});
      const tt=make('title');tt.textContent=n.label;g.appendChild(tt);g.appendChild(c);
      if(focused){g.appendChild(make('circle',{cx:x,cy:y,r:radius+7,fill:'none',stroke:'#267fa0','stroke-width':'1.5','stroke-opacity':'.9'}));}
      const showLabel=!focusNodeId||focused||related;
      if(showLabel){const label=make('text',{x:x+radius+5,y:y+4,'font-size':focused?'12':'10',fill:'var(--zia-text)','font-weight':focused?'700':'500'});label.textContent=n.label.length>29?n.label.slice(0,29)+'…':n.label;g.appendChild(label);}
      g.addEventListener('click',()=>selectNode(n));
      g.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectNode(n);}});
      g.addEventListener('mouseenter',()=>{if(!showLabel){const lab=make('text',{x:x+radius+5,y:y+4,'font-size':'11',fill:'var(--zia-text)','font-weight':'600','data-hover-label':'true'});lab.textContent=n.label.length>36?n.label.slice(0,36)+'…':n.label;g.appendChild(lab);}});
      g.addEventListener('mouseleave',()=>{const lab=g.querySelector('[data-hover-label]');if(lab)lab.remove();});
      svg.appendChild(g);
    }
    info.textContent=`${data.incluidos} publicaciones · ${nodes.length} nodos · ${edges.length} conexiones. Selecciona un nodo para enfocar sus relaciones. En Publicaciones, los enlaces indican metadatos compartidos, no similitud semántica. ${graph.mode==='filter'?'El filtro conserva los vínculos contextuales.':''} ${data.truncado?'Muestra limitada a una parte de la colección.':''}`;
  }
  draw();
  const note=document.createElementNS("http://www.w3.org/1999/xhtml","p");note.className="graph-info";
  note.textContent="Importante: las etiquetas representan términos catalogados, no prueban acuerdos, citas ni contradicciones. Estos requieren análisis verificable de documentos.";root.appendChild(note);
  log.scrollTop=log.scrollHeight;
}

function confirmUI(text,signal=ctrl?.signal?.aborted?null:ctrl?.signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(false);
    const box = add("ask", "");
    const activeSignal=signal;
    const cancel=()=>{box.textContent="Solicitud cancelada";resolve(false);};
    activeSignal?.addEventListener("abort",cancel,{once:true});
    const p = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    const summary = String(text).split(/\n(?:Herramienta|Detalles):/)[0];
    p.textContent = "Necesito tu permiso para: " + summary;
    if (text.length > summary.length) {
      const details = document.createElementNS("http://www.w3.org/1999/xhtml", "details");
      const title = document.createElementNS("http://www.w3.org/1999/xhtml", "summary");
      title.textContent = "Ver parámetros de la operación";
      const pre = document.createElementNS("http://www.w3.org/1999/xhtml", "pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.style.overflowWrap = "anywhere";
      pre.textContent = text.slice(summary.length).slice(0, 2500);
      details.appendChild(title); details.appendChild(pre); box.appendChild(p); box.appendChild(details);
    } else box.appendChild(p);
    for (const [label, val] of [["Sí, hazlo", true], ["No", false]]) {
      const b = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      b.textContent = label;
      b.addEventListener("click", () => { activeSignal?.removeEventListener("abort",cancel); box.textContent = (val ? "✔ Autorizado: " : "✘ Rechazado: ") + String(text).split(/\n(?:Herramienta|Detalles):/)[0]; resolve(val); });
      box.appendChild(b);
    }
  });
}

async function send(text) {
  if (busy || typeof text!=="string" || !text.trim()) return;
  ZIA.workspace?.show("chat");
  busy = true; ZIA.workspace?.setActivity("chat"); $("send").disabled = true; $("stop").disabled = false; $("q").value = "";
  ctrl = new AbortController();
  if (!ZIA.isConfigured()) { checkSetup(); busy = false; $("send").disabled = false; $("stop").disabled = true; return; }
  const w = $("welcome"); if (w) w.remove();
  add("u", text, true);
  chatHistory.push({ role: "user", content: text });
  ZIA.onWait = (secs) => { $("st").textContent = "⏳ Límite por minuto del plan gratuito: espero " + Math.round(secs) + " s y sigo…"; };
  try {
    chatHistory = await ZIA.runAgent(chatHistory, {
      signal: ctrl.signal,
      confirm: confirmUI,
      onEvent: (type, d) => {
        if (type === "plan") { add("t", "📋 Plan de tarea: " + d.plan.stages.join(" → "), true); }
        else if (type === "ejecutada") { $("st").textContent = "Operación completada"; if (d.name === "crear_nota") addCreatedNote(d.result); if (d.name === "mapa_conocimiento") renderKnowledgeMap(d.result); if (d.name === "buscar_pdf_disponible") { const box=add("pdf-result", ""); ZIA.pdfs.render(document,box,d.result); log.scrollTop=log.scrollHeight; } }
        else if (type === "rechazado") { add("t", "Operación rechazada: " + "la operación solicitada", true); }
        else if (type === "pensando") $("st").textContent = d.step === 0 ? "Pensando…" : "Trabajando… (paso " + (d.step + 1) + ")";
        else if (type === "herramienta") add("t", (LABELS[d.name] ? LABELS[d.name](d.args) : "Procesando la solicitud"), true);
        else if (type === "nota") add("a",d.text,false,true);
        else if (type === "error") add("e", "⚠ " + d.message, true);
        else if (type === "respuesta") add("a",d.text,false,true);
      },
    });
  } catch (e) {
    if (ctrl && ctrl.signal.aborted) add("t", "Tarea detenida por el usuario.", true);
    else if(e.name==="BudgetLimitError"){
      if(Array.isArray(e.history))chatHistory=e.history;
      add("t",e.message+" El contexto disponible se conserva mientras esta ventana siga abierta.",true);
      ZIA.workspace?.budgetNotice(e.budget,()=>send("Continúa la tarea anterior desde el contexto disponible. Comprueba el estado de cualquier operación interrumpida antes de repetir cambios y no repitas las operaciones ya finalizadas."),"Continuar en otra etapa");
    }
    else add("e", "Error: " + e.message, true);
  } finally {
    busy = false; $("send").disabled = false; $("stop").disabled = true; $("st").textContent = ZIA.lastModel ? "Modelo: "+ZIA.lastModel+(ZIA.lastFallback?" · respaldo":"") : ""; ZIA.onResearchChanged?.();
  }
}


// Importación local: selector de carpetas de Zotero/Firefox. No envía archivos a Gemini.
async function importPDFFolder() {
  const button=$('importPDFDir');
  if(button.disabled) return;
  if(busy){add('e','Termina primero la tarea actual del agente.',true);return;}
  const main=Services.wm.getMostRecentWindow('navigator:browser');
  const pane=main && (main.ZoteroPane||(main.Zotero&&main.Zotero.getActiveZoteroPane&&main.Zotero.getActiveZoteroPane()));
  const chosen=pane&&pane.getSelectedCollections?pane.getSelectedCollections():[];
  const col=chosen&&chosen[0];
  if(!col){add('e','Selecciona primero una colección de destino en Zotero.',true);return;}
  let folder;
  try {
    const C=Components.classes, I=Components.interfaces;
    const picker=C['@mozilla.org/filepicker;1'].createInstance(I.nsIFilePicker);
    // Gecko actual espera BrowsingContext en init(), no un objeto Window.
    const parentContext = (window && window.browsingContext) || (main && main.browsingContext);
    if (!parentContext) throw new Error('No se encontró el contexto de la ventana para seleccionar carpetas.');
    picker.init(parentContext,'Selecciona una carpeta con PDF',I.nsIFilePicker.modeGetFolder);
    const rv=await new Promise(resolve=>picker.open(resolve));
    if(rv!==I.nsIFilePicker.returnOK) return;
    folder=picker.file;
    if(!folder || !folder.exists() || !folder.isDirectory())throw new Error('No se pudo acceder a la carpeta.');
  } catch(e){add('e','No pude abrir la carpeta: '+e.message,true);return;}
  const files=[];const stack=[folder];const LIMIT=500;
  try {
    while(stack.length){
      const dir=stack.pop(),iter=dir.directoryEntries;
      while(iter.hasMoreElements()){
        const child=iter.getNext().QueryInterface(Components.interfaces.nsIFile);
        if(child.isDirectory()){if(!child.isSymlink())stack.push(child);}
        else if(child.isFile() && /\.pdf$/i.test(child.leafName)){files.push(child);if(files.length>LIMIT)throw new Error('Más de '+LIMIT+' PDF encontrados. Divide la carpeta para evitar una importación excesiva.');}
      }
    }
  } catch(e){add('e','Error al examinar carpetas: '+e.message,true);return;}
  if(!files.length){add('t','No encontré archivos PDF en esta carpeta.',true);return;}
  // Una autorización para el lote completo. Nunca elimina ni modifica archivos de origen.
  const approved=await confirmUI('Importar '+files.length+' PDF desde «'+folder.leafName+'» y sus subcarpetas a la colección «'+col.name+'»; intentar recuperar sus metadatos mediante el sistema nativo de Zotero. Los originales permanecerán en su carpeta.');
  if(!approved)return;
  button.disabled=true;
  const summary={total:files.length,importados:0,reconocidos:0,sin_identificar:0,omitidos:0,errores:[]};
  const imported=[];
  const report=add('t','Importando PDF: 0/'+files.length,true);
  try {
    // Duplicados conservadores: solo omitir archivos cuyos nombres ya estén entre los adjuntos de esta colección.
    const existing=new Set();
    for(const item of col.getChildItems()){
      if(item.isAttachment&&item.isAttachment()&&item.attachmentContentType==='application/pdf'){
        try{const path=await item.getFilePathAsync();if(path)existing.add(path.split(/[\\/]/).pop().toLocaleLowerCase());}catch(_){}
      }
    }
    for(let i=0;i<files.length;i++){
      const f=files[i];
      if(existing.has(f.leafName.toLocaleLowerCase())){summary.omitidos++;continue;}
      try{
        const item=await Zotero.Attachments.importFromFile({file:f,libraryID:col.libraryID,collections:[col.id],title:f.leafName});
        if(item){imported.push(item);summary.importados++;existing.add(f.leafName.toLocaleLowerCase());}
        else summary.errores.push(f.leafName+': no se creó adjunto');
      }catch(e){summary.errores.push(f.leafName+': '+e.message);}
      report.textContent='Importando PDF: '+(i+1)+'/'+files.length+' · Correctos: '+summary.importados+' · Errores: '+summary.errores.length;
    }
    const engine=Zotero.RecognizeDocument||Zotero.RecognizePDF;
    if(engine&&typeof engine.recognizeItems==='function'){
      for(let i=0;i<imported.length;i+=10){
        const batch=imported.slice(i,i+10);
        try{await engine.recognizeItems(batch);}catch(e){summary.errores.push('Reconocimiento lote '+(i/10+1)+': '+e.message);}
        for(const item of batch){
          const fresh=Zotero.Items.get(item.id);
          if(fresh&&fresh.parentID)summary.reconocidos++;else summary.sin_identificar++;
        }
      }
    }else{
      summary.sin_identificar=imported.length;
      summary.errores.push('Zotero no expone RecognizeDocument.recognizeItems en esta instalación. Puedes reconocer los PDF después con la función nativa.');
    }
    report.textContent='Importación en «'+col.name+'»: '+summary.importados+' PDF importados · '+summary.reconocidos+' con referencia padre detectada · '+summary.sin_identificar+' todavía independientes · '+summary.omitidos+' omitidos · '+summary.errores.length+' incidencias.';
    if(summary.sin_identificar>0)add('t','Hay '+summary.sin_identificar+' PDF independientes. Son archivos importados, no entradas bibliográficas completas. Puedes pedir: «Reconoce los PDF independientes de esta colección», o seleccionar esos PDF en Zotero y usar «Recuperar metadatos de PDF».',true);
    if(summary.errores.length)add('e','Incidencias (primeras 20):\n'+summary.errores.slice(0,20).join('\n'),true);
    add('t','Los PDF originales siguen en su carpeta. Los duplicados se comparan solo por nombre dentro de esta colección; revisa los posibles duplicados bibliográficos con Zotero.',true);
  }finally{button.disabled=false;}
}
$('importPDFDir').addEventListener('click',()=>importPDFFolder().catch(e=>add('e','Error de importación: '+e.message,true)));

$("send").addEventListener("click", () => send($("q").value));
$("q").addEventListener("keydown", e => {
  // Enter envía; Shift+Enter agrega salto de línea. Ignorar composición IME.
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (!busy) send($("q").value);
});
$("stop").addEventListener("click", () => ctrl && ctrl.abort());
$("clear").addEventListener("click", () => { if (busy) return; chatHistory=[]; log.replaceChildren(); $("q").value=""; add("t","Conversación nueva. Escribe una instrucción o abre los ejemplos de tareas.",true); $("q").focus(); });
for (const b of document.querySelectorAll(".goal button")) b.addEventListener("click", () => {
  const t = b.dataset.t;
  if (b.dataset.map === "true") { send("Construye el mapa interactivo de conocimiento de la colección seleccionada con mapa_conocimiento, sin inventar relaciones que no estén documentadas."); return; }
  if (!t) return;
  if (/:\s*$/.test(t)) { $("q").value = t; $("q").focus(); } else send(t);
});
function checkSetup() { $("setup").hidden = ZIA.isConfigured(); }
$("setupBtn").addEventListener("click", () => ZIA.openPrefs());
window.addEventListener("focus", checkSetup);
checkSetup();

// Historial local resumido; no almacena textos de los PDF.
try {
  const recent = ZIA.taskJournal.load().slice(-5).reverse();
  if (recent.length) {
    const box = add("t", "Historial reciente: " + recent.map(t => t.status + " (" + t.reads + " lecturas, " + t.writes + " cambios)").join(" · "), true);
    box.title = "Resumen de ejecuciones anteriores";
  }
} catch (_) {}

window.addEventListener("unload",()=>ctrl?.abort());
