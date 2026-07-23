# Workflow AI-First

## 1. Criar e reservar

```bash
npm run selo:novo -- --slug brasil-exemplo --titulo "Brasil — Exemplo"
```

O comando reserva o próximo ID, cria o JSON a partir do template e prepara a pasta de assets. `SEL-000001` já está reservado; a próxima sequência é `SEL-000002`.

## 2. Pesquisar e preparar

Preencha somente informações sustentadas por fontes e marque incertezas explicitamente. Depois execute:

```bash
npm run selo:preparar -- SEL-000002
npm run selo:validar -- SEL-000002
```

## 3. Solicitar revisão

```bash
npm run selo:revisao -- SEL-000002 --observacao "Pronto para revisão editorial"
```

Isso invalida qualquer aptidão para publicação e cria uma decisão pendente.

## 4. Aprovação humana

Somente uma pessoa autorizada deve executar:

```bash
npm run selo:aprovar -- SEL-000002 --revisor "Nome do revisor" --observacao "Conteúdo e imagens aprovados"
```

A ferramenta registra revisor, data, escopo e decisão. Nenhum agente deve preencher esses campos fingindo ser uma pessoa.

## 5. Publicar no registro

```bash
npm run selo:publicar -- SEL-000002
```

O comando falha se a aprovação humana estiver ausente ou inválida. Ele altera o estado editorial do JSON, mas não cria commit, push, merge ou deploy.

## 6. Auditar

```bash
npm run selo:auditoria -- SEL-000002
npm run catalogo:auditoria
```

Os relatórios ficam em `reports/` e a trilha operacional em `logs/pipeline.jsonl`; ambos são regeneráveis e não devem conter segredos.
