# Coleção Selos

Catálogo filatélico digital público, orientado a dados, com páginas pré-renderizadas e painel administrativo protegido no Netlify. O projeto documenta o acervo; não oferece avaliação comercial automática nem funciona como loja.

## Fonte oficial e acervo

A [main de ThiagoGelinski/colecao-selos](https://github.com/ThiagoGelinski/colecao-selos/tree/main) é a fonte oficial do código e dos dados aprovados para publicação. Alterações de implementação devem ser preparadas em branch separada, revisadas e validadas antes da integração autorizada pelo responsável.

A recuperação de 2026-09-10 parte do commit [df7d805](https://github.com/ThiagoGelinski/colecao-selos/commit/df7d805bfd2cc4909257f46b00957868e421f8a1), com sete registros publicados nos JSONs, aprovação humana registrada e 21 WebPs. Os dados e imagens desse acervo foram preservados.

| ID | Selo | Ano |
| --- | --- | --- |
| SEL-000001 | Brasil — Campos Salles — 20 centavos | 1967 |
| SEL-000002 | Brasil — Washington Luiz — 1 cruzeiro novo | 1968 |
| SEL-000003 | Brasil — Arthur Bernardes — 10 centavos | 1967 |
| SEL-000004 | Brasil — Severino Neiva — 8 cruzeiros | 1963 |
| SEL-000005 | Brasil — Anita Garibaldi — 5 centavos | 1967 |
| SEL-000006 | Brasil — Wenceslau Braz — 50 centavos | 1968 |
| SEL-000007 | Brasil — Marília de Dirceu — 2 centavos | 1967 |

O estado `publicado` no JSON indica um snapshot apto a integrar o catálogo; a conclusão do deploy Netlify precisa ser conferida separadamente. O [checklist do SEL-000001](docs/homologacao/SEL-000001-checklist.md) distingue a aprovação histórica das verificações visuais ainda sem evidência individual.

## Arquitetura atual

- Astro 7, TypeScript estrito, CSS nativo e JSON Schema Draft 2020-12 com AJV.
- Catálogo público pré-renderizado: `src/lib/selos.ts` incorpora os JSONs de `src/data/selos/` durante o build.
- Painel `/admin/**` e APIs `/api/admin/**` sob demanda pelo adaptador `@astrojs/netlify`, com autenticação no servidor.
- Netlify Blobs guarda credenciais, trabalho administrativo, arquivo de originais e recibos de publicação.
- Imagens públicas vêm exclusivamente do build aprovado. A API pública usada pelos redirecionamentos do Netlify não lê rascunhos em Blobs.
- Prévias privadas do painel usam `/api/admin/selos/:id/assets/:papel`, com sessão e sem cache.
- GitHub Actions verifica testes, auditoria, Astro Check, lint, tipos, build, pacote Netlify e diferenças. A CI não concede aprovação humana nem contém etapa de deploy.

Salvar no painel persiste o trabalho administrativo nos Blobs. Para chegar à fonte publicada, o fluxo implementado é **painel → preparação do snapshot → aprovação humana → branch e Pull Request no GitHub → testes → ação Publicar do administrador → main → build Netlify**.

A ativação depende do segredo de integração no servidor e da conexão Git do projeto Netlify à main. A existência do código não comprova que essas configurações estejam ativas nem que um teste real em produção tenha sido concluído. Veja [arquitetura de publicação](docs/publicacao/arquitetura.md).

## Estrutura

- `public/assets/selos/SEL-xxxxxx/`: derivados WebP publicados, agrupados pelo ID permanente.
- `src/data/selos/`: um JSON por selo, incorporado no build público.
- `schemas/`, `templates/` e `src/types/`: contrato executável e tipos.
- `manifests/`: reservas de IDs e configuração do catálogo.
- `src/lib/catalogo/`: pipeline editorial, persistência, fotografias e auditoria.
- `src/lib/admin/`: autenticação, sessões, edição e serviços administrativos.
- `src/lib/publicacao/`: snapshots, recibos e integração GitHub.
- `src/components/` e `src/pages/`: catálogo, painel e APIs.
- `docs/`: operação, governança, homologação e histórico.

## Instalação e validação

Requer Node.js 24.x, alinhado com `.nvmrc`, Netlify e GitHub Actions.

~~~bash
npm ci
npm run dev
~~~

Validação completa:

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

`lint`, `typecheck` e `check` executam Astro Check; não há etapa ESLint separada. `npm run ci` executa testes, auditoria, check e build; a sequência completa acima também confere o pacote da Function e diferenças. `npm run test:schema` limita os testes ao contrato e `npm run preview` disponibiliza o build local.

O adaptador inclui explicitamente JSONs, manifesto de IDs, template e imagens na Function. A verificação do pacote evita um build aparentemente válido cujo painel não encontra arquivos essenciais em produção. Testes e build não comprovam revisão visual nem concedem aprovação editorial.

## Operação pelo painel

1. Cadastre o selo pelo painel; o servidor reserva o ID sem reutilizar sequências.
2. Complete identificação, emissão, estado do exemplar, textos e fontes. Campos desconhecidos permanecem pendentes.
3. Envie as fotografias originais e confira as prévias privadas.
4. Use **Preparar revisão**. O snapshot vincula conteúdo completo, manifesto, hashes de imagens e commit oficial.
5. Um administrador ou revisor confere os dados e as fotografias e confirma **Aprovar e enviar ao GitHub**.
6. Consulte o Pull Request e a situação dos testes. Somente um administrador pode usar **Publicar versão aprovada**, depois da CI verde.
7. Confirme o SHA do deploy Netlify e as páginas públicas.

Administrador e catalogador podem editar e enviar fotos; administrador e revisor podem aprovar; somente administrador pode publicar. O servidor confere essas permissões. Digest completo e ETag impedem que uma tela antiga sobrescreva outra edição.

A publicação revalida main, commit do PR, diff permitido e hashes. O servidor avança main por fast-forward com `force: false`, sem contornar regras do GitHub. Alterações posteriores exigem nova revisão. A documentação não substitui autorização do responsável.

## Fotografias, repetidos e backups

Preserve as fotografias originais. Somente **recorte simétrico**, com remoção igual em lados opostos e preservação de toda a serrilha, e **conversão técnica para WebP** são permitidos. Não use IA generativa, retoque, restauração, filtros, correção de cores, remoção de fundo, rotação ou redimensionamento.

O upload recebe o original em PNG, JPEG, WebP ou TIFF, até 5 MiB. O servidor arquiva bytes por SHA256 com gravação exclusiva em `colecao-selos-originais`, produz WebP lossless, verifica os pixels retidos e preserva o derivado anterior antes da retificação. Mídia nova ou alterada só é exportada quando original e recibo de processamento são verificáveis.

Não foram identificadas capturas originais no inventário versionado. Isso não comprova ausência em outras pastas nem autoriza recriar fotografias. Os 21 WebPs históricos permanecem intactos; a nova cadeia de procedência não lhes atribui retroativamente uma origem.

Para repetidos, registre `exemplar.quantidade` e use a fotografia do exemplar de melhor conservação. Quantidade maior que 1 exige `criterio_selecao: melhor_conservacao` e confirmação do responsável. Ausência é exibida como “Não informada”; não foi presumida contagem para os sete registros.

Não exclua, mova ou sobrescreva backups/cópias existentes. Não inclua em commits `.bundle`, `.netlify/`, `node_modules/`, `dist/`, credenciais, originais privados, logs ou temporários.

## Configuração Netlify e GitHub

O `netlify.toml` usa `npm run build` e publica `dist`. Produção usa `PUBLICATION_MODE=production`: somente registros publicados e aptos para publicação entram no catálogo. Deploy previews usam `preview` para registros aptos à homologação. `SITE_URL` define a origem HTTPS; a URL provisória é [Coleção Selos](https://colecaodeselos.netlify.app).

Configure `GITHUB_PUBLISH_TOKEN` somente no servidor, com escopo **Functions** no Netlify e acesso restrito a `ThiagoGelinski/colecao-selos`: Contents e Pull requests em leitura/escrita, Actions e Metadata em leitura. Nunca coloque o token no cliente, Git, logs ou `netlify.toml`. Sem a configuração, as ações de publicação retornam `PUBLICATION_NOT_CONFIGURED`; edição e upload permanecem independentes.

A recuperação prevê `CATALOG_BLOB_STORE=colecao-selos-catalogo-v2` nas Functions de produção: o store legado contém rascunhos com IDs colidindo com registros oficiais e permanece preservado, sem transferência automática. O novo namespace usa o baseline oficial; o store de credenciais não muda. A ativação e o backup remoto precisam de confirmação própria, conforme [arquitetura](docs/publicacao/arquitetura.md).

O primeiro acesso administrativo usa um segredo temporário, persistindo somente seu hash e consumindo o bootstrap uma única vez. Preserve credenciais definitivas já existentes. Configuração e operação estão em [docs/admin/README.md](docs/admin/README.md).

## CLI e histórico editorial

Os comandos locais continuam disponíveis; não fazem commit, push, merge ou deploy por conta própria:

~~~bash
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
~~~

A IA pode preparar e validar, mas não criar uma aprovação humana. Aprovações, revogações e invalidações preservam o histórico. O manifesto de referência usa sequências 1 a 7 e `next_sequence: 8`; consulte sempre o estado atualizado e use a reserva atômica, sem atribuir IDs manualmente.

O pré-validador local `npm run publicacao:preparar -- .publication-work/revisao-001/pacote.json` permanece separado do serviço autenticado. Ele é somente leitura, não autentica o nome declarado nem transfere arquivos, e sempre retorna `can_publish: false`. O modelo está em `templates/publicacao.template.json`.

Consulte [workflow](docs/ai-first/workflow.md), [governança](docs/ai-first/governanca.md), [histórico](docs/ai-first/CHANGELOG.md) e o [relatório anterior de 2026-09-09](docs/publicacao/validacao-2026-09-09.md), preservado como evidência daquela etapa.

Na unidade virtual Google Drive foi observada falha EISDIR em hardlinks da escrita exclusiva local. Fixtures e validação podem usar cópia temporária verificável em NTFS. Testes isolados não devem consumir IDs reais ou criar selo fictício permanente e não substituem a conferência do deploy público.


Nota operacional de 2026-09-10: o site Netlify está ligado à main oficial. O backup dos quatro objetos legados foi verificado por dupla leitura e SHA-256; nenhum objeto remoto foi removido. CATALOG_BLOB_STORE=colecao-selos-catalogo-v2 foi configurado para o próximo deploy. O plano atual recusou escopos granulares; foram usados os escopos padrão. Para GITHUB_PUBLISH_TOKEN, prefira Functions quando o plano permitir; caso contrário, use os escopos padrão com valor de produção. O código consome esse segredo apenas no servidor e não o inclui no cliente. A credencial GitHub do painel ainda aguarda configuração e verificação.
