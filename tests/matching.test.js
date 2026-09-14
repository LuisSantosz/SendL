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
 assert.equal(match({name:"boleto.pdf",text:"Beneficiario 98.765.432/0001-88\nPagador Loja 12.345.678/0001-99"},rows).documento,rows[0].documento);
 assert.equal(match({name:"nota.pdf",text:"NOTA FISCAL EMITENTE 12.345.678/0001-99"},rows).documento,undefined);
});
test("divergências, duplicidades, PDFs ilegíveis e remessa já enviada ficam pendentes",()=>{
 assert.equal(match({name:"NFe_42217.pdf",text:"Destinatario 98.765.432/0001-88"},rows).documento,undefined);
 assert.equal(match({name:"NFe_42217.pdf"},[...rows,{documento:rows[1].documento,nota:"42217"}]).documento,undefined);
 assert.equal(match({name:"NFe_42217.pdf",analysisError:true},rows).documento,undefined);
 assert.equal(match({name:"NFe_42217.pdf"},rows.map(r=>({...r,sentAt:"today"}))).documento,undefined);
 assert.equal(match({name:"boleto.pdf",text:"Pagador 12.345.678/0001-99\nPagador 98.765.432/0001-88"},rows).documento,undefined);
});
