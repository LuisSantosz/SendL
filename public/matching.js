(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SendLMatching=api;})(globalThis,function(){
"use strict";
const key=s=>String(s||"").replace(/\D/g,"").padStart(14,"0");
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
// Confirmed SendL Santander layout: 501 + seven-digit NF + two-digit installment.
function fiscalTitle(value){
 const s=String(value||"").trim(),m=s.match(/^501(\d{7})-(\d{2})$/);
 return m?{nota:String(Number(m[1])),parcela:String(Number(m[2]))}:/^\d{1,9}$/.test(s)?{nota:String(Number(s)),parcela:""}:null;
}
function matchDocument(file,records){
 const pending=reason=>({reason});
 if(file.analysisError)return pending("PDF sem leitura confiável: confira o documento.");
 const rows=records.filter(r=>!r.sentAt).map(r=>({...r,originalDocument:r.documento,documento:key(r.documento)}));
 if(!rows.length)return pending("Importe a remessa para associar automaticamente.");
 const text=norm(file.text), hay=norm(file.name)+"\n"+text;
 const kind=/BOLETO|FICHA DE COMPENSACAO|PAGAVEL PREFERENCIALMENTE|\bBOL[_ .-]/.test(hay)?"boleto":/DANFE|NOTA FISCAL|\bNF[E_ .-]/.test(hay)?"nota":"";
 if(!kind)return pending("Tipo de documento não identificado.");
 const recipients=new Set();
 for(const m of text.matchAll(/(?:\bPAGADOR\b|\bSACADO\b|\bDESTINATARIO\b(?:\s*\/\s*REMETENTE)?)(?=([\s\S]{0,220}))/g)){
  const section=m[1].split(/BENEFICIARIO|CEDENTE|EMITENTE|SACADOR|AVALISTA|TRANSPORTADOR|\bPAGADOR\b|\bSACADO\b|\bDESTINATARIO\b|NOSSO NUMERO|NUMERO DO DOCUMENTO|AUTENTICACAO|CODIGO DE BARRAS/)[0];
  const id=section.match(/(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}[-.]\d{2}|\b\d{14}\b|\b\d{11}\b)/);
  if(id)recipients.add(key(id[0]));
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
 const installmentRefs=[];
 if(kind==="boleto"&&/NUMERO DO DOCUMENTO/.test(text)){
  for(const ref of text.matchAll(/\b(\d{9})\s*\/\s*(\d{5})\b/g)){
   invoices.add(String(Number(ref[1])));
   installmentRefs.push({nota:String(Number(ref[1])),parcela:String(Number(ref[2]))});
  }
 }
 const bol=norm(file.name).match(/\bBOL(?:ETO)?[_ .-]*0*(\d{1,9})(?!\d)/);
 const subject=norm(file.subject);
 const subjectNF=subject.match(/(?:NFE?|NOTA FISCAL(?: ELETRONICA)?)\s*[_\s().:#-]*0*(\d{1,9})(?!\d)/);
 if(bol&&subjectNF&&Number(bol[1])===Number(subjectNF[1]))invoices.add(String(Number(bol[1])));
 for(const r of rows){
  const fiscal=fiscalTitle(r.nota);
  if(fiscal&&invoices.has(fiscal.nota)){
   if(kind==="boleto"&&installmentRefs.length&&fiscal.parcela&&!installmentRefs.some(ref=>ref.nota===fiscal.nota&&ref.parcela===fiscal.parcela))continue;
   titles.add(r.documento);
  }
 }
 if(titles.size>1)return pending("Número de título/nota corresponde a mais de um cliente.");
 const recipient=[...recipients][0], titleDoc=[...titles][0];
 if(recipient&&titleDoc&&recipient!==titleDoc)return pending("CPF/CNPJ diverge do título da remessa.");
 // A known customer alone does not prove that this PDF belongs to this remittance.
 const paymentMatch=recipient&&rows.some(r=>{
  if(r.documento!==recipient||!r.vencimento||!Number.isFinite(Number(r.valor)))return false;
  const date=String(r.vencimento).split("-").reverse().join("/");
  const amount=Number(r.valor).toFixed(2).replace(".",",");
  const formatted=amount.replace(/\B(?=(\d{3})+(?!\d))/g,".");
  const compact=text.replace(/[ \t]/g,"");
  const hasAmount=[amount,formatted].some(value=>new RegExp("(^|[^0-9.,])"+value.replace(/[.,]/g,char=>"\\"+char)+"(?=$|[^0-9.,])").test(compact));
  return text.includes(date)&&hasAmount;
 });
 if(!titleDoc&&!paymentMatch)return pending("Documento não corresponde ao título ou ao valor/vencimento da remessa.");
 const documento=recipient||titleDoc;
 if(!documento||!rows.some(r=>r.documento===documento))return pending("Não foi encontrada correspondência na remessa.");
 return {documento:rows.find(r=>r.documento===documento).originalDocument,kind,nota:invoices.size===1?[...invoices][0]:"",reason:recipient?"CPF/CNPJ do destinatário na remessa":"Título/nota da remessa"};
}
function remessaQueries(records,base){
 const terms=new Set();
 for(const r of records.filter(r=>!r.sentAt)){
  const title=String(r.nota||"").replace(/[^A-Za-z0-9./-]/g,"");
  if(title){
   terms.add('"'+title+'"');
   const fiscal=fiscalTitle(title);
   if(fiscal){const n=fiscal.nota;terms.add('"'+n+'"');terms.add('"'+n.padStart(9,"0")+'"');}
  }
  const doc=String(r.documento||"").replace(/\D/g,"");
  if(doc){
   terms.add('"'+doc+'"');terms.add('"'+key(doc)+'"');
   const short=doc.replace(/^0+/,"");
   if(short.length<=11){const cpf=short.padStart(11,"0");terms.add('"'+cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")+'"');}
   else terms.add('"'+key(doc).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5")+'"');
  }
 }
 if(!terms.size)throw Error("Importe o CNAB ou os títulos antes de buscar documentos.");
 const queries=[];let batch=[];
 for(const term of terms){
  if((base+" {"+[...batch,term].join(" ")+"}").length>500){
   if(!batch.length)throw Error("Reduza a busca adicional.");
   queries.push(base+" {"+batch.join(" ")+"}");batch=[];
  }
  batch.push(term);
 }
 if(batch.length)queries.push(base+" {"+batch.join(" ")+"}");
 if(queries.some(q=>q.length>500))throw Error("Reduza a busca adicional.");
 return queries;
}
return {matchDocument,remessaQueries,fiscalTitle};
});
