const STORAGE_KEYS = {
  session: "sendl_session_backend_v1",
  records: "sendl_records_backend_v1",
  clients: "sendl_clients_backend_v1",
  logs: "sendl_logs_backend_v1",
};

let records = load(STORAGE_KEYS.records, []);
let clients = load(STORAGE_KEYS.clients, []);
let logs = load(STORAGE_KEYS.logs, []);
let outlookStatus = { connected: false, configured: false };

const toast = document.getElementById("toast");

document.addEventListener("DOMContentLoaded", () => {
  bindLogin();
  bindNavigation();
  bindActions();
  checkSession();
  refreshOutlookStatus();
  renderAll();

  const params = new URLSearchParams(window.location.search);
  if (params.get("outlook") === "connected") {
    addLog("Outlook conectado", "A Microsoft retornou a autorização para o SendL.");
    window.history.replaceState({}, document.title, "/");
    refreshOutlookStatus();
  }
});

function bindLogin() {
  document.getElementById("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "").trim();

    if (email === "financeiro@edel-white.com" && password === "edelwhite123") {
      document.getElementById("loginScreen").classList.add("success");

      setTimeout(() => {
        save(STORAGE_KEYS.session, { email, loggedAt: new Date().toISOString() });
        document.body.classList.remove("locked");
        document.getElementById("loginScreen").classList.remove("success");
        addLog("Login realizado", "Usuário acessou o painel SendL.");
        showToast("Acesso liberado.");
        renderAll();
      }, 650);

      return;
    }

    showToast("E-mail ou senha inválidos.");
  });
}

function checkSession() {
  const session = load(STORAGE_KEYS.session, null);
  document.body.classList.toggle("locked", !session?.email);
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const viewId = button.dataset.view;

      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");

      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      document.getElementById(viewId).classList.add("active");

      document.getElementById("pageTitle").textContent = button.textContent;
      renderAll();
    });
  });
}

function bindActions() {
  document.getElementById("btnLogout").addEventListener("click", logout);
  document.getElementById("btnImportRemessa").addEventListener("click", importRemessa);
  document.getElementById("btnImportClients").addEventListener("click", importClients);
  document.getElementById("btnConnectOutlook").addEventListener("click", () => {
    window.location.href = "/api/auth/outlook/login";
  });
  document.getElementById("btnRefreshOutlook").addEventListener("click", refreshOutlookStatus);
  document.getElementById("btnDisconnectOutlook").addEventListener("click", disconnectOutlook);
  document.getElementById("testEmailForm").addEventListener("submit", sendTestEmail);
}

function logout() {
  localStorage.removeItem(STORAGE_KEYS.session);
  document.body.classList.add("locked");
  showToast("Sessão encerrada.");
}

async function refreshOutlookStatus() {
  try {
    const response = await fetch("/api/auth/outlook/status");
    outlookStatus = await response.json();
  } catch {
    outlookStatus = {
      connected: false,
      configured: false,
      error: "Não foi possível consultar o backend.",
    };
  }

  renderOutlookStatus();
  renderStats();
}

function renderOutlookStatus() {
  const top = document.getElementById("topOutlook");
  const topStatus = document.getElementById("topOutlookStatus");
  const card = document.getElementById("outlookConnectionCard");
  const title = document.getElementById("outlookConnectionTitle");
  const details = document.getElementById("outlookConnectionDetails");

  const email = outlookStatus.accountEmail || "Outlook";

  top.textContent = email;
  card.classList.toggle("connected", Boolean(outlookStatus.connected));
  card.classList.toggle("disconnected", !outlookStatus.connected);

  topStatus.className = outlookStatus.connected ? "connected" : "disconnected";

  if (outlookStatus.connected) {
    topStatus.textContent = "Conectado";
    title.textContent = "Outlook conectado";
    details.textContent = `Conta Microsoft: ${outlookStatus.microsoftAccount || email}`;
    return;
  }

  topStatus.textContent = "Não conectado";

  if (!outlookStatus.configured) {
    title.textContent = "Variáveis ausentes";
    details.textContent = `Faltando no Railway: ${(outlookStatus.missing || []).join(", ")}`;
    return;
  }

  title.textContent = "Outlook não conectado";
  details.textContent = outlookStatus.message || "Clique em Conectar Outlook para autorizar pela Microsoft.";
}

