# Pipeline de catalogação AI-First

Esta camada organiza a colaboração entre automação, agentes de IA e revisão humana sem transformar inferências em fatos filatélicos. O site continua estático; as ferramentas operam sobre JSON versionado e não publicam nem fazem deploy por conta própria.

## Princípios

1. **ID permanente e sequencial:** toda inclusão começa pela reserva atômica em `manifests/ids.json`.
2. **Conteúdo rastreável:** dados, fontes, confiança e estado editorial permanecem no registro.
3. **IA prepara; humano decide:** nenhuma automação pode produzir uma aprovação humana.
4. **Publicação em duas etapas:** `selo:aprovar` registra a decisão; `selo:publicar` apenas aplica uma aprovação válida já existente.
5. **Falha fechada:** ausência, expiração lógica ou inconsistência da aprovação bloqueia publicação.
6. **Auditoria reproduzível:** relatórios são gerados localmente a partir dos arquivos versionados.

## Estrutura

- `tools/`: CLI sem dependências externas.
- `schemas/`: contrato JSON e regra condicional de aprovação.
- `templates/`: ponto de partida para novos registros.
- `manifests/`: reserva de IDs e configuração do catálogo.
- `reports/`: relatórios locais regeneráveis.
- `logs/`: trilha operacional local em JSON Lines.

Consulte [workflow.md](./workflow.md) para o fluxo e [governanca.md](./governanca.md) para responsabilidades e bloqueios.
