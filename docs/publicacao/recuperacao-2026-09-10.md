# Recuperação de 2026-09-10 — relatório anterior ao envio para main

## Origem e preservação

A pasta utilizada é a cópia existente no Google Drive, conforme escolha do responsável. O remoto é `https://github.com/ThiagoGelinski/colecao-selos.git`, a branch oficial é `main` e a base oficial conferida é `df7d805bfd2cc4909257f46b00957868e421f8a1`. O acesso GitHub de ThiagoGelinski tem permissão de push; o dry-run foi bem-sucedido. A preparação local anterior `ad69f3a` foi identificada e preservada. A implementação ocorre em `fix/recuperacao-publicacao`.

Antes das alterações, foi criada cópia verificável dos 167 arquivos rastreados, manifesto SHA-256, referências Git e arquivos ZIP dos commits local e oficial. Nenhum arquivo `.bundle` foi usado. Backups anteriores ficaram intactos.

Os sete JSONs, o manifesto oficial e as 21 fotografias WebP continuam iguais à main base; os bytes das fotografias foram comparados. Não foi presumida quantidade de repetidos nem existência de originais de captura entre os arquivos versionados.

## Diagnóstico remoto e correções

O site Netlify `colecaodeselos`, ID `f600cb2f-36a6-4c86-98c7-c22709e5bdfe`, está ligado ao repositório oficial e à main. Antes desta entrega, seu deploy ativo correspondia à base `df7d805`.

O store administrativo antigo continha quatro objetos: rascunhos de teste colidindo com SEL-000002 e SEL-000003, um verso do SEL-000003 que era idêntico ao verso oficial do SEL-000001 e um manifesto antigo com próxima sequência 3. A reserva falha registrava ausência de `templates/selo.template.json` na Function.

Todos os quatro objetos foram preservados no remoto e copiados duas vezes para verificação. Os hashes e ETags permaneceram estáveis. Backup: `netlify-20260910-201201-185042ff`; SHA-256 do manifesto do backup: `3b4e2fb61b1330518b6ed00b259505e00f896d4bbbc80362667605c58087df23`.

A recuperação seleciona `colecao-selos-catalogo-v2` para iniciar o painel com os sete registros oficiais. Nenhum objeto antigo foi apagado, movido ou sobrescrito. O store de autenticação permanece intacto. A variável foi confirmada na API Netlify; o plano exigiu escopos padrão em vez de Functions isolado.

Correções implementadas:

- Inclusão explícita de JSONs, manifesto, template e imagens no pacote do runtime Netlify.
- API pública de imagens passa a ler somente o build aprovado; preview administrativo usa rota autenticada e sem cache.
- Editor estruturado, permissões por perfil e conflitos de edição verificados pelo hash completo do registro.
- Upload arquiva fotografia original, derivado e recibo imutáveis; somente recorte simétrico e conversão WebP lossless, com preservação de metadados e comparação dos pixels. Não houve processamento das fotografias reais existentes.
- Quantidade opcional e declaração humana de melhor conservação para repetidos, sem inventar inventário.
- Snapshot, aprovação humana autenticada, branch/PR, verificação do diff/bytes/CI e avanço da main sem força. JSONs e fotos públicos continuam vindo do build Git; salvar nos Blobs não publica sozinho.
- Reconciliação por ETag, preservação de reservas privadas e bloqueio de snapshots ou bases alterados.
- README, operação, arquitetura e checklist atualizados. Checklist visual mantém itens sem evidência desmarcados e o histórico anterior preservado.

## Validação

As fontes da pasta de trabalho foram copiadas para snapshots temporários NTFS e conferidas por hash para evitar limitações e lentidão da unidade virtual do Drive. A implementação permanece na pasta original. Um primeiro build com junction de dependências falhou por restrição de symlink Windows; a validação concluída usa dependências físicas independentes. A instalação paralela do npm diretamente no Drive também apresentou erros de escrita na unidade virtual; as dependências geradas estão sendo recuperadas por cópia nativa com baixa concorrência. Isso não altera os resultados da validação em NTFS nem os dados oficiais.

| Verificação | Resultado |
| --- | --- |
| Testes completos com dependências atualizadas | 397 aprovados; zero falhas, cancelados ou ignorados |
| Auditoria do catálogo | Sete registros válidos |
| Auditoria npm | Zero vulnerabilidades |
| Lint (`astro check`) | Zero erros e warnings |
| Verificação de tipos (`astro check`) | Zero erros e warnings |
| Astro Check e build de produção | Concluídos |
| Arquivos no bundle Netlify | 30 arquivos conferidos por hash |
| `git diff --check` | Sem erros |
| Dados/fotografias oficiais | 29 arquivos protegidos preservados |

Lint e tipos usam o mesmo Astro Check, conforme scripts do projeto; não foi alegada execução de ESLint. Permanecem 11 hints de variáveis não usadas nos testes legados.

A auditoria de dependências inicial apontou 30 vulnerabilidades. Foram atualizados Astro 7.3.2, adaptador Netlify 8.2.5, Sharp 0.35.4 e Blobs 10.7.13; overrides direcionados no plugin Netlify de desenvolvimento e no Sharp compartilhado removeram as transitivas, sem `npm audit fix --force`. A suíte e o build foram repetidos após a atualização.

O E2E usa o SEL-000001 real em memória, com cópias dos sete JSONs e 21 fotos: edição, preparação, confirmação humana, PR, bloqueio por CI, CI aprovada, persistência condicional e atualização da fonte oficial simulada. Inclui adulteração, concorrência e repetição após falha. Não criou registro fictício permanente, nem concedeu nova aprovação aos registros reais.

A verificação HTTP anterior ao deploy fez 33 requisições bem-sucedidas. As 21 URLs estáticas entregaram bytes oficiais; a API direta do verso SEL-000003 entregou a imagem errada dos Blobs, confirmando o defeito corrigido. Isso é evidência técnica, não homologação visual. A automação de navegador não inicializou nesta sessão.

## Envio e ativação

Este relatório antecede o commit/push, conforme a ordem solicitada. O responsável autorizou o envio à main e a republicação após as validações. A CI remota e o deploy Netlify devem ser conferidos após o envio; este arquivo não antecipa seus resultados.

A integração automática do painel está implementada, mas `GITHUB_PUBLISH_TOKEN` ainda não foi identificado na configuração Netlify durante esta validação. Sem essa credencial, a edição e consulta funcionam e a publicação pelo painel fica explicitamente bloqueada. A republicação desta entrega usa o acesso GitHub autorizado da tarefa. Não existe dependência de token no navegador ou nos arquivos versionados.