const APP_CONFIG = {
  company: "Edel White",
  defaultChannels: {
    whatsappDisplay: "+55 11 96333-6098",
    whatsappNumber: "5511963336098",
    outlookEmail: "financeiro@edel-white.com",
  },
  demoUser: {
    email: "financeiro@edel-white.com",
    password: "edelwhite123",
    name: "Financeiro Edel White",
    role: "financeiro",
  },
};

const STORAGE_KEYS = {
  records: "sendl_records_v2",
  clients: "sendl_clients_v2",
  logs: "sendl_logs_v2",
  settings: "sendl_settings_v2",
  channels: "sendl_channels_v4",
  verification: "sendl_channel_verification_v4",
  session: "sendl_session_v2",
};

const DEFAULT_SETTINGS = {
  emailSubject: "Boleto Edel White referente à NF {{nota}}",
  messageTemplate:
`Olá, {{cliente}}.

Segue o boleto referente à nota fiscal {{nota}}, no valor de R$ {{valor}}, com vencimento em {{vencimento}}.

O envio foi realizado pelo financeiro da Edel White.
Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.

Atenciosamente,
Financeiro Edel White`,
};

let records = load(STORAGE_KEYS.records, []);
let clients = load(STORAGE_KEYS.clients, []);
let logs = load(STORAGE_KEYS.logs, []);
let settings = load(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
let channels = normalizeChannels(load(STORAGE_KEYS.channels, APP_CONFIG.defaultChannels));
let pendingVerification = load(STORAGE_KEYS.verification, {});

const views = document.querySelectorAll(".view");
const navItems = document.querySelectorAll(".nav-item");
const pageTitle = document.getElementById("pageTitle");
const toast = document.getElementById("toast");
const modal = document.getElementById("recordModal");

document.addEventListener("DOMContentLoaded", () => {
  checkSession();
  bindLogin();
  bindNavigation();
  bindForms();
  bindActions();
  hydrateSettings();
  hydrateChannels();
  renderAll();
});

function checkSession() {
  const session = load(STORAGE_KEYS.session, null);
  if (session?.email) {
    document.body.classList.remove("locked");
  } else {
    document.body.classList.add("locked");
  }
}

function bindLogin() {
  document.getElementById("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = clean(formData.get("email")).toLowerCase();
    const password = clean(formData.get("password"));

    if (email === APP_CONFIG.demoUser.email && password === APP_CONFIG.demoUser.password) {
      const loginScreen = document.getElementById("loginScreen");
      loginScreen.classList.add("success");

      setTimeout(() => {
        save(STORAGE_KEYS.session, {
          email,
          name: APP_CONFIG.demoUser.name,
          role: APP_CONFIG.demoUser.role,
          loggedAt: new Date().toISOString(),
        });

        addLog("Login realizado", `${APP_CONFIG.demoUser.name} acessou o painel.`);
        document.body.classList.remove("locked");
        loginScreen.classList.remove("success");
        showToast("Acesso liberado.");
        renderAll();
      }, 900);

      return;
    }

    showToast("E-mail ou senha inválidos.");
  });
}

function bindNavigation() {
  navItems.forEach((button) => {
    button.addEventListener("click", () => {
      const viewId = button.dataset.view;

      navItems.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");

      views.forEach((view) => view.classList.remove("active"));
      document.getElementById(viewId).classList.add("active");

      pageTitle.textContent = button.textContent;
      renderAll();
    });
  });
}

function bindForms() {
  document.getElementById("manualForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const record = normalizeRecord(Object.fromEntries(formData.entries()), "manual");

    const result = addRecord(record);
    if (!result.ok) {
      showToast(result.message);
      return;
    }

    event.currentTarget.reset();
    showToast("Cobrança salva com sucesso.");
    renderAll();
  });

  document.getElementById("clientForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const client = normalizeClient(Object.fromEntries(formData.entries()));

    const result = addClient(client);
    if (!result.ok) {
      showToast(result.message);
      return;
    }

    event.currentTarget.reset();
    showToast("Cliente salvo com sucesso.");
    renderAll();
  });

  document.getElementById("settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    settings = {
      emailSubject: clean(formData.get("emailSubject")),
      messageTemplate: clean(formData.get("messageTemplate")),
    };

    save(STORAGE_KEYS.settings, settings);
    addLog("Configurações atualizadas", "Modelo de mensagem salvo.");
    showToast("Configurações salvas.");
    renderAll();
  });

  document.getElementById("channelsForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const result = syncChannelsFromForm();

    if (!result.ok) {
      showToast(result.message);
      return;
    }

    save(STORAGE_KEYS.channels, channels);
    hydrateChannels();
    addLog("Canais atualizados", `WhatsApp ${channels.whatsappDisplay} e Outlook ${channels.outlookEmail}.`);
    showToast(result.changed ? "Canais salvos. Autentique os dados alterados." : "Canais salvos.");
    renderAll();
  });
}

