/* global ZoteroIA */
(function(Z){
 const R=Z.research;
 R.fullFragments=function(source,size=1000){
  const result=[];
  for(let pageIndex=0;pageIndex<source.pages.length;pageIndex++){
   const p=source.pages[pageIndex];
   for(let start=0;start<p.text.length;start+=size){const text=p.text.slice(start,start+size);if(!text.trim())continue;
    result.push({id:"E-"+source.signature.slice(0,12)+"-F-"+pageIndex+"-"+start,itemID:source.parent.id,attachmentID:source.attachment?.id||null,title:source.parent.getField("title"),text,start,end:start+text.length,page:p.page,pageVerified:p.pageVerified,kind:p.kind,origin:"document",url:this.link(source.attachment||source.parent,p.pageVerified?p.page:null)});
   }
  }
  return result;
 };
 R.fullRead=async function(item,objective,options={}){
  options={...options,meterId:options.meterId||this.id("reading")};
  const source=await this.source(item,{signal:options.signal,full:true}),columns=Z.matrixColumns.normalize(options.columns),manual=Math.max(0,Math.floor(Number(Z.pref("maxChars"))||0));
  if(manual>0&&manual<256)throw Error("Para leer por partes, usa al menos 256 caracteres por consulta o 0 para el ajuste automático.");
  const fragments=this.fullFragments(source,Math.min(1000,manual||1000));
  const annotations=this.select(this.spans({...source,pages:[]}),objective,2);
  const key="reading-"+await this.hash({version:1,source:source.signature,objective,columns,manual,instructions:String(Z.pref("systemPrompt")||"")});
  this.readingActive=this.readingActive||new Set();if(this.readingActive.has(key))throw Error("Ya hay una lectura de este documento en curso. Espera a que termine antes de repetirla.");this.readingActive.add(key);
  try{
   let state=await this.read(key,null);
   if(state&&(state.version!==1||state.signature!==source.signature||!Number.isInteger(state.next)||state.next<0||state.next>fragments.length||!state.fields||!Array.isArray(state.evidence)))throw Error("El avance de lectura no es válido. Se conserva para revisión; no se sobrescribirá.");
   const configuration=()=>({provider:String(Z.pref("provider")||""),model:String(Z.pref("model")||"")});
   if(state?.status==="completed"&&(!this.settings().cache||JSON.stringify(state.completedFor)!==JSON.stringify(configuration())))state=null;
   state=state||{version:1,signature:source.signature,next:0,fields:{},evidence:[],parts:0,modelsUsed:[],status:"reading"};
   const coverage=()=>({mode:"full",method:source.method,totalPages:source.totalPages,pagesWithText:source.pages.length,scannedPages:source.scannedPages,selectedSpans:state.next+annotations.length,totalSpans:fragments.length+annotations.length,selectedCharacters:fragments.slice(0,state.next).reduce((n,e)=>n+e.text.length,0),totalCharacters:source.characters,degraded:source.degraded,fullReading:state.next===fragments.length&&fragments.length>0&&!source.extractionTruncated,allRecoveredTextProcessed:state.next===fragments.length&&fragments.length>0,fullDocumentVerified:false,extractionTruncated:!!source.extractionTruncated,parts:state.parts,modelsUsed:state.modelsUsed||[],selection:"Texto recuperado analizado por partes consecutivas; anotaciones seleccionadas y comentarios diferenciados",highlights:annotations.filter(e=>e.origin==="highlight").length,comments:annotations.filter(e=>e.origin==="comment").length,annotationsOmitted:source.annotations?.omitted||0,annotationIssue:source.annotations?.issue||null});
   if(!fragments.length){
    return this.analyzeEvidence(item,objective,{...options,columns,prepared:{source,evidence:annotations,coverage:{...coverage(),fullReading:false}}});
   }
   while(state.next<fragments.length){
    Z.checkAbort(options.signal);
    const batch=[],cap=Math.max(1,Math.min(16000,manual||16000));let length=0;
    for(let i=state.next;i<fragments.length;i++){const span=fragments[i];if(batch.length&&length+span.text.length>cap)break;batch.push(span);length+=span.text.length;}
    options.onReadingProgress?.({part:state.parts+1,done:state.next,total:fragments.length,characters:coverage().selectedCharacters});
    const row=await this.analyzeEvidence(item,objective,{...options,columns,priorFields:state.fields,priorEvidence:state.evidence,prepared:{source,evidence:batch.concat(annotations),coverage:coverage()}});
    Z.checkAbort(options.signal);
    state={...state,next:state.next+batch.length,parts:state.parts+1,fields:row.fields,evidence:row.evidence,status:state.next+batch.length===fragments.length?"completed":"reading",updatedAt:new Date().toISOString(),completedFor:configuration(),modelsUsed:[...new Set([...(state.modelsUsed||[]),String(Z.lastModel||Z.pref("model")||"modelo configurado")])]};
    await this.write(key,state);
    options.onReadingProgress?.({part:state.parts,done:state.next,total:fragments.length,characters:coverage().selectedCharacters});
   }
   const row={itemID:item.id,key:item.key,libraryID:item.libraryID,title:item.getField("title"),authors:Z.summarize(item).autores,year:Z.summarize(item).año,status:"done",sourceSignature:source.signature,modified:item.getField("dateModified"),fields:state.fields,evidence:state.evidence,coverage:coverage(),generatedAt:state.updatedAt||new Date().toISOString()};
   return row;
  }catch(e){
   if(e.name==="BudgetLimitError")e.message+=" El avance por partes está guardado hasta la última respuesta completada. Reanuda la tarea o vuelve a pulsar el mismo botón de lectura después de revisar el límite.";
   throw e;
  }finally{this.readingActive.delete(key);}
 };
 R.analyze=(item,objective,options={})=>R.fullRead(item,objective,options);
})(ZoteroIA);
