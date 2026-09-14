"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const {validateMessage,mime}=require("../lib/mail");
const pdf=Buffer.from("%PDF-1.4\nmock PDF\n%%EOF").toString("base64");
const message=()=>({to:"financeiro@exemplo.com",subject:"Nota fiscal – João",text:"Olá, confira os anexos.",attachments:[{name:"Nota João.pdf",contentBytes:pdf}]});
test("MIME: UTF-8, anexos e corpo base64url válidos",()=>{
  const result=Buffer.from(mime(validateMessage(message()),"envio@exemplo.com","123"),"base64url").toString();
  assert.ok(result.includes("To: financeiro@exemplo.com\r\n"));
  assert.ok(result.includes("filename*=UTF-8''Nota%20Jo%C3%A3o.pdf"));
  assert.ok(result.includes(pdf));
  assert.ok(result.includes(Buffer.from(message().text).toString("base64")));
  assert.ok(!/(?:^|[^\r])\n/.test(result));
});
test("MIME: dobra assuntos Unicode longos sem partir caracteres",()=>{
  const msg=message();msg.subject="Ação ".repeat(30);
  const decoded=Buffer.from(mime(validateMessage(msg),"envio@exemplo.com","123"),"base64url").toString();
  const encoded=decoded.match(/Subject: ([\s\S]*?)\r\nMessage-ID:/)[1];
  const reconstructed=[...encoded.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map(m=>Buffer.from(m[1],"base64").toString()).join("");
  assert.equal(reconstructed,msg.subject.trim());
});
test("validação rejeita cabeçalhos injetados, PDFs falsos e base64 inválido",()=>{
  assert.throws(()=>validateMessage({...message(),subject:"NF\r\nBcc: atacante@exemplo.com"}));
  assert.throws(()=>validateMessage({...message(),attachments:[{name:"file.pdf",contentBytes:"bm90IHBkZg=="}]}));
  assert.throws(()=>validateMessage({...message(),attachments:[{name:"file.pdf",contentBytes:"%%%"}]}));
  assert.throws(()=>validateMessage({...message(),attachments:[{name:"../../secret.pdf",contentBytes:pdf}]}));
});
test("limites de quantidade e tamanho de anexos",()=>{
  assert.throws(()=>validateMessage({...message(),attachments:Array(31).fill(message().attachments[0])}));
  const huge=Buffer.concat([Buffer.from("%PDF-"),Buffer.alloc(12*1024*1024)]).toString("base64");
  assert.throws(()=>validateMessage({...message(),attachments:[{name:"grande.pdf",contentBytes:huge}]}));
});
