/* global Zotero, ZoteroIA, Services */
(function(Z){
 const R=Z.research, same=(a,b)=>R.stable(a)===R.stable(b);
 const copy=R.clone;
 const nice=v=>typeof v==="string"?v:JSON.stringify(v);
 Z.safe={
  snapshot(item){const data=copy(item.toJSON());for(const k of ["key","version","dateAdded","dateModified","collections","creators","tags","relations"])delete data[k];
   return {id:item.id,key:item.key,libraryID:item.libraryID,data,creators:item.getCreatorsJSON(),tags:item.getTags(),collections:item.getCollections().slice().sort((a,b)=>a-b),relations:item.getRelations(),notes:item.isRegularItem()?item.getNotes().slice().sort((a,b)=>a-b):[],attachments:item.isRegularItem()?item.getAttachments().slice().sort((a,b)=>a-b):[]};
  },
  editable(libraryID){const library=Zotero.Libraries.get(libraryID);if(!library||library.editable===false)throw Error("La biblioteca no permite modificaciones.");},
  async create(patches,label="Cambios propuestos"){
   R.assertWritable?.("changes");
   if(!Array.isArray(patches)||!patches.length||patches.length>100)throw Error("Propón entre 1 y 100 operaciones.");const operations=[],used=new Set();
   for(const patch of patches){
    if(patch.type==="item"){
     const item=await Zotero.Items.getAsync(Number(patch.id));if(!item||item.deleted||!item.isRegularItem())throw Error("La referencia no existe.");this.editable(item.libraryID);if(used.has(item.id))throw Error("Agrupa los cambios de una referencia en una sola operación.");used.add(item.id);
     const before=this.snapshot(item),after=copy(before);
     for(const [field,value] of Object.entries(patch.fields||{})){if(!Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(field),item.itemTypeID))throw Error("Campo no admitido: "+field);if(typeof value!=="string"||value.length>100000)throw Error("Valor inválido para "+field);
      if(field==="date"&&Z.datePrecision(before.data.date)>Z.datePrecision(value))throw Error("Se conserva la fecha más precisa; no se permite reducirla automáticamente.");if(value)after.data[field]=value;else delete after.data[field];}
     if(patch.creators){if(!Array.isArray(patch.creators)||patch.creators.length>200)throw Error("Creadores inválidos");after.creators=copy(patch.creators);}
     if(patch.tags){if(!Array.isArray(patch.tags))throw Error("Etiquetas inválidas");after.tags=patch.tags.map(t=>typeof t==="string"?{tag:t,type:0}:copy(t));if(after.tags.some(t=>!String(t.tag||"").trim()||t.tag.length>200))throw Error("Etiqueta vacía o demasiado larga");}
     if(patch.collections){after.collections=[...new Set(patch.collections.map(Number))].sort((a,b)=>a-b);for(const cid of after.collections){const c=Zotero.Collections.get(cid);if(!c||c.libraryID!==item.libraryID)throw Error("La colección destino no pertenece a la biblioteca del ítem.");}}
     if(patch.relations){after.relations=copy(patch.relations);}
     if(!same(before,after))operations.push({type:"item",before,after});
    }else if(patch.type==="createItem"){
     const record=Z.libraryTools.prepareRecord(patch);
     this.editable(record.libraryID);
     operations.push({type:"createItem",before:null,after:record});
    }else if(patch.type==="setDeleted"){
     const item=await Zotero.Items.getAsync(Number(patch.id));
     if(!item||!item.isRegularItem())throw Error("Referencia inexistente o tipo no bibliográfico.");
     this.editable(item.libraryID);
     if(typeof patch.deleted!=="boolean")throw Error("Estado de papelera inválido.");
     await Z.libraryTools.assertTrashChange(item,patch.deleted);
     if(used.has(item.id))throw Error("Referencia repetida.");used.add(item.id);
     if(!!item.deleted!==patch.deleted)operations.push({type:"setDeleted",before:this.snapshot(item),after:{libraryID:item.libraryID,deleted:patch.deleted}});
    }else if(patch.type==="renameCollection"){
     const c=Zotero.Collections.get(Number(patch.id));if(!c||c.deleted)throw Error("Colección inexistente");this.editable(c.libraryID);const name=String(patch.name||"").trim();if(!name||name.length>255)throw Error("Nombre inválido");if(used.has("c"+c.id))throw Error("Colección repetida");used.add("c"+c.id);
     operations.push({type:"renameCollection",before:{id:c.id,key:c.key,libraryID:c.libraryID,name:c.name,parentID:c.parentID||null},after:{id:c.id,key:c.key,libraryID:c.libraryID,name,parentID:c.parentID||null}});
    }else if(patch.type==="createNote"){
     const parent=patch.parentID?await Zotero.Items.getAsync(Number(patch.parentID)):null;const collection=patch.collectionID?Zotero.Collections.get(Number(patch.collectionID)):null;
     if(patch.parentID&&(!parent||!parent.isRegularItem()))throw Error("Referencia padre inválida");if(patch.collectionID&&!collection)throw Error("Colección inválida");
     const libraryID=parent?.libraryID||collection?.libraryID||Zotero.Libraries.userLibraryID;this.editable(libraryID);
     operations.push({type:"createNote",before:null,after:{libraryID,parentID:parent?.id||null,parentKey:parent?.key||null,parentTitle:parent?.getField("title")||null,collectionID:collection?.id||null,key:Zotero.Utilities.generateObjectKey(),note:"<h1>"+Z.md2html(String(patch.title||"Nota")).replace(/<\/?p>/g,"")+"</h1>"+Z.md2html(String(patch.markdown||""))}});
    }else if(patch.type==="createCollection"){
     const parent=patch.parentID?Zotero.Collections.get(Number(patch.parentID)):null;if(patch.parentID&&!parent)throw Error("Colección padre inválida");const libraryID=parent?.libraryID||Zotero.Libraries.userLibraryID;this.editable(libraryID);const name=String(patch.name||"").trim();if(!name||name.length>255)throw Error("Nombre inválido");operations.push({type:"createCollection",before:null,after:{libraryID,parentID:parent?.id||null,key:Zotero.Utilities.generateObjectKey(),name}});
    }else throw Error("Operación sin vista previa reversible: "+patch.type);
   }
   const plan={id:R.id("change"),label,operations,status:"draft",createdAt:new Date().toISOString()};R.changes.push(plan);await R.write("changes",R.changes);return copy(plan);
  },
  preview(plan){const lines=[plan.label,"Operaciones: "+plan.operations.length];for(const op of plan.operations){
   if(op.type==="item"){lines.push("\n«"+(op.before.data.title||op.before.key)+"»");for(const field of new Set([...Object.keys(op.before.data),...Object.keys(op.after.data)]))if(!same(op.before.data[field],op.after.data[field]))lines.push((R.FIELD_NAMES[field]||field)+": "+nice(op.before.data[field]||"")+" → "+nice(op.after.data[field]||""));
    if(!same(op.before.creators,op.after.creators)){const creators=cs=>cs.map(c=>(c.creatorType||"Creador")+": "+(c.name||[c.firstName,c.lastName].filter(Boolean).join(" "))).join("; ");lines.push("Creadores: "+creators(op.before.creators)+" → "+creators(op.after.creators));}
    if(!same(op.before.tags,op.after.tags))lines.push("Etiquetas: "+op.before.tags.map(t=>t.tag).join(", ")+" → "+op.after.tags.map(t=>t.tag).join(", "));
    if(!same(op.before.collections,op.after.collections)){const names=ids=>ids.map(cid=>Zotero.Collections.get(cid)?.name||cid).join(", ");lines.push("Colecciones: "+names(op.before.collections)+" → "+names(op.after.collections));}
    if(!same(op.before.relations,op.after.relations))lines.push("Relaciones: "+nice(op.before.relations)+" → "+nice(op.after.relations));
   }else if(op.type==="renameCollection")lines.push("Colección: "+op.before.name+" → "+op.after.name);
   else if(op.type==="createItem")lines.push("Nueva referencia ("+op.after.itemType+"): "+op.after.fields.title+"\nColección: "+(op.after.collectionID?Zotero.Collections.get(op.after.collectionID)?.name||op.after.collectionID:"raíz de la biblioteca")+"\nCampos: "+nice(op.after.fields)+"\nCreadores: "+nice(op.after.creators));
   else if(op.type==="setDeleted")lines.push((op.after.deleted?"Enviar a la papelera: ":"Restaurar de la papelera: ")+(op.before.data.title||op.before.key));
   else if(op.type==="createNote")lines.push("Nueva nota para "+(op.after.parentTitle||"la colección")+":\n"+op.after.note.replace(/<[^>]+>/g," "));
   else lines.push("Nueva colección: "+op.after.name);
  }return lines.join("\n");},
  current(planId){const plan=R.changes.find(c=>c.id===planId);if(!plan)throw Error("Propuesta inexistente");return plan;},
  async validate(op,after=false){
   const expected=after?(op.saved||op.after):op.before;
   if(op.type==="createItem"&&!after){
    this.editable(op.after.libraryID);
    if(op.after.collectionID){const c=Zotero.Collections.get(op.after.collectionID);if(!c||c.deleted||c.key!==op.after.collectionKey||c.libraryID!==op.after.libraryID)throw Error("La colección destino cambió o ya no existe.");}
    return;
   }
   if(op.type==="item"||op.type==="createNote"||op.type==="createItem"||op.type==="setDeleted"){
    if(!expected)return;
    const item=await Zotero.Items.getAsync(expected.id||Zotero.Items.getByLibraryAndKey(expected.libraryID,expected.key)?.id);if(!item||item.key!==expected.key||item.libraryID!==expected.libraryID||!same(this.snapshot(item),expected))throw Error("El registro cambió desde la vista previa. Se conserva tu edición; prepara una propuesta nueva.");this.editable(item.libraryID);
    if(!after&&op.type==="item")for(const cid of op.after.collections){const c=Zotero.Collections.get(cid);if(!c||c.deleted||c.libraryID!==item.libraryID)throw Error("La colección destino cambió o ya no existe.");}
    if(op.type==="setDeleted")await Z.libraryTools.assertTrashChange(item,after?op.before.data.deleted===true:op.after.deleted);
   }else if(op.type==="renameCollection"||op.type==="createCollection"){
    if(!expected)return;const c=Zotero.Collections.get(expected.id);if(!c||c.key!==expected.key||c.name!==expected.name||(c.parentID||null)!==(expected.parentID||null))throw Error("La colección cambió; vuelve a revisar la propuesta.");this.editable(c.libraryID);
    if(after&&op.type==="createCollection"&&(c.getChildItems().length||Zotero.Collections.getByLibrary(c.libraryID,true).some(child=>child.parentID===c.id)))throw Error("La colección contiene datos nuevos. No se elimina al deshacer.");
   }
  },
  applyState(item,state){const current=item.toJSON();const fields=new Set([...Object.keys(current),...Object.keys(state.data)]);for(const field of fields){if(Zotero.ItemFields.getID(field)&&Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(field),item.itemTypeID))item.setField(field,state.data[field]||"");}item.setCreators(state.creators);item.setTags(state.tags);item.setCollections(state.collections);if(!same(item.getRelations(),state.relations))item.setRelations(state.relations);},
  routinePlan(plan,routine){
   if(!routine||Z.needsApproval(routine.name,routine.args)||plan.operations.length>20)return false;
   const types={crear_nota:"createNote",crear_coleccion:"createCollection",renombrar_coleccion:"renameCollection",crear_referencia:"createItem",duplicar_referencia:"createItem"};
   if(types[routine.name])return plan.operations.length===1&&plan.operations[0].type===types[routine.name];
   if(!["agregar_etiquetas","agregar_a_coleccion","aplicar_organizacion"].includes(routine.name))return false;
   return plan.operations.every(op=>{
    if(op.type!=="item")return false;
    const before=op.before,after=op.after;
    // Routine organization can only add tags/memberships, never replace fields,
    // creators, remove tags or move items out of their existing collections.
    const expected={...before};
    if(routine.name!=="agregar_a_coleccion")expected.tags=after.tags;
    if(routine.name!=="agregar_etiquetas")expected.collections=after.collections;
    return same(expected,after)&&before.tags.every(t=>after.tags.some(a=>same(t,a)))&&before.collections.every(id=>after.collections.includes(id));
   });
  },
  async apply(planId,{signal,confirm,writeBudget}={},routine=null){Z.checkAbort(signal);const plan=this.current(planId);if(plan.status!=="draft")throw Error("La propuesta ya fue procesada. Prepara una nueva.");if(!plan.operations.length)return {status:"sin cambios",planID:plan.id};
   const direct=this.routinePlan(plan,routine)&&(!writeBudget||writeBudget.used+plan.operations.length<=20);
   if(!direct){if(typeof confirm!=="function")throw Error("Se requiere aprobar la vista previa antes de escribir.");if(await confirm(this.preview(plan))!==true)return {status:"rejected",planID:plan.id};}
   Z.checkAbort(signal);for(const op of plan.operations)await this.validate(op);
   if(writeBudget)writeBudget.used+=plan.operations.length;
   plan.approval=direct?"routine":"confirmed";
   plan.status="prepared";await R.write("changes",R.changes);
   try{await Zotero.DB.executeTransaction(async()=>{for(const op of plan.operations){Z.checkAbort(signal);await this.validate(op);this.editable(op.after.libraryID);
    if(op.type==="item"){const item=await Zotero.Items.getAsync(op.before.id);this.applyState(item,op.after);await item.save();op.saved=this.snapshot(item);}
    else if(op.type==="createItem"){const item=new Zotero.Item(op.after.itemType);item.libraryID=op.after.libraryID;for(const [field,value] of Object.entries(op.after.fields))item.setField(field,value);item.setCreators(op.after.creators);item.setTags(op.after.tags);if(op.after.collectionID)item.addToCollection(op.after.collectionID);await item.save();op.after.key=item.key;op.saved=this.snapshot(item);}
    else if(op.type==="setDeleted"){const item=await Zotero.Items.getAsync(op.before.id);item.deleted=op.after.deleted;await item.save();op.saved=this.snapshot(item);}
    else if(op.type==="renameCollection"){const c=Zotero.Collections.get(op.before.id);c.name=op.after.name;await c.save();op.saved={...op.after};}
    else if(op.type==="createNote"){const item=new Zotero.Item("note");item.libraryID=op.after.libraryID;if(op.after.parentID){const parent=await Zotero.Items.getAsync(op.after.parentID);if(!parent||parent.key!==op.after.parentKey)throw Error("La referencia padre cambió.");item.parentID=op.after.parentID;}else if(op.after.collectionID)item.addToCollection(op.after.collectionID);item.setNote(op.after.note);await item.save();op.after.key=item.key;op.saved=this.snapshot(item);}
    else if(op.type==="createCollection"){const c=new Zotero.Collection();c.libraryID=op.after.libraryID;c.name=op.after.name;if(op.after.parentID)c.parentID=op.after.parentID;await c.save();op.after.key=c.key;op.saved={...op.after,id:c.id};}
   }});plan.status="applied";plan.appliedAt=new Date().toISOString();await R.write("changes",R.changes);return {status:"applied",planID:plan.id,changes:copy(plan.operations),item_id:plan.operations.find(o=>o.type==="createItem")?.saved?.id,nota_id:plan.operations.find(o=>o.type==="createNote")?.saved?.id,coleccion_id:plan.operations.find(o=>o.type==="createCollection")?.saved?.id};
   }catch(e){for(const op of plan.operations){try{if(op.type==="item"||op.type==="setDeleted")await (await Zotero.Items.getAsync(op.before.id)).reload(null,true);else if(op.type==="renameCollection")await Zotero.Collections.get(op.before.id).reload(null,true);}catch(_) {}}plan.status="needs_review";plan.error=String(e.message);await R.write("changes",R.changes);throw e;}
  },
  async undo(planId,{signal,confirm}={}){const plan=this.current(planId);if(plan.status!=="applied")throw Error("Solo se pueden deshacer operaciones aplicadas.");for(const op of plan.operations)await this.validate(op,true);if(typeof confirm!=="function"||await confirm("Deshacer completamente:\n"+this.preview(plan))!==true)return {status:"rejected"};Z.checkAbort(signal);for(const op of plan.operations)await this.validate(op,true);
   await Zotero.DB.executeTransaction(async()=>{for(const op of [...plan.operations].reverse()){Z.checkAbort(signal);if(op.type==="item"){const item=await Zotero.Items.getAsync(op.before.id);this.applyState(item,op.before);await item.save();}else if(op.type==="createItem"){const item=await Zotero.Items.getAsync(op.saved.id);item.deleted=true;await item.save();}else if(op.type==="setDeleted"){const item=await Zotero.Items.getAsync(op.before.id);item.deleted=op.before.data.deleted===true;await item.save();}else if(op.type==="renameCollection"){const c=Zotero.Collections.get(op.before.id);c.name=op.before.name;await c.save();}else if(op.type==="createNote"){const item=await Zotero.Items.getAsync(op.saved.id);await item.erase();}else if(op.type==="createCollection"){await Zotero.Collections.get(op.saved.id).erase();}}});
   plan.status="undone";plan.undoneAt=new Date().toISOString();await R.write("changes",R.changes);return {status:"undone",planID:plan.id};
  },
  confirmNative(text){return Services.prompt.confirm(Zotero.getMainWindow(),"Vista previa de cambios",text);},
  async note(parent,title,markdown,options={}){const plan=await this.create([{type:"createNote",parentID:parent?.isRegularItem()?parent.id:null,title,markdown}],"Guardar nota de lectura");return this.apply(plan.id,{...options,confirm:options.confirm||this.confirmNative},{name:"crear_nota",args:{}});}
 };
 const S=Z.safe;
 const schema={type:"object",properties:{cambios:{type:"array",items:{type:"object",properties:{item_id:{type:"integer"},campos:{type:"object",additionalProperties:{type:"string"}},creadores:{type:"array",items:{type:"object"}},etiquetas:{type:"array",items:{type:"string"}},colecciones:{type:"array",items:{type:"integer"}}},required:["item_id"]}}},required:["cambios"]};
 Z.tools.preparar_cambios={description:"Prepara una vista previa persistente de campos, creadores, etiquetas y colecciones. No escribe en la biblioteca. Para aplicar se requiere aprobar la propuesta exacta.",parameters:schema,run:({cambios})=>S.create(cambios.map(c=>({type:"item",id:c.item_id,fields:c.campos,creators:c.creadores,tags:c.etiquetas,collections:c.colecciones})))};
 Z.tools.aplicar_cambios={escribe:true,managesApproval:true,description:"Aplica una propuesta previamente preparada tras aprobar sus valores antes/después. Verifica cambios concurrentes y guarda historial reversible.",parameters:{type:"object",properties:{propuesta_id:{type:"string"}},required:["propuesta_id"]},run:({propuesta_id},opts)=>S.apply(propuesta_id,opts)};
 Z.tools.deshacer_cambios={escribe:true,managesApproval:true,description:"Deshace una operación completa solo si los registros siguen intactos desde que la IA los cambió. Requiere confirmación.",parameters:{type:"object",properties:{propuesta_id:{type:"string"}},required:["propuesta_id"]},run:({propuesta_id},opts)=>S.undo(propuesta_id,opts)};
 Z.tools.historial_cambios={description:"Lista operaciones reversibles y propuestas pendientes, sin modificar la biblioteca.",parameters:{type:"object",properties:{}},run:async()=>R.changes.map(p=>({id:p.id,label:p.label,status:p.status,date:p.createdAt,preview:S.preview(p)}))};
 const routes={
  crear_nota:a=>[{type:"createNote",title:a.titulo,markdown:a.markdown,parentID:a.item_id,collectionID:a.coleccion_id}],
  crear_coleccion:a=>[{type:"createCollection",name:a.nombre,parentID:a.padre_id}],
  renombrar_coleccion:a=>[{type:"renameCollection",id:a.coleccion_id,name:a.nuevo_nombre}],
  agregar_etiquetas:async a=>Promise.all(a.item_ids.map(async id=>{const item=await Zotero.Items.getAsync(id);if(!item)throw Error("Referencia inexistente");return {type:"item",id,tags:[...item.getTags(),...a.etiquetas.filter(t=>!item.getTags().some(old=>old.tag===t)).map(tag=>({tag,type:0}))]};})),
  agregar_a_coleccion:async a=>Promise.all(a.item_ids.map(async id=>{const item=await Zotero.Items.getAsync(id);if(!item)throw Error("Referencia inexistente");return {type:"item",id,collections:[...item.getCollections(),a.coleccion_id]};})),
  aplicar_organizacion:async a=>{const grouped=new Map();for(const patch of a.asignaciones){if(!grouped.has(patch.item_id)){const item=await Zotero.Items.getAsync(patch.item_id);if(!item)throw Error("Referencia inexistente");grouped.set(patch.item_id,{type:"item",id:item.id,tags:item.getTags(),collections:item.getCollections()});}const row=grouped.get(patch.item_id);if(!row.tags.some(t=>t.tag===patch.etiqueta))row.tags.push({tag:patch.etiqueta,type:0});if(patch.coleccion_destino_id)row.collections.push(patch.coleccion_destino_id);}return [...grouped.values()];}
 };
 for(const [name,prepare] of Object.entries(routes)){const tool=Z.tools[name];tool.managesApproval=true;tool.run=async(args,opts={})=>{const plan=await S.create(await prepare(args),tool.resumen?tool.resumen(args):"Cambios propuestos");return S.apply(plan.id,opts,{name,args});};}
 // Legacy destructive/native operations retain their explicit approval, but are never
 // advertised as atomically reversible: their native UI must manage recognition/downloads.
 const correct=Z.tools.corregir_metadatos.run.bind(Z.tools.corregir_metadatos);
 Z.tools.corregir_metadatos.run=async function correctWithHistory(args,opts={}){
  R.assertWritable?.("changes");
  if(!Array.isArray(args.item_ids)||!args.item_ids.length||args.item_ids.length>20)throw Error("Indica entre 1 y 20 IDs de referencias.");
  if(Z.pdfMetadata){
   const fromPDF=[],others=[];
   for(const id of args.item_ids){Z.checkAbort(opts.signal);let context=null;try{context=await Z.pdfMetadata.resolve(id);}catch(e){Z.checkAbort(opts.signal);}
    (context?.parent&&context.pdf?fromPDF:others).push(id);
   }
   if(fromPDF.length){
    const reports=[];
    for(const id of fromPDF){Z.checkAbort(opts.signal);try{
      const result=await Z.pdfMetadata.complete({item_id:Number(id),sobrescribir:true,reemplazar_autores:args.corregir_autores===true},opts);
      reports.push({...result,estado:result.aplicado?"CORREGIDO":result.estado});
     }catch(e){Z.checkAbort(opts.signal);if(["BudgetLimitError","ProviderError","ModelPolicyError"].includes(e.name))throw e;reports.push({item_id:Number(id),estado:"ERROR",error:String(e.message||e).slice(0,220)});}
    }
    const otherResult=others.length?await correctWithHistory({...args,item_ids:others},opts):{resultados:[]};
    const resultados=[...reports,...otherResult.resultados];
    return {resultados,total_corregidos:resultados.filter(r=>r.estado==="CORREGIDO").length,advertencia:"Se leyó primero el PDF adjunto cuando estaba disponible, sin separarlo ni crear otro contenedor. Los cambios PDF se deshacen con deshacer_cambios usando propuesta_id. Las referencias sin PDF conservan la verificación de Crossref por DOI."};
   }
  }
  const before=new Map();for(const id of args.item_ids||[]){const item=await Zotero.Items.getAsync(Number(id));if(item?.isRegularItem())before.set(item.id,S.snapshot(item));}
  const result=await correct(args,opts),operations=[];
  for(const [id,previous] of before){const current=S.snapshot(await Zotero.Items.getAsync(id));if(!same(previous,current))operations.push({type:"item",before:previous,after:current,saved:current});}
  if(operations.length){const plan={id:R.id("metadata"),label:"Corrección de metadatos con Crossref",operations,status:"applied",createdAt:new Date().toISOString()};R.changes.push(plan);await R.write("changes",R.changes);result.propuesta_id=plan.id;}
  return result;
 };
 const system=Z.agentSystem.bind(Z);Z.agentSystem=()=>system()+" Para editar referencias usa preparar_cambios y aplicar_cambios. Explica valores anteriores y nuevos, y conserva propuesta_id para deshacer_cambios. Las rutas nativas de reconocer PDF, descargas, eliminación de colecciones e importaciones no tienen el historial reversible general: advierte esa diferencia antes de pedir autorización, nunca prometas deshacerlas automáticamente.";
})(ZoteroIA);
