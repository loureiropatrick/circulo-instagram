# Círculo

Um projeto para deixar de seguir em lote **somente quem não segue você de volta**, mantendo as conexões mútuas.

O filtro inicial é **Não seguem de volta**. Contas mútuas e contas sem comparação ficam bloqueadas para seleção, inclusive na seleção em massa. A comparação usa seus arquivos exportados; ela não consulta em tempo real quem segue você. Seguir de volta identifica uma conexão mútua, não comprova amizade.

## Comece aqui

1. Extraia este ZIP em uma pasta permanente do computador.
2. No **Chrome**, abra `chrome://extensions`. No **Edge**, abra `edge://extensions`.
3. Ative **Modo do desenvolvedor** e escolha **Carregar sem compactação**.
4. Selecione a pasta **extensao**, que contém `manifest.json`.
5. Clique no ícone da extensão **Círculo** para abrir o painel.
6. Importe **following.json e todos os followers_*.json**. Você também pode importar o JSON combinado ou uma fila com comparação preparada pelo Círculo. As duas listas são necessárias para identificar quem não segue de volta.
7. Proteja quem você quer manter usando o coração. Clique em **Selecionar todos que não me seguem (N)** acima da tabela para selecionar todas as contas elegíveis de uma vez, em **todas as páginas**, mesmo com uma busca ou outro filtro ativo. Mútuos, protegidos e contas já concluídas ficam de fora. A caixa no cabeçalho da tabela seleciona somente a página atual.
8. Em outra aba do mesmo navegador, entre no Instagram, abra **seu próprio perfil** e clique em **Seguindo**. Deixe essa lista aberta. Se a aba já estava aberta antes de instalar a extensão, recarregue-a.
9. Volte ao Círculo, clique em **Preparar fila**, revise a lista, confirme que a conta é sua e inicie.
10. Acompanhe em **Fila de limpeza**. Use **Pausar**, **Retomar** ou **Encerrar**. Uma confirmação já enviada ao Instagram pode terminar de ser verificada após a pausa.

Não é necessário instalar Node.js, Python ou dependências para usar a extensão. Ela funciona no Chrome e Edge para computador; a instalação local não utiliza as lojas desses navegadores.

### Atualizar uma instalação existente

Extraia o ZIP atualizado e substitua os arquivos da pasta **extensao** que você carregou anteriormente pelos arquivos novos. Em `chrome://extensions` ou `edge://extensions`, clique em **Recarregar** no Círculo. Feche o painel antigo, reabra pelo ícone da extensão e **recarregue também a aba do Instagram** antes de abrir Seguindo. Mantenha a mesma pasta e não remova a extensão para preservar os dados locais. Esta versão é **1.2.0**; o rodapé do painel também mostra a versão. Carregar outra pasta como uma nova extensão pode criar um armazenamento separado.

## Continuar depois de fechar o navegador

1. Abra o Instagram na **mesma conta** da fila salva. Entre no seu próprio perfil e abra **Seguindo**. Pode ser uma aba nova; mantenha apenas uma lista dessa conta aberta.
2. Abra o Círculo pelo ícone da extensão. O aviso **Sua fila está salva** mostra o último registro e os pendentes. O painel consulta o estado, mas não reinicia ações automaticamente.
3. Clique em **Revisar e retomar** no aviso ou em **Fila de limpeza**. Confira o usuário da conta e os nomes que faltam, marque a confirmação e retome.
4. A retomada mantém o histórico: contas concluídas e itens com resultado incerto não são executados novamente. Itens retirados da revisão também ficam fora da retomada.

Se aparecer uma falha de conexão, reabra o painel pelo ícone e use **Verificar conexão**. Se a lista do Instagram estiver em outra conta ou houver mais de uma lista aberta, a extensão informa o problema e mantém a fila salva.

**Encerrar sem apagar progresso** interrompe a fila e permite reorganizar a seleção. Não apaga suas listas nem o histórico. Se restarem itens, a fila encerrada pode ser retomada após nova revisão. **Exportar progresso** baixa um relatório JSON com concluídos, pendentes e itens para revisão; ele é um registro local, não um arquivo de restauração. Não publique esse relatório no GitHub.

## Como obter sua lista

No Instagram, abra a **Central de Contas → Suas informações e permissões → Exportar/Baixar suas informações**. Escolha seu perfil do Instagram, as informações de **seguidores e seguindo**, **todo o período** e o formato **JSON**. Os nomes dos menus podem variar conforme a versão.

Quando o Instagram disponibilizar o download, extraia o ZIP. Procure `following.json` e todos os `followers_1.json`, `followers_2.json` etc. Eles costumam estar na pasta `connections/followers_and_following`.

