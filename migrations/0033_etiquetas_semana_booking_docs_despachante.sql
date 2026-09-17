-- 0033_etiquetas_semana_booking_docs_despachante.sql
--
-- Pedido Ayslan (17/09/2026): substituir a planilha de controle da Paula
-- (cores de fundo manuais sinalizando situacao do processo) por algo
-- equivalente dentro do sistema, sem depender de alguem lembrar de pintar
-- uma celula. Duas pecas novas:
--
-- 1) semana_booking (integer): semana do booking (ex: 40, 41, 42), pra
--    poder ver a "Programacao Semanal de Embarques" agrupando processos
--    por essa coluna na tabela principal (mesmo mecanismo de "Agrupar por
--    coluna" ja existente). Espelha a aba "PROCESSOS DA SEMANA" da
--    planilha da Paula.
--
-- 2) docs_enviados_despachante (date): quando os documentos (HBL/CI) foram
--    enviados pra Amanda/Find Comex (despachante) pra ela solicitar a LI.
--    Fluxo confirmado pelo Ayslan: "se tivermos Aprovacao HBL = Sim,
--    precisamos enviar a Amanda, e ela que solicita a LI" — ou seja, esse
--    campo marca o passo INTERMEDIARIO entre aprovacao_hbl='Sim' (que ja
--    existe) e solicitacao_li='Sim' (que ja existe). Vira o badge roxo
--    "Enviar docs a despachante" (etiquetasDoProcesso() em
--    controle-core.js) enquanto aprovacao_hbl='Sim' e este campo ainda
--    nao foi preenchido.
--
-- 3) etiquetas_manuais_json (jsonb): etiquetas que nao dao pra derivar
--    automaticamente de outro campo (ex: "cliente pediu outro agente de
--    carga" — a "amarelo grifado" da planilha da Paula). Array de ids de
--    etiqueta, ex: ["OUTRO_AGENTE_CARGA"]. Ver ETIQUETAS_MANUAIS_DEFS em
--    controle-core.js.

alter table controle_processos add column if not exists semana_booking integer;
alter table controle_processos add column if not exists docs_enviados_despachante date;
alter table controle_processos add column if not exists etiquetas_manuais_json jsonb;
