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

O `netlify.toml` usa `npm run build`, publica `dist` e define produção por padrão. Antes do deploy, configure `SITE_URL` com o domínio definitivo no Netlify. Atualize também o Sitemap em `public/robots.txt`; o placeholder nunca deve ser tratado como domínio público real.

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
- domínio público ainda não definido;
- o primeiro registro depende de revisão visual e dos campos marcados com alta confiança ou probabilidade.
