// Testes do parser da aba "Fechamento" (planilha-import.js) -- 30/09/2026.
// A planilha de teste e montada aqui mesmo (sem dados reais da empresa), nos
// dois layouts que existem no Dropbox: o padrao (1 nota, sem juros) e o que
// cresce quando ha varias notas vendidas a prazo (linha JUROS embaixo de cada
// nota). Antes do fix por rotulo, o segundo layout deslocava toda a leitura
// 3 linhas para baixo (auditoria #580).
const XLSX = require('xlsx');
const pi = require('./planilha-import.js');
let total = 0, passaram = 0;
function teste(nome, fn){ total++; try { fn(); passaram++; console.log('  ✓ '+nome); } catch(e){ console.log('  ✗ '+nome+'\n      '+e.message); } }
function iguais(a,b,msg){ if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error((msg?msg+' — ':'')+`esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }
function ok(c,msg){ if(!c) throw new Error(msg||'falhou'); }

// Monta a aba Fechamento. `notas` = [{numero, valor, cliente, juros, pct, prazo}].
// Colunas: A B C D E F G H I J K  (indice 0..10)
function montarFechamento(notas, opt){
  opt = opt || {};
  const L = []; // linhas (arrays) — indice 0 = linha 1 da planilha
  const set = (r, col, v) => { L[r-1] = L[r-1] || []; L[r-1]['ABCDEFGHIJK'.indexOf(col)] = v; };
  set(2, 'B', 'REF-TESTE - 00000000000000 - CLIENTE TESTE');
  set(3, 'B', 'FECHAMENTO LIBERAÇÃO CONTAINERS');
  set(4, 'B', 'COMMERCIAL INVOICE'); set(4, 'E', 'REF-TESTE'); set(4, 'G', 'Data Registro D.I'); set(4, 'I', new Date(Date.UTC(2026, 7, 10)));
  set(11, 'G', 'Valor'); set(11, 'H', 'Clientes'); set(11, 'K', 'Data Nfe');
  let r = 12;
  set(r, 'B', 'NOTAS SAIDAS ');
  notas.forEach(function(n){
    set(r, 'E', n.numero); set(r, 'G', n.valor); set(r, 'H', n.cliente); set(r, 'K', new Date(Date.UTC(2026, 7, 12))); r++;
    if (n.juros) { set(r, 'E', 'JUROS'); set(r, 'G', n.juros); set(r, 'H', n.pct || 0.08); set(r, 'I', n.prazo || '30 / 60 / 90 dd'); r++; }
  });
  if (r < 15) r = 15; // layout padrao: TOTAL fica na linha 15 mesmo com 1 nota
  set(r, 'E', 'TOTAL'); set(r, 'G', notas.reduce((s,n)=>s+n.valor+(n.juros||0),0)); r++;
  set(r, 'F', 'Dolar'); set(r, 'G', 'Real'); set(r, 'H', 'TX Dolar'); set(r, 'I', 'Data'); r++;
  const adv = opt.advances || [[10000, 50000, 5.0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  adv.forEach(function(a){ set(r, 'B', a[3] || 'Adance Payment'); set(r, 'F', a[0]); set(r, 'G', a[1]); set(r, 'H', a[2]); r++; });
  r++;
  const v = Object.assign({ adiantamento: 30000, agente: 9000, difPis: 100, difCofins: 500, marj: 0, difIpi: 200, difIcms: 300, icmsSt: 7000, ibs: 10, cbs: 90, comVend: 0, recicl: 1500, lavacao: 505, baixaPatio: 0, comChin: 0, timp: 0, trade: 0, seguroUsd: 10, seguroTx: 5, difSeguro: 400 }, opt.valores || {});
  const linhasB = [
    ['Adiantamento Porto (Liberação)', v.adiantamento], ['Agente Frete', v.agente],
    [notas.some(n => n.juros) ? 'Diferença PIS + JUROS' : 'Diferença PIS', v.difPis], [notas.some(n => n.juros) ? 'Diferença COFINS + JUROS' : 'Diferença COFINS', v.difCofins],
    ['MARJORAÇÃO DE 0,6%', v.marj], ['Diferença IPI', v.difIpi], ['Diferença ICMS Próprio', v.difIcms], ['ICMS Sub. Tributária', v.icmsSt],
    ['IBS', v.ibs], ['CBS', v.cbs], ['Comissão Vendedor', v.comVend], ['Reciclagem', v.recicl], ['Lavação', v.lavacao],
    ['Despesas - Baixa Pátio para Venda/Devolução', v.baixaPatio], ['Comissão Chinês', v.comChin], ['Timp', v.timp], ['Trademaster', v.trade],
  ];
  linhasB.forEach(function(l){ set(r, 'B', l[0]); set(r, 'G', l[1]); r++; });
  set(r, 'B', 'Seguro '); set(r, 'E', v.seguroUsd); set(r, 'F', v.seguroTx); set(r, 'G', v.seguroUsd * v.seguroTx); r++;
  set(r, 'B', 'Dif. de Seguro'); set(r, 'F', v.difSeguro); r += 2;
  set(r, 'B', 'TOTAL'); set(r, 'G', 123456.78); r += 2;
  set(r, 'B', 'LUCRO BRUTO da IMPAK'); set(r, 'F', 'TOTAL'); set(r, 'G', 20000); r += 2;
  set(r, 'E', 'Notas Fiscais BOSS'); set(r, 'G', opt.boss || 0); r += 10;
  set(r, 'E', 'Total a RECEBER'); set(r, 'G', opt.bossLiquido || 0); r += 2;
  set(r, 'B', 'LUCRO BRUTO do PROCESSO'); set(r, 'G', 25000); r += 2;
  set(r, 'D', 'Data do Pedido'); set(r, 'F', new Date(Date.UTC(2026, 3, 22))); r++;
  set(r, 'D', 'Embarque'); set(r, 'F', new Date(Date.UTC(2026, 4, 20))); r++;
  set(r, 'D', 'Chegada Porto'); set(r, 'F', new Date(Date.UTC(2026, 7, 10))); r++;
  for (let i = 0; i < L.length; i++) if (!L[i]) L[i] = [];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L, { cellDates: true }), 'Fechamento');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
}

console.log('\n── Fechamento: layout padrão (1 nota, sem juros) ──');
const padrao = pi.importarFechamentoBase(montarFechamento([{ numero: '8531', valor: 240000, cliente: 'CLIENTE A' }]));
teste('lê cada linha pelo rótulo (valores batem com a planilha)', () => {
  iguais(padrao.real_json, { fob: 50000, diferenca_pis: 100, diferenca_cofins: 500, diferenca_ipi: 200, diferenca_icms_proprio: 300, icms_st: 7000, diferenca_ibs: 10, diferenca_cbs: 90, reciclagem_fechamento: 1500, lavacao: 505, seguro: 50 });
  iguais(padrao.moedas, { fob: 'BRL', seguro: 'BRL' });
});
teste('pacotes (Adiantamento Porto / Agente Frete) ficam só no resumo, fora do real_json', () => {
  iguais([padrao.resumo.adiantamento_porto, padrao.resumo.agente_frete], [30000, 9000]);
  ok(!('adiantamento_porto' in padrao.real_json) && !('agente_frete' in padrao.real_json));
});
teste('datas: registro DI, embarque e chegada', () => {
  iguais(padrao.datas, { data_embarque: '2026-05-20', data_chegada: '2026-08-10', data_registro_di: '2026-08-10' });
  ok(padrao.avisos.some(a => /Data do Pedido na planilha: 2026-04-22/.test(a)));
});
teste('resumo: notas, total, lucro e Boss', () => {
  iguais(padrao.resumo.notas, [{ numero: '8531', valor: 240000, cliente: 'CLIENTE A', data: '2026-08-12', juros: 0, juros_pct: null, prazo: null }]);
  iguais([padrao.resumo.total_notas, padrao.resumo.juros_total, padrao.resumo.total_custos, padrao.resumo.lucro_impak, padrao.resumo.lucro_processo, padrao.resumo.dif_seguro], [240000, 0, 123456.78, 20000, 25000, 400]);
  ok(!padrao.avisos.some(a => /juros/i.test(a)), 'sem aviso de juros quando não há');
});

console.log('\n── Fechamento: 3 notas a prazo (bloco cresce 3 linhas) ──');
const notas3 = [
  { numero: '8645', valor: 101311.19, cliente: 'GOMINHA - MG', juros: 8102.75, pct: 0.08 },
  { numero: '8646', valor: 7718.22, cliente: 'GOMINHA - SC', juros: 674.41, pct: 0.09 },
  { numero: '8647', valor: 163446.51, cliente: 'PNEUGREEN', juros: 14281.81, pct: 0.09 },
];
const prazo = pi.importarFechamentoBase(montarFechamento(notas3, { valores: { icmsSt: 18180.68, recicl: 3162.6, lavacao: 505, difPis: 361.21, difCofins: 2580.41 }, boss: 8174.29, bossLiquido: 6782.21 }));
teste('não desloca: ICMS ST, Reciclagem e Lavação caem nos campos certos (antes viravam Comissão Vendedor / Comissão Chinês / Timp)', () => {
  iguais(prazo.real_json.icms_st, 18180.68);
  iguais(prazo.real_json.reciclagem_fechamento, 3162.6);
  iguais(prazo.real_json.lavacao, 505);
  ok(!prazo.real_json.marjoracao && !prazo.real_json.comissao_vendedor && !prazo.real_json.comissao_china && !prazo.real_json.timp, 'campos zerados na planilha não podem receber valor de outra linha');
  iguais(prazo.real_json.fob, 50000, 'FOB vem das linhas Adance Payment, não de célula fixa');
});
teste('juros por nota + total, com aviso para lançar como venda a prazo', () => {
  iguais(prazo.resumo.notas.map(n => [n.numero, n.juros, n.prazo]), [['8645', 8102.75, '30 / 60 / 90 dd'], ['8646', 674.41, '30 / 60 / 90 dd'], ['8647', 14281.81, '30 / 60 / 90 dd']]);
  iguais(Math.round(prazo.resumo.juros_total * 100) / 100, 23058.97);
  ok(prazo.avisos.some(a => /23058\.97.*3 nota/.test(a)), prazo.avisos.join(' | '));
});
teste('notas Boss (bruto e líquido) no resumo', () => {
  iguais([prazo.resumo.notas_boss, prazo.resumo.boss_liquido], [8174.29, 6782.21]);
});
teste('Credit Note (crédito do fornecedor) entra no FOB pago com sinal negativo', () => {
  const r = pi.importarFechamentoBase(montarFechamento([{ numero: '8543', valor: 380595.94, cliente: 'CLIENTE B' }], { advances: [[27693, 142436.18, 5.1434], [-1000, -5143.4, 5.1434, 'Credit Note'], [0, 0, 0], [0, 0, 0]] }));
  iguais(Math.round(r.real_json.fob * 100) / 100, 137292.78);
});
teste('planilha sem aba Fechamento dá erro claro', () => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'DADOS');
  let msg = ''; try { pi.importarFechamentoBase(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); } catch (e) { msg = e.message; }
  ok(/Fechamento/.test(msg), msg);
});
teste('aba Fechamento fora do padrão (sem bloco de notas) avisa em vez de inventar valor', () => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', 'Qualquer coisa'], ['', 'Lavação', '', '', '', '', 450]]), 'Fechamento');
  const r = pi.importarFechamentoBase(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  iguais(r.real_json, { lavacao: 450 });
  ok(r.avisos.some(a => /fora do padrao/i.test(a)));
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Total: ${total} testes, ${passaram} passaram, ${total-passaram} falharam`);
process.exit(passaram===total?0:1);
