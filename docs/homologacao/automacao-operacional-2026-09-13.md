# Automação operacional — evidências de 13/09/2026

## Resultado e limites

O fluxo foi exercitado no site real, com registro técnico temporário SEL-000008, sem mudar os sete selos anteriores. A automação integral ainda tem dois bloqueios de permissão; este relatório não declara que ambos foram resolvidos.

- O GITHUB_PUBLISH_TOKEN existente cria blobs, commit e branch e permite ler CI e publicar a main. A criação de PR retornou HTTP 403, com exigência explícita `pull_requests=write` e mensagem `Resource not accessible by personal access token`.
- A chave OpenAI já disponível no ambiente autenticou e produziu uma proposta real usando frente e verso, via GPT-4.1 mini. A instalação segura no Netlify foi recusada: escopo Functions retornou 403 (`Upgrade your Netlify account to set specific scopes`); segredo sem escopo específico retornou 422 (`Secrets are not allowed to run in 'post_processing' scopes`). Nenhuma chave foi gravada como variável comum. GPT permanece em fallback no site.

Nenhum token ou chave foi criado, solicitado ao usuário, exposto ou versionado. Não foi alterado o plano Netlify. A credencial GitHub existente não teve suas permissões ampliadas. A conexão GitHub local já autorizada foi usada para abrir as PRs de teste e publicar a correção descrita abaixo; isso não concede ao painel a permissão que falta.

## Teste realizado

1. Conferidos repositório ThiagoGelinski/colecao-selos, main e deploy oficial inicial no commit 1474dab2611d43dc94c37bbf2cfa894b3b498725.
2. Conferidos hashes dos sete JSONs e das 21 imagens. Os stores de trabalho v2, originais e publicação estavam vazios antes do teste; stores legados, credenciais e backups não foram alterados.
3. Criado SEL-000008 pelos endpoints administrativos autenticados. Sessão temporária foi emitida com o acesso Netlify delegado já autorizado, sem mudar login, senha ou bootstrap. Não se apresenta esta etapa como teste de senha do usuário.
4. Enviadas frente, verso e card pelo pipeline real. As entradas foram fotografias WebP já existentes do SEL-000001, identificadas como material de teste; não foram chamadas de capturas originais históricas. Os bytes recebidos foram arquivados intactos. Conversão técnica para WebP lossless, sem recorte ou qualquer alteração visual.
5. Conferido no navegador móvel o fallback manual do pré-cadastro com frente/verso. Separadamente, a análise real via API retornou proposta, ano não confirmado e revisão humana obrigatória. Falhas de provedor e respostas inválidas também estão cobertas nos testes automatizados.
6. Preparada a revisão na interface. O teste técnico, expressamente autorizado pelo proprietário, acionou os controles de aprovação; não constitui homologação filatélica de uma nova peça.
7. A branch foi criada pelo painel. A PR precisou ser aberta pela conexão GitHub local devido à permissão ausente no token do painel. A primeira CI revelou um teste limitado a sete registros.
8. Corrigido tests/catalog-store-config.test.mjs: a leitura inicial do painel é comparada a todos os JSONs versionados e percorre a paginação, mantendo as verificações de validade e ausência de gravações no store vazio.
9. Preparada nova revisão contra a main corrigida. A CI da PR 11 passou e o painel liberou Publicar versão aprovada. O botão foi acionado na interface real; main avançou para o commit exato aprovado e o Netlify fez o deploy automático.
10. Conferido no catálogo público, em 13/09/2026 às 20:39 UTC, o oitavo card e a página temporária, ambos publicados. Em seguida, o registro técnico e seus três derivados foram retirados. A reserva permanece como cancelado_sem_reuso, sem reduzir next_sequence. Originais recebidos e recibos permanecem no arquivo privado; a trilha Git também é preservada.

## Evidências versionadas

- [Correção da validação](https://github.com/ThiagoGelinski/colecao-selos/commit/f4280a4e1fda7e3603b763b3abd2ff31c8c70a77)
- [PR 10: primeira tentativa, encerrada após diagnosticar o limite de sete registros](https://github.com/ThiagoGelinski/colecao-selos/pull/10)
- [PR 11: teste publicado pelo painel](https://github.com/ThiagoGelinski/colecao-selos/pull/11)
- [CI aprovada do snapshot exato](https://github.com/ThiagoGelinski/colecao-selos/actions/runs/34781288464)
- [Commit publicado pelo painel](https://github.com/ThiagoGelinski/colecao-selos/commit/2425885987d5617490d878bc266b9dd1af780687)
- [Deploy do teste](https://app.netlify.com/projects/colecaodeselos/deploys/6aa709c9fc312e0008a009b8)
- [Catálogo atual](https://colecaodeselos.netlify.app/catalogo)

## Validações

O snapshot temporário com oito registros passou em 401 testes, auditoria do catálogo, lint, typecheck, Astro Check, build, conferência de 34 arquivos do bundle por hash e git diff --check. npm audit não encontrou vulnerabilidades. A CI da PR 11 repetiu essas verificações e passou.

A retirada preserva os sete JSONs e as 21 imagens anteriores. Foram conferidos novamente os hashes e os registros administrativos, além dos bytes dos originais recebidos no teste. Nenhum backup foi criado, apagado, movido ou sobrescrito. Arquivos .bundle, .netlify, node_modules, dist, scripts operacionais temporários e segredos ficam fora do commit.

## Requisitos ainda bloqueados

Para operação integral, a conexão do painel precisa permitir a criação de PR neste repositório. Falta somente Pull requests: escrita na credencial testada; Contents: escrita e Actions: leitura foram exercitados.

A chave OpenAI existe e foi validada. Falta um armazenamento de segredo compatível com as permissões da conta Netlify. OPENAI_API_KEY, GPT_PRECADASTRO_ENABLED=true e OPENAI_API_MODEL=gpt-4.1-mini não foram ativados no site. Não se recorreu à gravação legível da chave como alternativa. O cadastro manual continua disponível.

Sem resolver esses dois pontos, futuros cadastros não completam todo o caminho sozinhos: a análise permanece manual e a criação da PR pelo painel permanece bloqueada. Depois da PR e da CI, o botão de publicação, o avanço da main e o deploy Netlify foram comprovados.

A versão de retirada, novamente com sete registros, também passou em 401 testes, auditoria, lint, typecheck, Astro Check, build e conferência dos 30 arquivos do bundle por hash. O diff dos sete registros e das 21 imagens contra a main inicial permaneceu vazio. A limpeza remota usa ETag no manifesto, confere os bytes antes de remover somente os quatro objetos do cadastro temporário e preserva o arquivo de originais e os recibos.
