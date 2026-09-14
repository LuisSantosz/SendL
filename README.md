# SendL 2 — central de documentos por Gmail

Refatoração da versão que estava na branch master (commit 585f2cf).
O repositório original era o MVP de julho com Outlook, CSV/CNAB local e login demonstrativo. Não continha a versão mais recente mencionada no projeto nem código Firebase. Esta entrega reconstrói o fluxo a partir dessa base; o arquivo RAR não foi extraído nesta sessão.

## O que funciona nesta versão

- Login validado no servidor, sem senha pública no HTML.
- Gmail OAuth com conta permitida, PKCE, estado vinculado à sessão e renovação do token.
- Importação e edição de clientes por CPF/CNPJ; CSV exportado pelo Excel.
- Importação de títulos via CSV ou variante Santander CNAB 400 compatível com o parser legado.
- Agrupamento por cliente com consulta por Map/Set e bloqueio de duplicidades na importação.
- Vários PDFs por cliente, nota ou boleto, enviados juntos ou separadamente.
- Busca paginada de PDFs no Gmail e vinculação explícita ao cliente selecionado.
- Sugestão do número de nota pelo nome do PDF ou chave NFe de 44 dígitos; edição manual.
- Conferência do destinatário, mensagem e cada anexo antes do envio.
- Registro persistente da operação no backend e tratamento de resultado incerto, sem repetir automaticamente o POST de envio.
- Tabelas paginadas, busca com debounce, tema claro/escuro e layout para celular.
- Backup JSON completo com clientes, títulos, histórico e PDFs, com restauração.
- Limpeza da fila pendente sem apagar os dados já enviados.

O WhatsApp e o Outlook foram removidos das rotas, configurações e interface. Não há envio por esses canais.

## Instalação local (Windows, macOS ou Linux)

Use Node.js 22 ou superior.

1. Baixe o ZIP da branch desta entrega e extraia.
2. Abra um terminal na pasta que contém package.json.
3. Execute npm install.
4. Copie .env.example para .env e preencha as variáveis.
5. Execute npm start e abra http://localhost:3000.

Não abra public/index.html por duplo clique. A interface e a API precisam ser servidas pelo mesmo backend.

ADMIN_EMAIL é o e-mail escolhido para entrar no painel, não precisa ser igual ao Gmail.
ADMIN_PASSWORD precisa ter ao menos 12 caracteres.
O login antigo demonstrativo foi removido. O sistema recusa o login se as novas credenciais não estiverem configuradas.

## Conectar Gmail

1. No projeto Google Cloud usado pelo SendL, habilite a Gmail API.
2. Configure o consentimento OAuth e crie/use um cliente OAuth do tipo Aplicativo da Web.
3. Cadastre exatamente a URL GOOGLE_REDIRECT_URI:
   - Local: http://localhost:3000/api/auth/gmail/callback
   - Railway: https://SEU-SERVICO.up.railway.app/api/auth/gmail/callback
4. Salve GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET apenas no servidor.
5. Configure GMAIL_EMAIL=faturamentoedelwhite@gmail.com (ou a conta autorizada da operação).
6. Entre no painel, acesse Configurações e clique em Conectar Gmail.
7. Autorize os dois acessos solicitados: leitura e envio.
8. Envie um teste apenas para um destinatário que você escolher.

O callback recusa uma conta diferente de GMAIL_EMAIL. As credenciais de um app antigo podem ser reutilizadas se o redirect estiver cadastrado; o token de Outlook não pode ser reaproveitado. Tokens Gmail de outra versão não são importados automaticamente.

Em apps externos no modo Teste, inclua a conta em usuários de teste e observe a validade reduzida das autorizações do Google. Se houver invalid_grant, reconecte em Configurações. A conexão está implementada, mas exige as credenciais e autorização reais para validar o envio na conta.

Referências oficiais:
- [OAuth para aplicações web](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Envio de mensagens MIME pelo Gmail](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Leitura de anexos Gmail](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get)

## Railway e persistência

Use um único serviço/uma única réplica Node para servir a interface e a API:
- Comando de inicialização: npm start
- Health check: /health
- NODE_ENV=production
- APP_ORIGIN=https://SEU-SERVICO.up.railway.app (sem caminho)
- TRUST_PROXY=1 para o proxy do Railway
- GOOGLE_REDIRECT_URI=https://SEU-SERVICO.up.railway.app/api/auth/gmail/callback
- As demais variáveis do .env.example
- Volume persistente montado em /data e DATA_DIR=/data

Não deixe DATA_DIR dentro de public/. Sem volume persistente, redeploys podem perder a autorização Gmail e o histórico que evita repetição de envios. A exclusão desse histórico também elimina a proteção contra repetição de operações antigas.

Sessões de acesso ficam em memória por até 8 horas; reiniciar o serviço exige novo login.
Um único processo mantém os bloqueios de envio e renovação. Não use cluster, múltiplas réplicas ou vários processos compartilhando a pasta de dados nesta versão.

Esta entrega não altera automaticamente o Firebase Hosting nem o Railway. O ZIP não contém configuração Firebase: para usar o frontend em outro domínio seria necessário configurar um proxy de API e a autenticação correspondente. Use o endereço único do backend nesta versão para evitar chamadas a uma API no domínio errado.

## Dados existentes e migração

Clientes, títulos e eventos antigos nas chaves sendl_*_backend_v1 são lidos na primeira abertura, desde que você use o mesmo navegador e a mesma origem (protocolo + domínio + porta). As chaves antigas não são apagadas.

