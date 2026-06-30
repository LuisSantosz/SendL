const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// Servir o painel SendL
app.use(express.static(path.join(__dirname)));

// Rota de teste
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "SendL",
    message: "Backend online"
  });
});

// Webhook WhatsApp - verificação da Meta
app.get("/api/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    console.log("Webhook WhatsApp verificado com sucesso.");
    return res.status(200).send(challenge);
  }

  console.log("Falha na verificação do webhook WhatsApp.");
  return res.sendStatus(403);
});

// Webhook WhatsApp - recebimento de eventos
app.post("/api/webhooks/whatsapp", (req, res) => {
  console.log("Evento recebido do WhatsApp:", JSON.stringify(req.body, null, 2));

  // Sempre responder 200 para a Meta saber que recebeu
  res.sendStatus(200);
});

// Railway usa a variável PORT automaticamente
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SendL rodando na porta ${PORT}`);
});