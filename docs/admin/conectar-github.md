# Conectar a publicação ao GitHub

Neste fluxo, a geração do token depende da sua sessão pessoal no GitHub, que pode solicitar senha ou autenticação em duas etapas. Depois disso, o agente pode validar o acesso, salvar o segredo no Netlify e acompanhar o deploy. Você não precisa enviar comandos nem revelar o token na conversa.

## Gerar o token

1. Entre no GitHub como **ThiagoGelinski** e abra [Criar token da Coleção Selos](https://github.com/settings/personal-access-tokens/new?name=Colecao%20Selos%20Publicacao&target_name=ThiagoGelinski&expires_in=30&contents=write&pull_requests=write&actions=read).
2. Confira o responsável **ThiagoGelinski**, o nome **Colecao Selos Publicacao** e a validade de **30 dias**.
3. Em acesso aos repositórios, marque **Only select repositories** e selecione somente **colecao-selos**.
4. Confira as permissões: **Contents** e **Pull requests** com leitura/escrita; **Actions** com leitura. **Metadata** permanece em leitura.
5. Clique em **Generate token** e copie o valor gerado. Não o cole em chat, arquivo do projeto ou commit. Consulte a [documentação do GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) se a tela apresentar campos adicionais.

## Salvar no Netlify

Quando o agente oferecer uma tela local temporária com campo mascarado, cole o token somente nela e confirme o envio. O agente poderá validar as permissões e gravar a variável automaticamente. Essa tela possui prazo limitado e não tem endereço permanente neste guia.

Como alternativa manual, abra o projeto **colecaodeselos** no Netlify e acesse **Project configuration → Environment variables**:

1. Crie ou atualize a variável `GITHUB_PUBLISH_TOKEN`, colando o token como valor do contexto **Production**, somente.
2. Prefira o escopo **Functions** quando disponível. O plano atual recusou escopos granulares; nesse caso, mantenha os escopos padrão. O código lê o segredo exclusivamente no servidor; não use prefixo `PUBLIC_`.
3. Salve e execute um novo deploy para disponibilizar a variável às Functions.

Antes de completar 30 dias, gere outro token, substitua somente esse valor e faça novo deploy. A renovação não exige alterar registros, fotografias, backups ou a senha administrativa. Após confirmar o novo acesso, revogue o token anterior no GitHub.
