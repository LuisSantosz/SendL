# Configurar a coleta de notas e boletos — SendL 2.1

A conta de acesso ao painel (ADMIN_EMAIL) é independente da conta de coleta e envio (GMAIL_EMAIL). O projeto usa faturamentoedelwhite@gmail.com para Gmail, conforme o fluxo do SendL.

## Atualizar esta versão

1. Exporte o backup completo no SendL antes de substituir arquivos.
2. Extraia o ZIP atualizado. Preserve seu arquivo .env e a pasta data (ou DATA_DIR) existente.
3. Copie o .env preservado para a nova pasta, na mesma pasta do server.js. Não use o .env.example no lugar das credenciais que você já preencheu.
4. Abra o terminal na nova pasta e execute npm install.
5. Não apague os dados do site do navegador. Use a mesma origem (http://localhost:3000) para manter clientes e PDFs.
6. Reinicie com npm start. A importação agora aceita Excel sem converter para CSV.

## Google Cloud / Google Auth Platform

1. Abra https://console.cloud.google.com/ e selecione o projeto que contém as credenciais Google do SendL. Você pode aproveitar um cliente OAuth Web existente.
2. Em APIs e serviços → Biblioteca, habilite Gmail API.
3. Em Google Auth Platform, confira Branding, Audience e Data Access. Para uma conta Gmail comum, o aplicativo é externo. Enquanto estiver em teste, adicione faturamentoedelwhite@gmail.com aos usuários de teste.
4. Em Clients, crie ou edite um cliente OAuth do tipo Aplicativo da Web.
5. Em URIs de redirecionamento autorizados, cadastre exatamente:
   http://localhost:3000/api/auth/gmail/callback
6. Se também for usar Railway, adicione a URL daquele serviço:
   https://SEU-SERVICO.up.railway.app/api/auth/gmail/callback
7. Confira os escopos de leitura e envio:
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send

Esta versão não precisa de WhatsApp nem de Microsoft Entra. A autenticação Google é feita no servidor; não é necessário cadastrar JavaScript origins para esse fluxo.

## Arquivo .env local

Mantenha ADMIN_EMAIL e ADMIN_PASSWORD já configurados. Confira estas linhas:

PORT=3000
NODE_ENV=development
APP_ORIGIN=http://localhost:3000
TRUST_PROXY=0
GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=SEU_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback
GMAIL_EMAIL=faturamentoedelwhite@gmail.com
DATA_DIR=./data

Preencha os valores reais apenas no seu computador/servidor. Não publique .env, Client Secret ou tokens no GitHub.

Após salvar, pare o servidor com Ctrl+C e rode npm start. Acesse exatamente http://localhost:3000. O endereço 127.0.0.1 é uma origem diferente.

## Autorizar

1. Entre no SendL e abra Configurações.
2. Confira a conta e a URL de retorno mostradas pelo painel.
3. Clique em Conectar Gmail e selecione faturamentoedelwhite@gmail.com.
4. Autorize leitura de mensagens/anexos e envio de e-mails.
5. Aguarde retornar ao SendL e confirme o status conectado.

Se a conexão anterior não possuir os escopos necessários, desconecte no SendL e conecte novamente. Se não vier refresh token, remova a autorização anterior do app em https://myaccount.google.com/connections e conecte novamente. Isso exige novo consentimento; não exclui suas mensagens.

## Coletar notas e boletos

Em Documentos:
1. Escolha Notas e boletos, Notas fiscais, Boletos ou Todos os PDFs.
2. Escolha o período (7, 30, 90 dias ou todo o período).
3. Opcionalmente, use o campo adicional:
   - from:notafiscaledelwhite para filtrar o remetente de boletos conhecido.
   - subject:"Nota Fiscal Eletronica" para notas.
   - subject:"Boleto(s) Bancário Referente à NFe" para boletos.
4. Clique em Buscar documentos.
5. Confira o assunto, o remetente e os anexos.
6. Selecione o cliente e o tipo do documento no formulário à esquerda, e clique em Vincular no PDF desejado.
7. Abra a fila e confira os PDFs antes do envio.

Os filtros de notas/boletos usam assunto ou nome de arquivo. Se não encontrar algo, use Todos os PDFs e amplie o período. Use Mais mensagens para continuar a busca (10 mensagens por página). A busca não apaga nem marca e-mails como lidos.

A coleta para a fila é iniciada por você e a vinculação ao cliente é explícita. Esta versão não tem sincronização agendada nem identifica automaticamente o CPF/CNPJ dentro do PDF. O número sugerido pelo nome/chave do arquivo deve ser conferido.

## Erros frequentes

- redirect_uri_mismatch: a URL cadastrada no cliente Google precisa ser idêntica à GOOGLE_REDIRECT_URI, inclusive protocolo, porta e caminho.
- invalid_client: Client ID/Client Secret incorretos ou pertencem a outro cliente/projeto.
- access_denied ou app em teste: confira o usuário de teste e se os dois acessos foram autorizados.
- invalid_grant: a autorização pode ter expirado ou sido revogada. Reconecte. Em apps externos no modo Teste, refresh tokens com esses escopos normalmente expiram em 7 dias.
- Origem não autorizada: abra o mesmo endereço de APP_ORIGIN.
- Conta diferente: conecte a conta indicada em GMAIL_EMAIL.
- Coleta vazia: use Todos os PDFs, amplie o período e confirme que a mensagem está na conta conectada.

## Railway

Depois de validar localmente, use as URLs HTTPS reais, NODE_ENV=production, TRUST_PROXY=1 e DATA_DIR em volume persistente. As variáveis locais não são enviadas ao Railway automaticamente.

## Referências oficiais

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/guides/filtering
- https://developers.google.com/identity/protocols/oauth2#expiration
