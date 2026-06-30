# SendL - Próximas etapas técnicas

## 1. Backend

Criar uma API para substituir o armazenamento local do navegador.

Sugestão:
- Node.js + NestJS + Prisma;
- ou Python + FastAPI + SQLAlchemy.

Rotas principais:
- POST /auth/login
- POST /clients/import
- GET /clients
- POST /remessas/import
- GET /invoices
- POST /invoices/:id/validate
- POST /invoices/:id/send
- GET /logs

## 2. Banco de dados

Usar PostgreSQL.

Tabelas principais:
- users
- system_channels
- clients
- remessa_imports
- invoices
- boletos
- send_attempts
- audit_logs

O arquivo `database/schema.sql` já contém uma sugestão inicial.

## 3. Integração Outlook

Como o e-mail é financeiro@edel-white.com, a integração ideal é Microsoft Graph.

Funções:
- ler e-mails recebidos;
- filtrar por pasta/assunto/remetente;
- baixar anexos PDF;
- cruzar PDF com nota/parcela;
- salvar arquivo em storage;
- atualizar status da nota.

## 4. Integração WhatsApp

Usar WhatsApp Business Cloud API.

Funções:
- template aprovado para envio de boleto;
- envio de documento PDF;
- registro do ID da mensagem;
- controle de falhas;
- bloqueio de duplicidade por idempotency key.

## 5. Hospedagem

Sugestão simples:
- Frontend: Firebase Hosting ou Vercel;
- Backend: Google Cloud Run, Render ou Railway;
- Banco: Supabase, Neon, Cloud SQL ou Render PostgreSQL;
- Storage: Google Cloud Storage ou AWS S3.
