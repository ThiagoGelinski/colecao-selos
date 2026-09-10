# Coleção Selos

Catálogo filatélico digital público, orientado a dados, com páginas pré-renderizadas e painel administrativo protegido no Netlify. O projeto documenta o acervo; não oferece avaliação comercial automática nem funciona como loja.

## Fonte oficial e acervo

A branch [main de ThiagoGelinski/colecao-selos](https://github.com/ThiagoGelinski/colecao-selos/tree/main) é a fonte oficial do código e dos dados aprovados para publicação. Alterações devem ser preparadas em branch separada, revisadas e validadas antes de qualquer merge ou publicação autorizados pelo responsável.

No commit de referência [df7d805](https://github.com/ThiagoGelinski/colecao-selos/commit/df7d805bfd2cc4909257f46b00957868e421f8a1), conferido em 2026-09-09, existem sete registros com `status: publicado`, aprovação humana registrada e aptidão para publicação:

| ID | Selo | Ano |
| --- | --- | --- |
| SEL-000001 | Brasil — Campos Salles — 20 centavos | 1967 |
| SEL-000002 | Brasil — Washington Luiz — 1 cruzeiro novo | 1968 |
| SEL-000003 | Brasil — Arthur Bernardes — 10 centavos | 1967 |
| SEL-000004 | Brasil — Severino Neiva — 8 cruzeiros | 1963 |
| SEL-000005 | Brasil — Anita Garibaldi — 5 centavos | 1967 |
| SEL-000006 | Brasil — Wenceslau Braz — 50 centavos | 1968 |
| SEL-000007 | Brasil — Marília de Dirceu — 2 centavos | 1967 |

Esse inventário descreve os JSONs versionados; o SHA efetivamente publicado no Netlify precisa ser verificado no deploy. O [checklist do SEL-000001](docs/homologacao/SEL-000001-checklist.md) distingue a aprovação registrada das verificações visuais ainda sem evidência individual.

## Arquitetura atual

- Astro 5, TypeScript estrito, CSS nativo e JavaScript mínimo.
- JSON Schema Draft 2020-12, AJV e regras semânticas compartilhadas entre CLI e Astro.
- Catálogo público pré-renderizado: `src/lib/selos.ts` incorpora os JSONs de `src/data/selos/` com `import.meta.glob` durante o build.
- Painel `/admin/**` e APIs `/api/admin/**` sob demanda pelo adaptador `@astrojs/netlify`, com autenticação server-side.
- Netlify Blobs para credenciais e alterações administrativas de registros, manifesto e mídia. Em execução local, o CLI usa o filesystem.
- GitHub Actions executa testes, auditoria, Astro Check e build; a CI não aprova conteúdo, não faz merge e não contém etapa de deploy.

Salvar pelo painel persiste o trabalho administrativo nos Blobs. Isso não atualiza os JSONs no GitHub nem o catálogo textual já gerado. A integração automática **painel → aprovação humana → GitHub → testes → Netlify ainda não está conectada**; sua preparação e os critérios de ativação estão em [docs/publicacao/arquitetura.md](docs/publicacao/arquitetura.md).

Há uma exceção no atendimento das imagens: `netlify.toml` redireciona `/assets/selos/...` para uma API que prioriza arquivos dos Blobs e usa o arquivo do deploy como fallback. Uma retificação de mídia pode, portanto, aparecer na URL pública antes de novo build. Essa separação entre dados estáticos e mídia mutável precisa ser resolvida no fluxo de publicação; salvar no painel não deve ser interpretado como aprovação.

## Estrutura

- `public/assets/selos/SEL-xxxxxx/`: WebPs do catálogo, agrupados pelo ID permanente.
- `src/data/selos/`: um JSON por selo, incorporado no build público.
- `schemas/`, `templates/` e `src/types/`: contrato executável, modelo de registro e tipos.
- `manifests/`: reservas de IDs e configuração do catálogo.
- `src/lib/catalogo/`: pipeline editorial, persistência local/Blobs e auditoria.
- `src/lib/admin/`: autenticação, sessões e serviços administrativos.
- `src/components/` e `src/pages/`: interface pública, painel e APIs.
- `docs/`: operação editorial, painel, homologação e arquitetura de publicação.

## Instalação e execução

Requer Node.js 24.x, alinhado entre desenvolvimento local, Netlify e GitHub Actions. Use `nvm use` quando disponível para carregar a versão indicada em `.nvmrc`.

```bash
npm ci
npm run dev
```

Abra a URL local informada pelo Astro. A validação completa é:

```bash
npm test
npm run catalogo:auditoria
npm run check
npm run build
```

`npm run ci` executa a mesma sequência. `npm run test:schema` limita a execução aos testes do contrato; `npm run preview` disponibiliza o build para revisão local. Testes e build bem-sucedidos não comprovam revisão visual nem concedem aprovação editorial.

## Publicação e ambientes

A regra de publicação está centralizada em `src/lib/config.ts`:

- `PUBLICATION_MODE=preview`: inclui registros não rascunho aptos para preview e exibe a indicação de homologação.
- `PUBLICATION_MODE=production`: inclui somente registros com status `publicado` e aptos para publicação.

A URL pública provisória configurada é [Coleção Selos](https://colecaodeselos.netlify.app). O padrão fica em `src/lib/site-url.mjs`; `SITE_URL` permite substituí-lo por uma nova origem HTTPS sem reescrever componentes ou dados.

O `netlify.toml` usa `npm run build`, publica `dist` e mantém produção em `PUBLICATION_MODE=production`; deploy previews e branch deploys usam `preview`. As políticas de branch, checks obrigatórios e liberação de produção devem ser configuradas e verificadas antes de ativar a integração descrita em [arquitetura de publicação](docs/publicacao/arquitetura.md). Esta documentação não autoriza merge, alteração da `main` ou deploy.

## Como adicionar um selo

1. Confirme a `main` oficial atualizada e identifique o estado local; trabalhe em branch separada.
2. Execute `npm run selo:novo -- --slug <slug> --titulo "<título>"`. O comando reserva o ID em `manifests/ids.json` e cria o registro. Não atribua IDs manualmente nem reutilize sequências.
3. Preserve as fotografias originais e prepare somente os derivados permitidos pela política abaixo. Adicione os WebPs aprovados em `public/assets/selos/<ID>/` e seus caminhos no JSON.
4. Prepare e valide os dados com `selo:preparar` e `selo:validar`, mantendo explícitas as informações ainda não confirmadas.
5. Solicite a revisão com `selo:revisao`. O revisor humano deve conferir conteúdo, frente/verso, fontes, SEO e responsividade e registrar as evidências.
6. Somente após a decisão humana explícita, registre-a com `selo:aprovar`; `selo:publicar` aplica uma aprovação válida ao registro. Nenhum desses comandos faz commit, push, merge ou deploy.
7. Execute a validação completa e prepare o Pull Request. Merge e publicação dependem de autorização do responsável.

O manifesto de referência contém as sequências 1 a 7 e `next_sequence: 8`. O próximo ID deve sempre ser obtido pelo comando de reserva a partir do manifesto atualizado; `SEL-000008` é apenas o valor esperado nesse snapshot.

Os nomes de imagens são `SEL-xxxxxx-frente.webp`, `SEL-xxxxxx-verso.webp`, `SEL-xxxxxx-card.webp` e, quando fornecido, `SEL-xxxxxx-thumb.webp`. Frente e card são obrigatórios; verso e thumb são opcionais.

## Fotografias originais e backups

Preserve as fotografias originais sem excluir, mover ou sobrescrever seus arquivos. Os únicos derivados autorizados são **recorte simétrico**, com remoção igual em lados opostos e preservação de toda a serrilha, e **conversão técnica para WebP**. Registre a origem, os hashes e os parâmetros utilizados; salve cada derivado separadamente. Não aplique retoque, reconstrução, geração por IA, remoção de fundo, correção de cor, rotação, redimensionamento ou qualquer outra alteração.

Os 21 WebPs versionados não comprovam, por si só, que as fotografias originais estejam arquivadas ou que o tratamento histórico tenha seguido essa política. A proveniência deve ser verificada antes de novos derivados. O upload e a retificação atuais não constituem um arquivo permanente de originais nem validam a história de transformação da imagem.

Backups existentes devem permanecer intactos. Não inclua em commits arquivos `.bundle`, `.netlify/`, `node_modules/`, `dist/`, credenciais, logs, relatórios regeneráveis ou temporários.

## Validação e campos de publicação

O carregador valida todos os JSONs no build e os ordena por ID. Campos filatélicos opcionais podem permanecer nulos e são apresentados como pendentes ou não informados, sem dados inventados.

`schemas/selo.schema.json` é o contrato estrutural executável, compilado por AJV e compartilhado pelo CLI e Astro. Regras cruzadas, como canonical derivado do slug, ficam na camada semântica compartilhada. Os diagnósticos distinguem `structural_errors`, `semantic_errors`, `editorial_errors`, `file_errors` e `asset_errors`.

`publicacao.status` descreve o estágio editorial. `apto_para_preview` controla homologação e `apto_para_publicacao` condiciona a inclusão em produção. Os sete registros do snapshot oficial estão publicados nos JSONs, com aprovação registrada; isso não preenche retroativamente checklists visuais.

## Pipeline AI-First e operação

O executável `tools/catalogo.mjs` trata argumentos, envelopes e códigos de saída. A implementação modular em `src/lib/catalogo/` cuida de registros, manifesto, transações, assets, auditoria, manutenção, histórico e logs.

```bash
npm run selo:novo -- --slug <slug> --titulo "<título>"
npm run selo:preparar -- <ID-ou-slug>
npm run selo:validar -- [ID-ou-slug]
npm run selo:revisao -- <ID-ou-slug>
npm run selo:aprovar -- <ID-ou-slug> --revisor "<nome>"
npm run selo:publicar -- <ID-ou-slug>
npm run selo:auditoria -- <ID-ou-slug>
npm run selo:rejeitar -- <ID-ou-slug> --revisor "<nome>" --motivo "<motivo>"
npm run selo:revogar -- <ID-ou-slug> --revisor "<nome>" --motivo "<motivo>"
npm run selo:status -- <ID-ou-slug> --json
npm run catalogo:status -- --json
npm run catalogo:auditoria
npm run catalogo:manutencao -- --dry-run --json
```

A IA pode preparar e validar registros, mas não pode conceder aprovação humana. `selo:publicar` falha quando a decisão, o revisor, a data, o hash, a versão ou o escopo de aprovação estão ausentes ou inválidos. IDs criados, falhos ou cancelados nunca são reutilizados. Consulte [workflow](docs/ai-first/workflow.md) e [governança](docs/ai-first/governanca.md) para regras de reserva, lock e aprovação.

Todos os comandos de catalogação aceitam `--json`: o stdout contém exatamente um envelope `{ ok, command, data, warnings }` ou `{ ok, command, error }`, coerente com o código de saída. Operações mutáveis recebem `transaction_id`; `--debug` ou `SELO_DEBUG=1` permitem diagnóstico com stack trace. Logs e relatórios locais não substituem commits, Pull Requests ou o histórico Git. A manutenção deve permanecer diagnóstica nesta preparação; nenhum backup pode ser removido.

## Painel administrativo

O painel permite autenticação, cadastro de selos, consulta, upload inicial e retificação de WebPs. Não concede aprovação humana nem sincroniza suas alterações automaticamente com o GitHub.

O primeiro acesso usa `admin` e um segredo de ativação de uso único fornecido exclusivamente pelo ambiente server-side. O hash é persistido no Netlify Blobs e `bootstrap_consumed=true` impede a reativação. Configure `ADMIN_SESSION_SECRET`, `ADMIN_BOOTSTRAP_ENABLED` e `ADMIN_BOOTSTRAP_SECRET` conforme [docs/admin/README.md](docs/admin/README.md); após a ativação definitiva, desabilite e remova o segredo de bootstrap. Nunca versione credenciais reais.

## Preparação da integração de publicação

O comando abaixo pré-valida um pacote local de revisão contra a main local, os registros, as reservas de IDs e as fotografias declaradas:

~~~bash
npm run publicacao:preparar -- .publication-work/revisao-001/pacote.json
~~~

O contrato está em schemas/publicacao.schema.json e o modelo pendente em templates/publicacao.template.json. O comando é somente leitura: verifica hashes, aprovação declarada, originais, formato/dimensões e receita de recorte simétrico/WebP. Não autentica a identidade declarada, não escreve no GitHub e sempre retorna can_publish: false. Veja [arquitetura e componentes ainda a conectar](docs/publicacao/arquitetura.md).

Na unidade virtual do Google Drive, foi observada falha EISDIR na operação de hardlink usada pela escrita exclusiva local. As fixtures dos testes usam o diretório temporário do sistema; isso não garante suporte à gravação transacional diretamente no Drive. Esta retomada não executa cadastro, retificação nem publicação sobre os sete registros.
