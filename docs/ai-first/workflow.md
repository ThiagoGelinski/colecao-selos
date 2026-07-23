# Workflow AI-First

## 1. Criar e reservar

```bash
npm run selo:novo -- --slug brasil-exemplo --titulo "Brasil — Exemplo"
```

Antes de consumir uma sequência, o comando normaliza e valida o slug, procura duplicidades e verifica a integridade global dos registros e de `manifests/ids.json`. A reserva ocorre sob lock exclusivo em `manifests/ids.lock`. O arquivo contém `pid`, `timestamp`, `command` e um token de propriedade; a liberação acontece em `finally` e somente pelo processo proprietário.

O lock usa criação exclusiva. Quando já existe, o comando espera com retentativas controladas até `SELO_LOCK_TIMEOUT_MS` (padrão: 5000 ms). `SELO_LOCK_RETRY_MS` controla o intervalo. Um lock mais antigo que `SELO_LOCK_STALE_MS` (padrão: 30000 ms) só é removido automaticamente se o PID registrado não estiver ativo. Para remover, o pipeline compara `dev`/`ino`, renomeia o mesmo arquivo para uma quarentena exclusiva, valida novamente identidade, token e PID e só então apaga a quarentena. Locks substituídos são restaurados ou preservados, nunca removidos pelo proprietário anterior.

Nunca apague um lock apenas por ele existir. Primeiro leia `manifests/ids.lock`, verifique o PID, o timestamp e o comando, confirme que o processo terminou e preserve uma cópia para investigação. Se o processo ainda estiver ativo, aguarde ou encerre-o de forma controlada; o pipeline nunca remove lock pertencente a outro processo ativo.

`SEL-000001` permanece reservado como sequência 1; a próxima sequência disponível é `SEL-000002`.

## 2. Transação de criação

Dentro do lock, o manifesto é relido e validado. A reserva passa por `reservado`, `criando` e `criado`. O JSON é criado de forma atômica e exclusiva, e a pasta de assets não pode existir previamente.

Se houver falha depois da reserva, o ID recebe `falha_na_criacao`, `failed_at` e `failure_reason`. JSON e pasta vazia criados pela própria transação são compensados somente após conferência de identidade; artefatos preexistentes, substituídos ou com conteúdo desconhecido são preservados. A sequência continua consumida e nunca poderá ser reutilizada. Falhas e cancelamentos são evidências auditáveis, não lacunas disponíveis.

## 3. Pesquisar e preparar

```bash
npm run selo:preparar -- SEL-000002
npm run selo:validar -- SEL-000002
```

## 4. Solicitar revisão e aprovar

```bash
npm run selo:revisao -- SEL-000002 --observacao "Pronto para revisão editorial"
npm run selo:aprovar -- SEL-000002 --revisor "Nome do revisor"
```

A aprovação humana registra identidade normalizada, data, versão e hash do conteúdo. Ela mantém `apto_para_publicacao: false`.

## 5. Publicar no registro

```bash
npm run selo:publicar -- SEL-000002
```

Somente este comando pode ativar `apto_para_publicacao`, depois de validar hash, versão, estrutura e assets. Ele não cria commit, push, merge ou deploy.

## 6. Auditar

```bash
npm run selo:auditoria -- SEL-000002
npm run catalogo:auditoria
```

A auditoria classifica achados em `errors`, `warnings` e `informational`. Relatórios locais ficam em `reports/` e eventos em `logs/pipeline.jsonl`; esses arquivos auxiliam o diagnóstico, mas não substituem commits, revisões e histórico Git.

## 7. Verificar na CI

Pull Requests e pushes em `main` executam instalação limpa, testes, auditoria, Astro Check e build. O mesmo fluxo pode ser reproduzido com `npm run ci`. Falhas de schema interrompem comandos mutáveis antes da gravação e também interrompem o carregamento/build. A CI não substitui a revisão humana e não contém etapa de deploy.