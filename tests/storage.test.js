"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs/promises"), os=require("node:os"), path=require("node:path");
const storage=require("../lib/storage");
test("persistência: cria pasta, grava JSON, lê e remove",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"sendl-storage-"));
  try {
    const store=storage(path.join(root,"private"));
    assert.equal(await store.read("token"),null);
    await store.write("token",{refresh_token:"test-only"});
    assert.deepEqual(await store.read("token"),{refresh_token:"test-only"});
    assert.deepEqual(await fs.readdir(path.join(root,"private")),["token.json"]);
    await store.remove("token");assert.equal(await store.read("token"),null);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
test("JSON corrompido gera erro em vez de resetar um registro de envio",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"sendl-bad-"));
  try {await fs.writeFile(path.join(root,"send.json"),"{");await assert.rejects(storage(root).read("send"));}
  finally {await fs.rm(root,{recursive:true,force:true});}
});
