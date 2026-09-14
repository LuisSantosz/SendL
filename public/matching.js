(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SendLMatching=api;})(globalThis,function(){
"use strict";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
function matchDocument(file,records){
 const pending=reason=>({reason});
 if(file.analysisError)return pending("PDF sem leitura confiável: confira o documento.");
 const rows=records.filter(r=>!r.sentAt);
 if(!rows.length)return pending("Importe a remessa para associar automaticamente.");
 const text=norm(file.text), hay=norm(file.name)+"\n"+text;
 const kind=/BOLETO|FICHA DE COMPENSACAO|\bBOL[_ .-]/.test(hay)?"boleto":/DANFE|NOTA FISCAL|\bNF[E_ .-]/.test(hay)?"nota":"";
 if(!kind)return pending("Tipo de documento não identificado.");
 const recipients=new Set();
 for(const m of text.matchAll(/(?:PAGADOR|SACADO|DESTINATARIO(?:\s*\/\s*REMETENTE)?)([\s\S]{0,220})/g)){
  const section=m[1].split(/BENEFICIARIO|CEDENTE|EMITENTE|AVALISTA|TRANSPORTADOR/)[0];
  const id=section.match(/(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|\b\d{14}\b|\b\d{11}\b)/);
  if(id)recipients.add(id[0].replace(/\D/g,""));
 }
 if(recipients.size>1)return pending("PDF contém mais de um destinatário.");
 const titles=new Set();
 for(const r of rows){
  const title=norm(r.nota);
  if(title&&!/^\d+$/.test(title)){
   const escaped=title.replace(/[.*+?^$()|[\]{}\\]/g,"\\$&");
   if(new RegExp("(^|[^A-Z0-9])"+escaped+"(?=$|[^A-Z0-9])").test(hay))titles.add(r.documento);
  }
 }
 const invoices=new Set();
 for(const m of hay.matchAll(/(?:^|\D)(\d{44})(?!\d)/g))invoices.add(String(Number(m[1].slice(25,34))));
 for(const m of hay.matchAll(/(?:NFE?|NOTA(?:\s*FISCAL)?(?:\s*ELETRONICA)?)\s*[_\s().:#-]*0*(\d{1,9})(?!\d)/g))invoices.add(String(Number(m[1])));
 for(const r of rows)if(/^\d+$/.test(String(r.nota))&&invoices.has(String(Number(r.nota))))titles.add(r.documento);
 if(titles.size>1)return pending("Número de título/nota corresponde a mais de um cliente.");
 const recipient=[...recipients][0], titleDoc=[...titles][0];
 if(recipient&&titleDoc&&recipient!==titleDoc)return pending("CPF/CNPJ diverge do título da remessa.");
 const documento=recipient||titleDoc;
 if(!documento||!rows.some(r=>r.documento===documento))return pending("Não foi encontrada correspondência na remessa.");
 return {documento,kind,reason:recipient?"CPF/CNPJ do destinatário na remessa":"Título/nota da remessa"};
}
return {matchDocument};
});
