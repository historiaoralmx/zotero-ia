/* global Zotero, ZoteroIA */
(function(Z){
 "use strict";
 const R=Z.research,S=Z.safe,copy=R.clone;
 const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
 const data=x=>esc(encodeURIComponent(JSON.stringify(x)));
 const plain=x=>String(x||"").replace(/\s+/g," ").trim();
 const kinds={resumen:"Resumen generado por IA",interpretacion:"Interpretación de la IA",cita:"Cita literal"};
 const N=Z.citationNotes={
  readings:new Map(),
  async target(itemID){
   const item=await Zotero.Items.getAsync(Number(itemID));if(!item||item.deleted)throw Error("El documento original ya no está disponible.");
   const parent=item.isAttachment()?await Zotero.Items.getAsync(item.parentID):item;
   if(!parent||parent.deleted||!parent.isRegularItem())throw Error("El PDF necesita una referencia bibliográfica padre para generar citas vinculadas a Zotero.");
   return {item,parent};
  },
  entry(item){
   const uri=Zotero.URI.getItemURI(item),itemData=Zotero.Cite.System.prototype.retrieveItem(item);
   if(!uri||!itemData)throw Error("Zotero no pudo obtener los datos bibliográficos de la referencia.");
   return {uris:[uri],itemData};
  },
  async pageLabels(pdf,cache){
   if(cache.has(pdf.id))return cache.get(pdf.id);
   if(Zotero.Items.loadDataTypes)await Zotero.Items.loadDataTypes([pdf],["childItems"]);
   const annotations=(pdf.getAnnotations?.()||[]).filter(a=>!a.deleted&&a.parentID===pdf.id);
   if(Zotero.Items.loadDataTypes)await Zotero.Items.loadDataTypes(annotations,["annotation"]);
   const candidates=new Map();
   for(const annotation of annotations){let position=null;try{position=typeof annotation.annotationPosition==="string"?JSON.parse(annotation.annotationPosition):annotation.annotationPosition;}catch(_){}
    const label=plain(annotation.annotationPageLabel);
    if(!Number.isSafeInteger(position?.pageIndex)||position.pageIndex<0||!label||label.length>80)continue;
    const page=position.pageIndex+1;if(!candidates.has(page))candidates.set(page,new Set());candidates.get(page).add(label);
   }
   const labels=new Map([...candidates].filter(([,values])=>values.size===1).map(([page,values])=>[page,[...values][0]]));cache.set(pdf.id,labels);return labels;
  },
  async citation(block,evidence,parent,context){
   const refs=[...new Set(block.evidenceIDs||[])].map(id=>evidence.find(e=>e.id===id&&e.origin!=="comment")).filter(Boolean);
   if(!refs.length)throw Error("La lectura no conserva evidencia documental válida para este apartado. No se guardó la nota.");
   if(block.kind==="cita"&&!refs.some(e=>plain(e.text).includes(plain(block.text))))throw Error("Una cita literal no coincide con sus evidencias. No se guardó la nota.");
   const items=[],identities=new Set(),locations=[],links=[];
   for(const e of refs){
    let source=await Zotero.Items.getAsync(Number(e.itemID));
    if(!source||source.deleted)throw Error("Una referencia de las evidencias ya no está disponible.");
    if(source.isAttachment())source=await Zotero.Items.getAsync(source.parentID);
    if(!source?.isRegularItem()||source.deleted||source.id!==parent.id)throw Error("La evidencia no corresponde a la referencia de esta lectura.");
    const entry=this.entry(source);context.entries.set(entry.uris[0],entry);
    let locator=null;
    if(e.attachmentID){
     const pdf=await Zotero.Items.getAsync(e.attachmentID);
     if(!pdf||pdf.deleted||!pdf.isAttachment()||pdf.parentID!==source.id||pdf.libraryID!==source.libraryID)throw Error("El adjunto original de una evidencia cambió o ya no está disponible.");
     if(e.pageVerified===true&&Number.isSafeInteger(e.page)&&e.page>0){
      locator=(await this.pageLabels(pdf,context.labels)).get(e.page)||null;
      locations.push(locator?"Etiqueta de página en Zotero: "+locator:"Página física del PDF: "+e.page+"; numeración editorial sin comprobar");
     }
     const url=R.link(pdf,e.pageVerified?e.page:null);if(url)links.push({url,id:e.id});
    }else{const url=R.link(source);if(url)links.push({url,id:e.id});}
    const cite={uris:entry.uris,...(locator?{locator,label:"page"}:{})},identity=JSON.stringify(cite);
    if(!identities.has(identity)){identities.add(identity);items.push(cite);}
   }
   context.count++;
   const label=parent.getField("title")||"Referencia",citation={citationItems:items,properties:{}};
   const preview=items.map(item=>esc(label)+(item.locator?", p. "+esc(item.locator):"")).join("; ");
   return '<span class="citation" data-citation="'+data(citation)+'">(<span class="citation-item">'+preview+'</span>)</span>'+
    (locations.length?'<br/><small>'+esc([...new Set(locations)].join(" · "))+'</small>':'')+
    (links.length?'<br/>'+links.map(link=>'<a href="'+esc(link.url)+'">Ver evidencia '+esc(link.id)+'</a>').join(' · '):'');
  },
  async block(block,evidence,parent,context,{heading=true}={}){
   if(!plain(block.text)||!kinds[block.kind])return '<p><i>Sin evidencia documental suficiente para este apartado.</i></p>';
   const citation=await this.citation(block,evidence,parent,context);
   return (heading?'<h3>'+esc(block.label||"Lectura")+'</h3>':'')+'<p><small>'+esc(kinds[block.kind])+'</small></p>'+Z.md2html(block.text)+'<p>'+citation+'</p>';
  },
  context(){return {entries:new Map(),labels:new Map(),count:0};},
  document(title,body,context){
   if(!context.count)throw Error("No hay afirmaciones con evidencia documental para guardar una nota con citas.");
   return '<div data-schema-version="9" data-citation-items="'+data([...context.entries.values()])+'"><h1>'+esc(title)+'</h1>'+body+
    '<p><i>Generado por Zotero IA. Revisa las afirmaciones y sus fuentes. En Word usa Zotero → Insertar nota para incorporar las citas activas; los enlaces a evidencias sirven para volver al documento.</i></p></div>';
  },
  async persist(html,{parent=null,collection=null,libraryID,title},options={}){
   Z.checkAbort(options.signal);S.editable(libraryID);
   const plan=await S.create([{type:"createNote",parentID:parent?.id,collectionID:collection?.id,title,markdown:""}],"Guardar lectura con citas de Zotero");
   const stored=S.current(plan.id);stored.operations[0].after.note=html;stored.operations[0].after.libraryID=libraryID;
   await R.write("changes",R.changes);const result=await S.apply(plan.id,options,{name:"crear_nota",args:{}});
   return {status:result.status,nota_id:result.nota_id||null,propuesta_id:result.planID,citas_nativas:true,mensaje:result.status==="applied"?"Nota guardada con citas de Zotero. En Word pulsa Zotero → Insertar nota y elígela.":"No se guardó la nota."};
  },
  async saveReading(readingID,options={},expectedParent=null,title=null){
   const reading=this.readings.get(readingID);if(!reading)throw Error("Esta lectura ya no está disponible en esta sesión. Realiza de nuevo la lectura y después guarda la nota.");
   const {parent}=await this.target(reading.parentID);
   if(parent.key!==reading.parentKey||parent.libraryID!==reading.libraryID||expectedParent&&parent.id!==expectedParent.id)throw Error("La lectura no corresponde a la referencia original.");
   const context=this.context();let body='';
   for(const block of reading.blocks){Z.checkAbort(options.signal);body+=await this.block(block,reading.evidence,parent,context);}
   const comments=reading.evidence.filter(e=>e.origin==="comment");if(comments.length)body+='<h2>Comentarios personales del investigador</h2>'+comments.map(e=>'<p>'+esc(e.text)+'</p>').join('');
   if(reading.scope)body+='<p><strong>Alcance:</strong> '+esc(reading.scope)+'</p>';
   const heading=title||reading.title;return this.persist(this.document(heading,body,context),{parent,libraryID:parent.libraryID,title:heading},options);
  },
  async row(run,itemID,context,options={}){
   const row=run.rows.find(r=>r.itemID===itemID);if(!row||row.status!=="done")throw Error("Este documento no tiene una ficha terminada para guardar.");
   const {item,parent}=await this.target(itemID);
   if(row.key!==item.key||row.libraryID!==item.libraryID)throw Error("La referencia original de la ficha cambió o ya no está disponible.");
   const blocks=Z.matrixColumns.forRun(run).map(c=>({label:c.label,...row.fields[c.key]})),parts=[];
   for(const block of blocks){Z.checkAbort(options.signal);parts.push(await this.block(block,row.evidence||[],parent,context,{heading:false}));}
   return {row,parent,blocks,parts};
  },
  async saveRow(runID,itemID,options={}){
   const run=copy(R.getRun(runID)),context=this.context(),record=await this.row(run,itemID,context,options);
   const title="Ficha de lectura · "+record.row.title,body='<p>Objetivo: '+esc(run.objective)+'</p>'+record.parts.map((part,i)=>'<h2>'+esc(record.blocks[i].label)+'</h2>'+part).join('');
   return this.persist(this.document(title,body,context),{parent:record.parent,libraryID:record.parent.libraryID,title},options);
  },
  async saveRun(runID,collectionID,options={}){
   const run=copy(R.getRun(runID));let collection=null,libraryID=null;
   const destination=collectionID||(run.collections.length===1?run.collections[0].id:null);
   if(destination){collection=Zotero.Collections.get(Number(destination));if(!collection||collection.deleted)throw Error("La colección de destino ya no está disponible.");libraryID=collection.libraryID;}
   else{const libraries=[...new Set(run.collections.map(c=>c.libraryID))];if(libraries.length!==1)throw Error("Elige una colección de destino para esta nota de varias bibliotecas.");libraryID=libraries[0];}
   S.editable(libraryID);const context=this.context(),columns=Z.matrixColumns.forRun(run);
   let body='<p>Objetivo: '+esc(run.objective)+'</p><table><thead><tr><th>Documento</th>'+columns.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>';
   for(const ref of run.items){Z.checkAbort(options.signal);const row=run.rows.find(r=>r.itemID===ref.id);
    if(row?.status!=="done"){body+='<tr><th>'+esc(row?.title||ref.title||ref.key)+'</th><td colspan="'+columns.length+'">Análisis pendiente o no disponible.</td></tr>';continue;}
    const record=await this.row(run,ref.id,context,options);body+='<tr><th>'+esc(record.row.title)+'</th>'+record.parts.map(part=>'<td>'+part+'</td>').join('')+'</tr>';
   }
   body+='</tbody></table>';const title="Tabla comparativa · "+run.objective;
   return this.persist(this.document(title,body,context),{collection,libraryID,title},options);
  }
 };
 const ask=Z.ask.bind(Z);Z.ask=async function(...args){
  const result=await ask(...args),ctx=result.ctx;
  if(ctx?.parent?.isRegularItem()&&ctx.citationBlocks?.some(block=>plain(block.text)&&block.evidenceIDs?.length)){
   ctx.readingID=R.id("citable-reading");N.readings.set(ctx.readingID,{parentID:ctx.parent.id,parentKey:ctx.parent.key,libraryID:ctx.parent.libraryID,title:String(args[1]||"Lectura"),blocks:copy(ctx.citationBlocks),evidence:copy(ctx.evidence||[]),scope:[ctx.readingCoverageText,ctx.coverage?.method].filter(Boolean).join(" · ")});
   while(N.readings.size>20)N.readings.delete(N.readings.keys().next().value);
  }
  return result;
 };
 const saveNote=Z.saveNote.bind(Z);Z.saveNote=(parent,title,markdown,options={})=>options.readingResult?N.saveReading(options.readingResult.ctx?.readingID,options,parent,title):saveNote(parent,title,markdown,options);
 Z.tools.guardar_lectura_como_nota={escribe:true,managesApproval:true,description:"Guarda una lectura ya realizada por leer_item como nota con citas nativas de Zotero para Word → Insertar nota. Usa el lectura_id devuelto por leer_item; no vuelve a generar la síntesis ni inventa citas desde Markdown.",parameters:{type:"object",properties:{lectura_id:{type:"string"},titulo:{type:"string"}},required:["lectura_id"]},run:(a,o)=>N.saveReading(a.lectura_id,o,null,a.titulo)};
 Z.tools.guardar_ficha_como_nota={escribe:true,managesApproval:true,description:"Guarda la ficha terminada de un documento de una tarea de lectura como nota hija con citas nativas, evidencia y deshacer. No recalcula la ficha. Para Word usa Insertar nota.",parameters:{type:"object",properties:{tarea_id:{type:"string"},item_id:{type:"integer"}},required:["tarea_id","item_id"]},run:(a,o)=>N.saveRow(a.tarea_id,a.item_id,o)};
 Z.tools.guardar_tabla_como_nota={escribe:true,managesApproval:true,description:"Guarda una tabla comparativa existente en una nota de Zotero con citas nativas por apartado. Solo cita fichas terminadas con evidencia; no inventa resultados pendientes. Usa la colección de la tarea si es única, o coleccion_id como destino explícito.",parameters:{type:"object",properties:{tarea_id:{type:"string"},coleccion_id:{type:"integer"}},required:["tarea_id"]},run:(a,o)=>N.saveRun(a.tarea_id,a.coleccion_id,o)};
 Z.agentGroups.lectura.names.push("guardar_lectura_como_nota","guardar_ficha_como_nota","guardar_tabla_como_nota");
 Z.agentGroups.lectura.pattern=new RegExp(Z.agentGroups.lectura.pattern.source+"|ficha|s[ií]ntesis|matri(?:z|ces)","i");
 const system=Z.agentSystem.bind(Z);Z.agentSystem=()=>system()+" Para guardar una síntesis o ficha con citas nativas usa guardar_lectura_como_nota con el lectura_id de leer_item. Para análisis guardados usa guardar_ficha_como_nota o guardar_tabla_como_nota. Son notas compatibles con Zotero → Insertar nota en Word, no una inserción directa en Word. Los enlaces zotero:// por sí solos no son citas nativas. No inventes páginas editoriales desde la numeración física del PDF.";
})(ZoteroIA);
