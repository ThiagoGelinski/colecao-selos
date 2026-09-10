# Workflow AI-First

## Preparação do trabalho

Use a `main` de [ThiagoGelinski/colecao-selos](https://github.com/ThiagoGelinski/colecao-selos/tree/main) como fonte oficial do código e dos dados aprovados para publicação. Antes de editar, confirme pasta, remoto, branch, atualização da `main` e alterações locais identificadas. Prepare mudanças em branch separada; merge e publicação exigem autorização do responsável.

Os comandos numerados abaixo descrevem a operação local. O painel persiste rascunhos nos Blobs, enquanto páginas e imagens públicas vêm do build da main. O serviço integrado está implementado e depende de configuração de runtime para operar. Veja a [arquitetura de publicação](../publicacao/arquitetura.md).

## Fluxo pelo painel

1. Cadastre e edite a ficha com perfil administrador ou catalogador. Preserve fontes, ressalvas e informações não confirmadas.
2. Envie a captura original; informe somente recortes simétricos. O servidor arquiva original, derivado e recibo antes de trocar a imagem corrente. A prévia permanece privada.
3. Informe quantidade somente após conferência. Para repetidos, selecione o exemplar de melhor conservação e registre a confirmação.
4. Prepare o snapshot da ficha, manifesto, imagens e main. Um administrador ou revisor confere a versão exibida e confirma sua aprovação; o servidor usa a identidade autenticada.
5. O backend congela a revisão e cria branch/PR contendo somente registro, manifesto permitido e WebPs aprovados. Acompanhe a CI para o SHA exato.
6. Após os testes verdes, somente o administrador pode publicar. O servidor revalida tudo e avança main sem força. Novo conteúdo, imagem, manifesto ou base exigem nova revisão.
7. Confira o commit e o deploy Netlify. O estado publicado no JSON é condição editorial do snapshot, não evidência de que o site público foi atualizado.

O token GitHub fica somente nas Functions da Netlify; sem configuração, a publicação retorna erro explícito. Teste isolado não comprova permissões ou deploy reais. Em resposta externa incerta ou manifesto pendente, consulte GitHub/main/deploy antes de intervir, mantendo recibos, rascunhos e backups intactos.

## Operação pelo CLI

## 1. Criar e reservar

```bash
npm run selo:novo -- --slug brasil-exemplo --titulo "Brasil — Exemplo"
```

Antes de consumir uma sequência, o comando normaliza e valida o slug, procura duplicidades e verifica a integridade global dos registros e de `manifests/ids.json`. A reserva ocorre sob lock exclusivo em `manifests/ids.lock`. O arquivo contém `pid`, `timestamp`, `command` e um token de propriedade; a liberação acontece em `finally` e somente pelo processo proprietário.

O lock usa criação exclusiva. Quando já existe, o comando espera com retentativas controladas até `SELO_LOCK_TIMEOUT_MS` (padrão: 5000 ms). `SELO_LOCK_RETRY_MS` controla o intervalo. Um lock mais antigo que `SELO_LOCK_STALE_MS` (padrão: 30000 ms) só é removido automaticamente se o PID registrado não estiver ativo. Para remover, o pipeline compara `dev`/`ino`, renomeia o mesmo arquivo para uma quarentena exclusiva, valida novamente identidade, token e PID e só então apaga a quarentena. Locks substituídos são restaurados ou preservados, nunca removidos pelo proprietário anterior.

Nunca apague um lock apenas por ele existir. Primeiro leia `manifests/ids.lock`, verifique o PID, o timestamp e o comando, confirme que o processo terminou e preserve uma cópia para investigação. Se o processo ainda estiver ativo, aguarde ou encerre-o de forma controlada; o pipeline nunca remove lock pertencente a outro processo ativo.

No snapshot oficial `df7d805bfd2cc4909257f46b00957868e421f8a1`, as sequências 1 a 7 estão consumidas e `next_sequence` vale 8. Use sempre o ID devolvido por `selo:novo`; `SEL-000008` nos exemplos abaixo representa apenas a próxima sequência nesse snapshot, não uma reserva antecipada.

## 2. Transação de criação

Dentro do lock, o manifesto é relido e validado. A reserva passa por `reservado`, `criando` e `criado`. O JSON é criado de forma atômica e exclusiva, e a pasta de assets não pode existir previamente.

Se houver falha depois da reserva, o ID recebe `falha_na_criacao`, `failed_at` e `failure_reason`. JSON e pasta vazia criados pela própria transação são compensados somente após conferência de identidade; artefatos preexistentes, substituídos ou com conteúdo desconhecido são preservados. A sequência continua consumida e nunca poderá ser reutilizada. Falhas e cancelamentos são evidências auditáveis, não lacunas disponíveis.

## 3. Pesquisar e preparar

```bash
npm run selo:preparar -- SEL-000008
npm run selo:validar -- SEL-000008
```

Antes de preparar novos derivados, comprove a preservação da fotografia original e registre sua proveniência. Somente recorte simétrico e conversão técnica para WebP são permitidos, sempre em arquivos separados. Não altere, mova ou sobrescreva originais ou backups. Os WebPs existentes não demonstram por si só que o original esteja arquivado. Consulte a [política de fotografias](./governanca.md#fotografias-originais-e-backups).

## 4. Solicitar revisão e aprovar

```bash
npm run selo:revisao -- SEL-000008 --observacao "Pronto para revisão editorial"
npm run selo:aprovar -- SEL-000008 --revisor "Nome do revisor"
```

A aprovação humana registra identidade normalizada, data, versão e hash do conteúdo. Ela mantém `apto_para_publicacao: false`. O comando deve registrar uma decisão humana explícita; a IA não pode criar essa decisão nem preencher verificações visuais sem evidências. No painel, a revisão autenticada inclui também hashes dos bytes de mídia, manifesto e base Git; o hash editorial do CLI sozinho não aprova uma alteração de fotografia.

## 5. Publicar no registro

```bash
npm run selo:publicar -- SEL-000008
```

No fluxo CLI, este comando aplica a aprovação válida e ativa `apto_para_publicacao` após validar hash, versão, estrutura e assets. Não cria commit, push, merge ou deploy. O serviço autenticado do painel prepara seu próprio snapshot final após a decisão humana, antes da promoção ao GitHub.

## 6. Auditar

```bash
npm run selo:auditoria -- SEL-000008
npm run catalogo:auditoria
```

A auditoria classifica achados em `errors`, `warnings` e `informational`. Relatórios locais ficam em `reports/` e eventos em `logs/pipeline.jsonl`; esses arquivos auxiliam o diagnóstico, mas não substituem commits, revisões e histórico Git.

## 7. Verificar na CI

Pull Requests e pushes em main executam instalação limpa, testes, auditoria, Astro Check, lint, tipos, `git diff --check`, build e `tests/netlify-bundle.check.mjs`. Os scripts lint, typecheck e check são entradas de Astro Check, sem ESLint separado. `npm run ci` executa testes, auditoria, check e build; a conferência do pacote Netlify e de diferenças também deve ser executada na validação completa.

Falhas de schema interrompem comandos mutáveis e carregamento/build. A CI não substitui revisão humana nem contém etapa de deploy. O serviço de publicação exige sucesso do workflow e do job para o SHA exato, confirmação administrativa e base ainda atual. A configuração e a prova de deploy real são separadas dos testes isolados.

## 8. Rejeitar, revogar e manter

Rejeição exige revisor e motivo e não apaga aprovação anterior. Revogação exige aprovação ativa e preserva autor, data, hash e versão aprovados. Aprovação, rejeição, revogação, invalidação e publicação acrescentam eventos cronológicos em `historico_editorial`.

O modo diagnóstico é `catalogo:manutencao -- --dry-run --json`. O CLI também dispõe de `--limpar` para resíduos cuja identidade é comprovada, mas esse modo não deve ser executado nesta preparação. Nenhum backup pode ser excluído, movido ou sobrescrito. Toda operação mutável registra `transaction_id`; logs e relatórios regeneráveis permanecem fora dos commits.

## 9. Serviços modulares e resultado explícito

O orquestrador não implementa manifesto, transação, auditoria, manutenção ou resolução de registros. Cada serviço retorna dados estruturados. Revogação manual e invalidação por hash chamam `revokeApproval`, que preserva aprovação/histórico e distingue os eventos `revogacao` e `invalidacao`.
