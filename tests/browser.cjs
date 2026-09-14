"use strict";
const assert=require("node:assert/strict"), fs=require("node:fs/promises"), os=require("node:os"), path=require("node:path");
const {chromium}=require("playwright");
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"sendl-browser-"));
  Object.assign(process.env,{DATA_DIR:root,ADMIN_EMAIL:"admin@example.com",ADMIN_PASSWORD:"test-password-long",NODE_ENV:"test",APP_ORIGIN:"http://localhost:3000"});
  delete process.env.RAILWAY_ENVIRONMENT;
  let browser,server,page;
  try {
    server=require("node:http").createServer();
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    process.env.APP_ORIGIN=base;
    server.on("request",require("../server"));
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    const sent=[];
    await page.route("**/api/auth/gmail/status",route=>route.fulfill({json:{configured:true,connected:true,email:"sender@example.com"}}));
    await page.route("**/api/email/send",async route=>{
      const body=route.request().postDataJSON();sent.push(body);
      await route.fulfill({json:{ok:true,status:"sent",messageId:"simulated",sentAt:new Date().toISOString()}});
    });
    await page.goto(base);
    await page.locator('#loginForm [name="email"]').fill("admin@example.com");
    await page.locator('#loginForm [name="password"]').fill("test-password-long");
    await page.locator("#loginForm button").click();
    await page.locator("body:not(.locked)").waitFor();
    await page.waitForFunction(()=>document.getElementById("connectionPill").textContent.includes("conectado"));
    console.log("PASS login autenticado no servidor");
    await page.locator('[data-view="clientes"]').click();
    await page.locator("#clientsFile").setInputFiles({name:"clientes.csv",mimeType:"text/csv",buffer:Buffer.from("cliente;documento;email;estado\nLoja Teste;12345678000199;cliente@example.com;SP\n")});
    await page.locator("#clientsForm button").click();
    await page.waitForFunction(()=>document.getElementById("clientsTable").textContent.includes("Loja Teste"));
    await page.locator('[data-view="remessa"]').click();
    await page.locator("#recordsFile").setInputFiles({name:"titulos.csv",mimeType:"text/csv",buffer:Buffer.from("cliente;documento;nota;valor;vencimento\nLoja Teste;12345678000199;42215;100,00;30/09/2026\nLoja Teste;12345678000199;42216;200,00;30/10/2026\nLoja Teste;12345678000199;42215;100,00;30/09/2026\n")});
    await page.locator("#recordsForm button").click();
    await page.waitForFunction(()=>document.getElementById("recordsFeedback").textContent.includes("2 adicionado(s); 1 duplicado(s)"));
    console.log("PASS importações CSV e filtro de duplicidade");
    await page.locator('[data-view="documentos"]').click();
    await page.locator("#fileClient").selectOption("12345678000199");
    const pdf=(name,text)=>({name,mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n"+text+"\n%%EOF")});
    await page.locator("#pdfFiles").setInputFiles([pdf("BOL_42215.pdf","boleto 1"),pdf("BOL_42216.pdf","boleto 2")]);
    await page.locator("#filesForm button").click();
    await page.waitForFunction(()=>document.querySelectorAll("#filesTable [data-preview]").length===2);
    await page.locator("#fileKind").selectOption("nota");
    await page.locator("#pdfFiles").setInputFiles(pdf("NFe_42215.pdf","nota fiscal"));
    await page.locator("#filesForm button").click();
    await page.waitForFunction(()=>document.querySelectorAll("#filesTable [data-preview]").length===3);
    await page.reload();
    await page.locator("body:not(.locked)").waitFor();
    await page.locator('[data-view="documentos"]').click();
    await page.waitForFunction(()=>document.querySelectorAll("#filesTable [data-preview]").length===3);
    console.log("PASS PDFs persistem no IndexedDB após recarregar");
    const second=await context.newPage();await second.goto(base);
    await second.waitForFunction(()=>document.getElementById("loginFeedback").textContent.includes("outra aba"));
    await second.close();
    console.log("PASS bloqueio de edição concorrente em outra aba");
    await page.locator('[data-view="configuracoes"]').click();
    const downloadPromise=page.waitForEvent("download");await page.locator("#exportBackup").click();
    const download=await downloadPromise, backupPath=path.join(root,"backup.json");
    await download.saveAs(backupPath);
    const backup=JSON.parse(await fs.readFile(backupPath,"utf8"));
    assert.equal(backup.files.length,3);assert.equal(backup.state.records.length,2);
    page.on("dialog",dialog=>dialog.accept());
    await page.locator('[data-view="fila"]').click();
    await page.locator("#clearQueue").click();
    await page.waitForFunction(()=>document.querySelectorAll(".queue-card").length===0);
    await page.locator('[data-view="configuracoes"]').click();
    await page.locator("#backupFile").setInputFiles(backupPath);
    await page.locator("#restoreForm button").click();
    await page.waitForFunction(()=>document.getElementById("toast").textContent==="Backup restaurado.");
    console.log("PASS backup completo, limpeza e restauração de PDFs");
    await page.locator('[data-view="fila"]').click();
    await page.locator(".queue-card").waitFor();
    assert.equal(await page.locator(".queue-card").count(),1);
    assert.ok((await page.locator(".queue-card").textContent()).includes("3 PDF(s)"));
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:950});
      for(const view of ["dashboard","remessa","fila","documentos","clientes","configuracoes"]){
        await page.locator('[data-view="'+view+'"]').click();
        const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
        assert.ok(fits,"Overflow horizontal em "+view+" com "+width+"px");
      }
    }
    console.log("PASS conteúdo contido em 1440, 390 e 320px nas seis telas");
    await page.setViewportSize({width:1440,height:1000});
    await page.locator("#themeToggle").click();
    assert.equal(await page.locator("html").getAttribute("data-theme"),"light");
    await page.locator('[data-view="fila"]').click();
    await page.locator("[data-send]").click();
    assert.equal(await page.locator("#sendTo").inputValue(),"cliente@example.com");
    assert.equal(await page.locator("#sendFiles .attachment").count(),3);
    await page.locator("#sendForm > button").click();
    await page.waitForFunction(()=>document.querySelectorAll(".queue-card").length===0);
    assert.equal(sent.length,1);assert.equal(sent[0].attachments.length,3);
    assert.equal(sent[0].to,"cliente@example.com");
    console.log("PASS conferência e envio simulado: três PDFs em um e-mail");
    // A note-only flow must work without any imported title.
    await page.locator('[data-view="documentos"]').click();
    await page.locator("#fileClient").selectOption("12345678000199");
    await page.locator("#fileKind").selectOption("nota");
    await page.locator("#pdfFiles").setInputFiles(pdf("NFe_42217.pdf","nota sem boleto"));
    await page.locator("#filesForm button").click();
    await page.waitForFunction(()=>document.querySelectorAll("#filesTable [data-preview]").length===4);
    await page.locator('[data-view="fila"]').click();
    await page.locator("[data-send]").click();
    assert.equal(await page.locator("#sendFiles .attachment").count(),1);
    assert.ok((await page.locator("#sendSubject").inputValue()).includes("Nota Fiscal"));
    await page.locator("#sendForm > button").click();
    await page.waitForFunction(()=>document.querySelectorAll(".queue-card").length===0);
    assert.equal(sent.length,2);
    console.log("PASS nota sem boleto e sem remessa");
    assert.deepEqual(errors,[]);
    console.log("PASS navegador sem erros JavaScript");
  } catch(error) {
    if(page) {
      await fs.mkdir("test-results",{recursive:true});
      await page.screenshot({path:"test-results/failure.png",fullPage:true}).catch(()=>{});
      console.error("PAGE URL",page.url());
      console.error("PAGE TEXT",(await page.locator("body").innerText().catch(()=>"")).slice(0,6000));
    }
    throw error;
  } finally {
    if(browser)await browser.close();
    if(server)await new Promise(resolve=>server.close(resolve));
    await fs.rm(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
