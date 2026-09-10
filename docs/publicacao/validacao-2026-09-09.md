# Validação da retomada — 2026-09-09

## Repositório e escopo

- Fonte oficial: ThiagoGelinski/colecao-selos, branch main.
- Commit oficial/local confirmado antes da edição: df7d805bfd2cc4909257f46b00957868e421f8a1.
- Pasta C:\Projetos\colecao-selos ausente; proprietário escolheu continuar na cópia colecao-selos da pasta aberta no Google Drive.
- Branch de trabalho: docs/preparacao-publicacao-governada.
- Antes da edição: nenhum arquivo versionado modificado; itens não rastreados identificados como .netlify/ e dois .bundle.
- Foram atualizadas documentação, checklist, exclusões de artefatos e preparação local da publicação. Dois testes existentes receberam ajustes de portabilidade/sincronização.

## Resultados

| Verificação | Resultado | Ambiente |
| --- | --- | --- |
| Suíte completa: node --test --test-isolation=process --test-reporter=spec tests/*.test.mjs | 340 testes passaram; zero falhas, cancelados ou skips | Fonte no Google Drive, Node 24.19.0; fixtures temporárias isoladas |
| Auditoria: node tools/catalogo.mjs catalogo:auditoria --json | 7 registros válidos, zero erros e avisos | Cópia do Google Drive |
| Pré-validador de publicação | 19 testes incluídos na suíte completa | Imagens sintéticas; nenhum processamento do acervo |
| npm ci --no-audit --no-fund | Instalação limpa concluída; 1055 pacotes | Snapshot local NTFS, npm 11.6.0 |
| npm run check | 107 arquivos; zero errors, zero warnings, 10 hints de variáveis não usadas em testes existentes | Snapshot local NTFS |
| npm run build | Check e build concluídos; sete páginas de selos geradas, sitemap e função SSR | Snapshot local NTFS, PUBLICATION_MODE=production |
| Correspondência do snapshot | SHA256 dos 166 arquivos conferidos corresponde à fonte; nenhuma divergência | Antes da adição deste relatório documental |
| git diff --check | Sem erros de whitespace | Branch local |
| Comparação com main em src/data, public/assets e manifests | Nenhuma alteração | Os sete JSONs, manifesto e 21 WebPs permanecem intactos |

Os comandos npm foram executados por npm-cli.js obtido do pacote oficial npm 11.6.0, em diretório temporário. O terminal fornecia Node mas não npm no PATH. Nenhum runtime temporário, pacote instalado ou artefato de build faz parte da entrega versionada.

## Limitações observadas e correções dos testes

A execução inicial detectou EISDIR na operação fs.link de uma fixture criada dentro da unidade virtual do Google Drive. O teste de I/O agora usa mkdtemp no diretório temporário local e mantém hardlinks reais e as mesmas verificações. O backend de produção não foi alterado: cadastro ou retificação pelo filesystem diretamente em G: ainda pode encontrar essa restrição.

Dois cenários de concorrência dependiam de esperas fixas e da vida de um processo titular por apenas dois segundos. Foram substituídos por handshake IPC no ponto de remoção do lock e por um titular mantido vivo até o término do teste. As asserções de preservação de lock foram mantidas e fortalecidas. O conjunto isolado de I/O e transações passou em 77 testes antes da execução completa.

Astro Check e build iniciados diretamente no Google Drive ficaram excessivamente lentos durante a resolução/importação de dependências. Foram interrompidos e não são reportados como sucesso. Para conclusão, foi criado um snapshot em diretório temporário local, contendo somente arquivos versionados e novos arquivos permitidos. Foram excluídos .git, .netlify, node_modules, dist, .astro, .bundle e temporários. Cada cópia foi conferida por SHA256. A instalação limpa e os checks concluíram nesse snapshot.

Nenhuma alteração funcional foi feita para contornar a resolução do Astro no Drive, e a pasta de trabalho permanece a escolhida pelo proprietário.

## Preservação e publicação

Os dois arquivos .bundle preexistentes continuam no lugar, com tamanhos 259522 e 3239584 bytes e datas de modificação de 2026-07-29. As demais cópias e backups do projeto não foram alterados. .gitignore exclui artefatos locais sem apagar seus arquivos.

O inventário versionado comprova 21 WebPs, não a preservação dos originais de captura. A política de originais foi documentada sem inventar proveniência. O pré-validador exige arquivo original e hash para cada derivado de um novo pacote; lê/decodifica em memória, não recorta, não converte nem sobrescreve fotografias reais.

O checklist do SEL-000001 registra o estado editorial já presente no JSON. Todas as verificações visuais sem evidência individual permanecem desmarcadas.

A automação remota ainda não está ativada. A entrega contém contrato, template pendente, pré-validação somente leitura e a arquitetura para conectar aprovação autenticada, originais imutáveis, isolamento da mídia pública, exportação para PR, CI e reconciliação após deploy. O nome de revisor informado num pacote não é prova de autorização; can_publish permanece sempre false.

Não houve push, criação de PR, merge, mudança da main, alteração de Blobs, configuração de proteção de branch ou deploy. A entrega deve ser revisada antes de qualquer integração remota.

## Referências

- [Arquitetura e componentes restantes](arquitetura.md)
- [Checklist do SEL-000001](../homologacao/SEL-000001-checklist.md)
- [README](../../README.md)
