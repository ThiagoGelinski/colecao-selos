# Painel administrativo

O painel permite consulta, cadastro, edição, fotografias e publicação com autenticação no servidor. `/admin/**` e `/api/admin/**` executam sob demanda; as páginas e imagens públicas vêm do build do GitHub main.

## Rotas

- `/admin/login`, `/admin/primeiro-acesso` e `/admin/alterar-senha`: acesso e credenciais.
- `/admin`: indicadores e atividade.
- `/admin/selos`: busca, cadastro, filtros e paginação.
- `/admin/selos/:id`: edição estruturada, fontes, quantidade, imagens, revisão e publicação.
- `/admin/configuracoes`: diagnóstico não sensível.
- `/api/admin/selos/:id/assets/:papel`: prévia privada da imagem de trabalho, sem cache.
- `/api/admin/selos/:id/publicacao`: ações `prepare`, `approve`, `status` e `publish`.

## Dados e permissões

A fonte oficial é a [main de ThiagoGelinski/colecao-selos](https://github.com/ThiagoGelinski/colecao-selos/tree/main). A recuperação preserva os sete registros SEL-000001 a SEL-000007 e suas 21 imagens WebP.

O store selecionado por `CATALOG_BLOB_STORE` guarda trabalho administrativo: registros em `manifests/SEL-xxxxxx.json`, manifesto em `manifests/ids.json` e mídia em suas chaves próprias. O servidor combina o conteúdo do deploy com as alterações dos Blobs. As gravações verificam digest do registro completo e ETag; uma tela antiga não pode sobrescrever outra edição no mesmo dia.

| Operação | Perfis |
| --- | --- |
| Consulta e situação da publicação | administrador, catalogador, revisor, consulta |
| Cadastro, edição e fotografias | administrador, catalogador |
| Aprovação humana | administrador, revisor |
| Publicação na main | administrador |

O formulário envia somente campos editáveis alterados. ID, slug, caminhos das imagens, aprovação, histórico e controle editorial não são livremente alteráveis por PATCH. Salvar conteúdo ou retificar imagem invalida a aprovação anterior e exige nova revisão.

O catálogo público incorpora os JSONs durante o build por `src/lib/selos.ts`. A API pública de imagens usa exclusivamente os arquivos desse build; não consulta rascunhos em Blobs. As prévias privadas do painel podem mostrar alterações ainda não publicadas.

## Área de trabalho da recuperação

A inspeção do store legado `colecao-selos-catalogo` identificou rascunhos com IDs SEL-000002 e SEL-000003 colidindo com os selos oficiais, mídia divergente e manifesto antigo. A recuperação prevê `CATALOG_BLOB_STORE=colecao-selos-catalogo-v2` nas Functions de produção, usando o baseline oficial dos sete selos sem transferir automaticamente esses conflitos.

O store antigo e seus objetos permanecem preservados. Não apague, mova ou sobrescreva registros, imagens ou backups. A conclusão da cópia verificável e a ativação remota precisam ser confirmadas separadamente; esta documentação não as declara concluídas. O store de credenciais não muda e o acesso definitivo não deve ser reiniciado. Veja [recuperação e reconciliação](../publicacao/arquitetura.md).

## Fotografias e repetidos

Envie a fotografia original em PNG, JPEG, WebP ou TIFF, até 5 MiB. Informe recorte horizontal e vertical em pixels: o primeiro remove a mesma margem esquerda/direita e o segundo no topo/base. Zero mantém a dimensão naquele eixo. Preserve toda a serrilha.

O servidor decodifica a imagem, rejeita animação, múltiplas páginas e formatos que exigiriam conversão de espaço de cor ou precisão, aplica somente o recorte e converte para WebP lossless. Confere pixels retidos, ICC e orientação. Não aplica IA, retoque, filtros, restauração, redimensionamento ou rotação automática.

Originais, derivados e recibos por SHA256 são arquivados com gravação exclusiva no store privado `colecao-selos-originais`. A retificação arquiva os bytes da imagem anterior como derivado legado, sem chamá-lo de original. A referência corrente só muda após a verificação desses arquivos. Não há rota de exclusão desse acervo.

Os 21 WebPs históricos não demonstram a localização das capturas originais nem sua transformação anterior. Os originais de captura não foram identificados entre os arquivos versionados; outros arquivos e backups permanecem intactos. Não exclua, mova ou sobrescreva backups.

A quantidade é opcional e aparece como “Não informada” enquanto não conferida. Havendo repetidos, informe a quantidade e confirme que a fotografia mostra o exemplar de melhor conservação. O schema exige esse critério para quantidade maior que 1; nenhum valor foi inventado para registros antigos.

## Revisão e publicação

1. Salve a edição e conclua o envio das fotografias. A tela bloqueia a revisão de alterações ainda não salvas.
2. Use **Preparar revisão**. O servidor vincula ficha completa, manifesto e bytes de imagens à main atual por hashes. Uma tela desatualizada precisa ser recarregada.
3. Um administrador ou revisor confere conteúdo, fontes e imagens e marca a confirmação humana explícita. **Aprovar e enviar ao GitHub** registra responsável da sessão, data e snapshot em recibo imutável e cria branch e Pull Request.
4. Atualize a situação. O backend exige o workflow `.github/workflows/ci.yml` e o job **Testes, auditoria e build** concluídos com sucesso para o SHA exato do PR.
5. Somente o administrador usa **Publicar versão aprovada**. O servidor revalida conteúdo, imagens, manifesto, diff, SHA e main; grava o snapshot aprovado por CAS e avança main por fast-forward sem força. Mudanças posteriores exigem nova revisão.
6. O Netlify deve estar conectado a essa main para executar o build. Confira separadamente o deploy e o catálogo; `publicado` no JSON não comprova que o site já mudou.

Os recibos ficam no store `colecao-selos-publicacao`. Repetir o mesmo snapshot reutiliza sua revisão. Falhas ou resultados externos incertos exigem consulta do PR e da referência Git antes de intervenção; não apague recibos, Blobs ou backups para destravar. A reconciliação preserva rascunhos posteriores e reservas de outros selos. Consulte [arquitetura](../publicacao/arquitetura.md).

A integração depende da configuração de runtime. Esta documentação registra o comportamento implementado; não afirma que credenciais, conexão Git ou um teste real em produção já estejam validados.

## Credencial de publicação

Siga o [passo a passo para conectar o GitHub](conectar-github.md), incluindo a opção de envio por tela local temporária e a configuração manual no Netlify.

Configure `GITHUB_PUBLISH_TOKEN` no servidor, preferindo o escopo **Functions** no Netlify quando o plano permitir; use os escopos padrão se a seleção granular não estiver disponível. Mantenha o valor somente no contexto de produção autorizado. Restrinja o token ao repositório `ThiagoGelinski/colecao-selos`: Contents e Pull requests em leitura/escrita, Actions e Metadata em leitura.

Não use prefixo `PUBLIC_`, não versione o valor nem o coloque no cliente, logs ou `netlify.toml`. A entrada de exemplo fica vazia. Sem a configuração, a publicação retorna `PUBLICATION_NOT_CONFIGURED` (503); edição e upload continuam independentes. O token não concede ao software uma decisão editorial: aprovação humana e ação administrativa permanecem obrigatórias.

## Primeiro acesso

Em um store administrativo vazio, o sistema só cria a credencial inicial quando a ativação está explicitamente habilitada em um contexto autorizado:

- usuário: `admin`;
- senha: valor server-side de `ADMIN_BOOTSTRAP_SECRET`, com ao menos 32 caracteres;
- ativação: `ADMIN_BOOTSTRAP_ENABLED=true`.

O segredo serve exclusivamente para iniciar o cadastro definitivo e somente seu hash scrypt é persistido. Após o login, o middleware permite apenas sessão, logout e `/admin/primeiro-acesso`; dashboard, selos, configurações, troca posterior de senha e APIs normais permanecem bloqueados.

A tela **Configure seu acesso administrativo** solicita um novo login, uma nova senha e a confirmação. O login é normalizado para minúsculas, deve ter de 4 a 64 caracteres e aceita letras, números, ponto, hífen e underscore. A senha deve ter ao menos 12 caracteres, não pode coincidir com o login nem com o segredo de ativação e deve ser confirmada.

Ao concluir, o sistema persiste somente o novo hash scrypt, marca `bootstrap_required=false` e `bootstrap_consumed=true`, incrementa `credential_version` e emite uma sessão nova. A sessão de bootstrap anterior deixa de ser válida. Remova `ADMIN_BOOTSTRAP_SECRET` e desative `ADMIN_BOOTSTRAP_ENABLED` após confirmar o acesso definitivo.

## Persistência e irreversibilidade

As credenciais ficam em um store site-wide do **Netlify Blobs**, com consistência forte e atualizações condicionais por ETag. São persistidos:

- `username`;
- `password_hash`;
- `bootstrap_required`;
- `bootstrap_consumed`;
- `credential_version`;
- `updated_at`;
- versão interna do modo de bootstrap.

`bootstrap_consumed=true` e uma credencial definitiva têm precedência absoluta. Carregamentos futuros, reinícios e novos deploys apenas reutilizam esse estado; nunca recriam ou reativam a credencial inicial. Um bootstrap experimental anterior ainda não consumido só é migrado quando a ativação atual está explicitamente configurada; estados parciais não consumidos seguem a mesma regra e convergem para o hash do segredo configurado. Deploy Previews e branch deploys não podem criar nem migrar bootstrap. Uma credencial definitiva sem o marcador separado recupera o marcador como consumido sem alterar login ou hash.

Se o marcador persistido disser `bootstrap_consumed=true`, mas a credencial estiver ausente ou ainda for de bootstrap, o sistema falha fechado e registra somente um código seguro no log server-side. Esse caso exige inspeção manual: o marcador nunca é apagado e a credencial definitiva nunca é sobrescrita automaticamente.

Os eventos server-side distinguem configuração ausente, store indisponível, estado incompleto, migração e conflito de ETag. Senhas, hashes, segredos e conteúdo dos erros não são registrados.

O filesystem efêmero da função, `localStorage`, `sessionStorage` e senhas em variáveis de ambiente não são usados. A senha definitiva nunca fica no código, no bundle cliente ou nos logs.

## Autenticação e sessão

O servidor compara hashes scrypt em tempo constante e emite cookie assinado por HMAC-SHA-256 com `HttpOnly`, `Secure`, `SameSite=Lax`, validade limitada, nonce, versão da credencial e estado de bootstrap. Login e primeiro acesso possuem rate limit rigoroso; requisições mutáveis validam origem e tamanho. Respostas de autenticação não revelam detalhes internos.

Depois do cadastro, `/admin/alterar-senha` exige sessão administrativa, senha atual, nova senha e confirmação. O login não é alterado nessa tela.

## Variáveis de ambiente

- `ADMIN_SESSION_SECRET`: segredo de assinatura das sessões, aleatório e com pelo menos 32 caracteres;
- `ADMIN_BOOTSTRAP_ENABLED`: use `true` somente durante a ativação inicial em produção ou ambiente local autorizado;
- `ADMIN_BOOTSTRAP_SECRET`: segredo temporário de ativação, aleatório e com pelo menos 32 caracteres, lido somente no servidor;
- `ADMIN_ROLE`: perfil inicial, padrão `administrador`;
- `ADMIN_SESSION_TTL_SECONDS`: duração entre 300 e 86400 segundos, padrão 28800;
- `SITE_URL`: origem pública do site;
- `PUBLICATION_MODE`: política pública já existente;
- `CATALOG_BLOB_STORE`: seletor restrito a `colecao-selos-catalogo` ou `colecao-selos-catalogo-v2`; a recuperação prevê v2 nas Functions de produção, preservando o store legado.

O segredo de bootstrap nunca deve ser colocado em `netlify.toml`, código, documentação, logs ou bundle cliente. Se o store estiver vazio e a configuração estiver ausente, desabilitada, curta ou em contexto proibido, a inicialização falha fechada e não grava estado parcial. Depois de `bootstrap_consumed=true`, as variáveis de bootstrap são ignoradas e não podem reabrir o fluxo.

## Deploy no Netlify

1. Em **Project configuration → Environment variables**, configure `ADMIN_SESSION_SECRET` com escopo server-side e pelo menos 32 caracteres aleatórios.
2. Para a ativação inicial em produção, configure temporariamente `ADMIN_BOOTSTRAP_ENABLED=true` e `ADMIN_BOOTSTRAP_SECRET` com outro valor aleatório de pelo menos 32 caracteres. Não disponibilize essas variáveis ao cliente.
3. Faça o deploy, acesse `/admin/login` e autentique com o usuário `admin` e o segredo temporário.
4. Conclua imediatamente `/admin/primeiro-acesso` com login e senha definitivos diferentes do segredo de ativação.
5. Confirme o acesso definitivo; em seguida remova `ADMIN_BOOTSTRAP_SECRET` e defina `ADMIN_BOOTSTRAP_ENABLED=false`.
6. Guarde o login e a senha definitivos em um gerenciador de senhas e verifique o diagnóstico não sensível em `/admin/configuracoes`.

Não configure bootstrap em Deploy Preview ou branch deploy. Não coloque segredos em `netlify.toml`. O store site-wide é compartilhado pelos deploys do mesmo projeto Netlify, e um estado consumido nunca é reativado automaticamente.

## Arquitetura

- `src/lib/admin/credential-store.mjs`: Netlify Blobs, consistência forte, ETag e irreversibilidade do bootstrap.
- `src/lib/admin/auth-service.mjs`: login, cadastro inicial e troca posterior.
- `src/lib/admin/auth.mjs` e `session.mjs`: hashes e sessões assinadas.
- `src/middleware.ts`: autenticação, bloqueio de bootstrap e headers.
- `src/lib/admin/editor.mjs`: edição protegida e invalidação de aprovação.
- `src/lib/catalogo/media.mjs`: arquivo de originais e processamento permitido.
- `src/lib/publicacao/`: snapshots, recibos e integração GitHub.
- `src/pages/api/admin`: backend JSON com verificações de sessão, papel e concorrência.

Cadastro, edição e upload persistem rascunhos. Aprovação e promoção ao GitHub usam operações separadas. `astro.config.mjs` inclui JSONs, manifesto, template e imagens no pacote da Function; `tests/netlify-bundle.check.mjs` verifica esses arquivos após o build.

## Verificação

~~~bash
npm test
npm run catalogo:auditoria
npm run lint
npm run typecheck
npm run check
npm run build
node tests/netlify-bundle.check.mjs
git diff --check
~~~

`lint`, `typecheck` e `check` executam Astro Check, sem etapa ESLint separada. Testes isolados não equivalem a login, aprovação ou deploy reais; registre essas evidências separadamente. Não use registros fictícios permanentes para testar a publicação.


Nota operacional de 2026-09-10: o site Netlify está ligado à main oficial. O backup dos quatro objetos legados foi verificado por dupla leitura e SHA-256; nenhum objeto remoto foi removido. CATALOG_BLOB_STORE=colecao-selos-catalogo-v2 foi configurado para o próximo deploy. O plano atual recusou escopos granulares; foram usados os escopos padrão. Para GITHUB_PUBLISH_TOKEN, prefira Functions quando o plano permitir; caso contrário, use os escopos padrão com valor de produção. O código consome esse segredo apenas no servidor e não o inclui no cliente. A credencial GitHub do painel ainda aguarda configuração e verificação.
