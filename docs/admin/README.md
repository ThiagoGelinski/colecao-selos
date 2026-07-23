# Fundação do painel administrativo

O Bloco 1 adiciona uma área administrativa server-side, separada do catálogo público. As páginas públicas continuam pré-renderizadas; `/admin/**` e `/api/admin/**` usam renderização sob demanda pelo adaptador oficial `@astrojs/netlify`.

## Rotas

- `/admin/login`: autenticação;
- `/admin/primeiro-acesso`: cadastro definitivo obrigatório durante o bootstrap;
- `/admin/alterar-senha`: troca posterior da senha, com confirmação da senha atual;
- `/admin`: indicadores e atividade;
- `/admin/selos`: busca, filtros e paginação;
- `/admin/selos/:id`: consulta somente leitura;
- `/admin/configuracoes`: diagnóstico não sensível.

## Primeiro acesso

Em um store administrativo vazio, o sistema cria uma única credencial inicial:

- usuário: `admin`;
- senha: `123456`.

Essa credencial serve exclusivamente para iniciar o cadastro definitivo. Após o login, o middleware permite apenas sessão, logout e `/admin/primeiro-acesso`; dashboard, selos, configurações, troca posterior de senha e APIs normais permanecem bloqueados.

A tela **Configure seu acesso administrativo** solicita um novo login, uma nova senha e a confirmação. O login é normalizado para minúsculas, deve ter de 4 a 64 caracteres e aceita letras, números, ponto, hífen e underscore. A senha deve ter ao menos 12 caracteres, não pode ser `123456`, não pode coincidir com o login e deve ser confirmada.

Ao concluir, o sistema persiste somente o novo hash scrypt, marca `bootstrap_required=false` e `bootstrap_consumed=true`, incrementa `credential_version` e emite uma sessão nova. A sessão de bootstrap anterior deixa de ser válida.

## Persistência e irreversibilidade

As credenciais ficam em um store site-wide do **Netlify Blobs**, com consistência forte e atualizações condicionais por ETag. São persistidos:

- `username`;
- `password_hash`;
- `bootstrap_required`;
- `bootstrap_consumed`;
- `credential_version`;
- `updated_at`;
- versão interna do modo de bootstrap.

`bootstrap_consumed=true` e uma credencial definitiva têm precedência absoluta. Carregamentos futuros, reinícios e novos deploys apenas reutilizam esse estado; nunca recriam ou reativam a credencial inicial. Um bootstrap experimental anterior ainda não consumido é migrado uma vez para o modo atual. Se o estado estiver ausente parcialmente, incompatível ou indisponível, a autenticação falha fechada.

O filesystem efêmero da função, `localStorage`, `sessionStorage` e senhas em variáveis de ambiente não são usados. A senha definitiva nunca fica no código, no bundle cliente ou nos logs.

## Autenticação e sessão

O servidor compara hashes scrypt em tempo constante e emite cookie assinado por HMAC-SHA-256 com `HttpOnly`, `Secure`, `SameSite=Lax`, validade limitada, nonce, versão da credencial e estado de bootstrap. Login e primeiro acesso possuem rate limit rigoroso; requisições mutáveis validam origem e tamanho. Respostas de autenticação não revelam detalhes internos.

Depois do cadastro, `/admin/alterar-senha` exige sessão administrativa, senha atual, nova senha e confirmação. O login não é alterado nessa tela.

## Variáveis de ambiente

- `ADMIN_SESSION_SECRET`: único segredo administrativo de ambiente, aleatório e com pelo menos 32 caracteres;
- `ADMIN_ROLE`: perfil inicial, padrão `administrador`;
- `ADMIN_SESSION_TTL_SECONDS`: duração entre 300 e 86400 segundos, padrão 28800;
- `SITE_URL`: origem pública do site;
- `PUBLICATION_MODE`: política pública já existente.

Nenhuma senha de bootstrap, username ou hash administrativo é configurado por variável de ambiente.

## Deploy no Netlify

1. Em **Project configuration → Environment variables**, configure `ADMIN_SESSION_SECRET` com escopo de Functions e pelo menos 32 caracteres aleatórios.
2. Se necessário, configure `ADMIN_ROLE` e `ADMIN_SESSION_TTL_SECONDS`.
3. Faça o deploy e acesse `/admin/login`.
4. Use a credencial inicial somente uma vez e conclua imediatamente `/admin/primeiro-acesso`.
5. Guarde o login e a senha definitivos em um gerenciador de senhas.
6. Verifique o diagnóstico não sensível em `/admin/configuracoes`.

Não coloque segredos em `netlify.toml`. O store site-wide é compartilhado pelos deploys do mesmo projeto Netlify.

## Arquitetura

- `src/lib/admin/credential-store.mjs`: Netlify Blobs, consistência forte, ETag, migração e irreversibilidade;
- `src/lib/admin/auth-service.mjs`: login, cadastro inicial e troca posterior;
- `src/lib/admin/auth.mjs`: scrypt, comparação e políticas de usuário/senha;
- `src/lib/admin/session.mjs`: sessões assinadas e versionadas;
- `src/middleware.ts`: autenticação, bloqueio do bootstrap e headers;
- `src/pages/api/admin`: backend JSON padronizado;
- `src/lib/admin/catalog-service.ts`: leitura e validação operacional do catálogo.

Nenhum endpoint altera JSON filatélico, aprova ou publica selos.

## Verificação

```bash
npm test
npm run catalogo:auditoria
npm run lint
npm run typecheck
npm run build
```
