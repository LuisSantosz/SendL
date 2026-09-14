"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),XLSX=require("xlsx");
const E=require("../public/excel"),D=require("../public/domain");
for(const bookType of ["xlsx","biff8"])test("Excel "+bookType+": abas, CPF/CNPJ formatado, valor e data",()=>{
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Instrucoes"],["Escolha Dados"]]),"Inicio");
  const sheet=XLSX.utils.aoa_to_sheet([["cliente","documento","nota","valor","vencimento"],["Loja",1234567000199,"42215",1234.56,46295]]);
  sheet.B2.z="00000000000000";sheet.D2.z='"$"#,##0.00';sheet.E2.z="mm/dd/yyyy";
  XLSX.utils.book_append_sheet(book,sheet,"Dados");
  const imported=E.read(XLSX,XLSX.write(book,{bookType,type:"buffer"}));
  assert.deepEqual(imported.names,["Inicio","Dados"]);
  const csv=E.csv(XLSX,imported.book,"Dados"),rows=D.parseCsv(csv);
  assert.equal(rows[0].documento,"01234567000199");
  assert.equal(rows[0].valor,"1234.56");
  const date=XLSX.SSF.parse_date_code(46295);
  assert.equal(rows[0].vencimento,date.y+"-"+String(date.m).padStart(2,"0")+"-"+String(date.d).padStart(2,"0"));
  assert.equal(D.importRecords(csv).rows.length,1);
});
test("Excel: aba ausente ou vazia deve falhar",()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([]),"Vazia");
  assert.throws(()=>E.csv(XLSX,book,"Outra"));assert.throws(()=>E.csv(XLSX,book,"Vazia"));
});
test("filtros Gmail combinam tipo, período e busca adicional",()=>{
  assert.ok(D.gmailQuery("boleto","7","from:notafiscaledelwhite").includes("subject:boleto"));
  assert.ok(D.gmailQuery("nota","90").includes("subject:NFe"));
  assert.equal(D.gmailQuery("all","all"),"has:attachment filename:pdf -in:sent -in:trash");
  assert.ok(D.gmailQuery().includes("newer_than:30d"));
  assert.throws(()=>D.gmailQuery("unknown","30"));
  assert.throws(()=>D.gmailQuery("both","-1"));
});
