# Referência de comandos

| Comando | Finalidade | Modifica dados |
|---|---|---|
| `selo:novo` | Normaliza slug, reserva ID sob lock e cria rascunho transacionalmente | Sim |
| `selo:preparar` | Verifica estrutura/assets e gera relatório | Não |
| `selo:validar` | Valida um registro ou o catálogo | Não |
| `selo:revisao` | Encaminha registro para decisão humana | Sim |
| `selo:aprovar` | Registra aprovação editorial vinculada a hash e versão | Sim |
| `selo:publicar` | Valida conteúdo/assets e concede aptidão técnica | Sim |
| `selo:auditoria` | Gera auditoria de um registro | Não |
| `catalogo:auditoria` | Audita manifesto, IDs, slugs, arquivos, reservas e assets | Não |

Use `--` para encaminhar argumentos pelo npm.

## Configuração do lock

- `SELO_LOCK_TIMEOUT_MS`: tempo máximo de espera, padrão 5000;
- `SELO_LOCK_RETRY_MS`: intervalo entre tentativas, padrão 50;
- `SELO_LOCK_STALE_MS`: idade mínima para considerar um lock obsoleto, padrão 30000.

Exemplo:

```bash
SELO_LOCK_TIMEOUT_MS=10000 npm run selo:novo -- --slug brasil-exemplo --titulo "Brasil — Exemplo"
```

Um lock antigo nunca é removido se o PID registrado ainda estiver ativo. Consulte `workflow.md` antes de investigar ou remover manualmente `manifests/ids.lock`.

## Validação e CI

- `npm run test:schema`: contrato, formatos, condicionais, registros reais e equivalência CLI/runtime;
- `npm test`: testes dos Blocos 1–3;
- `npm run ci`: testes, `catalogo:auditoria`, `check` e `build` na ordem da CI.

Os resultados de `selo:validar` separam erros estruturais (`structural_errors`) de semânticos, editoriais, nomes de arquivo e assets. Cada erro de schema expõe `instancePath`, `keyword`, `message` e `params`, permitindo localizar precisamente o campo inválido.