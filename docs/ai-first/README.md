# Pipeline de catalogação AI-First

Esta camada organiza a colaboração entre automação, agentes de IA e revisão humana sem transformar inferências em fatos filatélicos. O catálogo público continua pré-renderizado a partir de JSONs versionados; o painel administrativo e suas APIs executam no servidor. O CLI local opera no filesystem e a persistência administrativa em produção usa Netlify Blobs. As ferramentas de catalogação não fazem commit, push, merge ou deploy por conta própria.

## Princípios

1. **ID permanente e sequencial:** toda inclusão começa pela reserva atômica em `manifests/ids.json`.
2. **Conteúdo rastreável:** dados, fontes, confiança e estado editorial permanecem no registro.
3. **IA prepara; humano decide:** nenhuma automação pode produzir uma aprovação humana.
4. **Aprovação e publicação separadas:** no CLI, `selo:aprovar` registra a decisão e `selo:publicar` aplica a aprovação; no painel, aprovação humana cria a revisão GitHub e a ação Publicar exige administrador e CI verde.
5. **Falha fechada:** ausência, expiração lógica ou inconsistência da aprovação bloqueia publicação.
6. **Auditoria reproduzível:** relatórios são gerados localmente a partir dos arquivos versionados.
7. **Fonte oficial:** código e dados aprovados para publicação são os da `main` de [ThiagoGelinski/colecao-selos](https://github.com/ThiagoGelinski/colecao-selos/tree/main).
8. **Preservação fotográfica:** originais e backups permanecem intactos; somente recorte simétrico e conversão técnica para WebP são permitidos em derivados separados.

## Estrutura

- `tools/`: entrada do CLI; usa a implementação compartilhada de `src/lib/catalogo/` e as dependências do projeto.
- `schemas/`: contrato JSON e regra condicional de aprovação.
- `templates/`: ponto de partida para novos registros.
- `manifests/`: reserva de IDs e configuração do catálogo.
- `reports/`: relatórios locais regeneráveis.
- `logs/`: trilha operacional local em JSON Lines.

Consulte [workflow.md](./workflow.md) para o fluxo e [governanca.md](./governanca.md) para responsabilidades e bloqueios.

## Estado atual e integração implementada

O commit oficial de referência `df7d805bfd2cc4909257f46b00957868e421f8a1` contém sete selos, de SEL-000001 a SEL-000007, publicados nos JSONs e com aprovação registrada. Seus sete JSONs e 21 WebPs são preservados. O manifesto aponta `next_sequence: 8` nesse snapshot; reserve sempre pelo estado atualizado, sem reutilizar IDs.

O painel grava rascunhos nos Blobs. O catálogo público incorpora os JSONs do GitHub durante o build e serve somente as imagens desse build. Prévias de trabalho são privadas e autenticadas. Upload original, arquivo por SHA256 e conversão lossless com recorte simétrico foram implementados; isso não comprova a origem histórica dos WebPs existentes.

A cadeia implementada é painel → snapshot → aprovação humana autenticada → branch/PR → CI → ação Publicar do administrador → main → Netlify. O serviço exige token restrito ao repositório no servidor e conexão Git do Netlify; sua ativação e o deploy real precisam de evidências separadas. A [arquitetura de publicação](../publicacao/arquitetura.md) descreve hashes, permissões, idempotência e reconciliação que preserva outros rascunhos.

Quantidade é opcional; repetidos exigem contagem confirmada e seleção do exemplar de melhor conservação. Campos ausentes permanecem “Não informada”. Não são criadas aprovações humanas ou verificações visuais por inferência da automação.

## Contrato executável

O arquivo `schemas/selo.schema.json` usa JSON Schema Draft 2020-12 e é compilado uma única vez por `src/lib/selo-validation.mjs` com AJV e formatos oficiais. CLI, testes e runtime Astro consomem esse mesmo validador. A validação estrutural trata tipos, obrigatoriedade, formatos, enums e propriedades desconhecidas; a camada semântica compartilhada trata relações do projeto, como `seo.canonical_path` igual a `/selos/<slug>`. Regras de autorização editorial, arquivos e assets são relatadas separadamente.

A CI executa `npm ci`, testes, auditoria, Astro Check, lint, tipos, `git diff --check`, build e verificação dos arquivos da Function Netlify. `lint`, `typecheck` e `check` chamam Astro Check; não existe etapa ESLint separada. A CI não aprova conteúdo nem contém etapa de deploy. O serviço do painel verifica o resultado para o SHA exato antes de permitir a ação Publicar.

## Arquitetura final do CLI

`tools/catalogo.mjs` trata argumentos, envelopes, debug e exit codes. `src/lib/catalogo/` contém módulos sem ciclos para assets, auditoria, comandos, erros, histórico, I/O, lock, manifesto, saída, paths, registros e transações. O Schema executável continua sendo a única fonte estrutural.

Cada transição editorial acrescenta um evento imutável a `historico_editorial`; rejeição e revogação preservam dados anteriores. A auditoria editorial verifica coerência dos eventos, enquanto a operacional examina locks, quarentenas, temporários, reservas e diretórios/assets.

## Correções finais do Bloco 4

Todos os comandos retornam resultado explícito com `ok`, `data`, `warnings`, `error` e `exitCode`. O entrypoint converte esse contrato em um único envelope JSON coerente. `commands.mjs` apenas valida argumentos, chama serviços, compõe respostas e integra logging; registros, manifesto, transações, auditoria, manutenção e status não dependem dele.

O logging novo usa exclusivamente `reviewer`, `previous_status`, `new_status`, `hash`, `version`, `error_code` e `message`, além de timestamp, comando, PID e transaction ID.
