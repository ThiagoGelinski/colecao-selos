# Governança, IDs e aprovação humana

## Papéis

- **Automação/IA:** estrutura rascunhos, valida contratos e prepara relatórios.
- **Catalogador:** pesquisa e documenta fontes.
- **Revisor humano:** aprova explicitamente um conteúdo identificado por hash e versão.
- **Mantenedor:** decide commit, Pull Request, merge e deploy.

## Fonte oficial e publicação

A `main` de [ThiagoGelinski/colecao-selos](https://github.com/ThiagoGelinski/colecao-selos/tree/main) é a fonte oficial do código e dos dados aprovados para publicação. Mudanças devem ser feitas em branch separada. Merge e publicação dependem de autorização explícita do responsável; aprovação editorial ou sucesso técnico não concedem essa autorização automaticamente.

Os sete registros do snapshot `df7d805bfd2cc4909257f46b00957868e421f8a1` estão publicados nos JSONs. O painel grava trabalho administrativo nos Netlify Blobs e não o integra automaticamente ao GitHub. As páginas públicas leem os JSONs incorporados durante o build. A API de imagens prioriza os Blobs, permitindo que a mídia da mesma URL mude antes de novo build; essa exceção precisa ser resolvida para fechar o fluxo de aprovação.

A [arquitetura de publicação](../publicacao/arquitetura.md) define a preparação do fluxo painel → aprovação humana → GitHub → testes → Netlify. A cadeia ainda não está conectada. Revisões futuras precisam abranger um snapshot imutável de dados e mídia; sincronização e reconciliação por hash/ETag não podem apagar alterações posteriores ou alterar silenciosamente o baseline.

## Fotografias originais e backups

Fotografias originais e backups existentes devem ser preservados sem exclusão, movimentação ou sobrescrita. Os únicos tratamentos permitidos são recorte simétrico, com remoção igual em lados opostos e preservação integral da serrilha, e conversão técnica para WebP. Salve os derivados separadamente e registre origem, hashes e parâmetros. Retoque, reconstrução, geração por IA, remoção de fundo, correção de cor, rotação, redimensionamento e outros tratamentos não são autorizados.

A presença de um WebP não comprova que a fotografia original esteja arquivada ou que o tratamento histórico tenha respeitado essa política. O acervo versionado contém 21 WebPs; a proveniência dos originais deve ser comprovada, sem fabricar histórico retroativo. O upload atual não verifica essa proveniência, e o backup temporário de retificação não substitui a preservação permanente.

Não inclua em commits `.bundle`, `.netlify/`, `node_modules/`, `dist/`, credenciais ou arquivos temporários. Ignorar arquivos no Git não autoriza excluí-los do disco.

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

## Contrato e limites da automação

O JSON Schema executável é a fonte única para a estrutura do registro. Alterações incompatíveis exigem atualização explícita do schema, template, tipos e testes. Regras semânticas do domínio ficam na biblioteca compartilhada, não duplicadas entre CLI e site. A aprovação humana continua vinculada ao conteúdo e nunca é produzida pela CI; sucesso técnico significa apenas que o contrato, a auditoria e o build passaram.

## Histórico e manutenção operacional

O histórico editorial é append-only: eventos anteriores não são reescritos nem apagados. Não se cria histórico retroativo para registros legados. Revisor humano é obrigatório para aprovação, rejeição e revogação; invalidação automática identifica o responsável como `pipeline` e explicita o motivo.

Auditoria editorial avalia estado, sequência e evidências de decisão. Auditoria operacional avalia lock, manifesto, transações, temporários, quarentenas e assets. Manutenção não equivale a aprovação, publicação ou deploy. O modo destrutivo `--limpar` existe no CLI, mas esta preparação usa somente o diagnóstico e não autoriza excluir, mover ou sobrescrever backups.

## Auditoria e logging finais

A auditoria cruza o último evento com o estado atual, exige aprovação anterior para publicação/invalidação e detecta transições consecutivas incompatíveis. A manutenção inspeciona temporários e diretórios de remoção em manifests, registros, assets, reports e logs, além de JSON de relatório, linhas JSONL e transações sem evento final. Limpeza continua proibida para locks ativos, itens recentes e assets vinculados a registros válidos.

Eventos novos usam nomes de campos padronizados em inglês técnico; logs históricos não são reescritos.
