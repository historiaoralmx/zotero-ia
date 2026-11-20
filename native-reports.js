/* global Zotero, ZoteroIA */
(function(Z){
 "use strict";
 const N=Z.nativeReports={
  command(value){
   const text=String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().replace(/[.!?]+$/,'').trim();
   const collection=/^(?:genera(?:r)?|crea(?:r)?|abre|abrir)\s+(?:(?:un|el)\s+)?informe(?:\s+(?:nativo|de zotero))?(?:\s+(?:de|para)\s+(?:la\s+)?(?:coleccion|carpeta)(?:\s+(?:actual|seleccionada|abierta|que tengo abierta|que tengo seleccionada))?)?$/i.test(text);
   const selection=/^(?:genera(?:r)?|crea(?:r)?|abre|abrir)\s+(?:(?:un|el)\s+)?informe(?:\s+nativo)?\s+(?:de|para)\s+(?:los\s+)?(?:elementos|items|registros)\s+seleccionados$/i.test(text);
   return selection?{origen:'seleccion'}:collection?(/coleccion|carpeta/i.test(text)?{origen:'coleccion'}:{}):null;
  },
  capture(){
   const pane=Zotero.getActiveZoteroPane?.(),scope={collections:[],items:[],sort:'title',direction:'asc',recursive:Zotero.Prefs.get('recursiveCollections')===true};
   try{scope.collections=(pane?.getSelectedCollections?.()||[]).map(c=>c.id);}catch(_){}
   try{scope.items=(pane?.getSelectedItems?.()||[]).map(i=>i.id);}catch(_){}
   try{scope.sort=pane?.getSortField?.()||'title';scope.direction=pane?.getSortDirection?.()===-1?'desc':'asc';}catch(_){}
   return scope;
  },
  ids(values){if(!Array.isArray(values)||!values.length||values.some(id=>!Number.isInteger(id)||id<=0))throw Error('Indica IDs válidos de colecciones o elementos.');return [...new Set(values)];},
  async open(args={},options={}){
   Z.checkAbort(options.signal);const scope=options.toolContext?.reportScope||this.capture();
   if(args.coleccion_id!=null&&args.coleccion_ids!=null)throw Error('Indica una colección o una lista de colecciones.');
   const specified=args.coleccion_id!=null||args.coleccion_ids!=null;
   if((specified&&args.item_ids!=null)||(args.origen==='seleccion'&&specified)||(args.origen==='coleccion'&&args.item_ids!=null))throw Error('Elige una sola fuente para el informe: colecciones o elementos.');
   if(args.incluir_subcolecciones!=null&&typeof args.incluir_subcolecciones!=='boolean')throw Error('Indica si deseas incluir las subcolecciones.');
   if(args.origen!=null&&!['coleccion','seleccion'].includes(args.origen))throw Error('El origen debe ser colección o selección.');
   const mode=args.item_ids!=null||args.origen==='seleccion'?'seleccion':specified||args.origen==='coleccion'||scope.collections.length?'coleccion':'seleccion';
   const items=new Map(),roots=[],expanded=new Map();let recursive=false;
   if(mode==='coleccion'){
    const values=args.coleccion_id!=null?[args.coleccion_id]:args.coleccion_ids??scope.collections;
    if(!specified&&!values.length)throw Error('Selecciona una colección en Zotero para generar su informe.');
    const ids=this.ids(values);
    recursive=args.incluir_subcolecciones??scope.recursive;
    for(const id of ids){Z.checkAbort(options.signal);const c=Zotero.Collections.get(id);if(!c||c.deleted)throw Error('La colección indicada ya no está disponible.');roots.push(c);expanded.set(c.id,c);
     if(recursive)for(const desc of c.getDescendents(false,'collection')){const child=Zotero.Collections.get(desc.id);if(child&&!child.deleted)expanded.set(child.id,child);}
    }
    if(new Set([...expanded.values()].map(c=>c.libraryID)).size!==1)throw Error('Genera un informe por biblioteca: estas colecciones pertenecen a bibliotecas distintas.');
    if(Zotero.Collections.loadDataTypes)await Zotero.Collections.loadDataTypes([...expanded.values()],['childItems']);
    for(const c of expanded.values()){Z.checkAbort(options.signal);for(const item of c.getChildItems())if(!item.deleted)items.set(item.id,item);}
   }else{
    const values=args.item_ids??scope.items;if(args.item_ids==null&&!values.length)throw Error('Selecciona una colección o uno o varios elementos en Zotero para generar el informe.');
    const ids=this.ids(values);
    for(const id of ids){Z.checkAbort(options.signal);const item=await Zotero.Items.getAsync(id);if(!item||item.deleted)throw Error('Un elemento indicado ya no está disponible.');items.set(item.id,item);}
   }
   if(!items.size)throw Error('La colección o selección no contiene elementos para generar un informe.');
   const selected=[...items.values()],libraries=new Set(selected.map(item=>item.libraryID));
   if(libraries.size!==1)throw Error('Genera un informe por biblioteca: estos elementos pertenecen a bibliotecas distintas.');
   const libraryID=selected[0].libraryID;
   if(mode==='coleccion'&&libraryID!==roots[0].libraryID)throw Error('Los elementos no corresponden a la biblioteca de las colecciones indicadas.');
   const prefix=Zotero.API.getLibraryPrefix(libraryID);
   if(!prefix||selected.some(item=>!/^[A-Z0-9]{8}$/.test(item.key)))throw Error('Zotero no pudo identificar los elementos del informe.');
   const url='zotero://report/'+prefix+'/items?itemKey='+selected.map(item=>item.key).join(',')+'&sort='+encodeURIComponent(scope.sort||'title')+'&direction='+(scope.direction==='desc'?'desc':'asc');
   Z.checkAbort(options.signal);const viewer=Zotero.openInViewer(url,{allowJavaScript:false});
   if(!viewer||viewer.closed)throw Error('Zotero no pudo abrir el visor de informes.');
   return {estado:'INFORME_ABIERTO',tipo:'informe_nativo_zotero',origen:mode,biblioteca_id:libraryID,colecciones:roots.map(c=>({id:c.id,nombre:c.name})),total_colecciones:expanded.size,incluir_subcolecciones:recursive,total_elementos:selected.length,url,usa_ia:false,mensaje:'Se abrió el informe nativo de Zotero con los datos bibliográficos, notas y adjuntos disponibles. Es la función Generar informe del menú de Zotero.'};
  }
 };
 Z.tools.generar_informe_zotero={description:'Abre el informe NATIVO Generar informe de Zotero, con datos bibliográficos, notas y adjuntos de una colección o de elementos seleccionados. No redacta un análisis con IA ni exporta a Word. Sin argumentos utiliza las colecciones seleccionadas, o los elementos si no hay una colección. Respeta la preferencia nativa de subcolecciones si no se indica otra cosa. Admite grupos de lectura y no modifica la biblioteca.',parameters:{type:'object',properties:{coleccion_id:{type:'integer'},coleccion_ids:{type:'array',items:{type:'integer'},minItems:1},item_ids:{type:'array',items:{type:'integer'},minItems:1},origen:{type:'string',enum:['coleccion','seleccion']},incluir_subcolecciones:{type:'boolean'}}},run:(args,opts)=>N.open(args,opts)};
 Z.agentGroups.informes={pattern:/informe|report|datos bibliogr[aá]ficos|metadatos.*notas/i,names:['generar_informe_zotero']};
 Z.tools.descubrir_herramientas.parameters.properties.categoria.enum.push('informes');
 const context=Z.agentToolContext.bind(Z);Z.agentToolContext=history=>({...context(history),reportScope:N.capture()});
 const system=Z.agentSystem.bind(Z);Z.agentSystem=()=>system()+' Si el investigador se refiere a Generar informe de Zotero, al informe nativo o a un informe con los datos y notas de una colección, usa generar_informe_zotero. La herramienta abre el mismo visor que el menú contextual. Para una colección nombrada, localiza su ID real primero; para la colección seleccionada no hace falta buscarla. No sustituyas esta función por una síntesis con IA ni por un archivo Word. Un informe analítico con un objetivo de investigación sí requiere leer y analizar las fuentes. Distingue abrir el informe nativo, redactar un análisis y exportar un archivo.';
 const agent=Z.runAgent.bind(Z);Z.runAgent=async function(history,options={}){
  const user=[...history].reverse().find(m=>m.role==='user'),args=N.command(user?.content);
  if(!args)return agent(history,options);
  const onEvent=options.onEvent||(()=>{}),task=Z.taskJournal.start(user.content),scope=N.capture();
  Z.taskJournal.update(task,{status:'running'});onEvent('plan',{id:task,plan:{stages:['Identificar la colección o selección','Abrir el informe nativo de Zotero']}});
  try{onEvent('herramienta',{name:'generar_informe_zotero',args});const result=await N.open(args,{...options,toolContext:{reportScope:scope}});
   Z.taskJournal.update(task,{status:'completed',reads:1,writes:0,errors:0,rejected:0});onEvent('ejecutada',{name:'generar_informe_zotero',write:false,result});
   const answer='Abrí el informe nativo de Zotero para '+result.total_elementos+' elementos'+(result.colecciones.length?' de '+result.colecciones.map(c=>'«'+c.nombre+'»').join(', '):' seleccionados')+'. Incluye los datos bibliográficos, notas y adjuntos disponibles; no se consultó a la IA.';
   onEvent('respuesta',{text:answer});return history.concat({role:'assistant',content:answer});
  }catch(error){Z.taskJournal.update(task,{status:options.signal?.aborted?'cancelled':'failed',lastError:String(error.message).slice(0,300)});throw error;}
 };
})(ZoteroIA);
