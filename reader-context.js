/* global Zotero, ZoteroIA, Services */
(function(Z){
 "use strict";
 const pdf=item=>item&&!item.deleted&&item.isAttachment?.()&&item.attachmentContentType==="application/pdf";
 const field=(item,name)=>String(item?.getField(name)||"");
 const R=Z.readerContext={
  command(value){
   const text=String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ').replace(/[.!?]+$/,'').replace(/^(?:por favor,? )/,'').replace(/,? por favor$/,'');
   return /^(?:crea(?:r)?|genera(?:r)?|haz|hacer|guarda(?:r)?) (?:una |la )?nota (?:a partir de|con|desde|de) (?:todas? )?(?:las |los |mis )?(?:anotaciones|subrayados|resaltados)(?: y (?:comentarios|subrayados))?(?: (?:de este|de ese|del|de mi) (?:pdf|documento|archivo)(?: (?:abierto|actual|que tengo abierto|que esta abierto))?)?$/.test(text)?{}:null;
  },
  targetID(options={}){
   const context=options.toolContext;
   return context&&Object.prototype.hasOwnProperty.call(context,'readerPDFID')?context.readerPDFID:this.activePDFID();
  },
  isReaderRequest:text=>/anotaci[oó]n|anotaciones|subrayad|resaltad|pdf.*abiert|documento.*abiert/i.test(String(text||"")),
  activePDFID(){
   const fromWindow=win=>{
    if(!win||win.closed)return undefined;
    const type=win.document?.documentElement?.getAttribute("windowtype");
    if(type==="zotero:reader")return Number(win.reader?.itemID||win.reader?._itemID)||null;
    if(type==="navigator:browser"||win.Zotero_Tabs){
     const reader=Zotero.Reader?.getByTabID(win.Zotero_Tabs?.selectedID);
     return Number(reader?.itemID||reader?._itemID)||null;
    }
    return undefined;
   };
   try{for(const win of Services.wm.getZOrderDOMWindowEnumerator(null,true)){const id=fromWindow(win);if(id!==undefined)return id;}}catch(_){}
   try{const id=fromWindow(Services.wm.getMostRecentWindow(null));if(id!==undefined)return id;}catch(_){}
   try{return fromWindow(Zotero.getMainWindow?.())||null;}catch(_){return null;}
  },
  async resolve(itemID,options={}){
   Z.checkAbort(options.signal);
   const explicit=itemID!=null;
   let id=explicit?Number(itemID):this.targetID(options);
   if(!Number.isInteger(id)||id<=0)throw Error("No se identifica un PDF activo. Abre su pestaña en Zotero o indica la referencia que quieres usar.");
   let item=await Zotero.Items.getAsync(id),attachment=item;
   if(item?.isAnnotation?.())attachment=await Zotero.Items.getAsync(item.parentID);
   if(item?.isRegularItem?.()){
    const activeID=this.targetID(options);
    const active=activeID?await Zotero.Items.getAsync(activeID):null;
    if(pdf(active)&&active.parentID===item.id)attachment=active;
    else{
     const attachments=await Promise.all((item.getAttachments()||[]).map(id=>Zotero.Items.getAsync(id)));
     const candidates=attachments.filter(a=>pdf(a)&&a.parentID===item.id);
     if(candidates.length!==1)throw Error(candidates.length?"Esta referencia tiene varios PDF. Abre el que quieras usar o indica su ID de adjunto.":"La referencia no tiene un PDF adjunto disponible.");
     attachment=candidates[0];
    }
   }
   if(!pdf(attachment))throw Error("El PDF indicado ya no está disponible o no es un adjunto PDF.");
   const parent=attachment.parentID?await Zotero.Items.getAsync(attachment.parentID):null;
   if(attachment.parentID&&(!parent||parent.deleted||!parent.isRegularItem()))throw Error("La referencia padre del PDF ya no está disponible.");
   return {pdf:attachment,parent};
  },
  async annotations(context,{signal}={}){
   Z.checkAbort(signal);if(Zotero.Items.loadDataTypes)await Zotero.Items.loadDataTypes([context.pdf],["childItems"]);
   const all=context.pdf.getAnnotations().filter(a=>!a.deleted&&a.parentID===context.pdf.id);
   if(Zotero.Items.loadDataTypes)await Zotero.Items.loadDataTypes(all,["annotation"]);
   Z.checkAbort(signal);return all.sort((a,b)=>String(a.annotationSortIndex||a.key).localeCompare(String(b.annotationSortIndex||b.key)));
  },
  summary({pdf,parent}){return {pdf_id:pdf.id,pdf_key:pdf.key,titulo_pdf:field(pdf,"title"),item_id:parent?.id||null,titulo_referencia:parent?field(parent,"title"):null,biblioteca_id:pdf.libraryID};},
  async current(options={}){
   const id=this.targetID(options);if(!id)return null;
   const context=await this.resolve(id,options),annotations=await this.annotations(context,options);
   return {...this.summary(context),total_anotaciones:annotations.length};
  },
  async read({item_id,desde=0,limite=30}={},options={}){
   if(!Number.isInteger(desde)||desde<0||!Number.isInteger(limite)||limite<1||limite>50)throw Error("Usa una posición inicial válida y entre 1 y 50 anotaciones por consulta.");
   const context=await this.resolve(item_id,options),annotations=await this.annotations(context,options);
   return {...this.summary(context),total:annotations.length,desde,siguiente_desde:desde+limite<annotations.length?desde+limite:null,anotaciones:annotations.slice(desde,desde+limite).map(a=>{
    let position=null;try{position=typeof a.annotationPosition==="string"?JSON.parse(a.annotationPosition):a.annotationPosition;}catch(_){}
    const link=Z.research.link(context.pdf);
    return {id:a.id,key:a.key,tipo:a.annotationType,texto:String(a.annotationText||""),comentario_personal:String(a.annotationComment||""),etiqueta_pagina:String(a.annotationPageLabel||""),pagina_pdf:Number.isSafeInteger(position?.pageIndex)&&position.pageIndex>=0?position.pageIndex+1:null,color:a.annotationColor,url:link?link+"?annotation="+a.key:null};
   }),advertencia:"Los comentarios personales son del investigador; no se atribuyen al autor. Las anotaciones no equivalen al texto completo del PDF."};
  },
  async createNote({item_id}={},options={}){
   const context=await this.resolve(item_id,options),{pdf,parent}=context;Z.safe.editable(pdf.libraryID);
   const all=await this.annotations(context,options),annotations=all.filter(a=>a.annotationType!=="ink");
   if(!annotations.length)return {...this.summary(context),estado:"SIN_ANOTACIONES_EXPORTABLES",nota_id:null,total_anotaciones:all.length,mensaje:"Este PDF no tiene anotaciones exportables guardadas en Zotero. No se creó una nota."};
   if(typeof Zotero.EditorInstance?.createNoteFromAnnotations!=="function")throw Error("Esta versión de Zotero no ofrece la función para crear notas desde anotaciones.");
   const signature=()=>JSON.stringify(annotations.map(a=>a.toJSON()));
   const before=signature(),original={key:pdf.key,parentID:pdf.parentID||null,libraryID:pdf.libraryID};
   const native=await Zotero.EditorInstance.createNoteFromAnnotations(annotations,{noSave:true,parentID:parent?.id});
   Z.checkAbort(options.signal);
   const latest=await this.resolve(pdf.id,options),current=await this.annotations(latest,options);
   if(latest.pdf.key!==original.key||(latest.pdf.parentID||null)!==original.parentID||latest.pdf.libraryID!==original.libraryID||before!==JSON.stringify(current.filter(a=>a.annotationType!=="ink").map(a=>a.toJSON())))throw Error("El PDF o sus anotaciones cambiaron durante la preparación. Reintenta para guardar la versión actual.");
   const html=native.getNote();if(!html.trim())throw Error("Zotero no devolvió contenido para la nota. No se guardó nada.");
   const plan=await Z.safe.create([{type:"createNote",parentID:parent?.id,title:"Anotaciones · "+field(parent||pdf,"title"),markdown:""}],"Crear nota desde las anotaciones del PDF");
   const stored=Z.safe.current(plan.id),operation=stored.operations[0];operation.after.libraryID=pdf.libraryID;operation.after.note=html;
   await Z.research.write("changes",Z.research.changes);
   const result=await Z.safe.apply(plan.id,options,{name:"crear_nota",args:{}});
   return {...this.summary(context),estado:result.status,nota_id:result.nota_id||null,propuesta_id:result.planID,total_anotaciones:annotations.length,omitidas_tinta:all.length-annotations.length,sin_inferencia_ia:true,mensaje:result.status==="applied"?"Nota creada con las anotaciones originales y los enlaces generados por Zotero.":"No se creó la nota."};
  }
 };
 Z.tools.pdf_abierto={description:"Identifica el PDF que está abierto en el lector de Zotero, su referencia padre y número de anotaciones. No confunde la referencia con el ID del adjunto.",parameters:{type:"object",properties:{}},run:async(_args,opts)=>{const current=await R.current(opts);return current||{pdf_id:null,mensaje:"No hay un PDF activo identificado. Abre su pestaña en Zotero."};}};
 const target={item_id:{type:"integer",description:"ID del PDF o de su referencia. Si se omite, usa el PDF abierto al iniciar esta petición."}};
 Z.tools.leer_anotaciones_pdf={description:"Lee subrayados, comentarios y otras anotaciones guardadas en Zotero del PDF abierto o indicado. Acepta PDF adjunto, referencia padre o anotación; no requiere un archivo independiente ni DOI. Resultados paginados.",parameters:{type:"object",properties:{...target,desde:{type:"integer"},limite:{type:"integer"}}},run:(args,opts)=>R.read(args,opts)};
 Z.tools.crear_nota_desde_anotaciones={escribe:true,managesApproval:true,description:"Crea una nota de Zotero con TODAS las anotaciones exportables del PDF abierto o indicado y sus enlaces/citas nativos, sin pedir copiarlas ni reescribirlas con IA. Adjunta la nota a la referencia padre; admite PDF independiente. Se puede deshacer.",parameters:{type:"object",properties:{...target}},run:(args,opts)=>R.createNote(args,opts)};
 Z.agentGroups.anotaciones={pattern:/anotaci[oó]n|anotaciones|subrayad|resaltad|pdf.*abiert|documento.*abiert/i,names:["pdf_abierto","leer_anotaciones_pdf","crear_nota_desde_anotaciones"]};
 Z.tools.descubrir_herramientas.parameters.properties.categoria.enum.push("anotaciones");
 const selection=Z.tools.seleccion_actual.run;
 Z.tools.seleccion_actual.description+=" Incluye el PDF activo y distingue su ID del de la referencia padre.";
 Z.tools.seleccion_actual.run=async(args,opts={})=>({...await selection(args,opts),pdf_abierto:await R.current(opts)});
 const system=Z.agentSystem.bind(Z);Z.agentSystem=()=>system()+" Para anotaciones y subrayados usa pdf_abierto, leer_anotaciones_pdf o crear_nota_desde_anotaciones. Para crear una nota con las anotaciones usa directamente crear_nota_desde_anotaciones; exporta los originales y no necesita una lectura ni transcripción manual del PDF. El PDF puede estar adjunto a una referencia; no uses reconocimiento ni metadatos de PDF independientes para esta tarea. No afirmes que las anotaciones son inaccesibles sin intentar estas herramientas. Distingue texto subrayado y comentarios personales del investigador.";
 const context=Z.agentToolContext.bind(Z);Z.agentToolContext=history=>{
  const toolContext=context(history),goal=history.filter(m=>m.role==="user").slice(-3).map(m=>String(m.content||"")).join("\n");
  if(R.isReaderRequest(goal)&&!/independiente|contenedor|metadatos|reconoc/i.test(goal))for(const name of ["examinar_pdf_independiente","crear_referencia_desde_pdf","reconocer_pdf_coleccion","recuperar_metadatos_pdf"])toolContext.enabled.delete(name);
  return toolContext;
 };
 const agent=Z.runAgent.bind(Z);Z.runAgent=async function(history,options={}){
  const user=[...history].reverse().find(m=>m.role==='user'),args=R.command(user?.content);
  if(!args)return agent(history,options);
  Z.checkAbort(options.signal);
  const readerPDFID=R.activePDFID(),onEvent=options.onEvent||(()=>{}),task=Z.taskJournal.start(user.content);
  Z.taskJournal.update(task,{status:'running'});
  onEvent('plan',{id:task,plan:{stages:['Identificar el PDF abierto','Guardar sus anotaciones como nota de Zotero']}});
  try{
   const toolContext={readerPDFID},source=await R.current({...options,toolContext});
   if(!source)throw Error('No se identifica un PDF abierto. Activa su pestaña en el lector de Zotero y vuelve a enviar la orden.');
   onEvent('nota',{text:'PDF identificado: «'+(source.titulo_referencia||source.titulo_pdf)+'». Anotaciones guardadas: '+source.total_anotaciones+'.'});
   onEvent('herramienta',{name:'crear_nota_desde_anotaciones',args:{item_id:readerPDFID}});
   const result=await R.createNote({item_id:readerPDFID},{...options,toolContext});
   const saved=result.estado==='applied'&&Number.isInteger(result.nota_id)&&result.nota_id>0;
   Z.taskJournal.update(task,{status:result.estado==='rejected'?'rejected':'completed',reads:1,writes:saved?1:0,errors:0,rejected:result.estado==='rejected'?1:0});
   if(saved)onEvent('ejecutada',{name:'crear_nota_desde_anotaciones',write:true,result});
   const answer=saved?'Nota creada con '+result.total_anotaciones+(result.total_anotaciones===1?' anotación':' anotaciones')+' del PDF «'+(result.titulo_referencia||result.titulo_pdf)+'». Conserva los textos, comentarios, citas y enlaces de Zotero. '+(result.item_id?'La nota quedó asociada a su referencia.':'La nota quedó en la misma biblioteca que el PDF.')+' No se consultó a la IA.':result.mensaje||'No se creó la nota.';
   onEvent('respuesta',{text:answer});return history.concat({role:'assistant',content:answer});
  }catch(error){Z.taskJournal.update(task,{status:options.signal?.aborted?'cancelled':'failed',lastError:String(error.message).slice(0,300)});throw error;}
 };
 })(ZoteroIA);
