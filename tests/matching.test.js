"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {matchDocument:match}=require("../public/matching");
const rows=[{documento:"12345678000199",nota:"42217"},{documento:"98765432000188",nota:"5011234567-01"}];
test("associa NF e título integral sem confundir boleto com número da nota",()=>{
 assert.equal(match({name:"NFe_00042217.pdf"},rows).documento,rows[0].documento);
 assert.equal(match({name:"boleto.pdf",text:"Documento 5011234567-01"},rows).documento,rows[1].documento);
 assert.equal(match({name:"BOL_42217.pdf"},rows).documento,undefined);
});
test("CPF/CNPJ do pagador identifica cliente; emitente não",()=>{
 assert.equal(match({name:"boleto.pdf",text:"Beneficiario 98.765.432/0001-88\nPagador Loja 12.345.678/0001-99\nNFe 42217"},rows).documento,rows[0].documento);
 assert.equal(match({name:"nota.pdf",text:"NOTA FISCAL EMITENTE 12.345.678/0001-99"},rows).documento,undefined);
});
test("divergências, duplicidades, PDFs ilegíveis e remessa já enviada ficam pendentes",()=>{
 assert.equal(match({name:"NFe_42217.pdf",text:"Destinatario 98.765.432/0001-88"},rows).documento,undefined);
 assert.equal(match({name:"NFe_42217.pdf"},[...rows,{documento:rows[1].documento,nota:"42217"}]).documento,undefined);
 assert.equal(match({name:"NFe_42217.pdf",analysisError:true},rows).documento,undefined);
 assert.equal(match({name:"NFe_42217.pdf"},rows.map(r=>({...r,sentAt:"today"}))).documento,undefined);
 assert.equal(match({name:"boleto.pdf",text:"Pagador 12.345.678/0001-99\nPagador 98.765.432/0001-88"},rows).documento,undefined);
});

test("CPF preenchido com zeros, sacador/avalista e repetição do mesmo pagador",()=>{
 const remessa=[{documento:"00093960697015",nota:"18735",valor:214.80,vencimento:"2026-09-30"}];
 const file={name:"BOL_000018735.PDF",subject:"Boleto(s) Bancário Referente à NFe 000018735 - 05 Parcela(s)",
  text:"Pagador ANA 939.606.970-15\nSacador/Avalista EDEL 12.345.678/0001-99\nPagador 00093960697015"};
 assert.equal(match(file,remessa).documento,remessa[0].documento);
 assert.equal(match({...file,text:file.text+"\nPagador OUTRO 123.456.789-01"},remessa).documento,undefined);
});
test("CNAB com título bancário cruza pagador, valor e vencimento sem adivinhar número da NF",()=>{
 const remessa=[{documento:"00093960697015",nota:"5010018735-01",valor:214.8,vencimento:"2026-09-30"}];
 const file={name:"boleto.pdf",text:"Pagador 939.606.970-15\n30/09/2026\nR$ 214,80"};
 assert.equal(match(file,remessa).documento,remessa[0].documento);
 assert.equal(match({...file,text:file.text.replace("214,80","1214,80")},remessa).documento,undefined);
 assert.equal(match({...file,text:file.text.replace("30/09","30/10")},remessa).documento,undefined);
 assert.equal(match({name:"NFe_99999.pdf",text:"Destinatario 939.606.970-15"},remessa).documento,undefined);
});
test("buscas limitadas à remessa, com todas as variantes e tamanho aceito pela API",()=>{
 const {remessaQueries}=require("../public/matching"),D=require("../public/domain");
 const base=D.gmailQuery("both","30");
 const queries=remessaQueries(Array.from({length:80},(_,i)=>({documento:"00093960697015",nota:String(18735+i)})),base);
 assert.ok(queries.length>1);assert.ok(queries.every(q=>q.length<=500&&q.includes('filename:pdf')&&q.includes(" {")));
 assert.ok(queries.join(" ").includes('"000018735"'));assert.ok(queries.join(" ").includes('"939.606.970-15"'));
 assert.throws(()=>remessaQueries([],base),/Importe/);
 assert.throws(()=>remessaQueries([{nota:"1",sentAt:"today"}],base),/Importe/);
});
test("cadastro e fila compartilham CPF/CNPJ sem modificar documentos armazenados",()=>{
 const D=require("../public/domain"),clients=[{cliente:"ANA",documento:"93960697015",email:"ana@example.com"}];
 const records=[{documento:"00093960697015",nota:"1",valor:100}],files=[{documento:"939.606.970-15"}];
 const [group]=D.groups(records,clients,files);
 assert.equal(group.email,"ana@example.com");assert.equal(group.files.length,1);assert.equal(group.ready,true);
 assert.equal(records[0].documento,"00093960697015");
 assert.equal(D.groups(records,[...clients,{documento:"00093960697015",email:""}],files)[0].email,"ana@example.com");
 const conflict=D.groups(records,[...clients,{documento:"00093960697015",email:"other@example.com"}],files)[0];
 assert.equal(conflict.ready,false);assert.equal(conflict.emailConflict,true);
});
