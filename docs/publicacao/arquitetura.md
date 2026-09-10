# Publicação governada: painel, GitHub e Netlify

Atualização de implementação: 2026-09-10. A fonte oficial é a [main de ThiagoGelinski/colecao-selos](https://github.com/ThiagoGelinski/colecao-selos/tree/main). O código do fluxo está implementado; a ativação remota depende das credenciais, das permissões e do vínculo Git do Netlify. Esta especificação não afirma que a integração em produção já tenha sido ativada ou validada.

O [relatório de 2026-09-09](validacao-2026-09-09.md) permanece inalterado como histórico da preparação local. O pré-validador daquela etapa continua disponível e tem finalidade distinta do serviço autenticado descrito aqui.

## Fontes de dados e publicação

| Camada | Fonte |
| --- | --- |
| Código e dados aprovados oficiais | GitHub main |
| Páginas públicas | JSONs incorporados por `src/lib/selos.ts` durante o build |
| Imagens públicas | WebPs incluídos no mesmo build; a API pública não lê rascunhos dos Blobs |
| Trabalho administrativo | Baseline do deploy e store selecionado por `CATALOG_BLOB_STORE`; recuperação configurada em `colecao-selos-catalogo-v2` |
| Fotografias originais, derivados e procedência | Store privado `colecao-selos-originais` |
| Revisões e vínculo com PR | Store privado `colecao-selos-publicacao` |

Os sete JSONs e 21 WebPs do commit base `df7d805bfd2cc4909257f46b00957868e421f8a1` permanecem preservados. Os arquivos de captura originais não foram identificados no inventário versionado; a presença de WebPs não demonstra sua proveniência histórica. Nenhuma contagem de repetidos foi presumida.

O painel grava registros em `manifests/SEL-xxxxxx.json` e o manifesto administrativo em `manifests/ids.json`, no store do catálogo. O registro público só muda quando o snapshot aprovado chega à main e o Netlify conclui um novo build. `publicacao.status: publicado` no JSON descreve a aptidão desse snapshot, não a confirmação do deploy.

`astro.config.mjs` inclui explicitamente imagens, JSONs, manifesto e template no pacote da Function. `tests/netlify-bundle.check.mjs` verifica esses arquivos após o build, evitando falhas de cadastro ou leitura causadas por arquivos ausentes no runtime.

## Recuperação do store administrativo legado

A inspeção remota encontrou no store `colecao-selos-catalogo` registros de trabalho com IDs SEL-000002 e SEL-000003 colidindo com os selos oficiais, além de imagem de verso divergente para SEL-000003 e manifesto antigo. Esses objetos não podem ser tratados como versões aprovadas dos registros da main.

A configuração de recuperação usa `CATALOG_BLOB_STORE=colecao-selos-catalogo-v2` nas Functions de produção para iniciar a área de trabalho a partir do baseline oficial dos sete selos. O seletor aceita somente o store legado e o v2. A configuração local continua usando o filesystem; a variável não move arquivos ou conteúdo entre stores.

O store legado deve permanecer intacto: nenhum registro, imagem, reserva ou credencial é excluído, movido ou sobrescrito. A cópia de segurança dos quatro objetos foi verificada por dupla leitura, hashes SHA-256 e ETags estáveis; a variável de seleção do store v2 foi confirmada pela API Netlify. Os registros conflitantes não são transferidos automaticamente nem publicados com IDs oficiais colidentes. Sua eventual recuperação editorial exige inspeção e decisão específica, preservando toda a evidência anterior.

O store de credenciais administrativas e a sessão de acesso permanecem separados e não mudam com `CATALOG_BLOB_STORE`. Nunca recrie o bootstrap ou apague credenciais para trocar a área de trabalho do catálogo.

## Fluxo implementado

1. **Editar:** administrador ou catalogador salva a ficha por PATCH e envia fotografias. A API preserva identidade, caminhos e controle editorial; alterações invalidam a aprovação anterior. A comparação usa digest do JSON completo e escrita condicional por ETag.
2. **Preparar:** `POST /api/admin/selos/:id/publicacao` com `action: prepare` lê a main remota, ficha, manifesto e bytes das imagens. Valida schema, semântica, histórico, caminhos, reservas e imagens. Devolve resumo e hash da versão a revisar.
3. **Aprovar:** administrador ou revisor autenticado confere dados, fontes e imagens e envia `action: approve`, `snapshot_hash` e `confirm: true`. A identidade vem da sessão, não de um nome fornecido pelo navegador. O serviço relê o snapshot e rejeita qualquer mudança.
4. **Criar revisão GitHub:** o servidor congela o registro final e os bytes aprovados em recibo exclusivo e cria a branch `publicacao/<ID>-<prefixo-do-hash>` e seu PR. O diff é conferido contra o snapshot.
5. **Verificar CI:** `action: status` consulta o PR e a execução de `.github/workflows/ci.yml` para seu SHA exato. O workflow e o job `Testes, auditoria e build` precisam concluir com sucesso. PR fechado, draft, outra origem ou SHA alterado bloqueiam a publicação.
6. **Publicar:** somente administrador envia `action: publish` e `head_sha`. O servidor reconfere main, base do commit, diff, conteúdos, mídia e manifesto. Persiste a ficha aprovada por CAS, prepara a referência do manifesto e avança main ao commit conferido por fast-forward com `force: false`.
7. **Conferir deploy:** o projeto Netlify conectado à main recebe a mudança e executa o build. Verifique o commit implantado, o resultado do deploy e o catálogo público. O serviço não fabrica uma confirmação Netlify a partir do estado do JSON ou PR.

A CI é verificadora e não concede aprovação editorial. Mudanças de implementação continuam em branches próprias e dependem da autorização do responsável; o exportador de selos não publica alterações arbitrárias de código.

## Hashes, escopo e idempotência

`src/lib/catalogo/digest.mjs` calcula SHA256 com chaves JSON ordenadas recursivamente. O snapshot inclui digest do registro completo, digest do manifesto administrativo, SHA da main e lista de caminhos/hashes dos bytes das imagens. Alterar conteúdo, versão, imagem ou base invalida a revisão. O hash editorial legado `recordHash` continua no registro, mas não é usado sozinho para aprovar bytes de mídia.

Os recibos são persistidos com criação exclusiva em `reviews/<ID>/<snapshot_hash>.json` e os vínculos com GitHub em `pulls/<ID>/<snapshot_hash>.json`. O recibo guarda responsável, data, base, registro final, manifesto proposto e bytes de mídia. Repetir o mesmo snapshot reutiliza seu recibo e branch/PR; o backend confere a revisão existente antes de aceitá-la.

A exportação de conteúdo admite exclusivamente:

- `src/data/selos/SEL-xxxxxx.json` do selo revisado;
- `manifests/ids.json` com reservas oficiais preservadas;
- WebPs aprovados em `public/assets/selos/SEL-xxxxxx/`.

Originais privados, credenciais, backups, `.bundle`, `.netlify`, `node_modules`, `dist` e temporários não entram no diff de conteúdo. Verificação do PR rejeita exclusões, renomes, caminhos adicionais, outra base ou bytes divergentes.

Uma falha externa pode deixar recibo sem vínculo de PR, branch já criada ou resposta de atualização da main incerta. Consulte o PR e a referência Git antes de repetir ou intervir; não conclua que nada foi gravado apenas porque a resposta falhou. Nenhum recibo ou backup deve ser apagado para resolver pendências.

## Fotografias e procedência

O upload recebe bytes originais PNG, JPEG, WebP ou TIFF de até 5 MiB. Formato decodificado e MIME devem corresponder. Há limites de pixels e dimensões; animações, múltiplas páginas e arquivos que exigiriam conversão de espaço de cor ou precisão são recusados.

O servidor executa somente recorte simétrico e conversão WebP lossless. `crop_x` remove a mesma margem esquerda/direita; `crop_y` faz o mesmo no topo/base. As margens são inteiros não negativos e o resultado deve ter área positiva. Zero mantém o tamanho naquele eixo; não há redimensionamento ou orientação automática.

O processador preserva metadados, confere ICC/orientação e compara os pixels retidos da origem com o derivado. Não permite IA generativa, retoque, restauração, filtros, correção de cores, deformação, reconstrução de perfurações ou alteração de marcas. Cabe ao revisor conferir visualmente que a serrilha inteira foi preservada e que a captura corresponde ao exemplar.

O arquivo privado usa chaves por conteúdo:

- `originais/<sha256>`: captura recebida, byte a byte;
- `derivados/<sha256>.webp`: resultado técnico;
- `procedencia/<sha256>.json`: recibo gerado pelo servidor;
- `historico-derivados/<sha256>`: imagem anterior preservada na retificação, sem ser apresentada como original.

As gravações são exclusivas e verificadas por leitura. Originais e derivados anteriores não são sobrescritos; não há rota de exclusão. A mídia corrente só é promovida após o arquivamento. Na publicação, um WebP idêntico ao legado oficial é preservado como tal; bytes novos ou alterados exigem original, derivado e recibo válidos.

Prévias administrativas são autenticadas e usam `Cache-Control: no-store`. A rota pública lê exclusivamente o arquivo do build. Uma retificação privada não altera silenciosamente a fotografia pública na mesma URL.

O campo `exemplar.quantidade` é opcional e inteiro positivo. Quantidade maior que 1 exige `criterio_selecao: melhor_conservacao` e confirmação humana no editor. O catálogo exibe “Não informada” quando a contagem não foi registrada; validação técnica não comprova conservação física.

## Manifesto e reconciliação após o build

`publicationManifest` parte do manifesto oficial, preserva todas as reservas existentes e acrescenta somente a reserva concluída do selo aprovado. IDs ou slugs conflitantes são recusados; `next_sequence` nunca retrocede. Reservas de outros rascunhos permanecem no manifesto administrativo dos Blobs, sem exportar suas fichas.

O `baseline_hash` legado é SHA256 de `JSON.stringify(baseline)`, respeitando a ordem das chaves, e tem contrato diferente do digest canônico do snapshot. A reconciliação atualiza metadados por compare-and-swap apenas quando o novo baseline corresponde ao conteúdo aprovado. Divergência de conteúdo ou ETag preserva o trabalho posterior e retorna conflito.

Para o manifesto, `stageManifestBaseline` valida seu digest atual e registra `pending_baseline_hash` do manifesto público proposto, mantendo todas as reservas administrativas no payload. Quando o build passa a conter exatamente esse manifesto, a reconciliação atualiza `baseline_hash` e consome o marcador, sem perder rascunhos privados.

Um marcador pendente de outra integração causa `MANIFEST_PUBLICATION_PENDING`. Antes de intervenção, confirme o estado da main, do PR e do deploy. Não remova o marcador, Blobs, reservas ou backups por tentativa. Falhas de deploy não apagam o estado administrativo ou os originais.

## Configuração de runtime

O backend usa `GITHUB_PUBLISH_TOKEN` apenas no servidor. Restrinja o token a `ThiagoGelinski/colecao-selos` e às permissões:

| Permissão GitHub | Acesso |
| --- | --- |
| Contents | Leitura e escrita |
| Pull requests | Leitura e escrita |
| Actions | Leitura |
| Metadata | Leitura |

Configure o segredo no Netlify com escopo **Functions**, no contexto de produção autorizado. Não use prefixo `PUBLIC_` nem salve o valor em Git, cliente, logs ou `netlify.toml`. O `.env.example` mantém essa variável vazia. Sem o token, o backend falha com `PUBLICATION_NOT_CONFIGURED` (503); salvar ficha e enviar fotografia são operações independentes.

Na recuperação, configure também `CATALOG_BLOB_STORE=colecao-selos-catalogo-v2` com escopo Functions em produção, preservando o store legado conforme a seção acima.

O projeto Netlify precisa estar conectado ao repositório oficial, branch main, build `npm run build` e diretório `dist`. A publicação respeita as regras que o GitHub aplicar; não usa force push nem bypass. Se a política de branches impedir atualização da referência, a operação falha e deve ser analisada com o responsável.

Referências de configuração: [variáveis em Functions](https://docs.netlify.com/build/functions/environment-variables/) e [Git references API](https://docs.github.com/en/rest/git/refs).

## Validação e limites das evidências

A CI executa instalação limpa, testes, auditoria, Astro Check, lint, tipos, `git diff --check`, build e conferência do pacote Netlify. `lint`, `typecheck` e `check` são entradas para Astro Check; não são verificações ESLint diferentes.

Testes ponta a ponta isolados devem percorrer edição, snapshot, aprovação, PR, CI, publicação e leitura do build usando fixtures/stores temporários. Não devem consumir IDs reais ou deixar selo fictício permanente. Seu sucesso demonstra contratos e proteções, sem comprovar login real, token configurado, permissões, aprovação editorial em produção ou deploy público. Essas evidências precisam ser registradas separadamente.

## Pré-validador local preservado

`npm run publicacao:preparar -- .publication-work/revisao-001/pacote.json` usa `schemas/publicacao.schema.json` e `templates/publicacao.template.json`. Lê a main local, verifica pacote, hashes, reservas, aprovação declarada, originais e receita; rejeita caminhos externos e divergências.

Esse comando é somente leitura, não autentica o nome declarado, não cria PR, não faz push e sempre retorna `mode: preparation_only` e `can_publish: false`. Não substitui o serviço autenticado nem autoriza publicação. Seu histórico de implementação e validação em 2026-09-09 permanece no relatório original.


Nota operacional de 2026-09-10: o site Netlify está ligado à main oficial. O backup dos quatro objetos legados foi verificado por dupla leitura e SHA-256; nenhum objeto remoto foi removido. CATALOG_BLOB_STORE=colecao-selos-catalogo-v2 foi configurado para o próximo deploy. O plano atual recusou escopos granulares; foram usados os escopos padrão. Para GITHUB_PUBLISH_TOKEN, prefira Functions quando o plano permitir; caso contrário, use os escopos padrão com valor de produção. O código consome esse segredo apenas no servidor e não o inclui no cliente. A credencial GitHub do painel ainda aguarda configuração e verificação.
