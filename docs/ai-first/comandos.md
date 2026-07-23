# Referência de comandos

| Comando | Finalidade | Modifica dados |
|---|---|---|
| `selo:novo` | Reserva ID e cria rascunho | Sim |
| `selo:preparar` | Verifica estrutura/assets e gera relatório | Não |
| `selo:validar` | Valida um registro ou o catálogo | Não |
| `selo:revisao` | Encaminha registro para decisão humana | Sim |
| `selo:aprovar` | Registra aprovação humana explícita | Sim |
| `selo:publicar` | Aplica publicação após aprovação válida | Sim |
| `selo:auditoria` | Gera auditoria de um registro | Não |
| `catalogo:auditoria` | Audita IDs, slugs, assets e registros | Não |

Use `--` para encaminhar argumentos pelo npm. Exemplos completos estão em `workflow.md`.
