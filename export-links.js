/* global ZoteroIA, TextDecoder, TextEncoder */
(function(Z){const R=Z.research, base=R.exportBytes;
 const link=e=>typeof e.url==='string'&&/^(?:https?:\/\/|zotero:\/\/(?:select|open-pdf)\/)/i.test(e.url.trim())&&!/[\u0000-\u0020]/.test(e.url.trim())?e.url.trim():'';
 const cell=v=>String(v??'').slice(0,32767).replace(/[\uD800-\uDBFF]$/,'');
 function unpack(bytes){const files={},view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let pos=0;while(view.getUint32(pos,true)===0x04034b50){if(view.getUint16(pos+8,true)!==0)throw Error("Formato ZIP interno inesperado");const size=view.getUint32(pos+18,true),names=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true);const name=new TextDecoder().decode(bytes.slice(pos+30,pos+30+names)),start=pos+30+names+extra;files[name]=new TextDecoder().decode(bytes.slice(start,start+size));pos=start+size;}return files;}
 R.exportBytes=(runId,format)=>{const bytes=base(runId,format);if(!['docx','xlsx'].includes(format))return bytes;const files=unpack(bytes),run=R.getRun(runId),evidence=run.rows.flatMap(row=>(row.evidence||[]).map(e=>({...e,document:row.title}))),X=R.OOXML.xml;
  if(format==='docx'){
   let links='',relationships='';let index=1;
   for(const e of evidence){const rid='evidence'+index++,url=link(e);const label=e.id+' · '+e.document+' · '+(e.pageVerified?'Página PDF '+e.page:'Página no verificada');
    const text='<w:r><w:t>'+X(label)+'</w:t></w:r>';
    links+='<w:p>'+(url?'<w:hyperlink r:id="'+rid+'">'+text+'</w:hyperlink>':text)+'</w:p>';
    if(url)relationships+='<Relationship Id="'+rid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="'+X(url)+'" TargetMode="External"/>';
   }
   files['word/document.xml']=files['word/document.xml'].replace('<w:document ', '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ').replace('<w:sectPr>',links+'<w:sectPr>');
   files['word/_rels/document.xml.rels']='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+relationships+'</Relationships>';
  }else{
   const table=[['Documento','ID de evidencia','Tipo de fuente','Página PDF','Fragmento','Abrir fuente'],...evidence.map(e=>[e.document,e.id,e.kind,e.pageVerified?e.page:'No verificada',e.text,link(e)])];
   const linked=evidence.map((e,i)=>({url:link(e),index:i})).filter(e=>e.url);
   const sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="6" width="44" customWidth="1"/></cols><sheetData>'+table.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>'<c r="'+String.fromCharCode(65+j)+(i+1)+'" t="inlineStr" s="0"><is><t xml:space="preserve">'+X(cell(v))+'</t></is></c>').join('')+'</row>').join('')+'</sheetData><autoFilter ref="A1:F'+table.length+'"/>'+(linked.length?'<hyperlinks>'+linked.map(e=>'<hyperlink ref="F'+(e.index+2)+'" r:id="evidence'+e.index+'"/>').join('')+'</hyperlinks>':'')+'</worksheet>';
   files['xl/worksheets/sheet2.xml']=sheet;
   files['xl/worksheets/_rels/sheet2.xml.rels']='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+linked.map(e=>'<Relationship Id="evidence'+e.index+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="'+X(e.url)+'" TargetMode="External"/>').join('')+'</Relationships>';
   files['xl/workbook.xml']=files['xl/workbook.xml'].replace('</sheets>','<sheet name="Evidencias" sheetId="2" r:id="rId3"/></sheets>');
   files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels'].replace('</Relationships>','<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
   files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>','<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  }return R.OOXML.zip(files);
 };
})(ZoteroIA);
