/* global Zotero, ZoteroIA */
(function (Z) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const roots = ids => [...new Set(ids)].sort((a,b) => a-b);
  const P = Z.projects = {
    data:{version:1,activeId:null,projects:[]},error:null,pending:Promise.resolve(),
    async init() {
      try {
        const data = await Z.research.read("projects",{version:1,activeId:null,projects:[]});
        if (data?.version !== 1 || !Array.isArray(data.projects) || data.projects.some(p => !p.id || typeof p.name !== "string" || typeof p.objective !== "string" || !Array.isArray(p.collectionIds))) throw Error("Formato de proyectos no válido.");
        for(const project of data.projects)if(project.columns!==undefined)Z.matrixColumns.normalize(project.columns);
        this.data = data;this.error = null;
      } catch (_) { this.error="No se pudieron leer los proyectos guardados. Se conserva el archivo original; puedes seguir usando las demás secciones."; }
    },
    list() { return copy(this.data.projects); },
    current() { return copy(this.data.projects.find(p => p.id === this.data.activeId) || null); },
    match(ids) { const p=this.current();return p && JSON.stringify(roots(p.collectionIds))===JSON.stringify(roots(ids)) ? p : null; },
    commit(change) {
      const request = this.pending.catch(() => {}).then(async () => {
        if (this.error) throw Error(this.error);
        const next=copy(this.data), result=change(next);
        await Z.research.write("projects",next);
        this.data=next;return copy(result);
      });
      this.pending=request;return request;
    },
    save({id,name,objective,collectionIds,columns}) {
      return this.commit(data => {
        name=String(name||"").trim();objective=String(objective||"").trim();
        if (!name || name.length>120) throw Error("Escribe un nombre de proyecto de hasta 120 caracteres.");
        if (!objective || objective.length>2000) throw Error("Escribe una pregunta u objetivo de hasta 2000 caracteres.");
        if (!Array.isArray(collectionIds) || !collectionIds.length || collectionIds.some(n => !Number.isSafeInteger(n) || n<=0)) throw Error("Selecciona al menos una colección válida.");
        for (const key of collectionIds) { const c=Zotero.Collections.get(key);if (!c || c.deleted) throw Error("La colección "+key+" ya no está disponible. Revisa la selección."); }
        const existing = id && data.projects.find(p=>p.id===id);
        if (id && !existing) throw Error("El proyecto ya no existe.");
        const now=new Date().toISOString();
        const project={id:existing?.id||Z.research.id("project"),name,objective,collectionIds:roots(collectionIds),columns:Z.matrixColumns.normalize(columns===undefined?existing?.columns:columns),createdAt:existing?.createdAt||now,updatedAt:now};
        if (existing) data.projects[data.projects.indexOf(existing)]=project;else data.projects.push(project);
        data.activeId=project.id;return project;
      });
    },
    activate(id) {
      return this.commit(data => { if (id!==null && !data.projects.some(p=>p.id===id)) throw Error("El proyecto ya no existe.");data.activeId=id;return id; });
    },
    remove(id) {
      return this.commit(data => { const p=data.projects.find(p=>p.id===id);if (!p) throw Error("El proyecto ya no existe.");data.projects=data.projects.filter(p=>p.id!==id);if(data.activeId===id)data.activeId=null;return p; });
    },
  };
})(ZoteroIA);