- `following.json` é sua lista de contas seguidas.
- Os arquivos `followers_*.json` permitem identificar quem segue você de volta.
- Sem a lista de seguidores, a comparação aparece como **Não comparado** e a seleção fica bloqueada.
- Também é possível importar TXT ou CSV com nomes de usuário, ou colar um nome por linha. É preciso importar os seguidores em seguida para liberar a seleção. Datas podem ser informadas no CSV.
- O painel hospedado e a extensão têm armazenamentos separados. Para transferir uma seleção, exporte `circulo-fila.json` no painel e importe esse arquivo na extensão.

## O que o projeto faz

- Lê arquivos no próprio navegador, sem enviar suas listas ao servidor.
- Busca, ordena por data ou nome e filtra contas mútuas e que não seguem de volta.
- Mantém uma lista de protegidos, excluída da seleção.
- Mantém as conexões mútuas fora da fila, mesmo quando você usa “Selecionar todas”.
- Permite seleção em massa e revisão antes de começar.
- Executa uma fila sequencial pela interface visível do Instagram.
- Opera somente os usernames selecionados na lista **Seguindo** do próprio perfil.
- Confirma a identidade da linha e a mudança do botão antes de registrar uma remoção.
- Pausa ao encontrar login, restrições, diálogo inesperado ou resultado incerto. Um resultado incerto não é repetido automaticamente nessa execução.
- Preserva a fila e os resultados localmente. Recarregar ou mudar a aba interrompe a execução e exige retomada explícita.
- Exporta a lista filtrada em CSV e a fila em JSON.

Enquanto uma fila está em execução ou pausada, encerre-a antes de alterar protegidos, importar ou preparar outra seleção. Isso mantém a lista revisada igual à lista que será executada.

## Limitações

**Não é uma integração oficial do Instagram.** Não encontramos endpoint oficial de unfollow na documentação consultada. A extensão utiliza cliques na interface; mudanças no Instagram, idioma diferente de português/inglês ou uma conta com layout diferente podem impedir a execução.

O Instagram pode restringir ações automatizadas. O intervalo fixo de cinco segundos é um controle de ritmo e interrupção, **não uma garantia contra bloqueios**. O projeto não contorna verificações, CAPTCHA ou restrições.

Os dados representam a data da exportação. Nomes podem mudar e uma lista pode estar incompleta. Contas não localizadas são registradas como não executadas. Se a interface remover uma linha sem exibir uma mudança verificável para **Seguir**, o resultado fica não confirmado e a fila pausa para revisão manual.

Deixar de seguir pode exigir nova aprovação para voltar a seguir uma conta privada. Não há função de desfazer automaticamente.

Nenhuma ação foi executada em uma conta real durante o desenvolvimento. A instalação, a compatibilidade com o layout da sua conta e o primeiro teste real precisam ser verificados por você, começando com uma seleção pequena que já tenha revisado.

O histórico local evita recolocar contas concluídas em seleções importadas de snapshots antigos. Se você voltou a seguir uma conta e quer tratá-la como nova, encerre a fila, use **Limpar dados locais** e importe uma exportação atualizada.

## Privacidade e permissões

A extensão pede `storage` e acesso apenas a `https://www.instagram.com/*`. Não lê cookies, senhas ou tokens e não usa endpoints privados. Os arquivos, protegidos e histórico ficam no armazenamento deste navegador. O painel não utiliza fontes, imagens ou bibliotecas remotas.

Use **Privacidade → Limpar dados locais** para apagar a lista e os resultados do Círculo. Isso não desfaz ações já realizadas no Instagram. Remover a extensão também remove seu armazenamento; os arquivos exportados no computador continuam sob seu controle.

## Código e testes

```
extensao/
  manifest.json          Configuração MV3 e permissões
  index.html             Painel em português
  styles.css             Interface responsiva e temas claro/escuro
  theme.js               Alternância e persistência do tema
  app.js                 Importação, seleção, protegidos e fila
  data-core.js           Leitura e validação dos arquivos
  background.js          Controle persistente da execução
  instagram-content.js   Interação com a interface do Instagram
  icons/                 Ícones locais
testes/                  Testes e arquivos fictícios
package.json             Comando opcional de testes
```

Para desenvolvedores, com Node.js 20 ou superior: `npm test`. Não há dependências de produção nem etapa de build. As verificações cobrem leitura dos dados, persistência, importação/exportação, autorização de mensagens e controle da fila. Testes de dados e de controle passaram; a ação real em uma conta do Instagram não foi testada.

## Fontes

- [Documentação da Meta para Instagram](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00)
- [Meta: exportação de informações na Central de Contas](https://about.fb.com/news/2023/10/manage-your-information-across-apps/)
- [Ajuda do Instagram: exportar informações](https://help.instagram.com/181231772500920/)

Projeto independente, sem afiliação com Instagram ou Meta.
