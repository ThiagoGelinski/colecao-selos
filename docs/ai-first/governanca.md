# Governança, IDs e aprovação humana

## Papéis

- **Automação/IA:** estrutura rascunhos, valida contratos e prepara relatórios.
- **Catalogador:** pesquisa e documenta fontes.
- **Revisor humano:** aprova explicitamente um conteúdo identificado por hash e versão.
- **Mantenedor:** decide commit, Pull Request, merge e deploy.

## Estados de reserva

Cada entrada de `manifests/ids.json` contém `id`, `sequence`, `reserved_at`, `source`, `status`, `slug`, `created_at`, `completed_at`, `failed_at`, `failure_reason`, `cancelado_em` e `cancellation_reason`. Os campos obrigatórios e incompatíveis são validados conforme o status.

- `reservado`: sequência consumida;
- `criando`: transação em andamento;
- `criado`: JSON e pasta de assets criados;
- `falha_na_criacao`: transação falhou, com motivo preservado;
- `cancelado_sem_reuso`: cancelamento definitivo, sem devolver a sequência.

IDs nunca são reutilizados. Lacunas são aceitas somente como histórico de sequências consumidas. O manifesto deve reservar todos os arquivos existentes, manter IDs e sequences únicos e usar `next_sequence` maior que qualquer sequência registrada.

## Concorrência e lock

A escrita do manifesto é serializada por `manifests/ids.lock`, criado com exclusividade. O proprietário é identificado por PID e token. A remoção automática de lock obsoleto exige simultaneamente idade acima do limite, PID inativo e identidade de arquivo comprovada antes e depois de um rename para quarentena exclusiva. Token, PID, `dev` e `ino` são revalidados antes da remoção. A liberação normal ocorre em `finally` e segue o mesmo protocolo.

Slug inválido, slug duplicado ou manifesto inválido são bloqueados antes da reserva. A verificação é repetida dentro do lock para fechar a janela de concorrência.

## Aprovação humana

`aprovacao_humana` registra `status`, `decisao`, `aprovado_por`, `aprovado_em`, `hash_do_registro_aprovado`, `versao_aprovada`, `escopo` e observação opcional. Aprovação editorial não concede aptidão técnica. Somente `selo:publicar`, após o preflight completo, define `apto_para_publicacao: true`.

## Auditoria e histórico

`catalogo:auditoria` verifica manifesto, reservas, arquivos, IDs internos, slugs, datas, estados e assets. Logs e relatórios locais são regeneráveis e ignorados pelo Git; não substituem o histórico Git, o Pull Request nem a revisão humana.

Não registre credenciais, não permita que IA se identifique como revisora humana e não execute merge ou deploy dentro dos comandos de catalogação.
