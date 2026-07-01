require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

const app = express();

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const TOKEN_STORE_PATH = process.env.TOKEN_STORE_PATH || path.join(DATA_DIR, "outlook-token.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function requiredMicrosoftEnv() {
  const required = [
    "MICROSOFT_TENANT_ID",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_REDIRECT_URI",
    "OUTLOOK_EMAIL",
  ];

  return required.filter((key) => !process.env[key]);
}

function microsoftScopes() {
  return [
    "offline_access",
    "User.Read",
    "Mail.Send",
    "Mail.Read",
  ].join(" ");
}

function tokenEndpoint() {
  return `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
}

function authorizeEndpoint() {
  return `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`;
}

function readTokenStore() {
  try {
    if (!fs.existsSync(TOKEN_STORE_PATH)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_STORE_PATH, "utf8"));
  } catch (error) {
    console.error("Erro ao ler token Outlook:", error.message);
    return null;
  }
}

function saveTokenStore(tokenData) {
  const payload = {
    ...tokenData,
    stored_at: new Date().toISOString(),
    expires_at: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
    account_email: process.env.OUTLOOK_EMAIL,
  };

  fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function deleteTokenStore() {
  if (fs.existsSync(TOKEN_STORE_PATH)) {
    fs.unlinkSync(TOKEN_STORE_PATH);
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, item) => {
    const [key, ...value] = item.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(value.join("="));
    return acc;
  }, {});
}

async function exchangeAuthorizationCode(code) {
  const params = new URLSearchParams();
  params.set("client_id", process.env.MICROSOFT_CLIENT_ID);
  params.set("client_secret", process.env.MICROSOFT_CLIENT_SECRET);
  params.set("grant_type", "authorization_code");
  params.set("code", code);
  params.set("redirect_uri", process.env.MICROSOFT_REDIRECT_URI);
  params.set("scope", microsoftScopes());

  const response = await axios.post(tokenEndpoint(), params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return saveTokenStore(response.data);
}

async function refreshAccessTokenIfNeeded() {
  const token = readTokenStore();

  if (!token || !token.refresh_token) {
    throw new Error("Outlook não conectado. Faça login novamente.");
  }

  const shouldRefresh = !token.access_token || Date.now() > Number(token.expires_at || 0) - 5 * 60 * 1000;

  if (!shouldRefresh) {
    return token.access_token;
  }

  const params = new URLSearchParams();
  params.set("client_id", process.env.MICROSOFT_CLIENT_ID);
  params.set("client_secret", process.env.MICROSOFT_CLIENT_SECRET);
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", token.refresh_token);
  params.set("redirect_uri", process.env.MICROSOFT_REDIRECT_URI);
  params.set("scope", microsoftScopes());

  const response = await axios.post(tokenEndpoint(), params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const refreshed = saveTokenStore({
    ...response.data,
    refresh_token: response.data.refresh_token || token.refresh_token,
  });

  return refreshed.access_token;
}

async function getOutlookProfile() {
  const accessToken = await refreshAccessTokenIfNeeded();

  const response = await axios.get("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.data;
}

function buildSuccessPage(title, message) {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: Arial, sans-serif;
            background: #09090b;
            color: #fff;
          }
          article {
            width: min(520px, calc(100% - 32px));
            background: #fff;
            color: #111827;
            border-radius: 24px;
            padding: 28px;
            text-align: center;
            box-shadow: 0 24px 80px rgba(0,0,0,.35);
          }
          strong {
            display: grid;
            place-items: center;
            width: 64px;
            height: 64px;
            margin: 0 auto 16px;
            border-radius: 50%;
            background: #7c3aed;
            color: #fff;
            font-size: 32px;
          }
          p { color: #4b5563; line-height: 1.5; }
        </style>
      </head>
      <body>
        <article>
          <strong>✓</strong>
          <h1>${title}</h1>
          <p>${message}</p>
          <p>Você será redirecionado para o SendL.</p>
        </article>
        <script>
          setTimeout(() => {
            window.location.href = "/?outlook=connected";
          }, 1800);
        </script>
      </body>
    </html>
  `;
}

// Painel SendL
app.use(express.static(path.join(__dirname)));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "SendL",
    railway: Boolean(process.env.RAILWAY_ENVIRONMENT),
    outlookEmail: process.env.OUTLOOK_EMAIL || null,
  });
});

