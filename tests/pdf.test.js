"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {analyzePdf}=require("../lib/pdf");
function pdf(){
 const stream="BT /F1 12 Tf 50 750 Td (Pagador 12.345.678/0001-99) Tj ET";
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream"];
 let body="%PDF-1.4\n",offsets=[0];
 objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(body));body+=(i+1)+" 0 obj\n"+obj+"\nendobj\n";});
 const offset=Buffer.byteLength(body);
 body+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+offset+"\n%%EOF";
 return Buffer.from(body);
}
test("extrai texto de PDF real em worker",async()=>{const result=await analyzePdf(pdf());assert.equal(result.analysisError,undefined);assert.match(result.text,/12\.345\.678\/0001-99/);});
test("PDF inválido retorna pendência",async()=>assert.equal((await analyzePdf(Buffer.from("%PDF-invalid"))).analysisError,true));