async function disconnectOutlook() {
  const confirmed = confirm("Deseja desconectar o Outlook do SendL?");
  if (!confirmed) return;

  await fetch("/api/auth/outlook/disconnect", { method: "POST" });
  addLog("Outlook desconectado", "Token local removido do backend.");
  showToast("Outlook desconectado.");
  refreshOutlookStatus();
}

async function sendTestEmail(event) {
  event.preventDefault();

  const feedback = document.getElementById("testEmailFeedback");
  const form = new FormData(event.currentTarget);
  const to = String(form.get("to") || "").trim();

  feedback.innerHTML = "<div>Enviando teste...</div>";

  try {
    const response = await fetch("/api/outlook/send-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(JSON.stringify(data.error || data));
    }

    feedback.innerHTML = `<div>E-mail teste enviado para <strong>${escapeHtml(to)}</strong>.</div>`;
    addLog("E-mail teste enviado", `Teste enviado pelo Outlook para ${to}.`);
    showToast("E-mail teste enviado.");
  } catch (error) {
    feedback.innerHTML = `<div>Erro ao enviar teste: ${escapeHtml(error.message)}</div>`;
    showToast("Erro ao enviar e-mail teste.");
  }
}

function importClients() {
  const file = document.getElementById("clientsFile").files[0];
  const feedback = document.getElementById("clientsFeedback");
  feedback.innerHTML = "";

  if (!file) {
    showToast("Selecione o CSV de clientes.");
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    const rows = parseDelimitedFile(String(reader.result || ""));
    let imported = 0;

    rows.forEach((row) => {
      const client = {
        id: crypto.randomUUID(),
        cliente: clean(row.cliente || row.nome || row.razao_social).toUpperCase(),
        documento: cleanDocument(row.documento || row.cnpj || row.cpf),
        email: clean(row.email || row.email_financeiro).toLowerCase(),
        whatsapp: cleanPhone(row.whatsapp || row.telefone),
      };

      if (!client.cliente || !client.documento) return;

      const existing = clients.find((item) => item.documento === client.documento);
      if (existing) Object.assign(existing, client);
      else clients.unshift(client);

      imported += 1;
    });

    save(STORAGE_KEYS.clients, clients);
    feedback.innerHTML = `<div>${imported} cliente(s) importado(s)/atualizado(s).</div>`;
    addLog("Clientes importados", `${imported} clientes processados.`);
    renderAll();
  };

  reader.readAsText(file, "UTF-8");
}

function importRemessa() {
  const file = document.getElementById("remessaFile").files[0];
  const feedback = document.getElementById("remessaFeedback");
  feedback.innerHTML = "";

  if (!file) {
    showToast("Selecione o arquivo TXT de remessa.");
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    const parsed = parseRemessaSantander(String(reader.result || ""));
    let added = 0;
    let blocked = 0;

    parsed.forEach((record) => {
      const duplicateKey = [record.documento, record.nota, record.valor, record.vencimento].join("|");

      if (records.some((item) => item.duplicateKey === duplicateKey)) {
        blocked += 1;
        return;
      }

      records.unshift({
        ...record,
        id: crypto.randomUUID(),
        duplicateKey,
        createdAt: new Date().toISOString(),
      });

      added += 1;
    });

    save(STORAGE_KEYS.records, records);
    feedback.innerHTML = `<div>${added} título(s) importado(s). ${blocked} duplicidade(s) bloqueada(s).</div>`;
    addLog("Remessa importada", `${added} registros do arquivo ${file.name}.`);
    renderAll();
  };

  reader.readAsText(file, "UTF-8");
}

