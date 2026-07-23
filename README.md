# Coleção Selos

Catálogo filatélico digital público, estático e orientado a dados. A primeira versão homologa tecnicamente o registro `SEL-000001` sem banco de dados e sem transformar o catálogo em loja.

## Stack

- Astro e TypeScript em modo estrito
- JSON como fonte de dados
- CSS nativo e JavaScript mínimo
- geração estática, sitemap e deploy no Netlify

## Estrutura

- `public/assets/selos/SEL-xxxxxx/`: imagens aprovadas, agrupadas pelo ID permanente
- `src/data/selos/`: um JSON por selo
- `src/types/`: contrato TypeScript
- `src/lib/`: carregamento, validação, formatação, SEO e configuração
- `src/components/`: layout, UI, SEO e componentes filatélicos reutilizáveis
- `src/pages/`: início, catálogo, metodologia e rota dinâmica

## Instalação e execução

Requer Node.js 22 ou versão LTS compatível.

```bash
npm install
npm run dev
```

Abra a URL local informada pelo Astro. Para validação, build e preview:

```bash
npm run check
npm run build
npm run preview
```

## Publicação e ambientes

A regra de publicação está centralizada em `src/lib/config.ts`:

- `PUBLICATION_MODE=preview`: inclui registros não rascunho aptos para preview e exibe a indicação de homologação.
- `PUBLICATION_MODE=production`: inclui somente registros com status `publicado` e aptos para publicação.

