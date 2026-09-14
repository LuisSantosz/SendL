"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const D=require("../public/domain");
test("CSV: UTF-8 BOM, delimitador, aspas escapadas e campos multilinha",()=>{
  assert.deepEqual(D.parseCsv('\uFEFFcliente;documento;email\r\n"Loja ""Azul""\nMatriz";12345678000199;loja@exemplo.com\r\n'),[
    {cliente:'Loja "Azul"\nMatriz',documento:"12345678000199",email:"loja@exemplo.com"}
  ]);
});
test("CSV inválido não é importado silenciosamente",()=>{
  assert.throws(()=>D.parseCsv('cliente;email\n"teste;a@b.com'));
  assert.throws(()=>D.parseCsv("cliente;cliente\nA;B"));
});
test("datas impossíveis são recusadas",()=>{
  assert.equal(D.isoDate("310226"),"");
  assert.equal(D.isoDate("29/02/2024"),"2024-02-29");
  assert.equal(D.isoDate("2026-09-30"),"2026-09-30");
  assert.equal(D.isoDate("00/12/2026"),"");
});
test("valores pt-BR preservam centavos",()=>{
  assert.equal(D.amount("1.234,56"),1234.56);
  assert.equal(D.amount("15.25"),15.25);
  assert.ok(Number.isNaN(D.amount("12 reais")));
});
test("remessa CSV filtra linhas inválidas e informa contagem",()=>{
  const result=D.importRecords("cliente;documento;nota;valor;vencimento\nLoja;12345678000199;42215;150,20;30/09/2026\nErro;123;1;10;31/02/2026");
  assert.equal(result.rows.length,1);assert.equal(result.ignored,1);assert.equal(result.rows[0].valor,150.2);
});
test("CNAB: variante legada reconhecida, outros layouts rejeitados",()=>{
  const detail=Array(400).fill(" ");
  function at(start,value){for(let i=0;i<value.length;i++)detail[start+i]=value[i];}
  at(0,"1");at(100,"5011234567-013009260000000015020");at(220,"12345678000199");at(234,"LOJA EXEMPLO");
  const parsed=D.importRecords(detail.join(""));
  assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].valor,150.2);
  assert.throws(()=>D.importRecords("1".padEnd(240," ")));
});
test("duplicidades: considera base e duplicação no próprio arquivo",()=>{
  const row={documento:"12345678000199",nota:"123",valor:10,vencimento:"2026-09-30"};
  const result=D.mergeRecords([{...row,id:"a"}],[row,{...row,valor:20},{...row,valor:20}],()=>"b");
  assert.equal(result.added,1);assert.equal(result.duplicates,2);
  assert.equal(result.rows[0].id,"a");
});
test("número NFe extraído da posição correta da chave de 44 dígitos",()=>{
  const key="35"+"2609"+"12345678000199"+"55"+"001"+"000042215"+"1"+"12345678"+"9";
  assert.equal(key.length,44);
  assert.equal(D.invoiceNumber(key+".pdf"),"42215");
  assert.equal(D.invoiceNumber("BOL_000018571.pdf"),"18571");
  assert.equal(D.invoiceNumber("NFe (42215).pdf"),"42215");
  assert.equal(D.invoiceNumber("documento.pdf"),"");
});
test("um grupo por cliente, inclusive só nota ou só boleto",()=>{
  const clients=[{documento:"12345678000199",cliente:"Loja",email:"contato@exemplo.com"}];
  const records=[{documento:clients[0].documento,valor:10},{documento:clients[0].documento,valor:20}];
  const files=[{documento:clients[0].documento,kind:"nota"}];
  const groups=D.groups(records,clients,files);
  assert.equal(groups.length,1);assert.equal(groups[0].total,30);assert.equal(groups[0].ready,true);
  assert.equal(D.groups([],clients,files)[0].ready,true);
  assert.equal(D.groups([],clients,[{...files[0],kind:"boleto"}])[0].ready,true);
});
test("enviados saem da fila; contatos ausentes bloqueiam envio",()=>{
  const files=[{documento:"12345678000199",kind:"nota"}];
  assert.equal(D.groups([],[],files)[0].ready,false);
  assert.equal(D.groups([],[],[{...files[0],sentAt:"2026-09-14"}]).length,0);
});
test("destinatário rejeita múltiplos endereços e injeção de cabeçalho",()=>{
  assert.equal(D.validEmail("a@b.com"),true);
  for(const email of ["a@b.com,c@d.com","a@b.com\nBcc: x@y.com","a@b.com; x@y.com","a@b",""])assert.equal(D.validEmail(email),false);
});
test("conteúdo importado é escapado para HTML",()=>{
  assert.equal(D.escapeHtml('<img src=x onerror="x">'),"&lt;img src=x onerror=&quot;x&quot;&gt;");
});
