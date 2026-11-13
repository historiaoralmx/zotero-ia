/* global document, window, ZIA, Zotero, busy, ctrl */
(function () {
  const $ = id => document.getElementById(id), P = ZIA.projects;
  const panels={projects:"workspace-projects",analysis:"research-panel",results:"workspace-results",chat:"workspace-chat",related:"workspace-related",settings:"workspace-settings"};
  const nav=key=>$(key==="analysis"?"research-toggle":"workspace-nav-"+key);
  const el=(tag,text)=>{const n=document.createElementNS("http://www.w3.org/1999/xhtml",tag);if(text!==undefined)n.textContent=text;return n;};
  const message=text=>{$("workspace-project-message").textContent=text;};
  const W=ZIA.workspace={
    view:"projects",
    source:null,notice:"",
    setActivity(source) { this.source=source;this.notice="";this.clearBudget();this.activity(); },
    note(text) { this.notice=text;this.activity(); },
    clearBudget() { const box=$("workspace-budget-notice");if(box){box.hidden=true;box.replaceChildren();} },
    reviewBudget(budget) {
      this.show("settings");
      const requests=$("research-request-limit"),tokens=$("research-token-limit");
      if(budget.kind==="requests")requests.value=Math.min(10000,Math.max(Number(requests.value)||20,budget.requests+10));
      if(budget.kind==="tokens")tokens.value=Math.min(10000000,Math.max(Number(tokens.value)||60000,Math.ceil((budget.tokens+budget.nextEstimate*4)/1000)*1000));
      const input=budget.kind==="requests"?requests:tokens;const details=input.closest?.("details");if(details)details.open=true;input.focus();
      $("research-usage").textContent="Se propone un margen para continuar. Revisa los valores y pulsa Guardar límites para aplicarlos. Se aplican a las tareas del plugin; no cambian la cuota del proveedor.";
    },
    budgetNotice(budget,continueTask,continueLabel="Continuar") {
      if(!budget)return;const box=$("workspace-budget-notice");if(!box)return;
      box.replaceChildren();box.hidden=false;
      box.appendChild(el("strong","Pausa por el límite del plugin"));
      box.appendChild(el("p",budget.kind==="requests"?budget.requests+" / "+budget.maxRequests+" solicitudes de esta tarea.":budget.tokens+" tokens acumulados + "+budget.nextEstimate+" estimados para la siguiente consulta; máximo configurado: "+budget.maxTokens+"."));
      box.appendChild(el("p","Este límite es independiente del proveedor de IA y no cambia al poner otra clave."));
      action(box,"Revisar límites",()=>this.reviewBudget(budget));
      if(continueTask&&budget.nextEstimate<=budget.maxTokens)action(box,continueLabel,async()=>{if(busy)throw Error("Espera a que termine la operación actual.");await continueTask();});
      action(box,"Cerrar aviso",()=>this.clearBudget());
    },
    show(key) {
      if(!panels[key])return;
      this.view=key;
      for(const [name,id] of Object.entries(panels)){
        $(id).hidden=name!==key;nav(name).setAttribute("aria-selected",String(name===key));nav(name).tabIndex=name===key?0:-1;
      }
      if(key==="analysis")$("research-toggle").setAttribute("aria-expanded","true");else $("research-toggle").setAttribute("aria-expanded","false");
      if(key==="results")ZIA.researchUI.refresh();
      if(key==="related")ZIA.incitefulUI?.refreshSelection();
    },
    activity() {
      $("workspace-stop").disabled=!busy;
      const source=this.source==="analysis"?"research-status":this.source==="related"?"related-status":"st";
      $("workspace-activity").textContent=busy?($(source).textContent||"Tarea en curso…"):(this.notice||"Sin tarea en curso");
    },
  };
  function action(parent,label,handler){const b=el("button",label);b.type="button";b.addEventListener("click",()=>Promise.resolve().then(handler).catch(e=>message(e.message)));parent.appendChild(b);return b;}
  function ensureIdle(){if(busy)throw Error("Termina o detén la tarea actual antes de cambiar el proyecto.");}
  function collectionOptions(select,chosen=[]){
    select.replaceChildren();const ids=new Set(chosen);
    for(const library of Zotero.Libraries.getAll().filter(l=>["user","group"].includes(l.libraryType))){
      const group=el("optgroup");group.label=library.name||Zotero.Libraries.getName(library.libraryID);
      for(const c of Zotero.Collections.getByLibrary(library.libraryID,true)){
        const path=[c.name],seen=new Set([c.id]);let parent=c.parentID;
        while(parent&&!seen.has(parent)){seen.add(parent);const p=Zotero.Collections.get(parent);if(!p)break;path.unshift(p.name);parent=p.parentID;}
        const option=el("option",path.join(" / "));option.value=String(c.id);option.selected=ids.has(c.id);group.appendChild(option);
      }
      select.appendChild(group);
    }
  }
  function applyProject(project){
    ZIA.researchUI.collections();
    $("research-collections").disabled=!!project;
    if(project){
      const choices=new Set(project.collectionIds);
      for(const option of $("research-collections").options)option.selected=choices.has(Number(option.value));
      $("research-objective").value=project.objective;
    }
    const available=new Set([...$("research-collections").options].map(o=>Number(o.value)));
    const missing=project?.collectionIds.some(id=>!available.has(id));
    $("research-start").disabled=!!missing||!$("research-collections").selectedOptions.length;
    $("research-search").disabled=$("research-start").disabled;
    $("workspace-analysis-context").textContent=missing?"Proyecto: "+project.name+". Alguna colección ya no está disponible. Edita el proyecto en Proyectos antes de analizar.":project?"Proyecto: "+project.name+". Se usarán sus colecciones. Puedes ajustar el objetivo; para cambiar las colecciones, edita el proyecto en Proyectos.":"Sin proyecto activo. Elige las colecciones y escribe un objetivo para esta tarea.";
    $("workspace-project-name").textContent=project?.name||"Sin proyecto activo";
    $("research-columns-summary").textContent="Columnas: "+ZIA.matrixColumns.normalize(project?.columns).map(c=>c.label).join(" · ")+". Puedes personalizarlas al editar el proyecto.";
  }
  function edit(project){
    ensureIdle();W.show("projects");const form=$("workspace-project-form");form.hidden=false;form.dataset.editId=project?.id||"";
    $("workspace-project-form-title").textContent=project?"Editar proyecto":"Nuevo proyecto";
    $("workspace-project-title").value=project?.name||"";$("workspace-project-objective").value=project?.objective||"";
    $("workspace-project-columns").value=ZIA.matrixColumns.toText(project?.columns);
    collectionOptions($("workspace-project-collections"),project?.collectionIds||[]);$("workspace-project-title").focus();
    if(project?.collectionIds.some(id=>!Zotero.Collections.get(id)))message("Alguna colección ya no está disponible. Revisa la selección antes de guardar.");else message("");
  }
  async function use(project,view="analysis"){
    ensureIdle();await P.activate(project.id);applyProject(project);render();W.show(view);
  }
  function render(){
    const box=$("workspace-project-list");box.replaceChildren();
    const projects=P.list(),active=P.current();$("workspace-project-name").textContent=active?.name||"Sin proyecto activo";
    if(P.error){message(P.error);$("workspace-new-project").disabled=true;return;}
    if(!projects.length){const empty=el("div");empty.className="workspace-empty";empty.appendChild(el("h2","Crea tu primer proyecto"));empty.appendChild(el("p","Dale un nombre, escribe una pregunta y vincula las colecciones que quieres estudiar. También puedes analizar documentos sin crear un proyecto."));box.appendChild(empty);}
    for(const project of projects.slice().reverse()){
      const card=el("article");card.className="workspace-project";card.setAttribute("data-active",String(project.id===active?.id));card.appendChild(el("h2",project.name));
      if(project.id===active?.id)card.appendChild(el("small","Proyecto activo"));
      card.appendChild(el("p",project.objective));
      card.appendChild(el("small","Columnas: "+ZIA.matrixColumns.normalize(project.columns).map(c=>c.label).join(" · ")));
      const names=project.collectionIds.map(id=>Zotero.Collections.get(id)?.name||"Colección no disponible ("+id+")");card.appendChild(el("p",names.join(" · ")));
      const count=ZIA.research.runs.filter(r=>r.projectId===project.id).length;card.appendChild(el("small",count+" análisis guardados"));
      const toolbar=el("div");toolbar.className="workspace-toolbar";
      action(toolbar,"Abrir y analizar",()=>use(project));action(toolbar,"Ver resultados",async()=>{await use(project,"results");$("workspace-task-filter").value="project";ZIA.researchUI.refresh();});
      const more=el("details");more.appendChild(el("summary","Opciones del proyecto"));action(more,"Editar",()=>edit(project));
      action(more,"Eliminar proyecto",async()=>{
        ensureIdle();if(!window.confirm("¿Eliminar el proyecto «"+project.name+"»? Sus colecciones, referencias y análisis guardados se conservan."))return;
        const wasActive=P.current()?.id===project.id;await P.remove(project.id);if(wasActive)applyProject(null);render();ZIA.researchUI.refresh();message("Proyecto eliminado. Sus análisis siguen en Resultados → Todas las tareas.");
      });
      card.appendChild(toolbar);card.appendChild(more);box.appendChild(card);
    }
  }
  for(const key of Object.keys(panels)){
    nav(key).addEventListener("click",()=>W.show(key));
    nav(key).addEventListener("keydown",event=>{
      const keys=Object.keys(panels),index=keys.indexOf(key);let next;
      if(["ArrowRight","ArrowDown"].includes(event.key))next=(index+1)%keys.length;
      else if(["ArrowLeft","ArrowUp"].includes(event.key))next=(index+keys.length-1)%keys.length;
      else if(event.key==="Home")next=0;else if(event.key==="End")next=keys.length-1;else return;
      event.preventDefault();W.show(keys[next]);nav(keys[next]).focus();
    });
  }
  $("workspace-configure").addEventListener("click",()=>ZIA.openPrefs());$("workspace-settings-provider").addEventListener("click",()=>ZIA.openPrefs());
  $("workspace-new-project").addEventListener("click",()=>{try{edit(null);}catch(e){message(e.message);}});
  $("workspace-cancel-project").addEventListener("click",()=>{$("workspace-project-form").hidden=true;message("");});
  $("workspace-default-columns").addEventListener("click",()=>{$("workspace-project-columns").value=ZIA.matrixColumns.toText();});
  $("workspace-without-project").addEventListener("click",async()=>{try{ensureIdle();await P.activate(null);applyProject(null);render();W.show("analysis");}catch(e){message(e.message);}});
  $("workspace-project-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=$("workspace-save-project");button.disabled=true;
    try{
      ensureIdle();const form=$("workspace-project-form");const project=await P.save({id:form.dataset.editId||undefined,name:$("workspace-project-title").value,objective:$("workspace-project-objective").value,columns:ZIA.matrixColumns.fromText($("workspace-project-columns").value),collectionIds:[...$("workspace-project-collections").selectedOptions].map(o=>Number(o.value))});
      form.hidden=true;applyProject(project);render();message("Proyecto guardado. Pulsa Abrir y analizar para empezar.");
    }catch(e){message(e.message);}finally{button.disabled=false;}
  });
  $("workspace-task-filter").addEventListener("change",()=>ZIA.researchUI.refresh());
  $("research-collections").addEventListener("change",()=>{if(!P.current()){$("research-start").disabled=!$("research-collections").selectedOptions.length;$("research-search").disabled=$("research-start").disabled;}});
  $("workspace-stop").addEventListener("click",()=>ctrl?.abort());
  const originalRefresh=ZIA.onResearchChanged;
  ZIA.onResearchChanged=()=>{originalRefresh?.();render();W.activity();};
  const observer=new window.MutationObserver(()=>W.activity());
  for(const id of ["stop","st","research-status","related-status"])observer.observe($(id),{attributes:true,attributeFilter:["disabled"],childList:true,characterData:true,subtree:true});
  window.addEventListener("unload",()=>observer.disconnect(),{once:true});
  function orientation(){$("workspace-nav").setAttribute("aria-orientation",window.innerWidth<=720?"horizontal":"vertical");}
  window.addEventListener("resize",orientation);orientation();
  applyProject(P.current());render();W.show("projects");if(ZIA.research.recoveryErrors?.length)W.notice=ZIA.research.recoveryErrors.join(" ");W.activity();
})();