A URL pública provisória é [https://colecaodeselos.netlify.app](https://colecaodeselos.netlify.app). O valor padrão fica centralizado em `src/lib/site-url.mjs` e é utilizado pela configuração do Astro e pelos geradores de URLs absolutas.

O `netlify.toml` usa `npm run build`, publica `dist` e mantém produção em `PUBLICATION_MODE=production`; deploy previews e branch deploys usam `preview`. Para substituir o endereço no Netlify, acesse **Site configuration → Environment variables**, defina `SITE_URL` com a nova origem HTTPS e execute um novo deploy. A variável tem precedência sobre o valor padrão, portanto um domínio próprio poderá substituir o endereço `netlify.app` sem reescrever componentes ou dados.

## Como adicionar um selo

1. Reserve um ID permanente no padrão `SEL-000002` (regex `^SEL-[0-9]{6}$`). Nunca reutilize nem altere esse ID.
2. Crie `public/assets/selos/SEL-000002/` e adicione os WebP aprovados conforme o padrão de nomes.
3. Crie `src/data/selos/SEL-000002.json` a partir do contrato em `src/types/selo.ts`.
4. Informe os caminhos das imagens no JSON. Não é necessário alterar páginas, cards, rotas ou listas.
5. Execute `npm run check` e `npm run build`. Erros estruturais graves interrompem o build.
6. Revise o ambiente de homologação, incluindo frente, verso, campos pendentes, fontes, SEO e responsividade.
7. Após aprovação editorial, altere o status e os indicadores de aptidão no JSON e publique.

O padrão esperado de imagens é `SEL-xxxxxx-frente.webp`, `SEL-xxxxxx-verso.webp`, `SEL-xxxxxx-card.webp` e, quando fornecido, `SEL-xxxxxx-thumb.webp`. O verso e o thumb são opcionais; frente e card são obrigatórios.

## Validação

O carregador usa `import.meta.glob`, valida todos os JSONs no build e os ordena por ID. São rejeitados: ID inválido, slug ou título vazio, frente/card ausentes, status inválido, ano malformado, SEO incompleto, fontes fora de array e catálogos fora de objeto. Campos filatélicos opcionais podem permanecer nulos e são apresentados como pendentes ou não informados, sem dados inventados.

## Campos de publicação

`publicacao.status` descreve o estágio editorial. `apto_para_preview` controla homologação e `apto_para_publicacao` impede publicação acidental. O registro inicial permanece em `homologacao`, apto apenas para preview.

## Limites atuais

- sem banco, CMS, autenticação ou área administrativa;
- filtros executados no navegador sobre os registros já gerados;
- nenhuma avaliação comercial automática;
- nenhum tratamento ou geração de imagens;
- o endereço `netlify.app` é provisório e pode ser substituído por domínio próprio via `SITE_URL`;
- o primeiro registro depende de revisão visual e dos campos marcados com alta confiança ou probabilidade.
## Pipeline AI-First

O projeto inclui uma pipeline local, sem banco e sem serviços externos, para reservar IDs, preparar registros, validar conteúdo, registrar revisão humana, bloquear publicação sem aprovação e gerar auditorias reproduzíveis.

A criação deve ser feita por `selo:novo`. O comando normaliza e verifica o slug antes de consumir uma sequência, valida `manifests/ids.json` e usa o lock exclusivo `manifests/ids.lock`. Reservas que falham ficam registradas como `falha_na_criacao`; IDs criados, falhos ou cancelados nunca são reutilizados. Os estados possíveis são `reservado`, `criando`, `criado`, `falha_na_criacao` e `cancelado_sem_reuso`.

O lock registra PID, timestamp e comando. Um lock obsoleto só é removido automaticamente quando ultrapassa o limite configurado e o PID não está ativo. Para investigação manual, consulte [`docs/ai-first/workflow.md`](docs/ai-first/workflow.md). Logs locais e relatórios auxiliam o diagnóstico, mas não substituem commits, Pull Requests e o histórico Git.

Comandos disponíveis:

```bash
npm run selo:novo -- --slug <slug> --titulo "<título>"
npm run selo:preparar -- <ID-ou-slug>
npm run selo:validar -- [ID-ou-slug]
npm run selo:revisao -- <ID-ou-slug>
npm run selo:aprovar -- <ID-ou-slug> --revisor "<nome>"
npm run selo:publicar -- <ID-ou-slug>
npm run selo:auditoria -- <ID-ou-slug>
npm run catalogo:auditoria
```

A IA pode preparar e validar registros, mas não pode conceder aprovação humana. `selo:publicar` falha de forma fechada quando a decisão, o revisor, a data ou o escopo de aprovação estão ausentes ou inválidos. Consulte [`docs/ai-first/`](docs/ai-first/README.md) para arquitetura, workflow e governança.

### Contrato executável e CI

`schemas/selo.schema.json` é o contrato estrutural executável (JSON Schema Draft 2020-12). A mesma compilação AJV é reutilizada pelo CLI e pelo carregador do Astro; regras cruzadas que dependem do projeto, como canonical derivado do slug, permanecem na camada semântica compartilhada. Os diagnósticos distinguem `structural_errors`, `semantic_errors`, `editorial_errors`, `file_errors` e `asset_errors` e informam caminho, palavra-chave e mensagem.

Use `npm run test:schema` para testar somente o contrato ou `npm run ci` para executar localmente a mesma sequência obrigatória da CI: testes, auditoria do catálogo, Astro Check e build. O workflow de GitHub Actions valida Pull Requests e a branch `main`; ele não aprova registros, não altera estados editoriais, não faz merge e não publica/deploya o site.
## Operação editorial e diagnóstico

O executável `tools/catalogo.mjs` é apenas o ponto de entrada. A implementação está separada em `src/lib/catalogo/` por paths/configuração, I/O atômico, lock, manifesto, registros, assets, transações, auditoria, histórico editorial, comandos, erros e saída.

Novos comandos:

```bash
npm run selo:rejeitar -- SEL-000002 --revisor "Nome" --motivo "Motivo"
npm run selo:revogar -- SEL-000002 --revisor "Nome" --motivo "Motivo"
npm run selo:status -- SEL-000002 --json
npm run catalogo:status -- --json
npm run catalogo:manutencao -- --dry-run --json
npm run catalogo:manutencao -- --limpar --json
```

Todos os comandos aceitam `--json`; nesse modo o stdout contém apenas um envelope `{ ok, command, data, warnings }` ou `{ ok, command, error }`. Use `--debug` ou `SELO_DEBUG=1` somente para diagnóstico com stack trace. Operações mutáveis recebem `transaction_id` no log. A manutenção é somente diagnóstica por padrão e nunca remove lock ativo ou artefato recente/não comprovado.
### Garantia do modo JSON

Com `--json`, o envelope e o código de saída são inseparáveis: `exit code 0` sempre produz `ok: true`; qualquer código diferente de zero sempre produz `ok: false`. O stdout contém exatamente um documento JSON, sem mensagens intermediárias, e o stderr permanece vazio. Os comandos retornam `CommandResult` explícito, portanto falhas de validação e auditoria não dependem de `process.exitCode` oculto.

A arquitetura final separa `records`, `manifest`, `transactions`, `audit`, `maintenance`, `status`, `logging`, `history`, `assets`, `lock`, `io`, `paths`, `errors`, `output` e o orquestrador `commands`. Revogação manual e invalidação automática usam o mesmo domínio `revokeApproval`.