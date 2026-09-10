# Preparação da publicação governada

Estado em 2026-09-09: arquitetura proposta e pré-validador local implementado. A integração ponta a ponta ainda não está ativa. Esta entrega não cria PR, não escreve no GitHub, não altera os Blobs e não executa merge ou deploy.

## Fonte oficial e diagnóstico de retomada

O código e os dados publicados têm como fonte oficial a branch main de ThiagoGelinski/colecao-selos. Em 2026-09-09, main local e GitHub coincidiam no commit df7d805bfd2cc4909257f46b00957868e421f8a1. Há sete JSONs publicados e 21 WebPs rastreados. O estado do site Netlify em produção não foi comprovado apenas por essa leitura.

A pasta C:\Projetos\colecao-selos não existia. O proprietário escolheu expressamente continuar na cópia colecao-selos da pasta aberta no Google Drive. Antes da edição não havia arquivos versionados modificados. Os itens não rastreados identificados eram .netlify/ e dois arquivos .bundle; continuam fisicamente preservados e agora estão ignorados pelo Git. Nenhuma das outras cópias/backups foi consolidada, movida ou removida.

A branch de trabalho é docs/preparacao-publicacao-governada, criada a partir desse main. A API do GitHub reportou main sem proteção de branch naquele momento. O workflow de CI existir não significa que o GitHub exija seus resultados antes do merge.

## Comportamento atual comprovado pelo código

