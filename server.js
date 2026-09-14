"use strict";
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const { validateMessage, mime, MAX_BYTES } = require("./lib/mail");
const storage = require("./lib/storage");
const { validEmail } = require("./public/domain");
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = new URL(process.env.APP_ORIGIN || "http://localhost:" + PORT).origin;
const secure = ORIGIN.startsWith("https:");
const data = storage(process.env.DATA_DIR || path.join(__dirname, "data"));
const http = axios.create({ timeout: 30000, maxContentLength: 20 * 1024 * 1024, maxBodyLength: 24 * 1024 * 1024 });
const sessions = new Map(), attempts = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;
const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
let refreshFlight = null, sending = false, connecting = false;
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use((req,res,next) => {
  res.set({
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  });
  if (req.path.startsWith("/api/")) {
    res.set("Cache-Control", "no-store");
    if (!["GET","HEAD","OPTIONS"].includes(req.method) &&
        (req.get("X-SendL") !== "1" || (req.get("Origin") && req.get("Origin") !== ORIGIN))) {
      return res.status(403).json({ error: "Origem da solicitação não autorizada." });
    }
  }
  next();
});
app.use(express.json({ limit: "18mb" }));
const route = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
function fail(status,message) { const error = new Error(message); error.status = status; return error; }
function cookie(req,name) {
  const item = (req.headers.cookie || "").split(";").map(s=>s.trim()).find(s=>s.startsWith(name+"="));
  return item ? item.slice(name.length+1) : "";
}
function session(req) {
  const token = cookie(req,"sendl_session"), value = sessions.get(token);
  if (!value || value.expires < Date.now()) { sessions.delete(token); return null; }
  return value;
}
function credentialsReady() {
  return validEmail(process.env.ADMIN_EMAIL) && String(process.env.ADMIN_PASSWORD || "").length >= 12 &&
    (!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production") || (process.env.APP_ORIGIN && secure));
}
function googleMissing() {
  return ["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI","GMAIL_EMAIL"].filter(key=>!process.env[key]);
}
function googleError(error) {
  const code = error.response?.data?.error;
  if (code === "invalid_grant" || error.response?.status === 401) return fail(401,"Autorização do Gmail expirada ou revogada. Conecte a conta novamente.");
  if (error.response?.status === 403) return fail(403,"O Google negou a permissão. Confira a Gmail API e autorize os acessos de leitura e envio.");
  if (error.response?.status === 429) return fail(429,"Limite do Gmail atingido. Aguarde antes de tentar novamente.");
  if (error.status) return error;
  return fail(502,"Não foi possível concluir a comunicação com o Gmail. Verifique a conexão e tente novamente.");
}
async function accessToken() {
  if (refreshFlight) return refreshFlight;
  refreshFlight = (async () => {
    const token = await data.read("gmail-token");
    if (!token?.refresh_token) throw fail(401,"Gmail não conectado. Autorize sua conta em Configurações.");
    if (token.access_token && token.expires_at > Date.now()+60000) return token.access_token;
    try {
      const response = await http.post("https://oauth2.googleapis.com/token", new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: token.refresh_token, grant_type: "refresh_token"
      }).toString(), { headers: { "Content-Type":"application/x-www-form-urlencoded" } });
      const updated = { ...token, ...response.data, expires_at: Date.now()+response.data.expires_in*1000 };
      await data.write("gmail-token",updated);
      return updated.access_token;
    } catch(error) { throw googleError(error); }
  })();
  try { return await refreshFlight; } finally { refreshFlight = null; }
}
async function gmail(endpoint, options={}) {
  try {
    const token = await accessToken();
    return (await http.request({ ...options, url: "https://gmail.googleapis.com/gmail/v1/users/me/"+endpoint,
      headers: { Authorization: "Bearer "+token } })).data;
  } catch(error) { throw googleError(error); }
}
app.get("/health", (req,res) => res.json({ status:"ok", app:"SendL", version:"2.0.0" }));
app.get("/api/session", (req,res) => res.json({ authenticated: !!session(req), configured: credentialsReady() }));
app.post("/api/session/login", route(async (req,res) => {
  if (!credentialsReady()) throw fail(503,"Configure ADMIN_EMAIL e ADMIN_PASSWORD no servidor; use uma senha com pelo menos 12 caracteres.");
  const key = req.ip;
  const attempt = attempts.get(key) || { count:0, expires:Date.now()+15*60000 };
  if (attempt.expires < Date.now()) { attempt.count=0; attempt.expires=Date.now()+15*60000; }
  if (attempt.count >= 10) throw fail(429,"Muitas tentativas. Aguarde 15 minutos.");
  attempt.count++; attempts.set(key,attempt);
  if (typeof req.body.password !== "string" || req.body.password.length > 256) throw fail(401,"E-mail ou senha inválidos.");
  const [actual, expected] = await Promise.all([
    scrypt(req.body.password,"sendl-admin",64), scrypt(process.env.ADMIN_PASSWORD,"sendl-admin",64)
  ]);
  if (String(req.body.email || "").trim().toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase() || !crypto.timingSafeEqual(actual,expected))
    throw fail(401,"E-mail ou senha inválidos.");
  attempts.delete(key); sessions.delete(cookie(req,"sendl_session"));
  const id = crypto.randomBytes(32).toString("hex");
  sessions.set(id,{ expires:Date.now()+SESSION_TTL });
  res.cookie("sendl_session",id,{ httpOnly:true, secure, sameSite:"lax", maxAge:SESSION_TTL, path:"/" });
  res.json({ ok:true });
}));
app.use("/api", (req,res,next) => {
  req.session = session(req);
  if (!req.session) return res.status(401).json({ error:"Sua sessão expirou. Entre novamente no SendL." });
  next();
});
app.post("/api/session/logout", (req,res) => {
  sessions.delete(cookie(req,"sendl_session")); res.clearCookie("sendl_session",{ path:"/", secure, sameSite:"lax" }); res.json({ok:true});
});
app.get("/api/auth/gmail/login", (req,res,next) => {
  if (sending || connecting) return next(fail(409,"Aguarde a operação atual antes de conectar."));
  if (googleMissing().length) return next(fail(503,"Configure as credenciais do Google no servidor."));
  const state = crypto.randomBytes(32).toString("hex"), verifier = crypto.randomBytes(32).toString("base64url");
  req.session.oauth = { state, verifier, expires:Date.now()+10*60000 };
  const params = new URLSearchParams({
    client_id:process.env.GOOGLE_CLIENT_ID, redirect_uri:process.env.GOOGLE_REDIRECT_URI,
    response_type:"code", scope:SCOPES.join(" "), access_type:"offline", prompt:"consent",
    login_hint:process.env.GMAIL_EMAIL, state,
    code_challenge:crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method:"S256"
  });
  res.redirect("https://accounts.google.com/o/oauth2/v2/auth?"+params);
});
app.get("/api/auth/gmail/callback", route(async (req,res) => {
  const oauth = req.session.oauth; delete req.session.oauth;
  if (!oauth || oauth.expires < Date.now() || req.query.state !== oauth.state) throw fail(400,"Autorização inválida ou expirada. Inicie a conexão novamente.");
  if (req.query.error || typeof req.query.code !== "string") return res.redirect("/?gmail=denied");
  if (sending || connecting) throw fail(409,"Outra operação está em andamento. Conecte novamente após a conclusão.");
  connecting = true;
  try {
    const response = await http.post("https://oauth2.googleapis.com/token", new URLSearchParams({
      client_id:process.env.GOOGLE_CLIENT_ID, client_secret:process.env.GOOGLE_CLIENT_SECRET,
      code:req.query.code, grant_type:"authorization_code", redirect_uri:process.env.GOOGLE_REDIRECT_URI,
      code_verifier:oauth.verifier
    }).toString(), { headers:{"Content-Type":"application/x-www-form-urlencoded"} });
    const token = response.data;
    const profile = (await http.get("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers:{Authorization:"Bearer "+token.access_token}
    })).data;
    if (profile.emailAddress.toLowerCase() !== process.env.GMAIL_EMAIL.toLowerCase()) throw fail(400,"Conecte a conta Gmail configurada para o SendL.");
    const granted = new Set(String(token.scope || "").split(" "));
    if (SCOPES.some(scope => !granted.has(scope))) throw fail(400,"Autorize leitura e envio de e-mails para concluir.");
    if (!token.refresh_token) throw fail(400,"O Google não forneceu acesso offline. Revogue o acesso anterior ao aplicativo e conecte novamente.");
    if (refreshFlight) await refreshFlight.catch(()=>{});
    await data.write("gmail-token",{ ...token, email:profile.emailAddress, expires_at:Date.now()+token.expires_in*1000 });
    res.redirect("/?gmail=connected");
  } catch(error) { throw googleError(error); } finally { connecting=false; }
}));
app.get("/api/auth/gmail/status", route(async (req,res) => {
  if (googleMissing().length) return res.json({ configured:false, connected:false, message:"A conexão com o Google precisa ser configurada no servidor." });
  const token = await data.read("gmail-token");
  if (!token) return res.json({ configured:true, connected:false, email:process.env.GMAIL_EMAIL });
  try { const profile = await gmail("profile"); res.json({ configured:true, connected:true, email:profile.emailAddress }); }
  catch(error) { res.json({ configured:true, connected:false, email:process.env.GMAIL_EMAIL, message:error.message }); }
}));
app.post("/api/auth/gmail/disconnect", route(async (req,res) => {
  if (sending || connecting) throw fail(409,"Aguarde a operação em andamento.");
  connecting = true;
  try {
    if (refreshFlight) await refreshFlight.catch(()=>{});
    await data.remove("gmail-token");
    res.json({ok:true});
  } finally { connecting=false; }
}));
const operationId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
app.get("/api/email/operations/:id", route(async (req,res) => {
  if (!operationId(req.params.id)) throw fail(400,"Identificador inválido.");
  res.json(await data.read("send-"+req.params.id) || { status:sending?"pending":"not_found", createdAt:new Date().toISOString() });
}));
app.post("/api/email/operations/:id/resolve", route(async (req,res) => {
  if (sending || !operationId(req.params.id)) throw fail(409,"Operação indisponível.");
  const name = "send-"+req.params.id, op = await data.read(name);
  if (!op || !["pending","uncertain"].includes(op.status) || Date.now()-Date.parse(op.createdAt)<90000) throw fail(409,"Aguarde 90 segundos e confira a pasta Enviados do Gmail.");
  if (typeof req.body.delivered !== "boolean") throw fail(400,"Informe o resultado da conferência.");
  op.status = req.body.delivered ? "sent" : "failed";
  op.reviewedAt = new Date().toISOString();
  await data.write(name,op); res.json(op);
}));
app.post("/api/email/send", route(async (req,res) => {
  if (sending || connecting) throw fail(409,"Há uma operação em andamento. Aguarde antes de enviar.");
  if (!operationId(req.body.operationId)) throw fail(400,"Identificador de envio inválido.");
  let message;
  try { message=validateMessage(req.body); } catch(error) { throw fail(400,error.message); }
  const id=req.body.operationId, name="send-"+id;
  const hash=crypto.createHash("sha256").update(JSON.stringify(message)).digest("hex");
  sending=true;
  try {
    const previous=await data.read(name);
    if (previous && previous.hash !== hash) throw fail(409,"O conteúdo deste envio mudou. Confira o envio anterior antes de gerar uma nova tentativa.");
    if (previous?.status === "sent") return res.json({ok:true, ...previous});
    if (previous && ["pending","uncertain"].includes(previous.status)) throw fail(409,"Envio com resultado incerto. Confira a pasta Enviados e use Conferir resultado; não reenvie sem verificar.");
    const token=await accessToken();
    const raw=mime(message,process.env.GMAIL_EMAIL,id);
    const op={id,hash,status:"pending",to:message.to,subject:message.subject,createdAt:new Date().toISOString()};
    await data.write(name,op);
    let response;
    try {
      // Never retry this POST automatically: a timeout can happen after delivery.
      response=await http.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{raw},{
        headers:{Authorization:"Bearer "+token}
      });
    } catch(error) {
      const status=error.response?.status;
      op.status=status && status>=400 && status<500 && status!==408 ? "failed" : "uncertain";
      await data.write(name,op);
      if (op.status==="uncertain") throw fail(502,"O Gmail não confirmou o resultado. Confira a pasta Enviados antes de tentar novamente.");
      throw googleError(error);
    }
    op.status="sent"; op.messageId=response.data.id; op.sentAt=new Date().toISOString();
    await data.write(name,op);
    res.json({ok:true,...op});
  } finally { sending=false; }
}));
function pdfParts(part, result=[]) {
  if (part?.filename && /\.pdf$/i.test(part.filename) && part.body) result.push({
    name:part.filename, partId:part.partId, attachmentId:part.body.attachmentId || null, size:part.body.size || 0
  });
  for (const child of part?.parts || []) pdfParts(child,result);
  return result;
}
const googleId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value);
app.get("/api/gmail/documents", route(async (req,res) => {
  const q=String(req.query.q || "has:attachment filename:pdf newer_than:30d -in:sent -in:trash");
  if (q.length>500) throw fail(400,"Busca muito longa.");
  const pageToken=String(req.query.pageToken || "");
  if (pageToken.length>1000) throw fail(400,"Página inválida.");
  const list=await gmail("messages",{params:{q,maxResults:10,...(pageToken?{pageToken}:{})}});
  const messages=[];
  for(let i=0;i<(list.messages||[]).length;i+=3) {
    const chunk=await Promise.all(list.messages.slice(i,i+3).map(async item=>{
      const detail=await gmail("messages/"+encodeURIComponent(item.id),{params:{format:"full"}});
      const headers=detail.payload?.headers||[];
      const get=name=>headers.find(h=>h.name.toLowerCase()===name)?.value||"";
      return {id:item.id,subject:get("subject"),from:get("from"),date:get("date"),files:pdfParts(detail.payload)};
    }));
    messages.push(...chunk);
  }
  res.json({messages,nextPageToken:list.nextPageToken||null});
}));
app.get("/api/gmail/documents/:id/attachment", route(async(req,res)=>{
  if(!googleId(req.params.id)) throw fail(400,"Mensagem inválida.");
  const detail=await gmail("messages/"+req.params.id,{params:{format:"full"}});
  const partId=String(req.query.partId ?? "");
  const file=pdfParts(detail.payload).find(item=>item.partId===partId);
  if(!file) throw fail(404,"PDF não encontrado.");
  if(file.size>MAX_BYTES) throw fail(413,"O PDF ultrapassa 12 MB.");
  let body;
  if(file.attachmentId) {
    body=await gmail("messages/"+req.params.id+"/attachments/"+encodeURIComponent(file.attachmentId));
  } else {
    const find=p=>p.partId===partId?p:(p.parts||[]).map(find).find(Boolean);
    body=find(detail.payload)?.body;
  }
  const buffer=Buffer.from(body?.data||"","base64url");
  if(buffer.length>MAX_BYTES || buffer.subarray(0,5).toString("ascii")!=="%PDF-") throw fail(400,"Anexo inválido ou muito grande.");
  res.json({name:file.name,contentBytes:buffer.toString("base64")});
}));
app.use("/api",(req,res)=>res.status(404).json({error:"Rota não encontrada."}));
app.use(express.static(path.join(__dirname,"public"),{dotfiles:"deny",index:"index.html",maxAge:0}));
app.use((req,res)=>res.status(404).type("text").send("Página não encontrada."));
app.use((error,req,res,next)=>{
  if(res.headersSent) return next(error);
  const status=error.type==="entity.too.large"?413:error.type==="entity.parse.failed"?400:error.status||500;
  const message=status===413?"O envio excede o limite de tamanho.":error.type==="entity.parse.failed"?"JSON inválido.":status===500?"Não foi possível concluir a operação. Verifique o servidor.":error.message;
  console.error("SendL:",status,req.method,req.path);
  res.status(status).json({error:message});
});
const cleanup=setInterval(()=>{
  for(const [key,value] of sessions) if(value.expires<Date.now()) sessions.delete(key);
  for(const [key,value] of attempts) if(value.expires<Date.now()) attempts.delete(key);
},60000);
cleanup.unref();
if(require.main===module) app.listen(PORT,"0.0.0.0",()=>console.log("SendL disponível na porta "+PORT));
module.exports=app;
