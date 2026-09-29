// lib/filtro-tv.js — o que a conta só-leitura da TV recebe de cada processo.
//
// Relatório de segurança (item 10): a TV não recebe valores financeiros.
// MAS ela calcula estoque (No Chão/Armazém, cor dos Processos do Mês) com
// estoqueDoProcesso()/temRemessaEstoque() (controle-core.js), que precisam
// dos dados NÃO financeiros das vendas. Em 29/09/2026 a TV mostrava 53
// processos no Armazém e o PC 40, porque este filtro cortava nº/CFOP/itens
// das NFs de saída. testes_controle.js ("TV = PC") garante que o estoque
// calculado com o processo filtrado é IGUAL ao do processo completo — se
// alguém mexer aqui (ou o cálculo de estoque passar a usar outro campo),
// o teste quebra antes de ir pro ar.
'use strict';

const CAMPOS_FINANCEIROS_PROCESSO = ['pi_valor_usd','ci_valor_usd','pi_parcelas_json','pi_cambio','pi_cambio_entrada','pi_cambio_saldo',
  'pi_cambio_fechado','pi_cambio_custo','pi_cambio_banco','pi_valor_recebido_cliente','real_json','real_cambio','estimativa_json',
  'custos_cotados_json','nf_entrada_valor','nf_saida_valor','valor_frete','demurrage_valor'];
function removerCamposFinanceiros(p) {
  CAMPOS_FINANCEIROS_PROCESSO.forEach(k => { delete p[k]; });
  if (typeof p.vendas_json === 'string') {
    try {
      const vendas = JSON.parse(p.vendas_json);
      // A TV precisa dos dados NÃO financeiros de cada venda pra calcular o
      // estoque (No Chão/Armazém e a cor dos Processos do Mês): nº/data/CFOP
      // da NF de saída e os itens (descrição + quantidade). Antes só ia
      // cliente+nf_numero, então na TV nenhuma venda "baixava" estoque e os
      // números ficavam diferentes do PC (Ayslan 29/09/2026). Valores (R$,
      // preço, juros, forma de pagamento) continuam fora.
      if (Array.isArray(vendas)) p.vendas_json = JSON.stringify(vendas.map(v => v ? ({
        cliente: v.cliente, nf_numero: v.nf_numero,
        nf_saida_numero: v.nf_saida_numero, nf_saida_data: v.nf_saida_data, nf_saida_cfop: v.nf_saida_cfop,
        itens: Array.isArray(v.itens) ? v.itens.map(it => it ? ({ descricao: it.descricao, quantidade: it.quantidade }) : it) : v.itens,
      }) : v));
    } catch (e) { delete p.vendas_json; }
  }
}


module.exports = { CAMPOS_FINANCEIROS_PROCESSO, removerCamposFinanceiros };
