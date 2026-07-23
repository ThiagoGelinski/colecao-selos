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
