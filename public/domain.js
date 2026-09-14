(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SendL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";
  const clean = value => String(value ?? "").trim();
  const documentId = value => clean(value).replace(/\D/g, "");
  // CNAB reserves 14 digits for CPF/CNPJ; spreadsheets can omit leading zeroes.
  // Keep source values intact, normalizing only keys used to compare identities.
  const documentKey = value => {
    const id=documentId(value);
    return id&&id.length<=14?id.padStart(14,"0"):id;
  };
  const sameDocument = (a,b) => Boolean(documentId(a)&&documentId(b)&&documentKey(a)===documentKey(b));
  function clientFor(clients,doc) {
    const matches=clients.filter(c=>sameDocument(c.documento,doc));
    if(!matches.length)return undefined;
    const emails=[...new Set(matches.map(c=>clean(c.email).toLowerCase()).filter(Boolean))];
    const first=matches.find(c=>validEmail(c.email))||matches[0];
    return {...first,email:emails.length===1?emails[0]:"",emailConflict:emails.length>1};
  }
  const validEmail = value => /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(clean(value)) && clean(value).length <= 254;
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const header = value => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
  function parseCsv(content) {
    const source = String(content).replace(/^\uFEFF/, "");
    const first = source.split(/\r?\n/)[0];
    const delimiter = first.includes(";") ? ";" : ",";
    const table = []; let row = [], value = "", quoted = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') {
        if (quoted && source[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && (c === delimiter || c === "\r" || c === "\n")) {
        row.push(value.trim()); value = "";
        if (c !== delimiter) {
          if (row.some(Boolean)) table.push(row);
          row = [];
          if (c === "\r" && source[i + 1] === "\n") i++;
        }
      } else value += c;
    }
    if (quoted) throw new Error("CSV com aspas sem fechamento.");
    row.push(value.trim()); if (row.some(Boolean)) table.push(row);
    if (!table.length) return [];
    const headers = table.shift().map(header);
    if (new Set(headers).size !== headers.length) throw new Error("CSV com colunas repetidas.");
    return table.map(values => Object.fromEntries(headers.map((name, i) => [name, values[i] || ""])));
  }
  function isoDate(value) {
    const s = clean(value);
    let iso = s;
    if (/^\d{6}$/.test(s)) iso = "20" + s.slice(4) + "-" + s.slice(2,4) + "-" + s.slice(0,2);
    else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) iso = s.slice(6) + "-" + s.slice(3,5) + "-" + s.slice(0,2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    const d = new Date(iso + "T12:00:00Z");
    return !Number.isNaN(+d) && d.toISOString().slice(0,10) === iso ? iso : "";
  }
  function amount(value) {
    let s = clean(value).replace(/R\$\s*/g,"").replace(/\s/g,"");
    if (s.includes(",")) s = s.replace(/\./g,"").replace(",",".");
    return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) / 100 : NaN;
  }
  function recordKey(record) {
    return [documentKey(record.documento), clean(record.nota), Number(record.valor).toFixed(2), record.vencimento].join("|");
  }
  function importRecords(content) {
    const lines = String(content).replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
    let rows = [], ignored = 0;
    if (!lines.length) return { rows, ignored };
    if (/[;,]/.test(lines[0]) && /documento|cnpj|cpf/i.test(lines[0])) {
      rows = parseCsv(content).map(row => ({
        cliente: clean(row.cliente || row.nome),
        documento: documentId(row.documento || row.cnpj || row.cpf || row.cpf_cnpj || row.cnpj_cpf),
        nota: clean(row.nota || row.nfe || row.titulo),
        valor: amount(row.valor || row.valor_titulo || row.valor_parcela), vencimento: isoDate(row.vencimento)
      }));
    } else {
      // Keep the legacy Santander variant; do not silently guess other bank layouts.
      if (lines.some(line => line.length !== 400)) throw new Error("Layout não reconhecido. Use o CNAB 400 compatível ou o CSV modelo.");
      for (const line of lines) {
        if (!line.startsWith("1")) continue;
        const match = line.match(/(501\d{7}-\d{2})(\d{6})(\d{13})/);
        if (!match) { ignored++; continue; }
        rows.push({ cliente: clean(line.slice(234,274)), documento: documentId(line.slice(220,234)),
          nota: match[1], valor: Number(match[3]) / 100, vencimento: isoDate(match[2]) });
      }
    }
    const valid = rows.filter(r => {
      const ok = [11,14].includes(r.documento.length) && r.nota && r.vencimento && Number.isFinite(r.valor) && r.valor > 0;
      if (!ok) ignored++;
      return ok;
    });
    return { rows: valid, ignored };
  }
  function mergeRecords(existing, incoming, id) {
    const keys = new Set(existing.map(recordKey)); const rows = existing.slice(); let duplicates = 0;
    for (const item of incoming) {
      const duplicateKey = recordKey(item);
      if (keys.has(duplicateKey)) { duplicates++; continue; }
      keys.add(duplicateKey);
      rows.push({ ...item, duplicateKey, id: id(), createdAt: new Date().toISOString() });
    }
    return { rows, duplicates, added: rows.length - existing.length };
  }
  function invoiceNumber(name) {
    const key = String(name).match(/(?:^|\D)(\d{44})(?!\d)/);
    if (key) return String(Number(key[1].slice(25,34)));
    const match = String(name).match(/(?:NFE?|NOTA(?:\s*FISCAL)?(?:\s*ELETR[OÔ]NICA)?|BOL(?:ETO)?)\s*[_\s().:-]*0*(\d{1,9})(?!\d)/i);
    return match ? String(Number(match[1])) : "";
  }
  function groups(records, clients, files) {
    const map=new Map();
    function group(doc,name) {
      const key=documentKey(doc),client=clientFor(clients,doc);
      if(!map.has(key))map.set(key,{documento:documentId(doc),cliente:client?.cliente||name||doc,
        email:client?.email||"",emailConflict:client?.emailConflict||false,records:[],files:[]});
      return map.get(key);
    }
    records.filter(r=>!r.sentAt).forEach(r=>group(r.documento,r.cliente).records.push(r));
    files.filter(f=>!f.sentAt).forEach(f=>group(f.documento).files.push(f));
    return [...map.values()].map(g=>({...g,ready:validEmail(g.email)&&g.files.length>0,
      total:g.records.reduce((sum,r)=>sum+Number(r.valor||0),0)}));
  }
  function gmailQuery(type="both",period="30",extra="") {
    const kinds={
      nota:'{subject:"Nota Fiscal Eletronica" subject:"Nota Fiscal Eletrônica" subject:NFe filename:NFE filename:NOTA}',
      boleto:'{subject:boleto filename:BOL filename:BOLETO}',
      both:'{subject:"Nota Fiscal Eletronica" subject:"Nota Fiscal Eletrônica" subject:NFe subject:boleto filename:NFE filename:NOTA filename:BOL filename:BOLETO}',
      all:""
    };
    if(!Object.hasOwn(kinds,type)||!["7","30","90","all"].includes(String(period)))throw new Error("Filtro de coleta inválido.");
    if(clean(extra).length>250)throw new Error("A busca adicional deve ter até 250 caracteres.");
    return ["has:attachment filename:pdf -in:sent -in:trash",period==="all"?"":"newer_than:"+period+"d",kinds[type],clean(extra)].filter(Boolean).join(" ");
  }
  return { documentKey, sameDocument, clientFor, gmailQuery, clean, documentId, validEmail, escapeHtml, parseCsv, isoDate, amount, recordKey, importRecords, mergeRecords, invoiceNumber, groups };
});
