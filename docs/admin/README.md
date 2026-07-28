# Fundação do painel administrativo

A área administrativa server-side permanece separada do catálogo público. Além da consulta, ela oferece cadastro e gestão controlada de assets sem alterar a política pública de publicação. As páginas públicas continuam pré-renderizadas; `/admin/**` e `/api/admin/**` usam renderização sob demanda pelo adaptador oficial `@astrojs/netlify`.

## Rotas

- `/admin/login`: autenticação;
- `/admin/primeiro-acesso`: cadastro definitivo obrigatório durante o bootstrap;
- `/admin/alterar-senha`: troca posterior da senha, com confirmação da senha atual;
- `/admin`: indicadores e atividade;
- `/admin/selos`: busca, filtros e paginação;
- `/admin/selos/:id`: consulta do registro, upload inicial e retificação controlada de assets;
- `/admin/configuracoes`: diagnóstico não sensível.

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
- `PUBLICATION_MODE`: política pública já existente.

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

- `src/lib/admin/credential-store.mjs`: Netlify Blobs, consistência forte, ETag, migração e irreversibilidade;
- `src/lib/admin/auth-service.mjs`: login, cadastro inicial e troca posterior;
- `src/lib/admin/auth.mjs`: scrypt, comparação e políticas de usuário/senha;
- `src/lib/admin/session.mjs`: sessões assinadas e versionadas;
- `src/middleware.ts`: autenticação, bloqueio do bootstrap e headers;
- `src/pages/api/admin`: backend JSON padronizado;
- `src/lib/admin/catalog-service.ts`: leitura e validação operacional do catálogo.

Os endpoints de cadastro e assets podem persistir registros e referências de mídia com concorrência otimista. Eles não concedem aprovação humana, não publicam selos e não alteram a política do catálogo público. Assets substituíveis usam cache curto com revalidação para que uma retificação na mesma URL seja observável.

## Verificação

```bash
npm test
npm run catalogo:auditoria
npm run lint
npm run typecheck
npm run build
```
