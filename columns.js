/* global ZoteroIA */
(function(Z){
 const base=[
  {key:"tesis",label:"Tesis o argumento principal",prompt:"Identifica la tesis o argumento central del documento."},
  {key:"metodo",label:"Metodología",prompt:"Identifica el método y el diseño de investigación."},
  {key:"fuentes",label:"Fuentes utilizadas",prompt:"Identifica las fuentes, los datos o los materiales utilizados."},
  {key:"conceptos",label:"Conceptos centrales",prompt:"Identifica los conceptos centrales y cómo se utilizan."},
  {key:"limitaciones",label:"Limitaciones",prompt:"Identifica límites expresos; distingue cualquier límite inferido como interpretación."}
 ];
 const clean=s=>String(s??"").replace(/[\u0000-\u001f]/g," ").trim();
 const norm=s=>clean(s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 Z.matrixColumns={
  defaults:()=>base.map(c=>({...c})),
  normalize(values){
   if(values===undefined||values===null)return this.defaults();
   if(!Array.isArray(values)||values.length<1||values.length>10)throw Error("Define entre 1 y 10 columnas de análisis.");
   const labels=new Set(),keys=new Set();
   return values.map((v,i)=>{
    const text=typeof v==="string"?v:null,label=clean(text??v?.label),prompt=clean(text??v?.prompt??v?.label);
    const standard=base.find(c=>norm(c.label)===norm(label)||c.key===norm(label));
    const key=text!==null?(standard?.key||"col_"+(i+1)):String(v?.key||standard?.key||"col_"+(i+1));
    if(!label||label.length>80||!prompt||prompt.length>300)throw Error("Cada columna necesita un nombre de hasta 80 caracteres y una indicación de hasta 300.");
    if(!/^[a-z][a-z0-9_]{0,39}$/.test(key)||["constructor","prototype"].includes(key))throw Error("Identificador de columna no válido.");
    if(labels.has(norm(label))||keys.has(key))throw Error("Las columnas no pueden repetirse.");
    labels.add(norm(label));keys.add(key);return {key,label,prompt:text!==null&&standard?standard.prompt:prompt};
   });
  },
  forRun(run){return this.normalize(run?.columns);},
  fromText(text){
   if(!String(text||"").trim())return this.defaults();
   return this.normalize(String(text).split(/\r?\n/).filter(s=>s.trim()).map((line,i)=>{
    const pos=line.indexOf("|");if(pos<0)return line.trim();
    const label=line.slice(0,pos).trim(),standard=base.find(c=>norm(c.label)===norm(label));
    return {key:standard?.key||"col_"+(i+1),label,prompt:line.slice(pos+1).trim()};
   }));
  },
  toText(values){return this.normalize(values).map(c=>{
   const standard=base.find(b=>b.key===c.key&&b.label===c.label&&b.prompt===c.prompt);
   return standard||c.prompt===c.label?c.label:c.label+" | "+c.prompt;
  }).join("\n");}
 };
})(ZoteroIA);
