"use strict";
const {Worker}=require("node:worker_threads");
const path=require("node:path");
let active=0;
function analyzePdf(buffer){
 if(active>=2)return Promise.resolve({text:"",analysisError:true});
 active++;
 return new Promise(resolve=>{
  let done=false,worker,timer;
  function finish(result){if(done)return;done=true;clearTimeout(timer);active--;if(worker)worker.terminate().catch(()=>{});resolve(result);}
  try{
   worker=new Worker(path.join(__dirname,"pdf-worker.js"),{workerData:buffer,resourceLimits:{maxOldGenerationSizeMb:256}});
   timer=setTimeout(()=>finish({text:"",analysisError:true}),15000);
   worker.once("message",finish);
   worker.once("error",()=>finish({text:"",analysisError:true}));
   worker.once("exit",()=>finish({text:"",analysisError:true}));
  }catch{finish({text:"",analysisError:true});}
 });
}
module.exports={analyzePdf};
