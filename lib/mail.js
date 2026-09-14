"use strict";
const crypto = require("node:crypto");
const { validEmail } = require("../public/domain");
const MAX_BYTES = 12 * 1024 * 1024;
function validateMessage(body) {
  if (!body || !validEmail(body.to)) throw new Error("Informe um e-mail destinatário válido.");
  if (typeof body.subject !== "string" || !body.subject.trim() || body.subject.length > 200 || /[\r\n]/.test(body.subject)) throw new Error("Assunto inválido.");
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 20000) throw new Error("Mensagem inválida.");
  if (!Array.isArray(body.attachments) || body.attachments.length > 30) throw new Error("Selecione até 30 PDFs.");
  let bytes = 0;
  const attachments = body.attachments.map(file => {
    if (!file || typeof file.name !== "string" || !/\.pdf$/i.test(file.name) || file.name.length > 180 || /[\r\n/\\\x00]/.test(file.name)) throw new Error("Nome de PDF inválido.");
    if (typeof file.contentBytes !== "string" || (file.contentBytes.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(file.contentBytes))) throw new Error("Conteúdo PDF inválido.");
    const buffer = Buffer.from(file.contentBytes, "base64");
    if (buffer.toString("base64") !== file.contentBytes) throw new Error("Conteúdo PDF inválido.");
    bytes += buffer.length;
    if (buffer.subarray(0,5).toString("ascii") !== "%PDF-") throw new Error("O anexo não é um PDF válido.");
    return { name: file.name, contentBytes: buffer.toString("base64") };
  });
  if (bytes > MAX_BYTES) throw new Error("Os PDFs ultrapassam o limite de 12 MB por envio.");
  return { to: body.to.trim().toLowerCase(), subject: body.subject.trim(), text: body.text, attachments };
}
function mime(message, from, operationId) {
  if (!validEmail(from)) throw new Error("Remetente inválido.");
  const boundary = "sendl_" + crypto.randomBytes(18).toString("hex");
  const wrap = value => (value.match(/.{1,76}/g) || []).join("\r\n");
  const encoded = value => "=?UTF-8?B?" + Buffer.from(value).toString("base64") + "?=";
  const subject = Array.from(message.subject).reduce((parts,c) => {
    if (!parts.length || Buffer.byteLength(parts[parts.length-1]+c) > 42) parts.push(c);
    else parts[parts.length-1] += c;
    return parts;
  }, []).map(encoded).join("\r\n ");
  const lines = [
    "From: " + from, "To: " + message.to, "Subject: " + subject,
    "Message-ID: <" + operationId + "@sendl.local>", "Date: " + new Date().toUTCString(),
    "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="' + boundary + '"', "",
    "--" + boundary, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    wrap(Buffer.from(message.text).toString("base64"))
  ];
  for (const [index,file] of message.attachments.entries()) {
    const name = encodeURIComponent(file.name).replace(/['()*]/g,c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    lines.push("--" + boundary, "Content-Type: application/pdf",
      'Content-Disposition: attachment; filename="documento-' + (index+1) + '.pdf";',
      " filename*=UTF-8''" + name, "Content-Transfer-Encoding: base64", "", wrap(file.contentBytes));
  }
  lines.push("--" + boundary + "--", "");
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
module.exports = { validateMessage, mime, MAX_BYTES };
