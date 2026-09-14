"use strict";
const D=window.SendL, $=id=>document.getElementById(id), esc=D.escapeHtml;
const STATE_KEY="sendl_workspace_v2", PAGE_SIZE=25, MAX_BYTES=12*1024*1024;
function read(key,fallback) {
  const raw=localStorage.getItem(key);
  if(!raw) return fallback;
  try { return JSON.parse(raw); } catch { throw new Error("Dados locais inválidos em "+key+". Exporte uma cópia antes de limpar o navegador."); }
}
let state, files=[], db, gmailState={connected:false}, page={}, activeView="dashboard", sendGroup=null, gmailPage=null, gmailQuery="", testOperation=null, toastTimer;
const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const uid=()=>crypto.randomUUID();
function toast(message) { $("toast").textContent=message; $("toast").classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$("toast").classList.remove("show"),7000); }
function update(mutator) {
  const next=structuredClone(state); mutator(next);
  next.logs=next.logs.slice(0,200);
  localStorage.setItem(STATE_KEY,JSON.stringify(next)); state=next;
}
function log(title,description="") {
  update(s=>s.logs.unshift({title,description,createdAt:new Date().toISOString()}));
}
async function api(url,body) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),90000);
  try {
    const res=await fetch(url,{method:body===undefined?"GET":"POST",credentials:"same-origin",
      headers:{"X-SendL":"1",...(body===undefined?{}:{"Content-Type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
    if(!(res.headers.get("content-type")||"").includes("application/json")) throw new Error("O servidor retornou uma resposta inválida. Abra o SendL pelo endereço do backend.");
    const data=await res.json();
    if(!res.ok) {
      if(res.status===401 && !url.includes("/session/login")) {
        const check=await fetch("/api/session",{credentials:"same-origin"}).then(r=>r.json()).catch(()=>null);
        if(check && !check.authenticated) document.body.classList.add("locked");
      }
      throw new Error(data.error || "Não foi possível concluir a solicitação.");
    }
    return data;
  } catch(error) {
    if(error.name==="AbortError") throw new Error("O servidor demorou a responder. Se estava enviando, confira o resultado antes de tentar novamente.");
    if(error instanceof TypeError) throw new Error("Não foi possível acessar o servidor. Confira a conexão e o endereço do SendL.");
    throw error;
  } finally { clearTimeout(timer); }
}
let busy=false;
function action(id,event,handler) {
  $(id).addEventListener(event,async e=>{
    if(event==="submit") e.preventDefault();
    if(busy) return toast("Aguarde a operação atual.");
    busy=true;
    const controls=[...e.currentTarget.querySelectorAll("button")];
    if(e.currentTarget.tagName==="BUTTON") controls.push(e.currentTarget);
    controls.forEach(b=>b.disabled=true);
    try { await handler(e); } catch(error) { toast(error.message); }
    finally { controls.forEach(b=>b.disabled=false); busy=false; }
  });
}
function openDb() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open("sendl_documents_v2",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("files",{keyPath:"id"});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error("Não foi possível abrir o armazenamento de PDFs."));
    request.onblocked=()=>reject(new Error("Feche outras abas do SendL e tente novamente."));
  });
}
function transaction(mode,work) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("files",mode), store=tx.objectStore("files"); let result;
    try { result=work(store); } catch(error) {tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve(result?.result);
    tx.onerror=()=>reject(tx.error || new Error("Erro ao salvar PDFs. Confira o espaço disponível."));
    tx.onabort=()=>reject(tx.error || new Error("Operação de arquivos cancelada."));
  });
}
async function reloadFiles() { files=await transaction("readonly",s=>s.getAll()); }
function allGroups() {
  const groups=D.groups(state.records,state.clients,files);
  for(const [doc,op] of Object.entries(state.operations)) {
    if(!groups.some(g=>g.documento===doc)) groups.push({documento:doc,cliente:state.clients.find(c=>c.documento===doc)?.cliente||doc,email:op.to,records:[],files:[],ready:false,total:0});
  }
  return groups;
}
function locked(doc) { return Boolean(state.operations[doc]); }
function assertEditable(doc) { if(locked(doc)) throw new Error("Confira o resultado do envio anterior deste cliente antes de alterar os documentos."); }
function paginate(name,items) {
  const total=Math.max(1,Math.ceil(items.length/PAGE_SIZE));
  page[name]=Math.min(page[name]||1,total);
  $(name+"Pager").innerHTML='<button class="btn subtle" data-page="'+name+'" data-step="-1" '+(page[name]===1?"disabled":"")+'>Anterior</button><span>'+page[name]+' / '+total+' · '+items.length+' registros</span><button class="btn subtle" data-page="'+name+'" data-step="1" '+(page[name]===total?"disabled":"")+'>Próxima</button>';
  return items.slice((page[name]-1)*PAGE_SIZE,page[name]*PAGE_SIZE);
}
function search(items,input,fields) {
  const q=$(input).value.toLocaleLowerCase("pt-BR").trim();
  return q ? items.filter(item=>fields.some(key=>String(item[key]||"").toLocaleLowerCase("pt-BR").includes(q))) : items;
}
function empty(cols,message) { return '<tr><td colspan="'+cols+'" class="empty">'+message+"</td></tr>"; }
function navigate(view) {
  activeView=view;
  document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.id===view));
  document.querySelectorAll(".nav-item").forEach(el=>{
    el.classList.toggle("active",el.dataset.view===view);
    if(el.dataset.view===view) { el.setAttribute("aria-current","page"); $("pageTitle").textContent=el.childNodes[0].textContent.trim(); }
    else el.removeAttribute("aria-current");
  });
  render();
}
function render() {
  const groups=allGroups();
  $("queueCount").textContent=groups.length;
  $("statClients").textContent=state.clients.length; $("statRecords").textContent=state.records.length;
  $("statReady").textContent=groups.filter(g=>g.ready&&!locked(g.documento)).length;
  $("statPending").textContent=groups.filter(g=>!g.ready||locked(g.documento)).length;
  if(activeView==="dashboard") $("logs").innerHTML=state.logs.slice(0,30).map(l=>'<div class="log"><div><strong>'+esc(l.title)+'</strong><p>'+esc(l.description)+'</p></div><small>'+esc(new Date(l.createdAt).toLocaleString("pt-BR"))+'</small></div>').join("")||'<div class="empty">Tudo pronto para começar. Importe sua base de clientes.</div>';
  if(activeView==="remessa") {
    const rows=paginate("records",search(state.records,"recordSearch",["cliente","documento","nota"]));
    $("recordsTable").innerHTML=rows.map(r=>'<tr><td>'+esc(r.cliente)+'</td><td>'+esc(r.documento)+'</td><td>'+esc(r.nota)+'</td><td>'+money.format(Number(r.valor))+'</td><td>'+esc(r.vencimento?.split("-").reverse().join("/"))+'</td><td>'+ (r.sentAt?"Enviado":"Na fila")+'</td></tr>').join("")||empty(6,"Nenhum título encontrado.");
  }
  if(activeView==="clientes") {
    const rows=paginate("clients",search(state.clients,"clientSearch",["cliente","documento","email"]));
    $("clientsTable").innerHTML=rows.map(c=>'<tr><td>'+esc(c.cliente)+'</td><td>'+esc(c.documento)+'</td><td>'+esc(c.email||"Não informado")+'</td><td>'+esc(c.estado||"—")+'</td><td><button class="btn subtle" data-edit-client="'+esc(c.id)+'">Editar</button></td></tr>').join("")||empty(5,"Nenhum cliente encontrado.");
  }
  if(activeView==="fila") {
    const rows=paginate("queue",search(groups,"queueSearch",["cliente","documento","email"]));
    $("queueList").innerHTML=rows.map(g=>'<article class="queue-card"><div><h3>'+esc(g.cliente)+'</h3><p>'+esc(g.documento)+' · '+esc(g.email||"E-mail não cadastrado")+'</p><p>'+g.records.length+' título(s) · '+g.files.length+' PDF(s) · '+money.format(g.total)+'</p><span class="badge '+(g.ready&&!locked(g.documento)?"ok":"warn")+'">'+(locked(g.documento)?"Conferir envio anterior":g.ready?"Pronto para conferir":!D.validEmail(g.email)?"Falta um e-mail válido":"Falta vincular PDF")+'</span></div><div class="actions">'+(locked(g.documento)?'<button class="btn subtle" data-resolve="'+g.documento+'">Conferir resultado</button>':'<button class="btn primary" data-send="'+g.documento+'" '+(!g.ready||!gmailState.connected?"disabled":"")+'>Conferir e enviar</button>')+'</div></article>').join("")||'<div class="empty">A fila está vazia. Importe títulos ou vincule PDFs para começar.</div>';
  }
  if(activeView==="documentos") {
    const selected=$("fileClient").value;
    $("fileClient").innerHTML='<option value="">Selecione o cliente</option>'+[...state.clients].sort((a,b)=>a.cliente.localeCompare(b.cliente)).map(c=>'<option value="'+esc(c.documento)+'">'+esc(c.cliente)+' · '+esc(c.documento)+'</option>').join("");
    $("fileClient").value=selected;
    const directory=new Map(state.clients.map(c=>[c.documento,c.cliente]));
    $("filesTable").innerHTML=paginate("files",files).map(f=>'<tr><td>'+esc(directory.get(f.documento)||f.documento)+'</td><td>'+esc(f.name)+'</td><td>'+esc(f.kind==="nota"?"Nota":"Boleto")+'</td><td><input aria-label="Número da nota" data-invoice="'+esc(f.id)+'" maxlength="30" value="'+esc(f.nota)+'" '+(f.sentAt||locked(f.documento)?"disabled":"")+'></td><td>'+(f.sentAt?"Enviado":"Na fila")+'</td><td><div class="actions"><button class="btn subtle" data-preview="'+esc(f.id)+'">Abrir</button><button class="btn danger" data-remove-file="'+esc(f.id)+'" '+(locked(f.documento)?"disabled":"")+'>Remover</button></div></td></tr>').join("")||empty(6,"Nenhum PDF vinculado.");
  }
}
async function refreshGmail() {
  try { gmailState=await api("/api/auth/gmail/status"); }
  catch(error) { gmailState={connected:false,message:error.message}; }
  $("connectionPill").textContent="Gmail · "+(gmailState.connected?"conectado":"não conectado");
  $("connectionPill").className="badge "+(gmailState.connected?"ok":"warn");
  $("gmailStatus").textContent=gmailState.connected?"Conta conectada":"Conexão pendente";
  $("gmailDetails").textContent=gmailState.message||gmailState.email||"Conecte sua conta para buscar e enviar documentos.";
  try {
    const config=await api("/api/auth/gmail/config");
    const issues=[...(config.missing?.length?["Preencha no .env: "+config.missing.join(", ")+"."]:[]),...(config.redirectMatches?[]:["A URL de retorno precisa corresponder ao endereço em que o SendL está rodando."])];
    $("gmailSetup").hidden=false;
    $("gmailSetup").textContent="Conta de coleta: "+(config.email||"não configurada")+". URL de retorno para cadastrar no Google: "+config.expectedRedirectUri+". "+issues.join(" ");
  } catch(error) { $("gmailSetup").hidden=false;$("gmailSetup").textContent=error.message; }
  render();
}
let excelLibrary;
const workbookCache=new WeakMap();
function loadExcel() {
  if(window.XLSX)return Promise.resolve(window.XLSX);
  if(!excelLibrary)excelLibrary=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="/vendor/xlsx.full.min.js";
    script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error("Leitor Excel indisponível."));
    script.onerror=()=>{script.remove();excelLibrary=null;reject(new Error("Não foi possível carregar o leitor Excel. Execute npm install e reinicie o servidor."));};
    document.head.append(script);
  });
  return excelLibrary;
}
async function prepareExcel(input) {
  const file=$(input).files[0],prefix=input==="clientsFile"?"clients":"records",label=$(prefix+"SheetLabel"),select=$(prefix+"Sheet");
  if(!file||!/\.(xlsx|xls)$/i.test(file.name)){label.hidden=true;select.replaceChildren();return null;}
  if(file.size>10*1024*1024)throw new Error("O arquivo deve ter até 10 MB.");
  if(workbookCache.has(file))return workbookCache.get(file);
  const XLSX=await loadExcel(),result=SendLExcel.read(XLSX,await file.arrayBuffer());
  select.replaceChildren();
  if(result.names.length>1)select.add(new Option("Selecione a planilha",""));
  result.names.forEach(name=>select.add(new Option(name,name)));
  label.hidden=result.names.length===1;
  workbookCache.set(file,result);
  return result;
}
async function excelTemplate(kind) {
  const XLSX=await loadExcel();
  const rows=kind==="clients"?[["cliente","documento","email","estado"],["CLIENTE EXEMPLO","12345678000199","financeiro@exemplo.com","SP"]]:
    [["cliente","documento","nota","valor","vencimento"],["CLIENTE EXEMPLO","12345678000199","42215",150,"2026-09-30"]];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),kind==="clients"?"Clientes":"Titulos");
  download(kind==="clients"?"clientes-modelo.xlsx":"titulos-modelo.xlsx",XLSX.write(book,{bookType:"xlsx",type:"array"}),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
async function importText(input) {
  const file=$(input).files[0]; if(!file) throw new Error("Selecione um arquivo.");
  if(file.size>10*1024*1024) throw new Error("O arquivo deve ter até 10 MB.");
  if(/\.(xlsx|xls)$/i.test(file.name)) {
    const result=await prepareExcel(input),name=$(input==="clientsFile"?"clientsSheet":"recordsSheet").value;
    if(!name)throw new Error("Escolha a planilha do arquivo antes de importar.");
    return SendLExcel.csv(await loadExcel(),result.book,name);
  }
  const bytes=await file.arrayBuffer();
  try { return new TextDecoder("utf-8",{fatal:true}).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}
function clientEditor(id) {
  const c=state.clients.find(item=>item.id===id), form=$("clientEditor");
  form.reset();
  for(const name of ["id","cliente","documento","email","estado"]) form.elements[name].value=c?.[name]||"";
  form.elements.documento.readOnly=Boolean(c);
  $("clientDialog").showModal();
}
function download(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement("a");
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function csvValue(value) {
  let s=String(value??""); if(/^[=+\-@\t\r]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
async function base64(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Não foi possível ler o PDF."));
    reader.readAsDataURL(blob);
  });
}
function blobFromBase64(value) {
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  return new Blob([bytes],{type:"application/pdf"});
}
async function fileHash(blob) {
  const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function attach(blobs,doc,kind,sourcePrefix="local",quiet=false) {
  assertEditable(doc);
  if(!state.clients.some(c=>c.documento===doc)) throw new Error("Selecione um cliente cadastrado.");
  const additions=[]; let duplicates=0;
  const hashes=new Set(files.filter(f=>!f.sentAt&&f.documento===doc).map(f=>f.hash));
  for(const item of blobs) {
    const blob=item.blob, name=item.name;
    if(blob.size>MAX_BYTES || !/\.pdf$/i.test(name) || name.length>180 || /[\r\n/\\\x00]/.test(name)) throw new Error("PDF inválido ou maior que 12 MB: "+name);
    if(await blob.slice(0,5).text()!=="%PDF-") throw new Error("O arquivo não é um PDF: "+name);
    const hash=await fileHash(blob);
    if(hashes.has(hash)) {duplicates++;continue;}
    hashes.add(hash);
    additions.push({id:uid(),documento:doc,kind,nota:D.invoiceNumber(name),name,blob,hash,source:sourcePrefix,createdAt:new Date().toISOString()});
  }
  await transaction("readwrite",s=>additions.forEach(f=>s.put(f)));
  await reloadFiles(); log("Documentos vinculados",additions.length+" PDF(s); "+duplicates+" duplicado(s) ignorado(s).");
  render();if(!quiet)toast(additions.length+" PDF(s) vinculado(s). "+duplicates+" duplicado(s) ignorado(s).");
  return additions.length;
}
function preview(id) {
  const f=files.find(item=>item.id===id); if(!f) return;
  const url=URL.createObjectURL(f.blob); window.open(url,"_blank","noopener");setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function openSend(doc) {
  assertEditable(doc);
  const group=allGroups().find(g=>g.documento===doc);
  if(!group?.ready) throw new Error("Complete o e-mail e os anexos do cliente.");
  if(group.files.reduce((sum,f)=>sum+f.blob.size,0)>MAX_BYTES || group.files.length>30) throw new Error("O grupo excede 12 MB ou 30 PDFs. Remova alguns anexos antes de enviar.");
  sendGroup=group; $("sendClient").textContent=group.cliente+" · "+doc; $("sendTo").value=group.email;
  const notas=[...new Set(group.files.map(f=>f.nota).filter(Boolean))].join(", ");
  const boleto=group.files.some(f=>f.kind==="boleto"), nota=group.files.some(f=>f.kind==="nota");
  $("sendSubject").value=(boleto&&nota?"Boletos e Notas Fiscais":boleto?"Boleto(s) Bancário Referente à NFe":"Nota Fiscal Eletronica")+(notas?" ("+notas+")":"");
  $("sendText").value="Olá, "+group.cliente+"!\n\nEncaminhamos em anexo "+(boleto&&nota?"os boletos e as notas fiscais":boleto?"o(s) boleto(s)":"a(s) nota(s) fiscal(is)")+".\n\nEm caso de dúvidas, responda a este e-mail.\n\nAtenciosamente,\nEdel White Brasil";
  $("sendFiles").innerHTML=group.files.map(f=>'<div class="attachment"><span>'+esc(f.name)+' · '+(f.blob.size/1024).toFixed(0)+' KB</span><button type="button" class="btn subtle" data-preview="'+esc(f.id)+'">Abrir PDF</button></div>').join("");
  $("sendDialog").showModal();
}
async function markSent(doc,op) {
  const sentAt=new Date().toISOString(), fileIds=new Set(op.fileIds), recordIds=new Set(op.recordIds);
  await transaction("readwrite",s=>files.filter(f=>fileIds.has(f.id)).forEach(f=>s.put({...f,sentAt})));
  update(s=>{
    s.records=s.records.map(r=>recordIds.has(r.id)?{...r,sentAt}:r);
    delete s.operations[doc];
    s.logs.unshift({title:"Documentos enviados",description:"Envio concluído para "+op.to,createdAt:sentAt});
  });
  await reloadFiles(); render();
}
async function resolveOperation(doc) {
  const op=state.operations[doc]; if(!op) return;
  const remote=await api("/api/email/operations/"+op.id);
  if(remote.status==="sent") {await markSent(doc,op);toast("O Gmail confirmou o envio. Fila atualizada.");return;}
  if(remote.status==="failed"||remote.status==="not_found") {
    update(s=>delete s.operations[doc]);render();toast("O servidor não registrou envio concluído. Você pode conferir e tentar novamente.");return;
  }
  if(Date.now()-Date.parse(remote.createdAt||op.createdAt)<90000) throw new Error("Aguarde 90 segundos antes de conferir.");
  if(!confirm("Abra a pasta Enviados do Gmail e procure a mensagem para "+op.to+". Você já conferiu o destinatário, o assunto e os anexos?")) return;
  const delivered=confirm("A mensagem foi encontrada em Enviados?\n\nOK = foi enviada.\nCancelar = não foi encontrada.");
  if(!delivered && !confirm("Confirma que o Gmail NÃO enviou esta mensagem? Isso liberará uma nova tentativa que pode duplicar o e-mail se a conferência estiver incorreta.")) return;
  await api("/api/email/operations/"+op.id+"/resolve",{delivered});
  if(delivered) await markSent(doc,op); else update(s=>delete s.operations[doc]);
  render();toast(delivered?"Envio confirmado manualmente.":"Nova tentativa liberada após sua conferência.");
}
async function searchGmail(next=false) {
 if(!next){gmailQuery=D.gmailQuery($("gmailType").value,$("gmailPeriod").value,$("gmailQuery").value);gmailPage=null;}
 $("gmailNext").hidden=true;
 $("gmailResults").textContent="Buscando e associando documentos à remessa…";
 const params=new URLSearchParams({q:gmailQuery});if(next&&gmailPage)params.set("pageToken",gmailPage);
 let linked=0,skipped=0,pending=0;const output=[];
 try{
  const result=await api("/api/gmail/documents?"+params);
  for(const m of result.messages){
   const items=[];
   for(const f of m.files){
    const source="gmail:"+m.id+":"+f.partId;let reason="";
    try{
     if(files.some(file=>file.source===source)){skipped++;items.push("<p>"+esc(f.name)+" — já coletado.</p>");continue;}
     const result=await api("/api/gmail/documents/"+encodeURIComponent(m.id)+"/attachment?"+new URLSearchParams({partId:f.partId,analyze:"1"}));
     const match=window.SendLMatching.matchDocument(result,state.records);
     if(match.documento){
      assertEditable(match.documento);
      if(!state.clients.some(c=>c.documento===match.documento)){
       const record=state.records.find(r=>r.documento===match.documento);
       update(s=>s.clients.push({id:uid(),documento:match.documento,cliente:record.cliente||match.documento,email:"",estado:""}));
      }
      const blob=blobFromBase64(result.contentBytes),hash=await fileHash(blob);
      if(files.some(file=>file.hash===hash)){skipped++;items.push("<p>"+esc(f.name)+" — PDF já coletado.</p>");continue;}
      const count=await attach([{name:result.name,blob}],match.documento,match.kind,source,true);
      linked+=count;
      items.push("<p>"+esc(f.name)+" — vinculado automaticamente a "+esc(state.clients.find(c=>c.documento===match.documento).cliente)+" ("+esc(match.reason)+").</p>");
      continue;
     }
     reason=match.reason;
    }catch(error){reason=error.message;}
    pending++;
    items.push("<p>"+esc(f.name)+" — Pendente: "+esc(reason)+"</p>"+'<button class="btn subtle" data-gmail-message="'+esc(m.id)+'" data-gmail-part="'+esc(f.partId)+'">Vincular manualmente '+esc(f.name)+'</button>');
   }
   output.push('<div class="mail-result"><strong>'+esc(m.subject)+'</strong><small>'+esc(m.from)+' · '+esc(m.date)+'</small>'+items.join("")+'</div>');
   $("gmailResults").innerHTML="<p>"+linked+" vinculado(s), "+skipped+" já coletado(s), "+pending+" pendente(s).</p>"+output.join("");
  }
  if(!result.messages.length)$("gmailResults").textContent="Nenhum PDF encontrado nesta página.";
  gmailPage=result.nextPageToken;$("gmailNext").hidden=!gmailPage;
  toast(linked+" PDF(s) vinculado(s) automaticamente; "+pending+" pendente(s).");
 }catch(error){$("gmailResults").textContent=error.message;throw error;}
}
async function exportBackup() {
  const entries=[];
  for(const file of files) {const {blob,...meta}=file;entries.push({...meta,contentBytes:await base64(blob)});}
  download("sendl-backup-"+new Date().toISOString().slice(0,10)+".json",JSON.stringify({version:2,exportedAt:new Date().toISOString(),state,files:entries}),"application/json");
  toast("Backup exportado com clientes, títulos, histórico e PDFs.");
}
async function restoreBackup() {
  if(Object.keys(state.operations).length) throw new Error("Confira os envios pendentes antes de restaurar.");
  const file=$("backupFile").files[0];
  if(!file || file.size>100*1024*1024) throw new Error("Selecione um backup de até 100 MB.");
  const backup=JSON.parse(await file.text());
  if(backup.version!==2 || !Array.isArray(backup.state?.clients)||!Array.isArray(backup.state?.records)||!Array.isArray(backup.files)||!Array.isArray(backup.state?.logs)||!backup.state?.operations) throw new Error("Backup incompatível.");
  if(Object.keys(backup.state.operations).length) throw new Error("O backup tem envios não conferidos. Confira-os no navegador original antes de restaurar.");
  const clients=backup.state.clients;
  if(clients.some(c=>typeof c.id!=="string"||typeof c.cliente!=="string"||![11,14].includes(D.documentId(c.documento).length)||c.documento!==D.documentId(c.documento)||c.email&&!D.validEmail(c.email))) throw new Error("O backup contém clientes inválidos.");
  if(backup.state.records.some(r=>typeof r.id!=="string"||![11,14].includes(D.documentId(r.documento).length)||!D.isoDate(r.vencimento)||!Number.isFinite(Number(r.valor)))) throw new Error("O backup contém títulos inválidos.");
  const restored=[];
  for(const entry of backup.files) {
    if(typeof entry.id!=="string"||![11,14].includes(D.documentId(entry.documento).length)||!["nota","boleto"].includes(entry.kind)||typeof entry.contentBytes!=="string") throw new Error("Vinculação inválida no backup.");
    const blob=blobFromBase64(entry.contentBytes);
    if(blob.size>MAX_BYTES || await blob.slice(0,5).text()!=="%PDF-" || !/\.pdf$/i.test(entry.name)) throw new Error("PDF inválido no backup.");
    const {contentBytes,...meta}=entry;restored.push({...meta,blob,hash:await fileHash(blob)});
  }
  if(!confirm("Restaurar irá substituir os dados e PDFs deste navegador. Exporte o backup atual antes de continuar. Deseja substituir?")) return;
  // Write metadata first to detect localStorage quota errors before replacing PDFs.
  const old=localStorage.getItem(STATE_KEY);
  localStorage.setItem(STATE_KEY,JSON.stringify(backup.state));
  try { await transaction("readwrite",s=>{s.clear();restored.forEach(f=>s.put(f));}); }
  catch(error) {if(old===null)localStorage.removeItem(STATE_KEY);else localStorage.setItem(STATE_KEY,old);throw error;}
  state=backup.state;await reloadFiles();render();toast("Backup restaurado.");
}
async function start() {
  if(!navigator.locks) throw new Error("Abra o SendL por HTTPS (ou localhost), usando um navegador atualizado.");
  await new Promise((resolve,reject)=>{
    navigator.locks.request("sendl-workspace-editor",{ifAvailable:true},lock=>{
      if(!lock){reject(new Error("O SendL já está aberto em outra aba. Feche a outra aba e atualize esta página."));return;}
      resolve();
      return new Promise(()=>{});
    }).catch(reject);
  });
  state=read(STATE_KEY,null)||{clients:read("sendl_clients_backend_v1",[]),records:read("sendl_records_backend_v1",[]),logs:read("sendl_logs_backend_v1",[]),operations:{}};
  if(!Array.isArray(state.clients)||!Array.isArray(state.records)||!Array.isArray(state.logs)) throw new Error("Os dados locais precisam ser revisados antes de abrir.");
  state.operations ||= {};
  db=await openDb();await reloadFiles();
  const theme=localStorage.getItem("sendl_theme")||"dark";
  function setTheme(value) {document.documentElement.dataset.theme=value;$("themeToggle").textContent=value==="dark"?"Tema claro":"Tema escuro";localStorage.setItem("sendl_theme",value);}
  setTheme(theme);
  $("themeToggle").addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
  function clock() {$("clock").textContent=new Date().toLocaleString("pt-BR",{dateStyle:"full",timeStyle:"short"});}
  clock();setInterval(clock,30000);
  action("loginForm","submit",async e=>{
    const form=e.currentTarget;
    const body=Object.fromEntries(new FormData(form));
    $("loginFeedback").textContent="Entrando…";
    try {await api("/api/session/login",body);document.body.classList.remove("locked");form.reset();$("loginFeedback").textContent="";await refreshGmail();}
    catch(error) {$("loginFeedback").textContent=error.message;throw error;}
  });
  action("logout","click",async()=>{await api("/api/session/logout",{});document.body.classList.add("locked");});
  action("refreshGmail","click",refreshGmail);
  action("disconnectGmail","click",async()=>{if(confirm("Desconectar o Gmail do SendL?")){await api("/api/auth/gmail/disconnect",{});await refreshGmail();}});
  action("clientsFile","change",()=>prepareExcel("clientsFile"));
  action("recordsFile","change",()=>prepareExcel("recordsFile"));
  action("clientsForm","submit",async()=>{
    const rows=D.parseCsv(await importText("clientsFile")), directory=new Map(state.clients.map(c=>[c.documento,c]));
    let imported=0,ignored=0;
    for(const row of rows) {
      const documento=D.documentId(row.documento||row.cnpj||row.cpf||row.cpf_cnpj||row.cnpj_cpf), cliente=D.clean(row.cliente||row.nome||row.razao_social);
      const email=D.clean(row.email||row.e_mail||row.email_financeiro||row.e_mail_financeiro).toLowerCase();
      if(!cliente||![11,14].includes(documento.length)||email&&!D.validEmail(email)) {ignored++;continue;}
      assertEditable(documento);
      const existing=directory.get(documento);
      directory.set(documento,{...existing,id:existing?.id||uid(),cliente,documento,email:email||existing?.email||"",estado:D.clean(row.estado||row.uf||existing?.estado).toUpperCase()});
      imported++;
    }
    if(!imported) throw new Error("Nenhum cliente válido. Confira o modelo CSV, CPF/CNPJ e e-mails.");
    update(s=>s.clients=[...directory.values()]);log("Base atualizada",imported+" linha(s) processada(s); "+ignored+" inválida(s).");
    $("clientsFeedback").textContent=imported+" linha(s) processada(s). "+ignored+" inválida(s) ignorada(s).";render();
  });
  action("recordsForm","submit",async()=>{
    const parsed=D.importRecords(await importText("recordsFile"));
    if(!parsed.rows.length) throw new Error("Nenhum título compatível encontrado. Use o modelo CSV ou revise o layout CNAB.");
    for(const row of parsed.rows) assertEditable(row.documento);
    const merged=D.mergeRecords(state.records,parsed.rows,uid);
    update(s=>s.records=merged.rows);log("Remessa importada",merged.added+" título(s) novo(s).");
    $("recordsFeedback").textContent=merged.added+" adicionado(s); "+merged.duplicates+" duplicado(s); "+parsed.ignored+" inválido(s) ignorado(s).";render();
  });
  action("filesForm","submit",async()=>{
    const selected=[...$("pdfFiles").files];if(!selected.length) throw new Error("Selecione os PDFs.");
    await attach(selected.map(blob=>({blob,name:blob.name})),$("fileClient").value,$("fileKind").value);
    $("pdfFiles").value="";
  });
  action("clientEditor","submit",async e=>{
    const form=new FormData(e.currentTarget), doc=D.documentId(form.get("documento")), id=form.get("id")||uid(), email=D.clean(form.get("email")).toLowerCase();
    assertEditable(doc);
    if(![11,14].includes(doc.length)||email&&!D.validEmail(email)) throw new Error("Confira o CPF/CNPJ e o e-mail.");
    if(state.clients.some(c=>c.documento===doc&&c.id!==id)) throw new Error("Este CPF/CNPJ já está cadastrado.");
    const client={id,documento:doc,cliente:D.clean(form.get("cliente")),email,estado:D.clean(form.get("estado")).toUpperCase()};
    update(s=>{const i=s.clients.findIndex(c=>c.id===id);if(i<0)s.clients.push(client);else s.clients[i]={...s.clients[i],...client};});
    $("clientDialog").close();render();toast("Cliente salvo.");
  });
  $("newClient").addEventListener("click",()=>clientEditor());
  action("clearClients","click",async()=>{
    if(Object.keys(state.operations).length) throw new Error("Confira os envios em andamento antes de limpar a base.");
    if(confirm("Limpar todos os clientes? Os títulos e PDFs permanecem, mas será necessário cadastrar novamente os e-mails.")) {update(s=>s.clients=[]);render();toast("Base de clientes limpa.");}
  });
  action("clearQueue","click",async()=>{
    if(Object.keys(state.operations).length) throw new Error("Confira o resultado de todos os envios antes de limpar a fila.");
    if(!confirm("Remover todos os títulos e PDFs ainda não enviados? Clientes, histórico e documentos enviados serão mantidos."))return;
    const pending=files.filter(f=>!f.sentAt);
    const previous=structuredClone(state);
    update(s=>s.records=s.records.filter(r=>r.sentAt));
    try {await transaction("readwrite",s=>pending.forEach(f=>s.delete(f.id)));}
    catch(error){localStorage.setItem(STATE_KEY,JSON.stringify(previous));state=previous;throw error;}await reloadFiles();log("Fila limpa");render();
  });
  action("sendForm","submit",async()=>{
    const group=sendGroup;assertEditable(group.documento);
    const id=uid(), op={id,to:$("sendTo").value.trim(),createdAt:new Date().toISOString(),fileIds:group.files.map(f=>f.id),recordIds:group.records.map(r=>r.id)};
    const attachments=[];
    for(const file of group.files) attachments.push({name:file.name,contentBytes:await base64(file.blob)});
    const body={operationId:id,to:op.to,subject:$("sendSubject").value,text:$("sendText").value,attachments};
    if(!D.validEmail(body.to)) throw new Error("Destinatário inválido.");
    update(s=>s.operations[group.documento]=op);
    try {
      await api("/api/email/send",body);await markSent(group.documento,op);
      $("sendDialog").close();toast("Documentos enviados para "+body.to+".");
    } catch(error) {
      $("sendDialog").close();render();throw new Error(error.message+" Use Conferir resultado na fila.");
    }
  });
  action("testForm","submit",async e=>{
    const destination=new FormData(e.currentTarget).get("to");
    if(testOperation) {
      const result=await api("/api/email/operations/"+testOperation);
      if(result.status==="sent") {testOperation=null;$("testFeedback").textContent="O teste anterior foi enviado.";return;}
      if(["pending","uncertain"].includes(result.status)) {
        if(!confirm("Confira a pasta Enviados do Gmail. A mensagem de teste foi enviada?")) throw new Error("Teste anterior com resultado incerto. Aguarde e confira novamente antes de reenviar.");
        await api("/api/email/operations/"+testOperation+"/resolve",{delivered:true});testOperation=null;$("testFeedback").textContent="Teste confirmado.";return;
      }
    }
    testOperation=uid();
    const result=await api("/api/email/send",{operationId:testOperation,to:destination,subject:"Teste SendL - Gmail conectado",text:"Este é um e-mail de teste da central SendL / Edel White.",attachments:[]});
    if(result.ok){testOperation=null;$("testFeedback").textContent="E-mail de teste enviado.";log("Teste enviado");}
  });
  action("gmailSearchForm","submit",()=>searchGmail(false));
  action("gmailNext","click",()=>searchGmail(true));
  action("exportBackup","click",exportBackup);action("restoreForm","submit",restoreBackup);
  action("clientTemplate","click",()=>excelTemplate("clients"));
  action("recordTemplate","click",()=>excelTemplate("records"));
  $("exportClients").addEventListener("click",()=>download("sendl-clientes.csv","\uFEFFcliente;documento;email;estado\n"+state.clients.map(c=>[c.cliente,c.documento,c.email,c.estado].map(csvValue).join(";")).join("\n"),"text/csv;charset=utf-8"));
  for(const [input,table] of [["recordSearch","records"],["clientSearch","clients"],["queueSearch","queue"]]) {
    let timer;$(input).addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>{page[table]=1;render();},180);});
  }
  document.addEventListener("click",async e=>{
    const button=e.target.closest("button");if(!button)return;
    if(button.dataset.preview){preview(button.dataset.preview);return;}
    if(busy)return;
    try {
      if(button.dataset.view) return navigate(button.dataset.view);
      if(button.dataset.go) return navigate(button.dataset.go);
      if(button.dataset.close) return $(button.dataset.close).close();
      if(button.dataset.page){page[button.dataset.page]=(page[button.dataset.page]||1)+Number(button.dataset.step);render();return;}
      if(button.dataset.editClient){clientEditor(button.dataset.editClient);return;}
      if(button.dataset.send){openSend(button.dataset.send);return;}
      busy=true;
      if(button.dataset.resolve) await resolveOperation(button.dataset.resolve);
      if(button.dataset.removeFile) {
        const f=files.find(f=>f.id===button.dataset.removeFile);assertEditable(f.documento);
        if(confirm("Remover "+f.name+" do armazenamento do SendL?")) {await transaction("readwrite",s=>s.delete(f.id));await reloadFiles();render();}
      }
      if(button.dataset.gmailMessage) {
        const doc=$("fileClient").value;assertEditable(doc);
        if(!doc)throw new Error("Selecione o cliente no formulário de vinculação antes de importar do Gmail.");
        const client=state.clients.find(c=>c.documento===doc);
        if(!confirm("Vincular este PDF ao cliente "+client.cliente+" ("+doc+")?"))return;
        const result=await api("/api/gmail/documents/"+encodeURIComponent(button.dataset.gmailMessage)+"/attachment?partId="+encodeURIComponent(button.dataset.gmailPart));
        await attach([{name:result.name,blob:blobFromBase64(result.contentBytes)}],doc,$("fileKind").value,"gmail:"+button.dataset.gmailMessage+":"+button.dataset.gmailPart);
      }
    } catch(error){toast(error.message);}finally{busy=false;}
  });
  document.addEventListener("change",async e=>{
    const id=e.target.dataset.invoice;if(!id)return;
    if(busy){render();return;}
    busy=true;
    try {
      const f=files.find(item=>item.id===id);assertEditable(f.documento);
      await transaction("readwrite",s=>s.put({...f,nota:e.target.value.trim()}));await reloadFiles();
    } catch(error){toast(error.message);render();}finally{busy=false;}
  });
  render();
  const current=await api("/api/session");
  document.body.classList.toggle("locked",!current.authenticated);
  if(!current.configured)$("loginFeedback").textContent="O administrador precisa configurar o e-mail e a senha de acesso no servidor.";
  if(current.authenticated)await refreshGmail();
  const params=new URLSearchParams(location.search);
  if(params.has("gmail")) {toast(params.get("gmail")==="connected"?"Gmail conectado com sucesso.":"Conexão cancelada. Autorize novamente quando quiser.");history.replaceState({},document.title,"/");}
  // Refresh data if another tab changes client metadata; PDF storage is reloaded too.
  window.addEventListener("storage",async e=>{if(e.key===STATE_KEY&&!busy){try{state=read(STATE_KEY,state);await reloadFiles();render();}catch(error){toast(error.message);}}});
}
start().catch(error=>{$("loginFeedback").textContent=error.message;toast(error.message);});
