"use strict";
const {test,before,after}=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs/promises"), os=require("node:os"), path=require("node:path"), crypto=require("node:crypto");
let root,server,base,cookie="",mode="success",sendCount=0,refreshCount=0,releaseSend=null,signalSend=null;
const axios=require("axios"), create=axios.create.bind(axios);
axios.create=config=>create({...config,adapter:async request=>{
  const url=request.url;
  const ok=data=>({data,status:200,statusText:"OK",headers:{},config:request});
  if(url==="https://oauth2.googleapis.com/token") {
    if(String(request.data).includes("refresh_token"))refreshCount++;
    return ok({access_token:"test-access",refresh_token:"test-refresh",expires_in:3600,scope:"https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"});
  }
  if(url.endsWith("/profile"))return ok({emailAddress:"sender@example.com"});
  if(url.endsWith("/messages/send")){
    sendCount++;
    if(mode==="blocked"){signalSend();await new Promise(resolve=>releaseSend=resolve);}
    if(mode==="uncertain"||mode==="failed"){const error=new Error("mock");error.response={status:mode==="uncertain"?503:400,data:{}};throw error;}
    return ok({id:"gmail-message-"+sendCount});
  }
  if(url.endsWith("/messages"))return ok({messages:[{id:"abc123"}],nextPageToken:"next"});
  if(url.endsWith("/messages/abc123"))return ok({payload:{partId:"",headers:[{name:"Subject",value:"Nota 42215"},{name:"From",value:"billing@example.com"}],parts:[{partId:"1",filename:"NFe_42215.pdf",body:{attachmentId:"attach123",size:20}}]}});
  if(url.endsWith("/attachments/attach123"))return ok({data:Buffer.from("%PDF-1.4\nmock").toString("base64url")});
  throw new Error("Unexpected external request: "+url);
}});
async function request(url,body,headers={}) {
  return fetch(base+url,{method:body===undefined?"GET":"POST",headers:{"X-SendL":"1",Cookie:cookie,...(body===undefined?{}:{"Content-Type":"application/json"}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:"manual"});
}
function payload(id=crypto.randomUUID()) {return {operationId:id,to:"recipient@example.com",subject:"NF 42215",text:"Segue documento.",attachments:[{name:"nf.pdf",contentBytes:Buffer.from("%PDF-1.4\nmock").toString("base64")}]};}
before(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),"sendl-api-"));
  Object.assign(process.env,{DATA_DIR:root,ADMIN_EMAIL:"admin@example.com",ADMIN_PASSWORD:"test-password-long",NODE_ENV:"test",APP_ORIGIN:"http://localhost:3000",GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test-secret",GOOGLE_REDIRECT_URI:"http://localhost:3000/api/auth/gmail/callback",GMAIL_EMAIL:"sender@example.com"});
  delete process.env.RAILWAY_ENVIRONMENT;
  const app=require("../server");
  await new Promise(resolve=>server=app.listen(0,"127.0.0.1",resolve));
  base="http://127.0.0.1:"+server.address().port;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
test("arquivos internos e APIs não ficam públicos",async()=>{
  assert.equal((await request("/health")).status,200);
  assert.equal((await request("/api/auth/gmail/status")).status,401);
  for(const url of ["/server.js","/.env","/data/gmail-token.json","/package.json"])assert.equal((await request(url)).status,404);
  const index=await request("/");
  assert.equal(index.status,200);assert.ok(index.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
});
test("login recusa senha incorreta e origem não autorizada",async()=>{
  assert.equal((await request("/api/session/login",{email:"admin@example.com",password:"incorrect"})).status,401);
  assert.equal((await request("/api/session/login",{email:"admin@example.com",password:"test-password-long"},{Origin:"https://evil.example"})).status,403);
  const login=await request("/api/session/login",{email:"admin@example.com",password:"test-password-long"});
  assert.equal(login.status,200);assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));
  cookie=login.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await request("/api/session")).json()).authenticated,true);
});
test("OAuth: PKCE e state obrigatórios, callback conecta somente conta configurada",async()=>{
  const login=await request("/api/auth/gmail/login");
  assert.equal(login.status,302);
  const url=new URL(login.headers.get("location"));
  assert.ok(url.searchParams.get("code_challenge"));assert.equal(url.searchParams.get("code_challenge_method"),"S256");
  assert.equal((await request("/api/auth/gmail/callback?state=bad&code=mock")).status,400);
  const second=new URL((await request("/api/auth/gmail/login")).headers.get("location"));
  const callback=await request("/api/auth/gmail/callback?state="+second.searchParams.get("state")+"&code=mock");
  assert.equal(callback.status,302);
  assert.equal((await (await request("/api/auth/gmail/status")).json()).connected,true);
});
test("operação repetida retorna resultado sem reenviar",async()=>{
  const body=payload(), count=sendCount;
  assert.equal((await request("/api/email/send",body)).status,200);
  assert.equal((await request("/api/email/send",body)).status,200);
  assert.equal(sendCount,count+1);
  assert.equal((await request("/api/email/send",{...body,subject:"changed"})).status,409);
});
test("erro incerto bloqueia nova tentativa e exige conferência",async()=>{
  const body=payload();mode="uncertain";
  assert.equal((await request("/api/email/send",body)).status,502);
  assert.equal((await (await request("/api/email/operations/"+body.operationId)).json()).status,"uncertain");
  mode="success";const count=sendCount;
  assert.equal((await request("/api/email/send",body)).status,409);assert.equal(sendCount,count);
  assert.equal((await request("/api/email/operations/"+body.operationId+"/resolve",{delivered:true})).status,409);
  const file=path.join(root,"send-"+body.operationId+".json"),op=JSON.parse(await fs.readFile(file,"utf8"));
  op.createdAt=new Date(Date.now()-100000).toISOString();await fs.writeFile(file,JSON.stringify(op));
  assert.equal((await request("/api/email/operations/"+body.operationId+"/resolve",{delivered:true})).status,200);
  assert.equal((await request("/api/email/send",body)).status,200);assert.equal(sendCount,count);
});
test("erro definitivo permite tentar novamente com o mesmo conteúdo",async()=>{
  const body=payload();mode="failed";
  assert.equal((await request("/api/email/send",body)).status,502);
  assert.equal((await (await request("/api/email/operations/"+body.operationId)).json()).status,"failed");
  mode="success";assert.equal((await request("/api/email/send",body)).status,200);
});
test("envios concorrentes e desconexão durante envio são bloqueados",async()=>{
  mode="blocked";const body=payload();
  const started=new Promise(resolve=>signalSend=resolve);
  const first=request("/api/email/send",body);await started;
  assert.equal((await request("/api/email/send",payload())).status,409);
  assert.equal((await request("/api/auth/gmail/disconnect",{})).status,409);
  releaseSend();assert.equal((await first).status,200);mode="success";
});
test("token expirado é renovado uma vez em consultas concorrentes",async()=>{
  const filename=path.join(root,"gmail-token.json"),token=JSON.parse(await fs.readFile(filename,"utf8"));
  token.expires_at=0;await fs.writeFile(filename,JSON.stringify(token));
  const count=refreshCount;
  const responses=await Promise.all([request("/api/auth/gmail/status"),request("/api/auth/gmail/status")]);
  for(const res of responses)assert.equal((await res.json()).connected,true);
  assert.equal(refreshCount,count+1);
});
test("busca Gmail retorna anexos e baixa somente PDF selecionado",async()=>{
  const list=await (await request("/api/gmail/documents")).json();
  assert.equal(list.messages[0].files[0].name,"NFe_42215.pdf");assert.equal(list.nextPageToken,"next");
  const attachment=await (await request("/api/gmail/documents/abc123/attachment?partId=1")).json();
  assert.equal(Buffer.from(attachment.contentBytes,"base64").subarray(0,5).toString(),"%PDF-");
  assert.equal((await request("/api/gmail/documents/abc123/attachment?partId=2")).status,404);
});
test("rotas antigas removidas e sessão encerrada",async()=>{
  assert.equal((await request("/api/webhooks/whatsapp")).status,404);
  assert.equal((await request("/api/auth/outlook/login")).status,404);
  assert.equal((await request("/api/session/logout",{})).status,200);
  assert.equal((await request("/api/email/send",payload())).status,401);
});
