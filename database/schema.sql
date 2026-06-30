-- SendL v2 - Estrutura recomendada para PostgreSQL
-- Esta estrutura prepara o sistema para login, base de clientes, remessas, boletos e envios.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(160) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'financeiro',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE system_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(160) NOT NULL DEFAULT 'Edel White',
  whatsapp_number VARCHAR(30) NOT NULL DEFAULT '5511963336098',
  whatsapp_display VARCHAR(40) NOT NULL DEFAULT '+55 11 96333-6098',
  outlook_email VARCHAR(180) NOT NULL DEFAULT 'financeiro@edel-white.com',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(220) NOT NULL,
  document VARCHAR(20) NOT NULL UNIQUE,
  finance_email VARCHAR(180),
  whatsapp VARCHAR(30),
  contact_name VARCHAR(160),
  notes TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE remessa_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name VARCHAR(260) NOT NULL,
  file_hash VARCHAR(128) NOT NULL UNIQUE,
  source_bank VARCHAR(80) DEFAULT 'Santander',
  total_lines INTEGER,
  detail_lines INTEGER,
  total_amount NUMERIC(14, 2),
  imported_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  remessa_import_id UUID REFERENCES remessa_imports(id),
  client_id UUID REFERENCES clients(id),
  client_name_snapshot VARCHAR(220) NOT NULL,
  document VARCHAR(20) NOT NULL,
  invoice_number VARCHAR(80) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  due_date DATE NOT NULL,
  source VARCHAR(80) NOT NULL DEFAULT 'manual',
  status VARCHAR(60) NOT NULL DEFAULT 'imported',
  idempotency_key VARCHAR(260) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_invoice_validation
    UNIQUE (document, invoice_number, amount, due_date)
);

CREATE TABLE boletos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  file_url TEXT NOT NULL,
  file_name VARCHAR(260) NOT NULL,
  file_hash VARCHAR(128) NOT NULL UNIQUE,
  source_email VARCHAR(180),
  source_message_id VARCHAR(260),
  detected_amount NUMERIC(14, 2),
  detected_due_date DATE,
  status VARCHAR(60) NOT NULL DEFAULT 'located',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE send_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  boleto_id UUID REFERENCES boletos(id),
  channel VARCHAR(40) NOT NULL, -- whatsapp | outlook_email
  sender VARCHAR(180) NOT NULL,
  recipient VARCHAR(180) NOT NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_message_id VARCHAR(260),
  provider_response JSONB,
  error_message TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_invoice_channel_send
    UNIQUE (invoice_id, channel)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(120) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  entity_id UUID,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_document ON clients(document);
CREATE INDEX idx_invoices_document ON invoices(document);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_send_attempts_status ON send_attempts(status);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
