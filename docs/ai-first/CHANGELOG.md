# Histórico do pipeline AI-First

## Em desenvolvimento — Bloco 2: IDs, concorrência e transações

- lock exclusivo e configurável para manifests/ids.json;
- remoção do lock comprovada por dev/ino, rename exclusivo e revalidação;
- compensação segura de JSON e pasta vazia criados pela transação;
- detecção segura de lock obsoleto sem remover lock de processo ativo;
- manifesto 2.0 com ciclo de vida e política de não reutilização;
- validação prévia de manifesto, slug e integridade global;
- criação atômica e exclusiva de registros, com falhas persistidas;
- resolução de registros sem ambiguidade;
- auditoria classificada em erros, avisos e informações;
- testes multiprocesso de concorrência, timeout e recuperação.

## Bloco 1: segurança e integridade crítica

- aprovação humana vinculada a hash e versão;
- validação segura de assets e caminhos;
- publicação atômica e testes de integridade.

## Em desenvolvimento — Bloco 3: JSON Schema executável, testes integrados e CI

- schema Draft 2020-12 compilado por AJV com formatos e condicionais editoriais;
- validador único compartilhado entre CLI e runtime Astro;
- separação de erros estruturais, semânticos, editoriais, arquivos e assets;
- validação antes de toda escrita de registro;
- testes do contrato, template, catálogo real e equivalência entre camadas;
- CI obrigatória com instalação limpa, testes, auditoria, check e build, sem deploy.
## Em desenvolvimento — Bloco 4: modularização e operação editorial

- CLI modular com paths, I/O, lock, manifesto, registros, assets, transações, auditoria, histórico, erros e saída;
- erros tipados, exit codes, `--json` e diagnóstico `--debug`;
- comandos `selo:rejeitar`, `selo:revogar`, `selo:status`, `catalogo:status` e `catalogo:manutencao`;
- histórico editorial append-only para aprovação, rejeição, revogação, invalidação e publicação;
- logs com PID, comando e `transaction_id`;
- auditorias editorial e operacional ampliadas;
- manutenção segura, diagnóstica por padrão, com dry-run e limpeza explícita;
- testes integrados preservando os Blocos 1–3.