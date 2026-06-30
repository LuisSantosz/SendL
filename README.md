# SendL MVP v2

SendL é a central de controle de boletos da Edel White.

## Novidades da v4

- Tela de login com animação de acesso liberado.
- A tela de login desaparece após o acesso.
- Canais oficiais editáveis e autenticáveis:
  - WhatsApp inicial: +55 11 96333-6098
  - Outlook inicial: financeiro@edel-white.com
- Geração de código de autenticação para WhatsApp.
- Geração de código de autenticação para Outlook.
- Bloqueio de envio enquanto WhatsApp e Outlook não estiverem autenticados.
- Importação da remessa diária TXT Santander/CNAB 400.
- Importação da base de clientes em CSV.
- Cruzamento automático por CNPJ/CPF.
- Status novo: "Cliente sem contato".
- Vinculação manual de boleto PDF.
- Simulação de envio usando os canais oficiais.
- Modelo inicial de banco PostgreSQL atualizado.

## Acesso inicial do MVP

E-mail:

```txt
financeiro@edel-white.com
```

Senha:

```txt
edelwhite123
```

Importante: este login é apenas para teste local. Na versão em nuvem, a senha precisa ser criptografada e salva no backend.

## Como testar

1. Extraia o ZIP.
2. Abra `index.html` no navegador.
3. Faça login com o acesso inicial.
4. Vá em `Base clientes` e importe `modelos/modelo-base-clientes.csv`.
5. Vá em `Remessa diária` e importe seu arquivo TXT de remessa.
6. Vá em `Registros`.
7. Use `Boleto` para simular a localização do PDF.
8. Clique em `Validar`.
9. Clique em `Enviar`.

## Formato da base de clientes

Use CSV separado por ponto e vírgula:

```csv
cliente;documento;email;whatsapp;contato;observacao
Smile e Lovers;41.648.484/0001-67;financeiro@cliente.com.br;5511999999999;Financeiro;Cliente ativo
```

## Sobre o arquivo diário TXT

O importador lê arquivos de remessa em linhas fixas de 400 caracteres.

Ele processa os registros que começam com `1` e extrai:

- cliente;
- CNPJ/CPF;
- nota/parcela;
- vencimento;
- valor;
- endereço/cidade/UF, quando disponível.

## Próxima etapa

Transformar este MVP local em um sistema real em nuvem:

- Backend com Node.js/NestJS ou Python/FastAPI;
- PostgreSQL;
- login com usuário e senha criptografada;
- armazenamento de PDFs em nuvem;
- Microsoft Graph para Outlook;
- WhatsApp Cloud API;
- fila de envio;
- logs de auditoria.


## Ajustes da v3

- Removido o bloco "Fluxo da operação SendL" do dashboard.
- Removido o bloco "Próxima etapa técnica" da tela de configurações.
- Número de WhatsApp e e-mail Outlook agora podem ser editados na tela Configurações.


## Autenticação dos canais

Na tela `Configurações`, o usuário pode editar:

- número do WhatsApp;
- e-mail Outlook.

Depois de editar, é necessário gerar um código e confirmar.

Nesta versão local, o código aparece na tela como simulação.
Na versão em nuvem, o código deverá ser enviado de verdade:

- por WhatsApp Cloud API para o número informado;
- por Microsoft Graph/Outlook para o e-mail informado.

O envio de boletos fica bloqueado até os dois canais estarem autenticados.
