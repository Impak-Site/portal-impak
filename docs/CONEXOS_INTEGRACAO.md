# Integração IMPAK Portal ↔ Conexos Cloud — estado e próximos passos

_Atualizado em 19/09/2026. Dono: Ayslan._

## Onde estamos

O Conexos Cloud é o ERP oficial de comex da IMPAK. Hoje **tudo é redigitado** entre
os dois sistemas. A documentação técnica da API do Conexos só é liberada pra cliente,
então a parte que de fato conversa com eles fica pra **depois da reunião com o Conexos**.

O que já está pronto no nosso lado (sem depender deles):

| Peça | Onde | O que faz |
|---|---|---|
| Campo **ID no Conexos** | aba Identificação do processo (`conexos_id`) | guarda o identificador do mesmo processo lá — é o que vai casar os dois sistemas |
| **Última sincronização** | `conexos_ultima_sync` (mostra abaixo do campo) | quando o Conexos atualizou este processo pela última vez |
| Tabela **`integracao_log`** | migration `0034` | trilha de tudo que qualquer integração/import fez em cada processo (Conexos, planilha do despachante, planilha interna). Já está sendo gravada pelos 2 imports de planilha |
| Serviço **`services/conexos.js`** | código | de-para de campos, regra de precedência, fluxo buscar→mapear→aplicar→logar. Só o "buscar" (transporte HTTP) está vazio |
| Rotas | `GET /api/integracao/conexos/status`, `POST /api/integracao/conexos/sincronizar/:id`, `GET /api/integracao/log/:processoId` | prontas; enquanto `CONEXOS_API_URL`/`CONEXOS_API_TOKEN` não existem, respondem `nao_configurado` e não alteram nada |

## Campos que a integração vai trazer (de-para)

A coluna **Conexos** fica em branco até termos a documentação. O nome genérico é o
que o `services/conexos.js` entende hoje.

| Nosso campo | Nome genérico | Conexos (a preencher) | Sobrescreve valor já digitado? |
|---|---|---|---|
| numero_di | di.numero | | não (só completa vazio) |
| data_registro_di | di.data_registro | | não |
| canal | di.canal | | não |
| data_liberacao | di.data_desembaraco | | não |
| ci_numero / ci_data / ci_valor_usd | invoice.* | | não |
| hbl / mbl | bl.house / bl.master | | não |
| navio / etd / eta | embarque.* | | não |
| porto_origem / porto_destino | embarque.porto_* | | não |
| ce_master / ce_house | ce.* | | não |
| nf_entrada_numero / data / valor | nf_entrada.* | | não |
| nf_saida_numero / data / valor | nf_saida.* | | não |

> **Regra de precedência (item 4 do plano — a decidir com Paula):** hoje NADA vindo do
> Conexos sobrescreve um valor já digitado; só preenche o que está vazio. O que for
> diferente fica registrado em `integracao_log` como `ja_preenchido` (com os dois
> valores) pra alguém decidir. Quando definirmos quais campos o Conexos é "dono"
> (provavelmente DI, canal, desembaraço), basta virar `sobrescreve: true` no
> `MAPA_CAMPOS` — e vale reaproveitar o pop-up de conflitos que já existe na leitura
> por IA pra pedir confirmação nos demais.

## Perguntas pra levar na reunião com o Conexos

**Acesso**
1. A API é REST/JSON? Há documentação (Swagger/OpenAPI) que possam enviar?
2. Como é a autenticação — token fixo por cliente, OAuth, usuário+senha? O token expira?
3. Existe **ambiente de homologação/sandbox** separado do de produção?
4. Há limite de chamadas (rate limit) por minuto/dia?

**Dados**
5. Quais entidades a API expõe? Precisamos ao menos: **processo de importação, DI/DUIMP,
   invoice (CI), BL, CE Mercante, NF de entrada e de saída, câmbio/contrato de câmbio**.
6. Qual campo deles identifica o processo? É o mesmo "nº do processo" que aparece na tela
   do Conexos? Tem como buscar pela **nossa referência** (ex: UD26-117) ou só pelo ID deles?
7. As datas vêm em qual formato e fuso? Valores monetários com quantas casas, em qual moeda?
8. Dá pra saber **quando** um campo mudou (data de atualização por registro)? Sem isso a
   gente só consegue "puxar tudo" periodicamente.

**Fluxo**
9. Existe **webhook** (eles avisam quando algo muda) ou só consulta (a gente pergunta)?
10. Além de ler, dá pra **escrever** no Conexos (ex: criar o processo lá a partir do
    nosso, ou enviar a NF de saída)? Ou a integração é só leitura?
11. Como eles tratam processo cancelado/estornado — some, muda status, ou vira outro registro?

**Comercial/operacional**
12. A API tem custo à parte ou está no plano atual?
13. Quem é o contato técnico deles pra dúvidas durante a implementação?

## Quando as respostas chegarem

1. Preencher a coluna **Conexos** da tabela acima (de-para).
2. Implementar `transportePadrao().buscarProcesso()` em `services/conexos.js` com a chamada real.
3. Configurar `CONEXOS_API_URL` e `CONEXOS_API_TOKEN` no Railway (homologação primeiro).
4. Testar com 3 processos reais usando `POST /api/integracao/conexos/sincronizar/:id`
   e conferir `integracao_log` — nada é sobrescrito, então é seguro.
5. Decidir com a Paula a regra de precedência (item 4) e ligar `sobrescreve` onde fizer sentido.
6. Se houver webhook ou data de atualização: agendar sincronização automática (mesmo
   mecanismo dos alertas diários, `app_job_runs`).
