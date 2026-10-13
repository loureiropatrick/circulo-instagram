# Verificação do parser local

Comando executado: `node --test tests/data-core.test.mjs`

Resultado: **15 testes aprovados, zero falhas**.

Os arquivos em `tests/fixtures/` são exemplos fictícios com a estrutura da exportação oficial do Instagram; não contêm dados de uma conta real. Os testes usam leitura desses arquivos e o módulo que a interface carrega.

Cobertura:

- `following.json` com `relationships_following`, `string_list_data`, perfil em `href` e timestamps em segundos.
- União e deduplicação de `followers_1.json` e `followers_2.json`.
- Seguidores nunca entram na lista de pessoas seguidas; reciprocidade fica desconhecida sem arquivo de seguidores. Um arquivo explícito vazio estabelece que nenhum perfil segue de volta.
- BOM, caminhos em nomes de arquivo, schema prioritário e rejeição de arrays JSON ambíguos.
- CSV com cabeçalho opcional, aspas, separador vírgula/ponto e vírgula, datas ISO, timestamps em segundos ou milissegundos, ausência de data e linhas inválidas.
- TXT, nomes com `@`, URLs de perfil do Instagram, deduplicação e rejeição de domínios arbitrários/caminhos que não representam um perfil.
- Exportação/importação da fila Círculo versão 1; rejeição de payloads incompatíveis e separadores inseridos em um elemento da fila.
- Mensagens de erro em português para JSON inválido, ZIP sem extração e CSV malformado.

Contrato: `followedAt` usa sempre **milissegundos Unix** ou `null`. `followsYou` usa `true`, `false` ou `null`; `null` significa ausência da lista de seguidores. A data/reciprocidade refletem os arquivos importados. O parser não faz acesso à rede, não recebe cookies e não chama endpoints do Instagram.

Erros de arquivo interrompem a importação para que a interface mantenha os dados anteriores. Registros individuais sem nome válido são ignorados com aviso. TXT/CSV sem indicação no nome são tratados como “seguindo”, com aviso explícito.
