(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;else root.SendLExcel=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function read(XLSX,buffer) {
    const book=XLSX.read(buffer,{type:"array",cellDates:false,cellNF:true});
    const names=book.SheetNames.filter((name,i)=>!book.Workbook?.Sheets?.[i]?.Hidden);
    if(!names.length)throw new Error("O arquivo não contém planilhas visíveis.");
    return {book,names};
  }
  function csv(XLSX,book,name) {
    const sheet=book.Sheets[name];
    if(!sheet)throw new Error("Selecione uma planilha válida.");
    const range=sheet["!ref"]?XLSX.utils.decode_range(sheet["!ref"]):null;
    if(!range)throw new Error("A planilha selecionada está vazia.");
    if(range.e.r-range.s.r>50000||range.e.c-range.s.c>100)throw new Error("Use uma planilha de até 50 mil linhas e 101 colunas.");
    // Explicit ISO dates avoid locale ambiguity. Keep formatted CPF/CNPJ strings and zeros.
    const copy={...sheet};
    for(const key of Object.keys(sheet)) {
      if(key.startsWith("!"))continue;
      const cell=sheet[key];
      const column=XLSX.utils.decode_cell(key).c;
      const heading=String(sheet[XLSX.utils.encode_cell({r:range.s.r,c:column})]?.v||"").trim().toLowerCase().replace(/\s+/g,"_");
      if(cell.t==="n"&&["valor","valor_titulo","valor_parcela"].includes(heading)) {copy[key]={t:"s",v:String(cell.v)};continue;}
      if(cell.t==="n"&&XLSX.SSF.is_date(cell.z||"")) {
        const d=XLSX.SSF.parse_date_code(cell.v,{date1904:!!book.Workbook?.WBProps?.date1904});
        if(d)copy[key]={t:"s",v:String(d.y).padStart(4,"0")+"-"+String(d.m).padStart(2,"0")+"-"+String(d.d).padStart(2,"0")};
      }
    }
    return XLSX.utils.sheet_to_csv(copy,{FS:";",RS:"\n",blankrows:false});
  }
  return {read,csv};
});