| Camada | Fonte e comportamento atuais |
| --- | --- |
| Catálogo público | src/lib/selos.ts incorpora src/data/selos/*.json com import.meta.glob durante o build. |
| Publicação editorial | O CLI exige aprovação, hash e versão; selo:publicar altera o JSON local e não executa Git, merge ou deploy. |
| Painel | Rotas server-side consultam baseline e Netlify Blobs; cadastros/alterações são gravados no store colecao-selos-catalogo. |
| Registros no Blobs | Chaves manifests/SEL-xxxxxx.json e manifests/ids.json. Leitura detecta divergência do baseline materializado. |
| Imagens públicas | netlify.toml encaminha /assets/selos/... à API. readAssetBinary prioriza Blobs, depois arquivos do deploy. |
| Credenciais | Store administrativo próprio no Netlify Blobs, separado dos registros do catálogo. |
| Integração | Não existe, no main verificado, promoção automática do conteúdo do painel para PR no GitHub. |

Consequência: salvar um texto no painel não atualiza o catálogo público estático. Uma retificação de imagem, porém, pode alterar os bytes servidos na URL pública antes de um novo build. O fluxo proposto só poderá ser ativado depois de isolar imagens de rascunho das imagens aprovadas.

## Fluxo alvo e limites desta entrega

1. **Capturar e preservar:** guardar os bytes originais sem alteração, identificar origem, tamanho e SHA256; gravar com exclusividade em acervo de originais separado. Sem exclusão nem sobrescrita.
2. **Preparar no painel:** produzir rascunho e derivados de revisão em namespace separado, com ETags e versão. Não substituir a chave pública existente.
3. **Congelar revisão:** reunir JSON final proposto, base Git, manifesto de IDs, hashes dos originais/derivados e receita em snapshot imutável.
4. **Aprovação humana:** sessão autenticada registra identidade, decisão e instante para o hash completo do snapshot. Revisão inclui frente, verso, conteúdo e fidelidade fotográfica. Aprovação editorial histórica de um selo não aprova novos bytes.
5. **GitHub:** serviço com credencial exclusiva do servidor revalida a main remota e os ETags, cria uma branch e um PR com somente arquivos permitidos. Sem escrita direta em main, sem auto-merge.
6. **CI:** testes, auditoria, Astro Check e build são obrigatórios. O ambiente de preview deve consumir exatamente o commit do PR.
7. **Merge autorizado:** o mantenedor autoriza a integração depois da revisão. Essa autorização é distinta da aprovação editorial do selo.
8. **Netlify:** implantação do commit integrado de main. Confirmar o SHA efetivamente implantado e validar catálogo e imagens.
9. **Reconciliação:** atualizar o baseline administrativo por operação condicional, somente se snapshot, ETags e commit implantado ainda corresponderem. Edições posteriores permanecem pendentes.

| Componente | Nesta entrega |
| --- | --- |
| Contrato do pacote | schemas/publicacao.schema.json |
| Pré-validação local, somente leitura | src/lib/publicacao/prepare.mjs e tools/publicacao.mjs |
| Testes do preparo | tests/publicacao.test.mjs, executados também pelo npm test existente |
| Revisão humana autenticada do snapshot | Especificada; falta conectar ao painel |
| Acervo imutável de originais e gerador de derivados | Especificados; não implantados e nenhum original atual é presumido |
| Exportação Blobs → branch/PR | Especificada; sem transporte/API ativados |
| Imagens públicas isoladas dos rascunhos | Requisito de ativação; comportamento atual não foi alterado nesta entrega |
| Confirmação do deploy e reconciliação Blobs | Especificadas; ainda sem automação |
| Proteção de main e credenciais de serviço | Exigem configuração posterior autorizada |

## Contrato verificável do pacote

O pacote JSON usa schema_version 1.0.0 e contém:

- repository fixo, base_commit de main e created_at;
- records com ID, hash canônico do registro base ou null para um novo ID, blob_etag, JSON final proposto e todos os papéis de imagem usados;
- ids com hash do manifesto base, ETag e manifesto completo proposto;
- para cada imagem: arquivo derivado relativo à pasta do pacote, SHA256 binário, referência ao original com SHA256 e receita;
- approval separada do conteúdo, inicialmente pending, vinculada a snapshot_sha256.

O JSON final proposto deve ter sido preparado pelo domínio editorial existente: status publicado, aptidão técnica e aprovação válida, ainda sem ser integrado em main. O validador não executa selo:aprovar ou selo:publicar e não modifica esse estado. Um registro existente em main continua público enquanto a alteração proposta está em revisão.

O hash do snapshot usa JSON com chaves ordenadas recursivamente e inclui todos os campos, exceto approval. Cobre registros completos, manifesto, base Git, ETags, nomes, hashes das fotografias e receitas. Mudança em qualquer um desses campos exige nova revisão. Não usar recordHash isoladamente como aprovação da mídia: o hash editorial atual não cobre os bytes das imagens.

base_sha256 também usa JSON canônico. Já metadata.baseline_hash do Blobs atual é SHA256 de JSON.stringify(baseline), respeitando a ordem das chaves. São contratos diferentes; o novo pré-validador não modifica nem substitui o algoritmo de io.mjs.

Os ETags no pacote identificam o snapshot lido. O pré-validador local não consulta o Blobs para verificar se ainda são atuais. Essa conferência condicional é obrigatória no futuro exportador e na reconciliação.

## Fotografias: preservação e operações permitidas

Os 21 WebPs versionados são preservados como acervo existente. Não há, no inventário rastreado verificado, comprovação dos originais de captura ou de sua proveniência. Isso não significa que os originais estejam ausentes das outras pastas; significa que esta entrega não os localizou nem autenticou. O legado fica intacto. Uma nova promoção de imagem pelo fluxo preparado exige uma referência verificável ao original.

Para novas capturas, o acervo deverá armazenar original/<sha256> com gravação exclusiva, metadados de procedência e sem rota de exclusão. Uma nova captura recebe outro hash e outra entrada. Original e derivado nunca usam o mesmo arquivo. Backups transacionais da retificação atual não substituem esse acervo.

A receita permite apenas:

- recorte com margens inteiras não negativas, esquerda igual a direita e topo igual a baixo, preservando largura e altura positivas;
- conversão técnica para WebP, com encoder, versão, qualidade e modo lossless documentados.

Margens zero representam conversão sem recorte. A simetria não exige que margem horizontal e vertical tenham o mesmo valor. A renderização responsiva em CSS não altera os arquivos; não haverá redimensionamento dos pixels no processamento permitido.

Não são permitidos reconstrução por IA, remoção/preenchimento de elementos, alteração de cor/contraste/nitidez, retoque, rotação corretiva, deformação ou recorte assimétrico. A receita rejeita campos adicionais. Uma receita declarada, mesmo validada, não comprova os pixels: o processador futuro deve decodificar a fonte, aplicar somente essas operações, produzir o derivado e demonstrar os parâmetros. O revisor compara o resultado com a captura.

O pré-validador verifica os hashes, decodifica originais e WebPs em memória e confere as dimensões físicas declaradas e resultantes do recorte. Rejeita animação/múltiplos frames e aplica limites de tamanho e pixels. Não comprova origem fotográfica nem equivalência visual dos pixels. Seus testes usam imagens sintéticas e não são evidência visual. Nenhuma fotografia foi processada nesta entrega.

## Uso local do preparo

Requer Node.js 24 e dependências instaladas. Crie o pacote de trabalho em pasta ignorada, por exemplo .publication-work/revisao-001/, mantendo originais e derivados separados.

1. Partir do template publicacao.template.json, preencher o JSON proposto, manifesto, referências e hashes com evidências reais.
2. Confirmar main local contra o GitHub antes de produzir o snapshot. Nunca trocar a base silenciosamente durante uma revisão.
3. Rodar o comando abaixo. Enquanto approval estiver pending, ele retorna bloqueios e o hash a apresentar à revisão humana.
4. Registrar a decisão real fora da automação de preparo. O futuro painel autenticado é quem deverá criar a evidência verificável; não preencher uma identidade fictícia.
5. Reexecutar contra o mesmo snapshot e arquivos.

~~~bash
npm run publicacao:preparar -- .publication-work/revisao-001/pacote.json
~~~

Sem npm disponível no terminal, a execução equivalente é node tools/publicacao.mjs seguido do caminho. O comando exige o origin oficial, lê main por git show e usa apenas a pasta do pacote para verificar os arquivos. Rejeita caminhos externos, links simbólicos/junctions, originais ausentes, divergência de hashes, colisões e perda de reservas.

A saída é JSON único, com ok e código 0 somente para um pacote tecnicamente consistente; bloqueios retornam código 1. Sempre retorna mode: preparation_only e can_publish: false. files lista apenas JSONs, manifesto e WebPs derivados permitidos. Os originais ficam fora desse plano público e devem permanecer preservados no acervo privado. Em caso de bloqueio, files fica vazio.

O comando não autentica a pessoa indicada por reviewer, não comprova assinatura de aprovação e não transfere arquivos. Seu resultado não autoriza merge ou publicação. Um integrador futuro nunca deve confiar apenas em um nome digitado ou em ok: true.

## Exportador e PR a implementar

O serviço de integração deverá receber somente o identificador de um snapshot já aprovado e buscar o payload congelado no servidor. Não aceitar arquivos arbitrários do navegador como autoridade para escrever em GitHub.

Antes da gravação, conferir o commit remoto de main, assinatura/autenticidade da aprovação, versão do snapshot, ETags atuais e hashes de todos os bytes. Gerar uma chave de idempotência a partir do hash do snapshot. Repetição devolve o mesmo PR; não cria novas branches ou consome IDs.

O diff do PR permite exclusivamente src/data/selos/SEL-xxxxxx.json, manifests/ids.json e WebPs derivados aprovados em public/assets/selos/SEL-xxxxxx/. Nunca incluir .bundle, .netlify, node_modules, dist, temporários, credenciais, originais privados ou backups. Um PR de implementação, como esta branch documental/técnica, tem escopo separado do exportador de conteúdo.

Nesta v1, o manifesto preserva integralmente todas as reservas antigas, inclusive canceladas/falhas. Transições de reservas antigas ainda incompletas e mudanças de slug de reservas existentes não são promovidas por este preparo; exigem fluxo posterior explicitamente validado. Novas reservas completas podem ser acrescentadas. Não reutilizar lacunas e não retroceder next_sequence. A união do catálogo base com os candidatos precisa manter IDs e slugs únicos. Se main avançar, refazer o pacote e solicitar nova revisão; não substituir automaticamente o commit base aprovado.

A credencial do serviço fica apenas no servidor, limitada ao repositório e à criação/atualização de branches e PRs. Não conceder ao automatismo o papel de revisor ou bypass da proteção de main. Configuração de proteção e escopos deve ser feita e validada em etapa autorizada.

## Publicação de imagens e reconciliação

Antes de ativar a promoção, servir publicamente somente a mídia aprovada que acompanha o build, ou uma release imutável explicitamente vinculada ao commit. Rascunhos usam namespace privado distinto, acessível apenas pelo painel autenticado. Evitar URLs de produção que priorizem uma chave mutável do rascunho.

Após o deploy, o reconciliador deve:

1. Confirmar que o SHA implantado é o commit integrado aprovado.
2. Ler novamente registro/manifesto/versões da mídia e comparar os ETags com o snapshot exportado.
3. Verificar o conteúdo incorporado pelo build e calcular o novo baseline_hash pelo algoritmo legado exato.
4. Atualizar metadados por compare-and-swap e registrar evento com snapshot, commit, deploy e hashes.
5. Se qualquer ETag ou conteúdo mudou, registrar conflito e manter o estado posterior; não apagar Blobs nem sobrescrever revisões novas.

Não corrigir a divergência simplesmente removendo baseline_hash ou apagando o store. Falhas de deploy mantêm rascunho e originais preservados. Rollback público deverá selecionar um commit previamente aprovado e manter todo o histórico.

## Critérios para ativação futura

Além de testes unitários do preparo, comprovar em ambiente de homologação: aprovação autenticada, captura de originais com gravação exclusiva, reprodução de derivados, isolamento da mídia pública, repetição idempotente de PR, conflito com main/ETag avançados, rejeição de hashes adulterados, CI obrigatória, bloqueio de merge sem autorização, deploy do SHA esperado e reconciliação sem perda de edição concorrente.

A integração remota só estará pronta depois dessas evidências. O estado implementado agora é a preparação local verificável e a especificação dos componentes restantes.
