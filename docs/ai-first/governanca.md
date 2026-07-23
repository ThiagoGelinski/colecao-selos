# Governança e aprovação humana

## Papéis

- **Automação/IA:** estrutura rascunhos, sinaliza lacunas, valida contratos e prepara relatórios.
- **Catalogador:** pesquisa, fornece fontes e distingue fato de hipótese.
- **Revisor humano:** assume responsabilidade explícita pela aprovação ou rejeição.
- **Mantenedor:** decide commit, Pull Request, merge e deploy.

## Campos de aprovação

`aprovacao_humana` contém:

- `status`: pendente, aprovado, rejeitado ou revogado;
- `decisao`: pendente, aprovado ou rejeitado;
- `revisor`: identidade declarada da pessoa responsável;
- `revisado_em`: timestamp ISO 8601;
- `escopo`: sempre `publicacao_catalogo`;
- `observacao`: justificativa opcional.

## Bloqueios obrigatórios

Um registro só pode ficar `publicado` quando:

- `aprovacao_humana.status` e `decisao` forem `aprovado`;
- houver revisor não vazio e data válida;
- o escopo for `publicacao_catalogo`;
- `apto_para_publicacao` for verdadeiro;
- a validação estrutural não encontrar erros.

O schema, `selo:publicar`, `selo:validar` e as auditorias aplicam a mesma regra em profundidade.

## Segurança

- Não registrar tokens, credenciais ou dados pessoais desnecessários.
- Não permitir que IA se identifique como revisor humano.
- Não editar imagens homologadas por meio da pipeline.
- Não executar commit, push, merge ou deploy dentro dos comandos de catalogação.
