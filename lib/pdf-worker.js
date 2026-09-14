"use strict";
const {parentPort,workerData}=require("node:worker_threads");
(async()=>{
 let parser;
 try{
  const {PDFParse}=require("pdf-parse");
  parser=new PDFParse({data:new Uint8Array(workerData)});
  const info=await parser.getInfo();
  if(info.total>20)throw Error("Limite de páginas");
  const result=await parser.getText();
  if(!result.text.trim()||result.text.length>200000)throw Error("Texto indisponível");
  parentPort.postMessage({text:result.text});
 }catch{parentPort.postMessage({text:"",analysisError:true});}
 finally{if(parser)await parser.destroy();}
})().catch(()=>{process.exitCode=1;});
