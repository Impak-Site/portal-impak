// taxas-catalogo.js
//
// Catálogo único das Taxas Operacionais do sistema — usado tanto pelo
// Calculador (calculador.html, função calcular()) quanto pelo Controle
// (controle-core.js, CUSTOS_REAIS_CONFIG/calcularCustoRealTotal/
// calcularFechamento).
//
// Antes, cada um dos dois arquivos tinha sua PRÓPRIA lista de taxas
// (TAXAS_CONFIG no Calculador, CUSTOS_REAIS_CONFIG no Controle) — risco real
// de "adicionar/corrigir uma taxa num lugar e esquecer no outro" (foi
// exatamente esse tipo de divergência que causou parte dos outliers de
// Custo Total investigados na auditoria de agosto/2026). Agora existe uma
// cópia só, carregada via <script src="taxas-catalogo.js"></script> (ANTES
// do script de cada página) e exposta em window.TaxasCatalogo.
//
// Cada taxa tem um campo `base_rateio` — a "unidade" pela qual ela é
// multiplicada, EXPLÍCITA em vez de espalhada em comentários/ifs dentro do
// código de cada tela:
//
//   'processo'   → valor único pro embarque inteiro, NÃO multiplica por
//                  nada (ex: Armazenagem — a fórmula por porto já soma
//                  mínimo/pesagem/controle/levante × containers
//                  internamente, então multiplicar de novo contaria
//                  container em dobro; Custos Diversos; Seguro de Venda;
//                  ICMS de Saída — todos já são "o total", lançados uma vez).
//   'container'  → multiplica pela quantidade de containers do processo
//                  (Siscomex, Marinha/AFRMM, Capatazia, Despachante, etc.
//                  — a maioria das taxas operacionais).
//
// Hoje o sistema assume 1 BL por processo (mesmo com N containers) — não
// existe uma categoria 'bl' separada de 'container'. Se um dia a Impak
// passar a ter processos com múltiplos BLs, essa é a extensão natural do
// modelo (mais uma base_rateio, sem mexer no resto).
//
// Isso NÃO muda nenhum resultado de cálculo — é a mesma regra que já
// existia (implícita, duplicada) nos dois arquivos, agora só num lugar.
(function () {
  'use strict';

  // grupo 'taxas' = Taxas Operacionais (o grupo que tinha a duplicidade real
  // entre TAXAS_CONFIG e CUSTOS_REAIS_CONFIG). Outros grupos do Controle
  // (Compra e Frete, Impostos, Comissões, Fechamento) continuam só lá —
  // não fazem parte dessa unificação porque não tinham duplicidade: só o
  // Controle os edita, o Calculador não tem campo próprio pra eles.
  const TAXAS_OPERACIONAIS = [
    { id: 'siscomex',         label: 'Siscomex',                        moeda: 'BRL', base_rateio: 'container' },
    { id: 'marinha',          label: 'Marinha/AFRMM',                   moeda: 'BRL', base_rateio: 'container' },
    { id: 'armazenagem',      label: 'Armazenagem',                     moeda: 'BRL', base_rateio: 'processo' },
    { id: 'emissao_li',       label: 'Emissão L.I.',                    moeda: 'BRL', base_rateio: 'container' },
    { id: 'baixa_patio',      label: 'Baixa Pátio',                     moeda: 'BRL', base_rateio: 'container' },
    { id: 'capatazia',        label: 'Capatazia/THC',                   moeda: 'BRL', base_rateio: 'container' },
    { id: 'liberacao_bl',     label: 'Liberação BL',                    moeda: 'BRL', base_rateio: 'container' },
    { id: 'despachante',      label: 'Despachante',                     moeda: 'BRL', base_rateio: 'container' },
    { id: 'sda',              label: 'SDA',                             moeda: 'BRL', base_rateio: 'container' },
    { id: 'lavacao',          label: 'Lavação Container',               moeda: 'BRL', base_rateio: 'container' },
    { id: 'administrativo',   label: 'Administrativo',                  moeda: 'BRL', base_rateio: 'container' },
    { id: 'agente',           label: 'Agente Carga',                    moeda: 'BRL', base_rateio: 'container' },
    { id: 'handling',         label: 'Handling at Destination',         moeda: 'USD', base_rateio: 'container' },
    { id: 'additional_costs', label: 'Additional Costs',                moeda: 'USD', base_rateio: 'container' },
    { id: 'import_logistics', label: 'Import Logistics',                moeda: 'USD', base_rateio: 'container' },
    { id: 'trs',              label: 'TRS',                             moeda: 'USD', base_rateio: 'container' },
    { id: 'tsc',              label: 'TSC',                             moeda: 'USD', base_rateio: 'container' },
    { id: 'drop_off',         label: 'Drop Off',                        moeda: 'USD', base_rateio: 'container' },
    { id: 'isps',             label: 'ISPS',                            moeda: 'USD', base_rateio: 'container' },
    { id: 'iof',              label: 'IOF',                             moeda: 'USD', base_rateio: 'container' },
    { id: 'desconsolidacao',  label: 'Desconsolidação',                 moeda: 'USD', base_rateio: 'container' },
    // Reciclagem: pedido do Jean (03/09/2026) — em Encomenda é custo do
    // cliente (não entra no processo); em Importação Própria IMPAK é custo
    // nosso (cobra X do cliente, paga Y). Antes era lançado dentro de
    // 'Custos Diversos' por falta de campo próprio.
    { id: 'reciclagem',       label: 'Reciclagem',                      moeda: 'BRL', base_rateio: 'processo' },
    // Só existem como lançamento no Controle (aba Custos Reais) — o
    // Calculador não tem campo próprio pra eles no formulário de cotação.
    { id: 'custos_diversos',  label: 'Custos Diversos',                 moeda: 'BRL', base_rateio: 'processo', soControle: true },
    { id: 'seguro_venda',     label: 'Seguro de Venda',                 moeda: 'BRL', base_rateio: 'processo', soControle: true },
    { id: 'icms_saida',       label: 'ICMS de Saída (1,4% s/ Produtos)', moeda: 'BRL', base_rateio: 'processo', soControle: true },
  ];

  function porId(id) {
    return TAXAS_OPERACIONAIS.find(t => t.id === id) || null;
  }

  // Lista só das taxas que o Calculador edita (exclui as soControle) — usada
  // pra montar TAXAS_CONFIG em calculador.html sem mudar o formato que o
  // resto do arquivo já espera ({id, label, unit, tipo}).
  function paraCalculador() {
    return TAXAS_OPERACIONAIS
      .filter(t => !t.soControle)
      .map(t => ({
        id: t.id,
        label: t.label,
        unit: t.moeda === 'USD' ? 'US$' : 'R$',
        tipo: t.moeda === 'USD' ? 'usd' : 'fixa',
        base_rateio: t.base_rateio,
      }));
  }

  const TaxasCatalogo = {
    TAXAS_OPERACIONAIS,
    porId,
    paraCalculador,
  };

  // Isomórfico: no browser (calculador.html/controle_v2.html, via
  // <script src>) expõe em window.TaxasCatalogo; no Node (server-side, ex.
  // mapeamento_cotacao_processo.js via require('./taxas-catalogo.js')) expõe
  // via module.exports. Mesma fonte de verdade nos dois ambientes.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaxasCatalogo;
  }
  if (typeof window !== 'undefined') {
    window.TaxasCatalogo = TaxasCatalogo;
  }
})();