function parseRemessaSantander(content) {
  const lines = content.replace(/\r/g, "").split("\n").map((line) => line.padEnd(400, " "));
  const details = lines.filter((line) => line.startsWith("1"));
  const result = [];

  details.forEach((line) => {
    const match = line.match(/(501\d{7}-\d{2})(\d{6})(\d{13})/);
    if (!match) return;

    result.push({
      cliente: clean(line.slice(234, 274)).toUpperCase(),
      documento: cleanDocument(line.slice(220, 234)),
      nota: match[1],
      vencimento: cnabDateToIso(match[2]),
      valor: (Number(match[3]) / 100).toFixed(2),
    });
  });

  return result;
}

function renderAll() {
  renderStats();
  renderLogs();
  renderRecordsTable();
  renderClientsTable();
  renderOutlookStatus();
}

function renderStats() {
  document.getElementById("statRecords").textContent = records.length;
  document.getElementById("statClients").textContent = clients.length;
  document.getElementById("statOutlook").textContent = outlookStatus.connected ? "OK" : "--";
  document.getElementById("statPending").textContent = records.filter((record) => !record.email || !record.boleto).length;
}

function renderLogs() {
  const list = document.getElementById("logList");

  if (!logs.length) {
    list.className = "log-list empty-state";
    list.textContent = "Nenhum evento registrado ainda.";
    return;
  }

  list.className = "log-list";
  list.innerHTML = logs.slice(0, 20).map((log) => `
    <div class="log-item">
      <strong>${escapeHtml(log.title)}</strong>
      <p>${escapeHtml(log.description)}</p>
      <small>${new Date(log.createdAt).toLocaleString("pt-BR")}</small>
    </div>
  `).join("");
}

function renderRecordsTable() {
  const tbody = document.getElementById("recordsTable");

  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Nenhum registro importado.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map((record) => `
    <tr>
      <td>${escapeHtml(record.cliente)}</td>
      <td>${formatDocument(record.documento)}</td>
      <td>${escapeHtml(record.nota)}</td>
      <td>R$ ${formatMoney(record.valor)}</td>
      <td>${formatDate(record.vencimento)}</td>
    </tr>
  `).join("");
}

function renderClientsTable() {
  const tbody = document.getElementById("clientsTable");

  if (!clients.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Nenhum cliente importado.</td></tr>`;
    return;
  }

  tbody.innerHTML = clients.map((client) => `
    <tr>
      <td>${escapeHtml(client.cliente)}</td>
      <td>${formatDocument(client.documento)}</td>
      <td>${escapeHtml(client.email)}</td>
    </tr>
  `).join("");
}

function addLog(title, description) {
  logs.unshift({
    id: crypto.randomUUID(),
    title,
    description,
    createdAt: new Date().toISOString(),
  });

  save(STORAGE_KEYS.logs, logs);
}

function parseDelimitedFile(content) {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const firstLine = normalized.split("\n")[0];
  const delimiter = firstLine.includes(";") ? ";" : ",";
  const lines = normalized.split("\n").filter(Boolean);
  const headers = splitCsvLine(lines.shift(), delimiter).map(normalizeHeader);

  return lines.map((line) => {
    const values = splitCsvLine(line, delimiter);
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] || "";
      return acc;
    }, {});
  });
}

function splitCsvLine(line, delimiter) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') insideQuotes = !insideQuotes;
    else if (char === delimiter && !insideQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else current += char;
  }

  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

function normalizeHeader(header) {
  return clean(header)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function clean(value) { return String(value || "").trim(); }
function cleanDocument(value) { return clean(value).replace(/[^\d]/g, ""); }
function cleanPhone(value) { return clean(value).replace(/[^\d]/g, ""); }

function cnabDateToIso(value) {
  const text = clean(value);
  if (!/^\d{6}$/.test(text)) return "";
  return `20${text.slice(4, 6)}-${text.slice(2, 4)}-${text.slice(0, 2)}`;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDocument(value) {
  const doc = cleanDocument(value);
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return value || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2800);
}

function load(key, fallback) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
