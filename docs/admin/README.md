# Fundação do painel administrativo

O Bloco 1 adiciona uma área administrativa somente leitura, separada do catálogo público. As páginas públicas continuam pré-renderizadas; `/admin/**` e `/api/admin/**` usam renderização sob demanda pelo adaptador oficial `@astrojs/netlify`, com Image CDN desativada para preservar o tratamento atual dos assets locais.

## Rotas

- `/admin/login`: autenticação sem cadastro público;
- `/admin`: indicadores e atividade derivados dos JSON oficiais;
- `/admin/selos`: busca, filtro, ordenação e paginação dos registros;
- `/admin/selos/:id`: consulta somente leitura;
- `/admin/configuracoes`: diagnóstico não sensível do ambiente.

## Autenticação e sessão

As credenciais nunca ficam no código ou no bundle do navegador. O servidor compara a senha com `scrypt`, em tempo constante, e emite cookie assinado por HMAC-SHA-256 com `HttpOnly`, `Secure`, `SameSite=Lax`, validade limitada e nonce. O middleware protege todas as páginas e APIs administrativas, exceto o endpoint de login.

Perfis previstos: `administrador`, `catalogador`, `revisor` e `consulta`. Neste bloco os perfis são registrados na sessão, mas ainda não autorizam operações de escrita.

Gere um hash local sem registrar a senha no histórico do shell:

```bash
node --input-type=module
```

No prompt do Node:

```js
const { hashPassword } = await import('./src/lib/admin/auth.mjs');
await hashPassword('uma-senha-longa-e-unica');
```

Copie o resultado para `ADMIN_PASSWORD_HASH` e encerre o prompt. Não versione `.env`.

## Variáveis de ambiente

- `ADMIN_USERNAME`: usuário administrativo;
- `ADMIN_PASSWORD_HASH`: hash scrypt no formato documentado;
- `ADMIN_SESSION_SECRET`: segredo aleatório com pelo menos 32 caracteres;
- `ADMIN_ROLE`: perfil inicial, padrão `administrador`;
- `ADMIN_SESSION_TTL_SECONDS`: duração entre 300 e 86400 segundos, padrão 28800;
- `SITE_URL`: origem pública do site;
- `PUBLICATION_MODE`: política pública já existente.

## Netlify

Em **Project configuration → Environment variables**, cadastre as variáveis `ADMIN_*` pela interface do Netlify e disponibilize-as para Functions. Não coloque segredos em `netlify.toml`: variáveis declaradas ali não são apropriadas para segredos de runtime. Um novo deploy é necessário após alterar variáveis.

Para desenvolvimento local, copie `.env.example` para `.env`, substitua todos os placeholders e execute `npm run dev`. O `.gitignore` impede o versionamento de arquivos `.env` reais.

## Arquitetura

- `src/lib/admin/catalog-domain.mjs`: filtros, projeção e estatísticas puras;
- `src/lib/admin/catalog-service.ts`: adaptador de leitura dos JSON e validação operacional compartilhada `validateRecordOperational`, incluindo assets;
- `src/lib/admin/auth.mjs`: configuração, hash, credenciais e sessão;
- `src/middleware.ts`: autorização de rotas e headers;
- `src/pages/api/admin`: backend JSON padronizado;
- `src/layouts/AdminLayout.astro`: shell responsivo.

Nenhum endpoint deste bloco escreve JSON, executa shell, aprova, publica ou cria branches/PRs.

## Segurança e limites

O login possui limite básico por endereço de origem em memória. Em arquitetura serverless isso reduz abuso por instância, mas um rate limiter distribuído deve ser adotado antes de ampliar o painel. Erros públicos não incluem stack, credenciais ou valores secretos. A sessão assinada não substitui um provedor de identidade quando houver gestão completa de usuários.

## Verificação

```bash
npm test
npm run catalogo:auditoria
npm run lint
npm run typecheck
npm run build
```
