# SendL - Outlook oficial no Railway

Esta versão adiciona o backend oficial para conectar o Outlook via Microsoft Entra ID e Microsoft Graph.

## Rotas criadas

```txt
GET  /api/auth/outlook/login
GET  /api/auth/outlook/callback
GET  /api/auth/outlook/status
POST /api/auth/outlook/disconnect
POST /api/outlook/send-email
POST /api/outlook/send-test
GET  /api/webhooks/whatsapp
POST /api/webhooks/whatsapp
GET  /health
```

## Variáveis que precisam estar no Railway

Coloque no serviço SendL > Variables:

```env
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=https://sendl-production.up.railway.app/api/auth/outlook/callback
OUTLOOK_EMAIL=financeiro@edelwhite.onmicrosoft.com
WHATSAPP_VERIFY_TOKEN=SendL_EdelWhite_2026
NODE_ENV=production
```

Use `financeiro@edelwhite.onmicrosoft.com` enquanto o domínio `edel-white.com` não estiver validado no Microsoft 365.

## Microsoft Entra ID

No aplicativo SendL em Registros de aplicativo, configure:

```txt
Redirect URI:
https://sendl-production.up.railway.app/api/auth/outlook/callback
```

Permissões delegadas:

```txt
User.Read
Mail.Send
Mail.Read
offline_access
```

Depois clique em "Conceder consentimento de administrador".

## Como testar

1. Suba este código no GitHub.
2. O Railway fará o deploy.
3. Abra:

```txt
https://sendl-production.up.railway.app/health
```

4. Acesse o SendL.
5. Vá em Configurações.
6. Clique em "Conectar Outlook".
7. Faça login na tela oficial da Microsoft.
8. O sistema volta para o SendL.
9. Envie um e-mail teste.

## Observação importante

Nesta versão, o token do Outlook é salvo em arquivo dentro da pasta `data/outlook-token.json`.

Isso funciona para teste, mas em produção o ideal é salvar os tokens em banco de dados seguro, como PostgreSQL, porque arquivos podem ser perdidos em redeploys ou troca de instância.
