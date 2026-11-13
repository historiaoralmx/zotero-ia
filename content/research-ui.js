/* global document, window, ZIA, Zotero, busy, ctrl, confirmUI, checkSetup */
(function(){
 const R=ZIA.research,S=ZIA.safe,$=id=>document.getElementById(id);
 const el=(tag,text)=>{const e=document.createElementNS("http://www.w3.org/1999/xhtml",tag);if(text!==undefined)e.textContent=text;return e;};
 const status={paused:"Detenida / lista para continuar",running:"En curso",completed:"Completada",completed_with_issues:"Terminada con incidencias",draft:"Pendiente de aprobación",applied:"Aplicada",undone:"Deshecha",prepared:"Preparada; revisar estado",needs_review:"Requiere revisión"};
 const message=text=>{$("research-status").textContent=text;ZIA.workspace?.note(text);};
 function refreshUsage(){const u=R.usage;const tokens=Object.values(u.tasks).reduce((n,t)=>n+t.tokens,0),estimated=Object.values(u.tasks).some(t=>t.estimatedRequests>0);$("research-usage").textContent=u.totalRequests+" solicitudes · "+tokens+" tokens "+(estimated?"(incluye estimaciones)":"reportados")+" · "+u.cacheHits+" respuestas reutilizadas"+(Object.values(u.tasks).some(t=>t.unmeteredRejections)?" · Hay intentos rechazados sin consumo confirmado":"")+(u.last?" · Último modelo: "+u.last.model+(u.last.fallback?" (respaldo)":""):"");}
 async function work(action){if(busy){message("Termina o detén la tarea actual antes de iniciar otra.");return;}busy=true;ZIA.workspace?.setActivity("analysis");ctrl=new AbortController();$("stop").disabled=false;$("send").disabled=true;
  try{await action(ctrl.signal);}catch(e){message(ctrl.signal.aborted?"Tarea detenida. El avance guardado permanece disponible.":e.message);}finally{busy=false;$("stop").disabled=true;$("send").disabled=false;refresh();}
 }
 function button(parent,label,handler){const b=el("button",label);b.type="button";b.addEventListener("click",()=>handler().catch(e=>message(e.message)));parent.appendChild(b);return b;}
 function selected(){const ids=[...$("research-collections").selectedOptions].map(o=>Number(o.value));if(!ids.length)throw Error("Selecciona una colección para definir el alcance.");return ids;}
 async function exportRun(run,format){const fp=Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);fp.init(window.browsingContext,"Exportar matriz",fp.modeSave);fp.defaultString="Matriz-"+run.id+"."+format;fp.defaultExtension=format;fp.appendFilter(format.toUpperCase(),"*."+format);const result=await new Promise(resolve=>fp.open(resolve));if(result!==fp.returnOK&&result!==fp.returnReplace)return;await R.exportMatrix(run.id,format,fp.file.path);message("Matriz exportada con sus evidencias.");}
 function evidenceCard(parent,e){const article=el("article");article.className="research-evidence";const link=el("a",e.title||"Abrir fuente");if(e.url)link.href=e.url;article.appendChild(link);article.appendChild(el("small",(e.pageVerified?"Página PDF "+e.page:"Página no verificada")+" · "+e.kind+" · "+e.id));if(e.origin==="comment")article.appendChild(el("strong","Comentario personal: no es una afirmación del documento."));article.appendChild(el("blockquote",e.text));if(e.matched?.length)article.appendChild(el("small","Coincidencias: "+e.matched.join(", ")));parent.appendChild(article);}
 const resultViews = [
  { button: $("research-show-passages"), content: $("research-passage-results") },
  { button: $("research-show-matrix"), content: $("research-matrix-results") },
 ];
 function showResults(view) {
  $("research-result-controls").hidden = !view;
  for (const entry of resultViews) {
   entry.content.hidden = entry !== view;
   entry.button.setAttribute("aria-pressed", String(entry === view));
  }
  if (!view) return;
  view.button.disabled = false;
  ZIA.workspace?.show("results");
  $("research-result-controls").scrollIntoView({block:"nearest"});
 }
 for (const view of resultViews) view.button.addEventListener("click", () => showResults(view));
 const matrixFields=run=>ZIA.matrixColumns.forRun(run).map(c=>[c.key,c.label]);
 const fieldKind={resumen:"Resumen",interpretacion:"Interpretación de la IA",cita:"Cita literal","sin evidencia":"Sin evidencia suficiente","cita no verificada":"Cita no verificada"};
 function documentTitle(ref,row){if(row?.title)return row.title;if(ref.title)return ref.title;try{const title=Zotero.Items.get(ref.id)?.getField("title");if(title)return title;}catch(_){}return ref.key||"Documento "+ref.id;}
 function rowState(row){if(!row)return {label:"Pendiente",message:"Este documento todavía no se ha analizado."};if(row.status==="done")return {label:"Analizado"};if(row.status==="no_text")return {label:"Sin texto disponible",message:row.error||"No se recuperó texto para analizar este documento."};if(row.status==="missing")return {label:"Documento no disponible",message:row.error||"El documento ya no está disponible en la biblioteca."};return {label:"Requiere revisión",message:row.error||"El análisis no se completó. Puedes reintentarlo desde Tareas guardadas."};}
 function readingCard(parent,row,title,onBack,columns){
  parent.replaceChildren();parent.hidden=false;
  const actions=el("div");actions.className="research-matrix-actions";button(actions,"Volver a la tabla",async()=>onBack());parent.appendChild(actions);
  parent.appendChild(el("h3","Ficha de lectura · "+title));
  const metadata=[row.authors,row.year].filter(Boolean).join(" · ");if(metadata)parent.appendChild(el("p",metadata));
  const cited=new Set();
  for(const [name,label] of columns){const field=row.fields?.[name]||{};
   parent.appendChild(el("h4",label));parent.appendChild(el("small",fieldKind[field.kind]||field.kind||"Análisis"));
   parent.appendChild(el("p",field.text||"No identificado en los fragmentos disponibles."));
   for(const key of field.evidenceIDs||[]){const evidence=(row.evidence||[]).find(e=>e.id===key);if(evidence){evidenceCard(parent,evidence);cited.add(key);}}
  }
  const annotations=(row.evidence||[]).filter(e=>["highlight","comment"].includes(e.origin)&&!cited.has(e.id));
  if(annotations.length){parent.appendChild(el("h4","Subrayados y comentarios incluidos en la lectura"));for(const e of annotations)evidenceCard(parent,e);}
  if(row.coverage)parent.appendChild(el("small","Alcance: "+(row.coverage.method||"extracción disponible")+"; "+(row.coverage.selectedSpans||0)+" fragmentos utilizados. "+(row.coverage.allRecoveredTextProcessed?"Se procesó todo el texto recuperado por partes; no se certifica la recuperación de cada contenido del PDF.":"No equivale a lectura integral.")));
  if(row.coverage?.selection)parent.appendChild(el("small",row.coverage.selection));
  if(row.coverage?.extractionTruncated)parent.appendChild(el("strong","Extracción parcial: se alcanzó un límite o no se pudo recuperar parte del archivo. La ficha solo se fundamenta en el texto disponible."));
  if(row.coverage?.pageSampling)parent.appendChild(el("small","PDF de más de 1000 páginas: se muestrearon páginas a lo largo del archivo, incluido su final."));
  if(row.coverage?.spanSampling)parent.appendChild(el("small","Documento extenso: se muestrearon fragmentos a lo largo del texto recuperado; la búsqueda no es exhaustiva."));
  if(row.coverage?.annotationIssue)parent.appendChild(el("small",row.coverage.annotationIssue));
  if(row.coverage?.annotationsOmitted)parent.appendChild(el("small",row.coverage.annotationsOmitted+" anotaciones fuera del límite de esta lectura."));
  parent.scrollIntoView({block:"nearest"});
 }
 function matrix(run){
  const columns=matrixFields(run);
  if(run.budget)ZIA.workspace?.budgetNotice(run.budget);
  const box=$("research-matrix-results");box.dataset.runId=run.id;box.replaceChildren();
  box.appendChild(el("h3","Matriz comparativa de lectura"));box.appendChild(el("p","Objetivo: "+run.objective));
  const done=run.rows.filter(r=>r.status==="done").length;
  box.appendChild(el("p",(status[run.status]||run.status)+" · "+done+" de "+run.items.length+" documentos analizados · "+run.rows.length+" procesados."));
  box.appendChild(el("p","Cada fila corresponde a un documento. Compara las columnas para identificar coincidencias y diferencias. Los análisis son generados por IA: comprueba las fuentes desde la ficha de lectura."));
  const actions=el("div");actions.className="research-matrix-actions";button(actions,"Exportar a Excel",()=>exportRun(run,"xlsx"));button(actions,"Exportar a Word",()=>exportRun(run,"docx"));box.appendChild(actions);
  if(!run.items.length){box.appendChild(el("p","Esta tarea no contiene documentos."));showResults(resultViews[1]);return;}
  const hint=el("p","Desplázate hacia la derecha para ver todas las columnas. Usa «Ver ficha y evidencias» para revisar el análisis completo y sus fuentes.");hint.className="research-matrix-hint";box.appendChild(hint);
  const scroll=el("div");scroll.className="research-matrix-scroll";scroll.tabIndex=0;scroll.setAttribute("role","region");scroll.setAttribute("aria-label","Tabla comparativa de documentos. Desplazamiento horizontal y vertical.");
  const table=el("table");table.className="research-matrix-table";table.style.minWidth=(260+columns.length*240)+"px";
  const caption=el("caption","Comparación: "+columns.map(f=>f[1]).join(", "));table.appendChild(caption);
  const head=el("thead"),headRow=el("tr");for(const label of ["Documento y estado",...columns.map(f=>f[1])]){const th=el("th",label);th.setAttribute("scope","col");headRow.appendChild(th);}head.appendChild(headRow);table.appendChild(head);
  const body=el("tbody"),card=el("section");card.className="research-reading-card";card.hidden=true;card.setAttribute("aria-label","Ficha de lectura y evidencias del documento elegido");
  const rows=new Map(run.rows.map(row=>[row.itemID,row]));
  for(const ref of run.items){const row=rows.get(ref.id),state=rowState(row),title=documentTitle(ref,row),tr=el("tr");
   const doc=el("th");doc.setAttribute("scope","row");doc.className="research-matrix-document";doc.appendChild(el("strong",title));
   const metadata=[row?.authors,row?.year].filter(Boolean).join(" · ");if(metadata)doc.appendChild(el("small",metadata));
   const badge=el("span",state.label);badge.className="research-matrix-state";doc.appendChild(badge);
   if(row?.status==="done"||row?.evidence?.length){
    const view=button(doc,"Ver ficha y evidencias",async()=>readingCard(card,row,title,()=>{card.hidden=true;scroll.scrollIntoView({block:"nearest"});view.focus();},columns));
   }
   tr.appendChild(doc);
   if(row?.status!=="done"){const cell=el("td",state.message);cell.setAttribute("colspan",String(columns.length));cell.className="research-matrix-issue";tr.appendChild(cell);}
   else for(const [name] of columns){const field=row.fields?.[name]||{},cell=el("td"),text=String(field.text||"");
    const content=el("p",text.length>450?text.slice(0,450)+"…":text||"No identificado en los fragmentos disponibles.");content.className="research-matrix-field";cell.appendChild(content);
    if(text.length>450){let expanded=false;const more=button(cell,"Leer completo",async()=>{expanded=!expanded;content.textContent=expanded?text:text.slice(0,450)+"…";more.textContent=expanded?"Ver menos":"Leer completo";more.setAttribute("aria-expanded",String(expanded));});more.setAttribute("aria-expanded","false");}
    cell.appendChild(el("small",fieldKind[field.kind]||field.kind||"Análisis"));tr.appendChild(cell);
   }
   body.appendChild(tr);
  }
  table.appendChild(body);scroll.appendChild(table);box.appendChild(scroll);box.appendChild(card);showResults(resultViews[1]);
 }
 function refresh(){const tasks=$("research-runs");tasks.replaceChildren();for(const run of [...R.runs].reverse().filter(run=>$("workspace-task-filter")?.value!=="project" || (ZIA.projects?.current()?.id && run.projectId===ZIA.projects.current().id))){
  const box=el("div");box.className="research-task";box.appendChild(el("strong",run.objective));box.appendChild(el("small",run.collections.map(c=>c.name).join("; ")));box.appendChild(el("p",(status[run.status]||run.status)+" · "+run.rows.length+" / "+run.items.length+(run.reason?" · "+run.reason:"")));
  if(run.readingProgress)box.appendChild(el("small","Avance dentro del documento: "+run.readingProgress.done+" / "+run.readingProgress.total+" fragmentos. Se conserva la última parte guardada."));
  if(run.budget)button(box,"Revisar límite del plugin",async()=>{ZIA.workspace?.budgetNotice(run.budget);ZIA.workspace?.reviewBudget(run.budget);});
  if(run.budget&&run.budget.nextEstimate<=run.budget.maxTokens)button(box,"Continuar en otra etapa",()=>work(async signal=>{const result=await R.process(run.id,{signal,newStage:true,onProgress:p=>message("Analizados "+p.done+" de "+p.total+": "+p.title)});matrix(result);message("Etapa finalizada. Se conservaron las partes ya leídas y se aplicaron los mismos límites configurados.");}));
  button(box,"Ver matriz",async()=>matrix(run));
  button(box,"Continuar",()=>work(async signal=>{if(!ZIA.isConfigured())throw Error("Configura tu IA para analizar los textos.");const result=await R.process(run.id,{signal,onProgress:p=>message("Analizados "+p.done+" de "+p.total+": "+p.title)});matrix(result);message(status[result.status]||result.status);}));
  const extra=el("details");extra.className="workspace-secondary-actions";extra.appendChild(el("summary","Más opciones"));box.appendChild(extra);
  button(extra,"Reintentar incidencias",()=>work(async signal=>{const result=await R.process(run.id,{signal,retryErrors:true,onProgress:p=>message(p.done+" / "+p.total)});matrix(result);}));
  button(extra,"Revisar fuentes cambiadas",()=>work(async()=>{await R.refreshRun(run.id);message("Fuentes revisadas. Continuar volverá a procesar las que cambiaron.");}));
  button(extra,"Word",()=>exportRun(run,"docx"));button(extra,"Excel",()=>exportRun(run,"xlsx"));button(extra,"JSON",()=>exportRun(run,"json"));
  button(extra,"Eliminar tarea",async()=>{
   if(busy){message("Termina o detén la tarea actual antes de eliminar otra.");return;}
   if(!window.confirm("¿Eliminar la tarea «"+run.objective+"» y su matriz guardada? Esta acción no se puede deshacer."))return;
   await work(async()=>{
    await R.deleteRun(run.id);
    const view=resultViews[1];
    if(view.content.dataset.runId===run.id){
     const wasVisible=!view.content.hidden;
     view.content.replaceChildren();
     view.content.hidden=true;
     delete view.content.dataset.runId;
     view.button.disabled=true;
     view.button.setAttribute("aria-pressed","false");
     if(wasVisible)showResults(resultViews[0].button.disabled?null:resultViews[0]);
    }
    message("Tarea eliminada.");
   });
  });
  tasks.appendChild(box);
 }
 if(!tasks.children.length){const filtered=$("workspace-task-filter")?.value==="project";tasks.appendChild(el("p",filtered?(ZIA.projects?.current()?"Este proyecto todavía no tiene análisis guardados. Empieza en Analizar.":"Elige un proyecto o selecciona Todas las tareas para consultar los análisis anteriores."):"Todavía no hay análisis guardados. Empieza en Analizar."));}
 const changes=$("research-changes");changes.replaceChildren();for(const plan of [...R.changes].reverse().slice(0,50)){const details=el("details");details.appendChild(el("summary",plan.label+" · "+(status[plan.status]||plan.status)));details.appendChild(el("pre",S.preview(plan)));
  if(plan.status==="draft")button(details,"Revisar y aplicar",()=>work(async signal=>{const result=await S.apply(plan.id,{signal,confirm:confirmUI});message(result.status==="applied"?"Cambios aplicados. Puedes deshacerlos desde este historial.":"No se aplicaron cambios.");}));
  if(plan.status==="applied")button(details,"Deshacer operación completa",()=>work(async signal=>{const result=await S.undo(plan.id,{signal,confirm:confirmUI});message(result.status==="undone"?"Operación deshecha.":"No se modificó la operación.");}));changes.appendChild(details);
 }refreshUsage();}
 function collections(){const select=$("research-collections");const previous=new Set([...select.selectedOptions].map(o=>Number(o.value)));select.replaceChildren();for(const library of Zotero.Libraries.getAll().filter(l=>["user","group"].includes(l.libraryType))){const group=el("optgroup");group.label=library.name||Zotero.Libraries.getName(library.libraryID);for(const c of Zotero.Collections.getByLibrary(library.libraryID,true)){const names=[c.name],seen=new Set([c.id]);let ancestor=c.parentID;while(ancestor&&!seen.has(ancestor)){seen.add(ancestor);const parent=Zotero.Collections.get(ancestor);if(!parent)break;names.unshift(parent.name);ancestor=parent.parentID;}const option=el("option",names.join(" / "));option.value=c.id;option.title=names.join(" / ")+" · Incluye subcolecciones";group.appendChild(option);}select.appendChild(group);}
  if(previous.size){for(const o of select.options)o.selected=previous.has(Number(o.value));}
  else try{for(const c of Zotero.getActiveZoteroPane().getSelectedCollections())for(const o of select.options)if(Number(o.value)===c.id)o.selected=true;}catch(_){}
 }
 const panel=$("research-panel");
 ZIA.researchUI={refresh,collections,selected,showMatrix:matrix};

 $("research-start").addEventListener("click",()=>work(async signal=>{if(!ZIA.isConfigured())throw Error("Configura tu IA antes de iniciar un análisis.");const run=await R.createRun(selected(),$("research-objective").value);refresh();const result=await R.process(run.id,{signal,onProgress:p=>message("Analizados "+p.done+" de "+p.total+": "+p.title)});matrix(result);message(status[result.status]||result.status);}));
 $("research-search").addEventListener("click",()=>work(async signal=>{const result=await R.search({consulta:$("research-query").value,coleccion_ids:selected()},{signal,onProgress:p=>message("Buscando en "+p.done+" de "+p.total+" documentos…")});const box=$("research-passage-results");box.replaceChildren();box.appendChild(el("p",result.results.length+" pasajes · "+result.analyzed+" / "+result.total+" documentos · "+result.method+(result.omitted?" · "+result.omitted+" documentos fuera del límite de esta búsqueda":"")));for(const e of result.results)evidenceCard(box,e);for(const issue of result.issues)box.appendChild(el("p","Documento "+issue.id+": "+issue.error));showResults(resultViews[0]);message("Búsqueda local terminada.");}));
 $("research-save-limits").addEventListener("click",()=>{for(const [id,key,min,max] of [["research-request-limit","taskRequestLimit",1,10000],["research-token-limit","taskTokenLimit",1000,10000000],["research-output-limit","responseTokenLimit",100,16000]]){const value=Number($(id).value);if(!Number.isInteger(value)||value<min||value>max){message("Revisa los límites: valores fuera de rango.");return;}}
  Zotero.Prefs.set(ZIA.P+"taskRequestLimit",Number($("research-request-limit").value),true);Zotero.Prefs.set(ZIA.P+"taskTokenLimit",Number($("research-token-limit").value),true);Zotero.Prefs.set(ZIA.P+"responseTokenLimit",Number($("research-output-limit").value),true);Zotero.Prefs.set(ZIA.P+"researchCache",$("research-cache").checked,true);message("Límites guardados. Se aplican también al continuar una tarea existente.");refreshUsage();
 });
 const limits=R.settings();$("research-request-limit").value=limits.requests;$("research-token-limit").value=limits.tokens;$("research-output-limit").value=limits.output;$("research-cache").checked=limits.cache;
 document.addEventListener("click",event=>ZIA.handleResultLink(event,e=>message(e.message)));
 window.addEventListener("focus",()=>{if(!panel.hidden)refreshUsage();});ZIA.onResearchChanged=refresh;
})();
