# Fundação do painel administrativo

O Bloco 1 adiciona uma área administrativa server-side, separada do catálogo público. As páginas públicas continuam pré-renderizadas; `/admin/**` e `/api/admin/**` usam renderização sob demanda pelo adaptador oficial `@astrojs/netlify`.

## Rotas

- `/admin/login`: autenticação sem cadastro público;
- `/admin/alterar-senha`: troca obrigatória no primeiro acesso e troca autorizada posterior;
- `/admin`: indicadores e atividade derivados dos JSON oficiais;
- `/admin/selos`: busca, filtro, ordenação e paginação;
- `/admin/selos/:id`: consulta somente leitura;
- `/admin/configuracoes`: diagnóstico não sensível.

## Primeiro acesso

O primeiro acesso usa o usuário `admin` e a senha temporária definida exclusivamente em `ADMIN_BOOTSTRAP_PASSWORD` no ambiente do Netlify. A senha ambiental precisa ter ao menos 16 caracteres, é convertida para scrypt na primeira inicialização e nunca é persistida em texto puro. Após o login, o middleware redireciona obrigatoriamente para `/admin/alterar-senha`. Dashboard, selos, configurações e APIs administrativas normais permanecem bloqueados até a troca.

A nova senha deve ter ao menos 12 caracteres, não pode ser `admin`, não pode coincidir com o usuário e deve ser confirmada. A senha atual também é verificada. A aplicação persiste somente o hash scrypt e renova a sessão com uma nova versão de credencial; qualquer sessão anterior deixa de ser válida.

A interface nunca exibe a senha temporária, hashes ou segredos.

## Persistência

As credenciais ficam em um store site-wide do **Netlify Blobs**, com criptografia em trânsito e em repouso fornecida pela plataforma. A aplicação usa consistência forte e atualizações condicionais por ETag para impedir trocas concorrentes. São persistidos somente:

- `username`;
- `password_hash`;
- `bootstrap_required`;
- `credential_version`;
- `updated_at`;
- marcador durável de bootstrap consumido.

O filesystem efêmero da função, `localStorage` e `sessionStorage` não são usados. Se o store estiver indisponível ou ficar incompleto após a inicialização, a autenticação falha fechada. O marcador `bootstrap_consumed` é a fonte de verdade. Depois da troca definitiva, a variável pode ser removida ou alterada sem afetar o login; ela não é mais consultada e não existe fallback ou recriação do bootstrap. Se estiver ausente na primeira inicialização, o sistema falha fechado sem criar credencial.

Para desenvolvimento integrado, use `netlify dev`; o Netlify CLI fornece um store local isolado. Testes unitários usam um adaptador exclusivamente em memória e nunca acessam dados reais.

## Autenticação e sessão

O servidor compara hashes scrypt em tempo constante e emite cookie assinado por HMAC-SHA-256 com `HttpOnly`, `Secure`, `SameSite=Lax`, validade limitada, nonce, versão da credencial e estado de bootstrap. O middleware protege páginas e APIs administrativas. Login e alteração de senha possuem rate limit; requisições mutáveis validam origem e tamanho.

Perfis previstos: `administrador`, `catalogador`, `revisor` e `consulta`. Fora do bootstrap, somente o perfil `administrador` pode trocar a senha.

## Variáveis de ambiente

- `ADMIN_SESSION_SECRET`: segredo aleatório com pelo menos 32 caracteres;
- `ADMIN_BOOTSTRAP_PASSWORD`: senha temporária com pelo menos 16 caracteres, obrigatória somente antes da primeira inicialização e removível após a troca definitiva;
- `ADMIN_ROLE`: perfil inicial, padrão `administrador`;
- `ADMIN_SESSION_TTL_SECONDS`: duração entre 300 e 86400 segundos, padrão 28800;
- `SITE_URL`: origem pública do site;
- `PUBLICATION_MODE`: política pública já existente.

`ADMIN_USERNAME` e `ADMIN_PASSWORD_HASH` não são mais necessários. A senha definitiva nunca é armazenada em variável de ambiente nem versionada.

## Deploy no Netlify

1. Em **Project configuration → Environment variables**, crie `ADMIN_SESSION_SECRET` com escopo de Functions e valor aleatório de pelo menos 32 caracteres.
2. Crie `ADMIN_BOOTSTRAP_PASSWORD` com uma senha temporária exclusiva de pelo menos 16 caracteres e o mesmo escopo. Não use uma senha publicada ou reutilizada.
3. Se necessário, configure `ADMIN_ROLE` e `ADMIN_SESSION_TTL_SECONDS`.
4. Faça o deploy da branch de preview e acesse `/admin/login` com o usuário `admin` e a senha definida no ambiente.
5. Conclua imediatamente a troca obrigatória de senha.
6. Remova `ADMIN_BOOTSTRAP_PASSWORD` do ambiente depois de confirmar o login definitivo.
7. Verifique o diagnóstico em `/admin/configuracoes` sem expor valores sensíveis.
Não coloque segredos em `netlify.toml`. O store site-wide é compartilhado por deploys do mesmo projeto; portanto, deploy previews conectados ao mesmo site usam o mesmo estado administrativo persistente.

## Arquitetura

- `src/lib/admin/credential-store.mjs`: Netlify Blobs, consistência forte, ETag e marcador de bootstrap;
- `src/lib/admin/auth-service.mjs`: login e troca de senha;
- `src/lib/admin/auth.mjs`: scrypt, comparação e política de senha;
- `src/lib/admin/session.mjs`: sessões assinadas e versionadas;
- `src/middleware.ts`: autenticação, bloqueio de bootstrap e headers;
- `src/pages/api/admin`: backend JSON padronizado;
- `src/lib/admin/catalog-service.ts`: leitura e validação operacional do catálogo.

A alteração de senha é a única escrita administrativa desta extensão do Bloco 1. Nenhum endpoint altera JSON filatélico, aprova ou publica selos.

## Verificação

```bash
npm test
npm run catalogo:auditoria
npm run lint
npm run typecheck
npm run build
```