// WhatsApp webhook - verificação Meta
app.get("/api/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    console.log("Webhook WhatsApp verificado.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// WhatsApp webhook - eventos Meta
app.post("/api/webhooks/whatsapp", (req, res) => {
  console.log("Evento WhatsApp recebido:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Outlook OAuth - iniciar login oficial
app.get("/api/auth/outlook/login", (req, res) => {
  const missing = requiredMicrosoftEnv();

  if (missing.length) {
    return res.status(500).json({
      connected: false,
      error: "Variáveis Microsoft ausentes no Railway.",
      missing,
    });
  }

  const state = crypto.randomBytes(24).toString("hex");
  const secureCookie = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);

  res.cookie("sendl_outlook_state", state, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams();
  params.set("client_id", process.env.MICROSOFT_CLIENT_ID);
  params.set("response_type", "code");
  params.set("redirect_uri", process.env.MICROSOFT_REDIRECT_URI);
  params.set("response_mode", "query");
  params.set("scope", microsoftScopes());
  params.set("state", state);
  params.set("prompt", "select_account");

  res.redirect(`${authorizeEndpoint()}?${params.toString()}`);
});

// Outlook OAuth - callback oficial
app.get("/api/auth/outlook/callback", async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.status(400).send(`Erro Microsoft: ${error} - ${error_description || ""}`);
    }

    if (!code) {
      return res.status(400).send("Código de autorização não recebido.");
    }

    const cookies = parseCookies(req);
    if (!state || cookies.sendl_outlook_state !== state) {
      return res.status(400).send("State inválido. Inicie a conexão novamente pelo SendL.");
    }

    res.clearCookie("sendl_outlook_state");

    await exchangeAuthorizationCode(code);
    const profile = await getOutlookProfile();

    console.log("Outlook conectado:", profile.userPrincipalName || profile.mail);

    res.status(200).send(buildSuccessPage(
      "Outlook conectado",
      `A conta ${profile.userPrincipalName || profile.mail || process.env.OUTLOOK_EMAIL} foi conectada oficialmente ao SendL.`
    ));
  } catch (error) {
    console.error("Erro no callback Outlook:", error.response?.data || error.message);
    res.status(500).send(`
      <h1>Erro ao conectar Outlook</h1>
      <pre>${JSON.stringify(error.response?.data || { message: error.message }, null, 2)}</pre>
      <p>Verifique as variáveis do Railway, permissões do Microsoft Entra e Redirect URI.</p>
    `);
  }
});

// Outlook status
app.get("/api/auth/outlook/status", async (req, res) => {
  const missing = requiredMicrosoftEnv();
  const token = readTokenStore();

  if (missing.length) {
    return res.json({
      connected: false,
      configured: false,
      missing,
      accountEmail: process.env.OUTLOOK_EMAIL || null,
    });
  }

  if (!token) {
    return res.json({
      connected: false,
      configured: true,
      accountEmail: process.env.OUTLOOK_EMAIL,
      message: "Outlook ainda não conectado.",
    });
  }

  try {
    const profile = await getOutlookProfile();

    res.json({
      connected: true,
      configured: true,
      accountEmail: process.env.OUTLOOK_EMAIL,
      microsoftAccount: profile.userPrincipalName || profile.mail,
      displayName: profile.displayName,
      expiresAt: token.expires_at ? new Date(token.expires_at).toISOString() : null,
    });
  } catch (error) {
    res.json({
      connected: false,
      configured: true,
      accountEmail: process.env.OUTLOOK_EMAIL,
      error: error.response?.data || error.message,
    });
  }
});

// Outlook desconectar
app.post("/api/auth/outlook/disconnect", (req, res) => {
  deleteTokenStore();
  res.json({ ok: true, connected: false });
});

// Enviar e-mail por Microsoft Graph
app.post("/api/outlook/send-email", async (req, res) => {
  try {
    const { to, subject, html, text, attachments } = req.body;

    if (!to || !subject || (!html && !text)) {
      return res.status(400).json({
        ok: false,
        error: "Informe to, subject e html ou text.",
      });
    }

    const accessToken = await refreshAccessTokenIfNeeded();

    const normalizedAttachments = Array.isArray(attachments)
      ? attachments.map((attachment) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.name,
          contentType: attachment.contentType || "application/pdf",
          contentBytes: attachment.contentBytes,
        }))
      : [];

    const message = {
      message: {
        subject,
        body: {
          contentType: html ? "HTML" : "Text",
          content: html || text,
        },
        toRecipients: [
          {
            emailAddress: {
              address: to,
            },
          },
        ],
        attachments: normalizedAttachments,
      },
      saveToSentItems: true,
    };

    await axios.post("https://graph.microsoft.com/v1.0/me/sendMail", message, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    res.json({
      ok: true,
      sent: true,
      to,
      subject,
    });
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message,
    });
  }
});

// Enviar e-mail teste
app.post("/api/outlook/send-test", async (req, res) => {
  try {
    const to = req.body.to || process.env.OUTLOOK_EMAIL;

    if (!to) {
      return res.status(400).json({
        ok: false,
        error: "Informe um destinatário para o teste.",
      });
    }

    const accessToken = await refreshAccessTokenIfNeeded();

    const message = {
      message: {
        subject: "Teste SendL - Outlook conectado",
        body: {
          contentType: "HTML",
          content: `
            <h2>SendL conectado ao Outlook</h2>
            <p>Este é um e-mail de teste enviado oficialmente pelo Microsoft Graph.</p>
            <p>Conta configurada: <strong>${process.env.OUTLOOK_EMAIL}</strong></p>
          `,
        },
        toRecipients: [
          {
            emailAddress: {
              address: to,
            },
          },
        ],
      },
      saveToSentItems: true,
    };

    await axios.post("https://graph.microsoft.com/v1.0/me/sendMail", message, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    res.json({
      ok: true,
      sent: true,
      to,
    });
  } catch (error) {
    console.error("Erro no e-mail teste:", error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message,
    });
  }
});

// Fallback SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SendL rodando na porta ${PORT}`);
});
