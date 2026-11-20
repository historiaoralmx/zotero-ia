/* global Zotero, ZoteroIA, Services, Components, IOUtils, DOMParser, TextEncoder */
(function(Z){
 "use strict";
 const R=Z.research,X=value=>R.OOXML.xml(String(value??"").replace(/[\ufffe\uffff]/g,""));
 const relationships='http://schemas.openxmlformats.org/package/2006/relationships';
 const office='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
 const W=Z.wordExport={
  filename(title){let name=String(title||"Informe-Zotero-IA").replace(/[<>:"/\\|?*\u0000-\u001f]/g," ").replace(/\s+/g," ").replace(/[. ]+$/g,"").trim().slice(0,100);if(!name)name="Informe-Zotero-IA";if(/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(name))name="Informe-"+name;return name.replace(/\.docx$/i,"")+".docx";},
  bytes(title,markdown){
   const parser=new DOMParser(),doc=parser.parseFromString(Z.md2html(markdown),"text/html");
   const links=[];
   const run=(text,style={})=>'<w:r>'+((style.bold||style.italic||style.code)?'<w:rPr>'+(style.bold?'<w:b/>':'')+(style.italic?'<w:i/>':'')+(style.code?'<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>':'')+'</w:rPr>':'')+String(text).split(/\r?\n/).map((line,i)=>(i?'<w:br/>':'')+'<w:t xml:space="preserve">'+X(line)+'</w:t>').join('')+'</w:r>';
   const inline=(nodes,style={})=>Array.from(nodes).map(node=>{
    if(node.nodeType===3)return run(node.textContent,style);
    if(node.nodeType!==1)return '';
    const tag=node.localName.toLowerCase();if(tag==='br')return '<w:r><w:br/></w:r>';
    const next={...style,bold:style.bold||['b','strong','th'].includes(tag),italic:style.italic||['i','em'].includes(tag),code:style.code||['code','pre'].includes(tag)};
    if(tag==='a'){
     const url=node.getAttribute('href')||'',content=inline(node.childNodes,next);
     if(/^(?:https?:\/\/|zotero:\/\/(?:open-pdf|select)\/)/i.test(url)&&!/[\u0000-\u0020]/.test(url)){
      const id='link'+(links.length+1);links.push({id,url});return '<w:hyperlink r:id="'+id+'">'+content+'</w:hyperlink>';
     }return content;
    }
    return inline(node.childNodes,next);
   }).join('');
   const paragraph=(content,style='Normal',extra='')=>'<w:p><w:pPr><w:pStyle w:val="'+style+'"/>'+extra+'</w:pPr>'+content+'</w:p>';
   const blocks=(nodes,depth=0)=>Array.from(nodes).map(node=>{
    if(node.nodeType===3)return node.textContent.trim()?paragraph(run(node.textContent)):'';
    if(node.nodeType!==1)return '';
    const tag=node.localName.toLowerCase();
    if(tag==='table'){
     const rows=Array.from(node.querySelectorAll('tr'));if(!rows.length)return '';
     const count=rows.reduce((max,row)=>Math.max(max,Array.from(row.children).filter(c=>['td','th'].includes(c.localName)).length),0);
     const borders=['top','left','bottom','right','insideH','insideV'].map(side=>'<w:'+side+' w:val="single" w:sz="4" w:color="D9E2E8"/>').join('');
     return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+borders+'</w:tblBorders></w:tblPr><w:tblGrid>'+Array.from({length:count},()=>'<w:gridCol w:w="2400"/>').join('')+'</w:tblGrid>'+rows.map(row=>'<w:tr>'+Array.from(row.children).filter(c=>['td','th'].includes(c.localName)).map(cell=>'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>'+(cell.localName==='th'?'<w:shd w:fill="EAF3F7"/>':'')+'</w:tcPr>'+paragraph(inline(cell.childNodes,{bold:cell.localName==='th'}))+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
    }
    if(tag==='ul'||tag==='ol')return Array.from(node.children).map((li,i)=>paragraph(run(tag==='ol'?(i+1)+'. ':'• ')+inline(Array.from(li.childNodes).filter(n=>!['ul','ol'].includes(n.localName))), 'Normal','<w:ind w:left="'+(360*Math.min(depth+1,10))+'" w:hanging="180"/>')+blocks(Array.from(li.children).filter(n=>['ul','ol'].includes(n.localName)),depth+1)).join('');
    if(tag==='hr')return paragraph('','Normal','<w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D9E2E8"/></w:pBdr>');
    if(/^h[1-6]$/.test(tag))return paragraph(inline(node.childNodes),'Heading'+Math.min(3,Math.max(1,Number(tag.slice(1))-1)));
    if(['p','pre','blockquote','li'].includes(tag))return paragraph(inline(node.childNodes,{code:tag==='pre'}));
    return blocks(node.childNodes,depth);
   }).join('');
   const body=paragraph(run(title),'Title')+blocks(doc.body.childNodes);
   const styles='<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="140"/></w:pPr></w:style>'+[['Title',32],['Heading1',28],['Heading2',25],['Heading3',23]].map(([id,size])=>'<w:style w:type="paragraph" w:styleId="'+id+'"><w:name w:val="'+id+'"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="17495B"/><w:sz w:val="'+size+'"/></w:rPr></w:style>').join('')+'</w:styles>';
   return R.OOXML.zip({
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="'+relationships+'"><Relationship Id="document" Type="'+office+'officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="'+office.slice(0,-1)+'"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>',
    'word/styles.xml':styles,
    'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="'+relationships+'"><Relationship Id="styles" Type="'+office+'styles" Target="styles.xml"/>'+links.map(link=>'<Relationship Id="'+link.id+'" Type="'+office+'hyperlink" Target="'+X(link.url)+'" TargetMode="External"/>').join('')+'</Relationships>'
   });
  },
  source(args,options){
   const sources=['tarea_id','lectura_id','contenido'].filter(key=>args[key]!=null);if(sources.length>1)throw Error("Indica una sola fuente: tarea, lectura o contenido.");
   if(args.tarea_id!=null){const run=R.getRun(args.tarea_id);return {title:args.titulo||'Tabla comparativa · '+run.objective,bytes:R.exportBytes(run.id,'docx'),origin:'tarea_guardada'};}
   if(args.lectura_id!=null){const reading=Z.citationNotes?.readings.get(args.lectura_id);if(!reading)throw Error("La lectura ya no está disponible. Realízala de nuevo o exporta su ficha desde Resultados.");
    const blocks=reading.blocks.filter(b=>String(b.text||'').trim()).map(b=>'## '+b.label+'\n\n'+b.text+'\n\n'+(b.evidenceIDs||[]).map(id=>{const e=reading.evidence.find(e=>e.id===id);return e?.url?'['+id+']('+e.url+')':id;}).join(' '));
    const comments=reading.evidence.filter(e=>e.origin==='comment').map(e=>'Comentario personal del investigador: '+e.text);
    return {title:args.titulo||reading.title,markdown:blocks.concat(comments,reading.scope||'').join('\n\n'),origin:'lectura_guardada'};
   }
   const markdown=args.contenido??options.toolContext?.previousAnswer;
   if(typeof markdown!=='string'||!markdown.trim())throw Error("No hay un informe previo para exportar. Genera primero el informe o indica una tarea o lectura guardada.");
   if(markdown.length>2000000)throw Error("El informe es demasiado extenso para esta exportación. Divídelo en varios documentos.");
   return {title:args.titulo||'Informe · Zotero IA',markdown,origin:args.contenido!=null?'contenido_indicado':'respuesta_anterior'};
  },
  previousAnswer(history){
   const lastUser=history.map(m=>m.role).lastIndexOf('user');
   const previous=history.slice(0,lastUser<0?history.length:lastUser).reverse().find(m=>m.role==='assistant'&&!m.tool_calls?.length&&typeof m.content==='string'&&m.content.trim()&&!/^(?:Documento Word guardado en:|Se canceló el guardado\.)/.test(m.content));
   return previous?.content||null;
  },
  async choosePath(filename){
   const picker=Components.classes['@mozilla.org/filepicker;1'].createInstance(Components.interfaces.nsIFilePicker);
   const win=Services.wm.getMostRecentWindow('zotero-ia:agent')||Zotero.getMainWindow();
   picker.init(win.browsingContext,'Guardar documento Word',picker.modeSave);picker.defaultString=filename;picker.defaultExtension='docx';picker.appendFilter('Documento Word (*.docx)','*.docx');
   const result=await new Promise(resolve=>picker.open(resolve));
   return result===picker.returnOK||result===picker.returnReplace?{path:picker.file.path,replace:result===picker.returnReplace}:null;
  },
  async save(args={},options={}){
   Z.checkAbort(options.signal);const source=this.source(args,options),bytes=source.bytes||this.bytes(source.title,source.markdown);
   const selected=await this.choosePath(this.filename(source.title));Z.checkAbort(options.signal);
   if(!selected)return {estado:'CANCELADO',mensaje:'Se canceló el guardado. No se creó un archivo.'};
   if(!/\.docx$/i.test(selected.path))throw Error("Guarda el documento con la extensión .docx.");
   const tmp=selected.path+'.'+R.id('word')+'.tmp';
   try{await IOUtils.write(selected.path,bytes,{tmpPath:tmp,mode:selected.replace?'overwrite':'create'});}
   catch(e){try{await IOUtils.remove(tmp);}catch(_){}throw Error('No se pudo guardar el Word. Revisa la carpeta, los permisos y si el archivo está abierto. '+String(e.message||e));}
   return {estado:'GUARDADO',ruta:selected.path,formato:'docx',bytes:bytes.length,origen:source.origin,citas_activas:false,mensaje:'Documento Word guardado. Conserva texto, formato y enlaces. Para citas actualizables usa una nota con citas de Zotero y luego Insertar nota en Word.'};
  }
 };
 Z.tools.exportar_word={escribe:true,managesApproval:true,description:"Genera y guarda un archivo Word .docx mediante el diálogo Guardar. Sin contenido ni IDs exporta el último informe/respuesta del asistente; no lo reescribe ni lo vuelve a pedir a la IA. También exporta una tarea o lectura guardada por su ID. Preserva títulos, listas, tablas y enlaces; las citas activas se llevan a Word mediante notas nativas, no por esta exportación. No admite rutas elegidas por el modelo.",parameters:{type:'object',properties:{titulo:{type:'string'},tarea_id:{type:'string'},lectura_id:{type:'string'},contenido:{type:'string',description:'Solo si necesitas aportar un texto concreto; omítelo para exportar la respuesta anterior sin repetirla.'}}},run:(args,opts)=>W.save(args,opts)};
 Z.agentGroups.exportacion={pattern:/word|docx|exporta|exportaci[oó]n|informe|reporte|guardar.*archivo/i,names:['exportar_word']};
 Z.tools.descubrir_herramientas.parameters.properties.categoria.enum.push('exportacion');
 const context=Z.agentToolContext.bind(Z);Z.agentToolContext=history=>{
  const result=context(history),previous=W.previousAnswer(history);
  if(previous)result.previousAnswer=previous;return result;
 };
 const system=Z.agentSystem.bind(Z);Z.agentSystem=()=>system()+" Puedes crear archivos Word .docx con exportar_word. Si el usuario dice «lo quiero en Word» o «expórtalo», llama exportar_word sin contenido para guardar el informe anterior con un selector de destino. No niegues esta capacidad ni sustituyas la acción por copiar y pegar. Si te da una tarea, usa tarea_id. No inventes la opción Word (.docx) en el menú Exportar colección de Zotero: esta exportación pertenece al complemento. Afirma que se guardó solo si el resultado es GUARDADO y proporciona la ruta; respeta CANCELADO. Distingue exportar un archivo de insertar citas activas: para estas últimas usa las notas citables y Zotero → Insertar nota en Word.";
 const runAgent=Z.runAgent.bind(Z);Z.runAgent=async function(history,options={}){
  const user=[...history].reverse().find(m=>m.role==='user'),text=String(user?.content||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().replace(/[.!?]+$/,'').trim();
  const direct=/^(?:(?:lo\s+)?(?:quiero|necesito)|pasalo|exportalo|guardalo|damelo)\s+(?:en|a)\s+(?:(?:un\s+)?(?:documento|archivo)\s+(?:de\s+)?)?word$/i.test(text),previous=W.previousAnswer(history);
  if(!direct||!previous)return runAgent(history,options);
  const onEvent=options.onEvent||(()=>{}),task=Z.taskJournal.start(user.content),counters={reads:0,writes:0,rejected:0,errors:0};
  Z.taskJournal.update(task,{status:'running'});onEvent('plan',{id:task,plan:{stages:['Preparar el informe anterior','Elegir el destino del archivo','Guardar el documento Word']}});
  try{
   onEvent('herramienta',{name:'exportar_word',args:{}});
   const result=await W.save({},{...options,toolContext:{previousAnswer:previous}});
   const saved=result.estado==='GUARDADO';counters.writes=saved?1:0;
   Z.taskJournal.update(task,{...counters,status:saved?'completed':'cancelled'});
   if(saved)onEvent('ejecutada',{name:'exportar_word',write:true,result});
   const answer=saved?'Documento Word guardado en: '+result.ruta+'\n\nPara citas actualizables, usa una nota con citas de Zotero y luego Insertar nota en Word.':result.mensaje;
   onEvent('respuesta',{text:answer});return history.concat({role:'assistant',content:answer});
  }catch(error){Z.taskJournal.update(task,{...counters,errors:1,status:options.signal?.aborted?'cancelled':'failed',lastError:String(error.message).slice(0,300)});throw error;}
 };
})(ZoteroIA);