A nova chave é sendl_workspace_v2. Os PDFs ficam no IndexedDB sendl_documents_v2. Nenhum PDF é armazenado no localStorage.
A atualização não converte dados de versões que não estão no repositório. Se a sua instalação usa outra versão, exporte os dados dela antes de substituir.

Antes de trocar de domínio/computador ou limpar o navegador, use Exportar backup completo. A restauração substitui o conjunto atual, inclui os PDFs e não envia mensagens. Limite de importação do backup: 100 MB. Se houver envios com resultado pendente, resolva-os no navegador de origem antes de exportar para migração.

O painel permite somente uma aba ativa por origem, para evitar alterações concorrentes da mesma fila. Use HTTPS ou localhost e um navegador atualizado com Web Locks / IndexedDB.

Os clientes e PDFs não são sincronizados entre computadores. Esta versão mantém o armazenamento local do MVP; não é um banco compartilhado para múltiplos usuários.

## Importações e vinculações

Clientes CSV: cliente;documento;email;estado
Títulos CSV: cliente;documento;nota;valor;vencimento

Use os modelos disponíveis no painel. Datas aceitas: DD/MM/AAAA ou AAAA-MM-DD.
Colunas opcionais em branco não apagam os contatos já preenchidos. E-mails inválidos e documentos com tamanho incorreto são ignorados na importação, com contagem ao final. A validação de CPF/CNPJ é estrutural; não consulta a Receita nem verifica titularidade.

O parser CNAB preserva a variante antiga que reconhece títulos no padrão 501XXXXXXX-XX, com registros de 400 caracteres e campos de pagador nas posições do código anterior. Outros bancos/layouts e CNAB 240 são recusados; não se deve adaptar posições sem um arquivo representativo. Sem o RAR/amostra real, não foi possível homologar o CNAB da operação. O CSV permite importar os títulos sem depender dessa variante.

A leitura do número de nota usa nome do arquivo/chave, não OCR nem interpretação do conteúdo do PDF. Números de BOL_ podem ser identificadores de boleto e precisam de conferência. A vinculação ao cliente nunca é feita apenas por um número parecido. Se houver dúvida, edite o número e abra o PDF.

Busca Gmail: 10 mensagens por página; 3 consultas de detalhe simultâneas; baixar um PDF exige seleção explícita do cliente. PDFs são validados pelo cabeçalho e extensão. Limite por mensagem: 12 MB de PDFs e 30 anexos. Anexos repetidos para o mesmo cliente pendente são filtrados pelo SHA-256 do conteúdo.

## Resultado incerto / prevenção de duplicidades

O servidor grava a operação antes de chamar o Gmail. O mesmo identificador com o mesmo conteúdo retorna o resultado já registrado se enviado; conteúdo diferente para a mesma operação é recusado. Cliques concorrentes são bloqueados.

Se o Gmail responder com erro definitivo de cliente, uma nova tentativa pode ser liberada após consultar o resultado. Se ocorrer timeout, erro 5xx ou falha de rede, a operação fica pendente/incerta e NÃO é repetida automaticamente.

Use Conferir resultado. Após 90 segundos, confira a pasta Enviados no Gmail e informe se o e-mail foi entregue ao Gmail. Essa conferência é manual; ausência de confirmação não comprova ausência de envio. Um reenvio liberado incorretamente pode duplicar a mensagem. O status Enviado indica aceite do Gmail, não leitura pelo destinatário nem garantia de entrega final.

## Segurança e organização

Apenas public/ é disponibilizada na web. Tokens, código do servidor e comprovantes de operação não são servidos como arquivos estáticos. As APIs exigem sessão; gravações exigem cabeçalho da aplicação e origem correspondente. O painel usa cookies HttpOnly/SameSite e cookies Secure em HTTPS; o token OAuth nunca é devolvido à interface.

O histórico de operações do servidor e os tokens ficam em DATA_DIR com gravação atômica. Faça backup reservado desse volume. Desconectar remove o token local; para revogar também no Google, remova o acesso do app na conta Google.

Estrutura:
- server.js: autenticação, rotas Gmail e inicialização.
- lib/mail.js: validação e composição MIME.
- lib/storage.js: arquivos persistentes gravados atomicamente.
- public/: interface, estilos e regras compartilhadas.
- tests/: testes de regras, MIME, armazenamento e proteção HTTP.
- .github/workflows/ci.yml: checagem e testes sem credenciais reais.

Removidos: index/assets legados, data/.gitkeep desnecessário, CORS aberto e dependência cors, endpoints/variáveis Microsoft e Meta, senha demonstrativa e fontes externas. A pasta data é criada quando necessária.

## Validação

npm run check
npm test

A CI usa Node 22, instala as dependências e executa as verificações. Os testes HTTP rodam localmente com servidor efêmero, sem Gmail real. Nenhum e-mail é enviado pelos testes.

Antes de substituir a instalação em uso, valide com um destinatário de teste:
1. Login e logout.
2. Uma pequena base de clientes e uma remessa representativa.
3. Dois boletos e uma nota para o mesmo cliente; conferir um único envio.
4. Boleto sem nota e nota sem boleto.
5. Atualização da página, backup e restauração dos PDFs.
6. Gmail conectado, recebimento dos anexos e falhas de autorização.
7. Layout em celular e notebook.

A CI não substitui a validação visual no navegador nem a homologação com arquivos CNAB reais.