function bindActions() {
  document.getElementById("btnImportRemessa").addEventListener("click", importRemessa);
  document.getElementById("btnImportClients").addEventListener("click", importClients);
  document.getElementById("btnExportCsv").addEventListener("click", exportRecordsCsv);
  document.getElementById("btnExportClients").addEventListener("click", exportClientsCsv);
  document.getElementById("btnSeed").addEventListener("click", seedData);
  document.getElementById("btnLogout").addEventListener("click", logout);
  document.getElementById("btnSendWhatsAppCode").addEventListener("click", () => generateChannelCode("whatsapp"));
  document.getElementById("btnConfirmWhatsApp").addEventListener("click", () => confirmChannelCode("whatsapp"));
  document.getElementById("btnSendEmailCode").addEventListener("click", () => generateChannelCode("email"));
  document.getElementById("btnConfirmEmail").addEventListener("click", () => confirmChannelCode("email"));
  document.getElementById("searchInput").addEventListener("input", renderRecordsTable);
  document.getElementById("statusFilter").addEventListener("change", renderRecordsTable);
}

function logout() {
  localStorage.removeItem(STORAGE_KEYS.session);
  document.body.classList.add("locked");
  showToast("Sessão encerrada.");
}

function normalizeClient(data) {
  const document = cleanDocument(data.documento || data.document || data.cnpj || data.cpf);
  return {
    id: data.id || crypto.randomUUID(),
    cliente: clean(data.cliente || data.nome || data.razao_social || data.razao || data.name).toUpperCase(),
    documento: document,
    email: clean(data.email || data.email_financeiro || data.finance_email).toLowerCase(),
    whatsapp: cleanPhone(data.whatsapp || data.telefone || data.celular),
    contato: clean(data.contato || data.responsavel || data.responsável),
    observacao: clean(data.observacao || data.observação || data.obs),
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeRecord(data, origem = "manual") {
  const now = new Date().toISOString();
  const documento = cleanDocument(data.documento || data.document || data.cnpj || data.cpf);
  const foundClient = findClientByDocument(documento);

  const record = {
    id: data.id || crypto.randomUUID(),
    origem,
    cliente: clean(data.cliente || data.nome || data.name || foundClient?.cliente).toUpperCase(),
    documento,
    nota: clean(data.nota || data.numero_nota || data.invoice || data.document_number),
    valor: normalizeMoney(data.valor || data.amount),
    vencimento: normalizeDate(data.vencimento || data.due_date),
    email: clean(data.email || foundClient?.email).toLowerCase(),
    whatsapp: cleanPhone(data.whatsapp || foundClient?.whatsapp),
    contato: clean(data.contato || foundClient?.contato),
    boleto: clean(data.boleto || data.pdf || data.file),
    endereco: clean(data.endereco),
    cidade: clean(data.cidade),
    uf: clean(data.uf),
    status: data.status || "importado",
    createdAt: data.createdAt || now,
    updatedAt: now,
    sentAt: data.sentAt || "",
    lastError: data.lastError || "",
    attempts: Number(data.attempts || 0),
  };

  record.duplicateKey = makeDuplicateKey(record);
  record.status = data.status || getInitialStatus(record);

  return record;
}

function getInitialStatus(record) {
  if (!record.email || !record.whatsapp) return "cliente_sem_contato";
  if (!record.boleto) return "aguardando_boleto";
  if (!record.valor || !record.vencimento || !record.nota) return "pendente_revisao";
  return "pronto_envio";
}

function makeDuplicateKey(record) {
  return [
    record.documento || "sem-documento",
    record.nota || "sem-nota",
    record.valor || "sem-valor",
    record.vencimento || "sem-vencimento",
  ].join("|").toLowerCase();
}

function addClient(client) {
  if (!client.cliente || !client.documento) {
    return { ok: false, message: "Cliente e documento são obrigatórios." };
  }

  const existing = clients.find((item) => item.documento === client.documento);

  if (existing) {
    Object.assign(existing, {
      cliente: client.cliente || existing.cliente,
      email: client.email || existing.email,
      whatsapp: client.whatsapp || existing.whatsapp,
      contato: client.contato || existing.contato,
      observacao: client.observacao || existing.observacao,
      updatedAt: new Date().toISOString(),
    });

    save(STORAGE_KEYS.clients, clients);
    refreshRecordsContacts(client.documento);
    addLog("Cliente atualizado", `${existing.cliente} teve os contatos atualizados.`);
    return { ok: true, updated: true };
  }

  clients.unshift(client);
  save(STORAGE_KEYS.clients, clients);
  refreshRecordsContacts(client.documento);
  addLog("Cliente cadastrado", `${client.cliente} adicionado à base de clientes.`);
  return { ok: true, updated: false };
}

function addRecord(record) {
  const duplicate = records.find((item) => item.duplicateKey === record.duplicateKey);

  if (duplicate) {
    addLog("Duplicidade bloqueada", `Nota ${record.nota} para ${record.cliente} já existe na base.`);
    return {
      ok: false,
      message: `Duplicidade bloqueada: nota ${record.nota} já cadastrada para este documento, valor e vencimento.`,
    };
  }

  records.unshift(record);
  save(STORAGE_KEYS.records, records);
  addLog("Registro importado", `Nota ${record.nota} adicionada para ${record.cliente}.`);
  return { ok: true };
}

function refreshRecordsContacts(documento) {
  const client = findClientByDocument(documento);
  if (!client) return;

  let changed = false;

  records.forEach((record) => {
    if (record.documento !== documento) return;

    record.email = record.email || client.email;
    record.whatsapp = record.whatsapp || client.whatsapp;
    record.contato = record.contato || client.contato;

    if (record.status === "cliente_sem_contato" && record.email && record.whatsapp) {
      record.status = record.boleto ? "pronto_envio" : "aguardando_boleto";
      record.lastError = "";
    }

    record.updatedAt = new Date().toISOString();
    changed = true;
  });

  if (changed) save(STORAGE_KEYS.records, records);
}

function importClients() {
  const file = document.getElementById("clientsFile").files[0];
  const feedback = document.getElementById("clientsFeedback");
  feedback.innerHTML = "";

  if (!file) {
    showToast("Selecione a base de clientes em CSV.");
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    const rows = parseDelimitedFile(String(reader.result || ""));

    if (!rows.length) {
      showToast("Arquivo vazio ou inválido.");
      return;
    }

    let created = 0;
    let updated = 0;
    let blocked = 0;
    const messages = [];

    rows.forEach((row, index) => {
      const client = normalizeClient(row);
      const result = addClient(client);

      if (result.ok && result.updated) updated += 1;
      else if (result.ok) created += 1;
      else {
        blocked += 1;
        messages.push(`Linha ${index + 2}: ${result.message}`);
      }
    });

    feedback.innerHTML = `
      <div><strong>${created}</strong> cliente(s) novo(s) importado(s).</div>
      <div><strong>${updated}</strong> cliente(s) atualizado(s).</div>
      <div><strong>${blocked}</strong> linha(s) bloqueada(s).</div>
      ${messages.slice(0, 8).map((message) => `<div>${escapeHtml(message)}</div>`).join("")}
    `;

    showToast("Base de clientes importada.");
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
    const content = String(reader.result || "");
    const parsed = parseRemessaSantander(content);

    if (!parsed.length) {
      showToast("Nenhum registro de cobrança encontrado.");
      feedback.innerHTML = `<div>Nenhuma linha iniciada por 1 foi reconhecida no padrão esperado.</div>`;
      return;
    }

    let success = 0;
    let blocked = 0;
    let withoutContact = 0;
    const messages = [];

    parsed.forEach((item) => {
      const record = normalizeRecord(item, "remessa_santander");
      const result = addRecord(record);

      if (result.ok) {
        success += 1;
        if (record.status === "cliente_sem_contato") withoutContact += 1;
      } else {
        blocked += 1;
        messages.push(result.message);
      }
    });

    const totalValue = parsed.reduce((sum, item) => sum + Number(normalizeMoney(item.valor) || 0), 0);

    feedback.innerHTML = `
      <div><strong>${parsed.length}</strong> título(s) encontrado(s) na remessa.</div>
      <div><strong>${success}</strong> importado(s), <strong>${blocked}</strong> duplicidade(s) bloqueada(s).</div>
      <div><strong>${withoutContact}</strong> registro(s) sem contato na base de clientes.</div>
      <div>Valor total lido: <strong>R$ ${formatMoney(totalValue)}</strong>.</div>
      ${messages.slice(0, 8).map((message) => `<div>${escapeHtml(message)}</div>`).join("")}
    `;

    addLog("Remessa importada", `${success} registros importados do arquivo ${file.name}.`);
    showToast("Remessa processada.");
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

    const nota = match[1];
    const vencimento = cnabDateToIso(match[2]);
    const valor = (Number(match[3]) / 100).toFixed(2);

    const documento = cleanDocument(line.slice(220, 234));
    const cliente = clean(line.slice(234, 274)).toUpperCase();
    const endereco = clean(line.slice(274, 314));
    const cidade = clean(line.slice(334, 349));
    const uf = clean(line.slice(349, 351));

    result.push({
      cliente,
      documento,
      nota,
      valor,
      vencimento,
      endereco,
      cidade,
      uf,
      boleto: "",
    });
  });

  return result;
}

function parseDelimitedFile(content) {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const firstLine = normalized.split("\n")[0];
  const delimiter = firstLine.includes(";") ? ";" : ",";
  const lines = normalized.split("\n").filter(Boolean);
  const headers = splitCsvLine(lines.shift(), delimiter).map((h) => normalizeHeader(h));

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

    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

function renderAll() {
  hydrateChannels();
  renderStats();
  renderRecordsTable();
  renderClientsTable();
  renderLogs();
}

function renderStats() {
  const ready = records.filter((record) => record.status === "pronto_envio").length;
  const pending = records.filter((record) =>
    ["aguardando_boleto", "cliente_sem_contato", "pendente_revisao", "erro"].includes(record.status)
  ).length;

  document.getElementById("statTotal").textContent = records.length;
  document.getElementById("statClients").textContent = clients.length;
  document.getElementById("statReady").textContent = ready;
  document.getElementById("statPending").textContent = pending;
}

function renderRecordsTable() {
  const tbody = document.getElementById("recordsTable");
  const term = clean(document.getElementById("searchInput")?.value || "").toLowerCase();
  const status = document.getElementById("statusFilter")?.value || "";

  let filtered = records;

  if (term) {
    filtered = filtered.filter((record) =>
      [record.cliente, record.documento, record.nota, record.email, record.whatsapp, record.cidade]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }

  if (status) {
    filtered = filtered.filter((record) => record.status === status);
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Nenhum registro encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((record) => `
    <tr>
      <td>
        <strong>${escapeHtml(record.cliente)}</strong><br>
        <small>${escapeHtml(record.origem)}</small>
      </td>
      <td>${formatDocument(record.documento)}</td>
      <td>${escapeHtml(record.nota)}</td>
      <td>R$ ${formatMoney(record.valor)}</td>
      <td>${formatDate(record.vencimento)}</td>
      <td>
        ${record.email ? escapeHtml(record.email) : "<small>sem e-mail</small>"}<br>
        ${record.whatsapp ? `<small>${escapeHtml(record.whatsapp)}</small>` : "<small>sem WhatsApp</small>"}
      </td>
      <td>${record.boleto ? escapeHtml(record.boleto) : "<small>Não localizado</small>"}</td>
      <td>${statusBadge(record.status)}</td>
      <td>
        <div class="actions">
          <button class="btn small ghost" onclick="openRecord('${record.id}')">Ver</button>
          <button class="btn small secondary" onclick="markBoleto('${record.id}')">Boleto</button>
          <button class="btn small secondary" onclick="validateRecord('${record.id}')">Validar</button>
          <button class="btn small primary" onclick="sendRecord('${record.id}')" ${record.status !== "pronto_envio" ? "disabled" : ""}>Enviar</button>
          <button class="btn small danger" onclick="deleteRecord('${record.id}')">Excluir</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderClientsTable() {
  const tbody = document.getElementById("clientsTable");

  if (!clients.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum cliente cadastrado ainda.</td></tr>`;
    return;
  }

  const ordered = [...clients].sort((a, b) => a.cliente.localeCompare(b.cliente));

  tbody.innerHTML = ordered.map((client) => {
    const linked = records.filter((record) => record.documento === client.documento).length;

    return `
      <tr>
        <td><strong>${escapeHtml(client.cliente)}</strong></td>
        <td>${formatDocument(client.documento)}</td>
        <td>${escapeHtml(client.email)}</td>
        <td>${escapeHtml(client.whatsapp)}</td>
        <td>${escapeHtml(client.contato || "Não informado")}</td>
        <td>${linked}</td>
        <td>
          <div class="actions">
            <button class="btn small danger" onclick="deleteClient('${client.id}')">Excluir</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
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
      <span>${formatDateTime(log.createdAt)}</span>
    </div>
  `).join("");
}

function hydrateSettings() {
  const form = document.getElementById("settingsForm");
  form.emailSubject.value = settings.emailSubject;
  form.messageTemplate.value = settings.messageTemplate;
}

function hydrateChannels() {
  channels = normalizeChannels(channels);

  const form = document.getElementById("channelsForm");
  if (form) {
    form.whatsappDisplay.value = channels.whatsappDisplay;
    form.outlookEmail.value = channels.outlookEmail;
  }

  const topWhatsapp = document.getElementById("topWhatsapp");
  const topOutlook = document.getElementById("topOutlook");
  const topWhatsappStatus = document.getElementById("topWhatsappStatus");
  const topEmailStatus = document.getElementById("topEmailStatus");

  if (topWhatsapp) {
    topWhatsapp.textContent = channels.whatsappDisplay;
    topWhatsapp.parentElement.classList.toggle("authenticated", channels.whatsappVerified);
    topWhatsapp.parentElement.classList.toggle("not-authenticated", !channels.whatsappVerified);
  }

  if (topOutlook) {
    topOutlook.textContent = channels.outlookEmail;
    topOutlook.parentElement.classList.toggle("authenticated", channels.emailVerified);
    topOutlook.parentElement.classList.toggle("not-authenticated", !channels.emailVerified);
  }

  if (topWhatsappStatus) {
    topWhatsappStatus.textContent = channels.whatsappVerified ? "Autenticado" : "Não autenticado";
  }

  if (topEmailStatus) {
    topEmailStatus.textContent = channels.emailVerified ? "Autenticado" : "Não autenticado";
  }

  updateAuthStatus("whatsapp", channels.whatsappVerified);
  updateAuthStatus("email", channels.emailVerified);
}

function normalizeChannels(data) {
  const base = data || APP_CONFIG.defaultChannels;
  const whatsappDisplay = clean(base.whatsappDisplay || APP_CONFIG.defaultChannels.whatsappDisplay);
  const outlookEmail = clean(base.outlookEmail || APP_CONFIG.defaultChannels.outlookEmail).toLowerCase();

  return {
    whatsappDisplay,
    whatsappNumber: cleanPhone(base.whatsappNumber || whatsappDisplay),
    outlookEmail,
    whatsappVerified: Boolean(base.whatsappVerified),
    emailVerified: Boolean(base.emailVerified),
    whatsappVerifiedAt: base.whatsappVerifiedAt || "",
    emailVerifiedAt: base.emailVerifiedAt || "",
  };
}

function syncChannelsFromForm() {
  const form = document.getElementById("channelsForm");
  const whatsappDisplay = clean(form.whatsappDisplay.value);
  const outlookEmail = clean(form.outlookEmail.value).toLowerCase();
  const whatsappNumber = cleanPhone(whatsappDisplay);

  if (!isValidBrazilWhatsapp(whatsappNumber)) {
    return {
      ok: false,
      message: "Informe um WhatsApp brasileiro válido. Exemplo: +55 11 96333-6098.",
    };
  }

  if (!isValidEmail(outlookEmail)) {
    return {
      ok: false,
      message: "Informe um e-mail válido.",
    };
  }

  const whatsappChanged = whatsappNumber !== channels.whatsappNumber;
  const emailChanged = outlookEmail !== channels.outlookEmail;

  channels = {
    ...channels,
    whatsappDisplay: formatWhatsappDisplay(whatsappNumber),
    whatsappNumber,
    outlookEmail,
    whatsappVerified: whatsappChanged ? false : channels.whatsappVerified,
    emailVerified: emailChanged ? false : channels.emailVerified,
    whatsappVerifiedAt: whatsappChanged ? "" : channels.whatsappVerifiedAt,
    emailVerifiedAt: emailChanged ? "" : channels.emailVerifiedAt,
  };

  return {
    ok: true,
    changed: whatsappChanged || emailChanged,
  };
}

function generateChannelCode(type) {
  const result = syncChannelsFromForm();

  if (!result.ok) {
    showToast(result.message);
    return;
  }

  save(STORAGE_KEYS.channels, channels);

  const target = type === "whatsapp" ? channels.whatsappNumber : channels.outlookEmail;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;

  pendingVerification[type] = {
    target,
    code,
    expiresAt,
    createdAt: new Date().toISOString(),
  };

  save(STORAGE_KEYS.verification, pendingVerification);

  const channelLabel = type === "whatsapp" ? "WhatsApp" : "Outlook";
  const feedback = document.getElementById("channelsFeedback");

  feedback.innerHTML = `
    <div>
      <strong>Código de teste ${channelLabel}:</strong> ${code}<br>
      <small>Na versão em nuvem, este código será enviado de verdade para ${escapeHtml(type === "whatsapp" ? channels.whatsappDisplay : channels.outlookEmail)}.</small>
    </div>
  `;

  addLog(`Código ${channelLabel} gerado`, `Código de autenticação criado para ${target}.`);
  showToast(`Código ${channelLabel} gerado.`);
  hydrateChannels();
}

function confirmChannelCode(type) {
  const form = document.getElementById("channelsForm");
  const inputName = type === "whatsapp" ? "whatsappCode" : "emailCode";
  const typedCode = clean(form[inputName].value);
  const currentTarget = type === "whatsapp" ? cleanPhone(form.whatsappDisplay.value) : clean(form.outlookEmail.value).toLowerCase();
  const verification = pendingVerification[type];

  if (!verification) {
    showToast("Gere um código antes de confirmar.");
    return;
  }

  if (Date.now() > verification.expiresAt) {
    delete pendingVerification[type];
    save(STORAGE_KEYS.verification, pendingVerification);
    updateAuthStatus(type, false, true);
    showToast("Código expirado. Gere um novo código.");
    return;
  }

  if (verification.target !== currentTarget) {
    showToast("O dado informado mudou. Gere um novo código.");
    return;
  }

  if (verification.code !== typedCode) {
    updateAuthStatus(type, false, true);
    showToast("Código inválido.");
    return;
  }

  if (type === "whatsapp") {
    channels.whatsappDisplay = formatWhatsappDisplay(currentTarget);
    channels.whatsappNumber = currentTarget;
    channels.whatsappVerified = true;
    channels.whatsappVerifiedAt = new Date().toISOString();
    form.whatsappDisplay.value = channels.whatsappDisplay;
    form.whatsappCode.value = "";
  } else {
    channels.outlookEmail = currentTarget;
    channels.emailVerified = true;
    channels.emailVerifiedAt = new Date().toISOString();
    form.emailCode.value = "";
  }

  delete pendingVerification[type];
  save(STORAGE_KEYS.verification, pendingVerification);
  save(STORAGE_KEYS.channels, channels);

  const channelLabel = type === "whatsapp" ? "WhatsApp" : "Outlook";
  document.getElementById("channelsFeedback").innerHTML = `
    <div><strong>${channelLabel} autenticado com sucesso.</strong></div>
  `;

  addLog(`${channelLabel} autenticado`, `Canal confirmado e liberado para envio.`);
  showToast(`${channelLabel} autenticado.`);
  hydrateChannels();
  renderAll();
}

function updateAuthStatus(type, verified, error = false) {
  const element = document.getElementById(type === "whatsapp" ? "whatsappAuthStatus" : "emailAuthStatus");
  if (!element) return;

  element.classList.remove("pending", "verified", "error");

  if (verified) {
    element.classList.add("verified");
    element.textContent = "Autenticado";
  } else if (error) {
    element.classList.add("error");
    element.textContent = "Erro";
  } else {
    element.classList.add("pending");
    element.textContent = "Pendente";
  }
}

function areChannelsAuthenticated() {
  return Boolean(channels.whatsappVerified && channels.emailVerified);
}

function isValidBrazilWhatsapp(value) {
  const digits = cleanPhone(value);
  return digits.startsWith("55") && digits.length >= 12 && digits.length <= 13;
}

function formatWhatsappDisplay(value) {
  const digits = cleanPhone(value);

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  return value;
}

window.markBoleto = function markBoleto(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  const fileName = prompt("Informe o nome do arquivo PDF localizado:", `boleto_${record.nota}.pdf`);
  if (!fileName) return;

  record.boleto = clean(fileName);
  record.updatedAt = new Date().toISOString();

  if (record.email && record.whatsapp) {
    record.status = "pronto_envio";
    record.lastError = "";
  } else {
    record.status = "cliente_sem_contato";
    record.lastError = "Cliente sem e-mail ou WhatsApp na base.";
  }

  addLog("Boleto localizado", `Boleto vinculado à nota ${record.nota}.`);
  showToast("Boleto vinculado ao registro.");
  persistRecords();
};

window.validateRecord = function validateRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  const client = findClientByDocument(record.documento);
  if (client) {
    record.email = record.email || client.email;
    record.whatsapp = record.whatsapp || client.whatsapp;
    record.contato = record.contato || client.contato;
  }

  const errors = [];

  if (!record.cliente) errors.push("Cliente ausente.");
  if (!record.documento) errors.push("Documento ausente.");
  if (!record.nota) errors.push("Número da nota ausente.");
  if (!record.valor) errors.push("Valor ausente.");
  if (!record.vencimento) errors.push("Vencimento ausente.");
  if (!record.email || !isValidEmail(record.email)) errors.push("E-mail inválido ou ausente.");
  if (!record.whatsapp || record.whatsapp.length < 12) errors.push("WhatsApp inválido ou ausente.");
  if (!record.boleto) errors.push("Boleto ainda não localizado.");

  const duplicate = records.find((item) =>
    item.id !== record.id && item.duplicateKey === record.duplicateKey
  );

  if (duplicate) errors.push("Duplicidade encontrada na base.");

  if (errors.length) {
    record.status = (!record.email || !record.whatsapp) ? "cliente_sem_contato" : "pendente_revisao";
    record.lastError = errors.join(" ");
    addLog("Validação com pendência", `Nota ${record.nota}: ${record.lastError}`);
    showToast("Registro enviado para revisão.");
  } else {
    record.status = "pronto_envio";
    record.lastError = "";
    addLog("Registro validado", `Nota ${record.nota} pronta para envio.`);
    showToast("Registro pronto para envio.");
  }

  record.updatedAt = new Date().toISOString();
  persistRecords();
};

window.sendRecord = function sendRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  if (record.status !== "pronto_envio") {
    showToast("Valide o registro antes de enviar.");
    return;
  }

  if (!areChannelsAuthenticated()) {
    showToast("Autentique o WhatsApp e o Outlook em Configurações antes de enviar.");
    return;
  }

  const alreadySent = records.find((item) =>
    item.id !== record.id &&
    item.duplicateKey === record.duplicateKey &&
    item.status === "enviado"
  );

  if (alreadySent) {
    record.status = "erro";
    record.lastError = "Bloqueado: já existe envio concluído para esta nota.";
    addLog("Envio bloqueado", `Nota ${record.nota} já possui envio concluído.`);
    showToast("Envio bloqueado por duplicidade.");
    persistRecords();
    return;
  }

  record.attempts += 1;
  record.status = "enviado";
  record.sentAt = new Date().toISOString();
  record.updatedAt = record.sentAt;
  record.lastError = "";

  addLog(
    "Envio simulado",
    `Nota ${record.nota} enviada pelo WhatsApp ${channels.whatsappDisplay} e pelo Outlook ${channels.outlookEmail}.`
  );

  showToast("Envio simulado realizado com sucesso.");
  persistRecords();
};

window.openRecord = function openRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  document.getElementById("modalTitle").textContent = `Nota ${record.nota}`;

  const message = fillTemplate(settings.messageTemplate, record);

  document.getElementById("modalBody").innerHTML = `
    <div class="details-grid">
      ${detail("Cliente", record.cliente)}
      ${detail("Documento", formatDocument(record.documento))}
      ${detail("Nota/parcela", record.nota)}
      ${detail("Valor", `R$ ${formatMoney(record.valor)}`)}
      ${detail("Vencimento", formatDate(record.vencimento))}
      ${detail("Boleto", record.boleto || "Não localizado")}
      ${detail("E-mail destino", record.email || "Sem e-mail")}
      ${detail("WhatsApp destino", record.whatsapp || "Sem WhatsApp")}
      ${detail("Canal WhatsApp", `${channels.whatsappDisplay} (${channels.whatsappVerified ? "autenticado" : "não autenticado"})`)}
      ${detail("Canal Outlook", `${channels.outlookEmail} (${channels.emailVerified ? "autenticado" : "não autenticado"})`)}
      ${detail("Status", statusLabel(record.status))}
      ${detail("Origem", record.origem)}
      ${detail("Cidade/UF", `${record.cidade || ""} ${record.uf || ""}`.trim() || "Não informado")}
      ${detail("Criado em", formatDateTime(record.createdAt))}
      ${detail("Enviado em", record.sentAt ? formatDateTime(record.sentAt) : "Sem envio")}
      ${detail("Tentativas", String(record.attempts))}
    </div>

    ${record.lastError ? `<div class="feedback"><div><strong>Pendência:</strong> ${escapeHtml(record.lastError)}</div></div>` : ""}

    <div class="code-sample">
      <strong>Prévia da mensagem:</strong>
      <pre>${escapeHtml(message)}</pre>
    </div>
  `;

  modal.showModal();
};

window.deleteRecord = function deleteRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  const confirmed = confirm(`Deseja excluir a nota ${record.nota} de ${record.cliente}?`);
  if (!confirmed) return;

  records = records.filter((item) => item.id !== id);
  save(STORAGE_KEYS.records, records);
  addLog("Registro excluído", `Nota ${record.nota} removida da base local.`);
  showToast("Registro excluído.");
  renderAll();
};

window.deleteClient = function deleteClient(id) {
  const client = clients.find((item) => item.id === id);
  if (!client) return;

  const confirmed = confirm(`Deseja excluir ${client.cliente} da base de clientes?`);
  if (!confirmed) return;

  clients = clients.filter((item) => item.id !== id);
  save(STORAGE_KEYS.clients, clients);
  addLog("Cliente excluído", `${client.cliente} removido da base.`);
  showToast("Cliente excluído.");
  renderAll();
};

function exportRecordsCsv() {
  const headers = ["cliente", "documento", "nota", "valor", "vencimento", "email", "whatsapp", "boleto", "status", "origem", "sentAt"];
  downloadCsv(`sendl-registros-${new Date().toISOString().slice(0, 10)}.csv`, headers, records);
  addLog("Exportação CSV", "Registros exportados em CSV.");
  showToast("CSV de registros exportado.");
}

function exportClientsCsv() {
  const headers = ["cliente", "documento", "email", "whatsapp", "contato", "observacao"];
  downloadCsv(`sendl-clientes-${new Date().toISOString().slice(0, 10)}.csv`, headers, clients);
  addLog("Exportação clientes", "Base de clientes exportada em CSV.");
  showToast("CSV de clientes exportado.");
}

function downloadCsv(filename, headers, rows) {
  const lines = [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => csvSafe(row[header] || "")).join(";")),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function seedData() {
  const sampleClients = [
    {
      cliente: "SMILE E LOVERS",
      documento: "41.648.484/0001-67",
      email: "financeiro@smileelovers.com.br",
      whatsapp: "5511999999999",
      contato: "Financeiro",
    },
    {
      cliente: "NEW DENTAL CARE LTDA",
      documento: "39.715.643/0001-57",
      email: "financeiro@newdentalcare.com.br",
      whatsapp: "5511988888888",
      contato: "Contas a pagar",
    },
  ];

  const sampleRecords = [
    {
      cliente: "SMILE E LOVERS",
      documento: "41.648.484/0001-67",
      nota: "5010042073-01",
      valor: "737,15",
      vencimento: "2026-07-27",
      boleto: "boleto_5010042073-01.pdf",
    },
    {
      cliente: "NEW DENTAL CARE LTDA",
      documento: "39.715.643/0001-57",
      nota: "5010042048-01",
      valor: "9058,10",
      vencimento: "2026-06-24",
      boleto: "",
    },
  ];

  let addedClients = 0;
  let addedRecords = 0;

  sampleClients.forEach((item) => {
    const result = addClient(normalizeClient(item));
    if (result.ok && !result.updated) addedClients += 1;
  });

  sampleRecords.forEach((item) => {
    const result = addRecord(normalizeRecord(item, "exemplo"));
    if (result.ok) addedRecords += 1;
  });

  showToast(`${addedClients} cliente(s) e ${addedRecords} registro(s) de exemplo carregados.`);
  renderAll();
}

function persistRecords() {
  save(STORAGE_KEYS.records, records);
  renderAll();
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

function findClientByDocument(documento) {
  const cleanDoc = cleanDocument(documento);
  return clients.find((client) => client.documento === cleanDoc);
}

function fillTemplate(template, record) {
  return template
    .replaceAll("{{cliente}}", record.cliente)
    .replaceAll("{{nota}}", record.nota)
    .replaceAll("{{valor}}", formatMoney(record.valor))
    .replaceAll("{{vencimento}}", formatDate(record.vencimento));
}

function detail(label, value) {
  return `
    <div class="detail">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function statusBadge(status) {
  return `<span class="badge ${status}">${statusLabel(status)}</span>`;
}

function statusLabel(status) {
  const labels = {
    importado: "Importado",
    aguardando_boleto: "Aguardando boleto",
    cliente_sem_contato: "Cliente sem contato",
    boleto_localizado: "Boleto localizado",
    pendente_revisao: "Pendente revisão",
    pronto_envio: "Pronto para envio",
    enviado: "Enviado",
    erro: "Erro",
  };

  return labels[status] || status;
}

function clean(value) {
  return String(value || "").trim();
}

function cleanDocument(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function cleanPhone(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function normalizeMoney(value) {
  const raw = clean(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const number = Number(raw);
  return Number.isFinite(number) ? number.toFixed(2) : "";
}

function normalizeDate(value) {
  const text = clean(value);
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const short = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (short) return `20${short[3]}-${short[2]}-${short[1]}`;

  return text;
}

function cnabDateToIso(value) {
  const text = clean(value);
  if (!/^\d{6}$/.test(text)) return "";
  return `20${text.slice(4, 6)}-${text.slice(2, 4)}-${text.slice(0, 2)}`;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR");
}

function formatDocument(value) {
  const doc = cleanDocument(value);

  if (doc.length === 14) {
    return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }

  if (doc.length === 11) {
    return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }

  return value || "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function csvSafe(value) {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function normalizeHeader(header) {
  return clean(header)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
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
