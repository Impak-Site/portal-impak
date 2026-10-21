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
  iguais(padrao.real_json, { fob: 50000, diferenca_pis: 100, diferenca_cofins: 500, diferenca_ipi: 200, diferenca_icms_proprio: 300, icms_st: 7000, diferenca_ibs: 10, diferenca_cbs: 90, reciclagem_fechamento: 1500, lavacao: 505, seguro: 50, adiantamento_porto: 30000, agente_frete: 9000 });
  iguais(padrao.moedas, { fob: 'BRL', seguro: 'BRL', adiantamento_porto: 'BRL', agente_frete: 'BRL' });
});
teste('sem aba MODELO: Adiantamento Porto / Agente Frete entram como valor único, com aviso', () => {
  iguais([padrao.resumo.adiantamento_porto, padrao.resumo.agente_frete], [30000, 9000]);
  iguais([padrao.resumo.pacotes.adiantamento.modo, padrao.resumo.pacotes.agente.modo], ['pacote', 'pacote']);
  ok(padrao.avisos.some(a => /Adiantamento Porto entrou como um valor so .*nao achei os itens dele na aba MODELO/.test(a)), padrao.avisos.join(' | '));
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

// Pacotes item a item pela aba MODELO (20/10/2026, UD26-047): a planilha
// fechada só com Adiantamento Porto / Agente Frete deixava o processo sem
// II, IPI, frete, taxas do agente... e o Fechamento sem ~R$ 96 mil de custo.
// Valores fictícios.
console.log('\n── Fechamento: pacotes abertos item a item pela aba MODELO ──');
const MODELO_FICTICIO = [
  ['', 'CONTAINERS', 1], ['', 'DÓLAR FOB', '', 10000, 5, 50000], ['', 'FRETE', '', 1000, 5, 5000], ['', 'SEGURO', '', 2, 5, 10],
  ['', 'IMP. IMPORTACAO', 0.16, 2000, 5, 10000], ['', 'IPI', 0.01, 200, 5, 1000], ['', 'PIS', 0.03, 300, 5, 1500], ['', 'COFINS', 0.12, 1400, 5, 7000],
  ['', 'ICMS', 0.01, 180, 5, 900], ['', 'IBS', 0.001, 10, 5, 50], ['', 'CBS', 0.009, 90, 5, 450],
  ['', 'TAXA SISCOMEX', '', '', '', 150], ['', 'MARINHA MERCANTE (AFRMM)', '', '', '', 800], ['', 'ARMAZENAGEM', '', '', '', 2000],
  ['', 'SEM ANTIDUMPING', '', '', '', 0], ['', 'EMISSÃO L.Is (Licenças de Importação)', '', 1, 50, 150],
  ['', 'CAPATAZIA (THC - Container)', '', '', '', 1100], ['', 'LIBERAÇÃO DE BL', '', '', '', 600], ['', 'Diferença de FRETE', '', 400, 5, 2000],
  ['', 'Additional Costs', '', 100, 5, 500], ['', 'Import Logistics Fee', '', 32.8, 5, 164], ['', 'TRS - Taxa registro do Siscarga', '', 0, 5, 0],
  ['', 'Drop Off Fee', '', 20, 5, 100], ['', 'ISPS (Destination)', '', 16, 5, 80], ['', 'IOF', '', 35, 5, 175], ['', 'DESCONSOLIDAÇÃO', '', 60, 5, 300],
  ['', 'TAXA - AGENTE CARGA (IMPOSTOS IR/PCC/ISS)', '', '', '', 400], ['', 'DESPACHANTE', '', '', '', 1650],
  ['', 'CUSTO TOTAL', '', '', '', 99999], ['', 'IPI', '', '', '', 88888], // bloco da venda: não é custo de importação
];
function comModelo(bufFech, linhas, nomeAba){
  const wb = XLSX.read(bufFech, { type: 'buffer', cellDates: true });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nomeAba || 'MODELO - COM S.T');
  return pi.importarFechamentoBase(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
}
// Adiantamento = 10000+1000+1500+7000+900+150+800+2000+50 (L.I. sem os R$ 100) = 23400
// Agente = frete 5000 + dif. frete 2000 + 1100+600+500+164+100+80+175+300+400 = 10419
const notaSemNumero = [{ numero: '', valor: 120000, cliente: 'CLIENTE TESTE' }];
const itemizado = comModelo(montarFechamento(notaSemNumero, { valores: { adiantamento: 23400, agente: 10419 } }), MODELO_FICTICIO);
teste('itens da MODELO batem com o pacote: entram item a item (sem o pacote) e o custo é o mesmo da planilha', () => {
  const r = itemizado.real_json;
  iguais([r.ii, r.ipi, r.pis, r.cofins, r.icms, r.siscomex, r.marinha, r.armazenagem, r.emissao_li], [10000, 1000, 1500, 7000, 900, 150, 800, 2000, 50]);
  iguais([r.capatazia, r.liberacao_bl, r.additional_costs, r.import_logistics, r.drop_off, r.isps, r.iof, r.desconsolidacao, r.agente], [1100, 600, 500, 164, 100, 80, 175, 300, 400]);
  ok(!('adiantamento_porto' in r) && !('agente_frete' in r), 'pacote e itens nunca juntos');
  ok(!('trs' in r) && !('antidumping' in r) && !('despachante' in r), 'linha zerada ou fora do pacote não entra');
  iguais([itemizado.resumo.pacotes.adiantamento.modo, itemizado.resumo.pacotes.agente.modo], ['itens', 'itens']);
  ok(!itemizado.avisos.some(a => /valor so/.test(a)), itemizado.avisos.join(' | '));
});
teste('diferença de frete entra junto no Frete Internacional; IBS/CBS da importação vão como crédito', () => {
  iguais(itemizado.real_json.frete, 7000);
  iguais(itemizado.resumo.pacotes.agente.partes.frete.map(p => p.valor), [5000, 2000]);
  iguais([itemizado.real_json.ibs, itemizado.real_json.cbs], [50, 450]);
  iguais(itemizado.moedas.ii, 'BRL'); iguais(itemizado.moedas.frete, 'BRL');
});
teste('emissão de L.I.: usa só a taxa quando o pacote do modelo desconta os R$ 100 por L.I.', () => {
  iguais(itemizado.real_json.emissao_li, 50);
  const cheio = comModelo(montarFechamento(notaSemNumero, { valores: { adiantamento: 23500, agente: 10419 } }), MODELO_FICTICIO);
  iguais(cheio.real_json.emissao_li, 150, 'pacote com a L.I. inteira: usa a L.I. inteira');
});
teste('itens que não batem com o pacote (pacote digitado à mão): entra o valor único, com aviso', () => {
  const r = comModelo(montarFechamento(notaSemNumero, { valores: { adiantamento: 25000, agente: 10419 } }), MODELO_FICTICIO);
  iguais(r.real_json.adiantamento_porto, 25000);
  ok(!('ii' in r.real_json), 'sem itens do pacote que não bateu');
  iguais(r.real_json.frete, 7000, 'o outro pacote bateu e entra item a item');
  ok(r.avisos.some(a => /Adiantamento Porto entrou como um valor so .*nao batem com o Fechamento/.test(a)), r.avisos.join(' | '));
});
teste('aba MODELO - SEM S.T também serve quando é ela que bate', () => {
  const r = comModelo(montarFechamento(notaSemNumero, { valores: { adiantamento: 23400, agente: 10419 } }), MODELO_FICTICIO, 'MODELO - SEM S.T');
  iguais([r.real_json.ii, r.real_json.frete], [10000, 7000]);
});
teste('linha do bloco do agente sem taxa no Controle ("Lift ON / Lift OFF") vai para Custos Diversos; "CRS" é a taxa CRS', () => {
  const modelo = MODELO_FICTICIO.map(l => l.slice());
  const iTrs = modelo.findIndex(l => /^TRS/.test(l[1]));
  modelo.splice(iTrs, 0, ['', 'Lift ON / Lift OFF', '', 50, 5, 250], ['', 'CRS - Container Repair Surcharge', '', 36, 5, 180]);
  const r = comModelo(montarFechamento(notaSemNumero, { valores: { adiantamento: 23400, agente: 10419 + 250 + 180 } }), modelo);
  iguais([r.real_json.custos_diversos, r.real_json.trs], [250, 180]);
  iguais(r.resumo.pacotes.agente.modo, 'itens');
  iguais(r.resumo.pacotes.agente.partes.custos_diversos.map(p => p.rotulo), ['Lift ON / Lift OFF']);
});
teste('diferença de imposto negativa (crédito) entra com sinal; linha de custo estranha ao modelo vai para Custos Diversos com aviso', () => {
  const wb = XLSX.read(montarFechamento(notaSemNumero, { valores: { difCofins: -800 } }), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['Fechamento'];
  const aCom = Object.keys(ws).find(a => /^B\d+$/.test(a) && /^Comissão Chinês/.test(String(ws[a].v)));
  ws[aCom].v = 'Armazenagem'; ws['G' + aCom.slice(1)] = { t: 'n', v: 321.5 };
  const r = pi.importarFechamentoBase(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
  iguais(r.real_json.diferenca_cofins, -800);
  iguais(r.real_json.custos_diversos, 321.5);
  ok(r.avisos.some(a => /Custos Diversos: Armazenagem R\$ 321,5/.test(a)), r.avisos.join(' | '));
});
teste('nota de saída com valor e SEM número entra no resumo (numero null)', () => {
  iguais(itemizado.resumo.notas.map(n => [n.numero, n.valor]), [[null, 120000]]);
});
teste('bloco de notas sem a linha TOTAL não lê pagamento como nota', () => {
  const wb = XLSX.read(montarFechamento([{ numero: '8601', valor: 50000, cliente: 'X' }]), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['Fechamento'];
  Object.keys(ws).filter(a => /^E\d+$/.test(a) && String(ws[a].v).trim().toUpperCase() === 'TOTAL').forEach(a => { ws[a].v = ''; });
  const r = pi.importarFechamentoBase(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
  iguais(r.resumo.notas.map(n => n.valor), [50000]);
});

// Datas automáticas do modelo (17/10/2026): DADOS!E4 "DATA D.I" = HOJE(),
// H6 "DATA EMBARQUE" = E4, H4 "DATA DO PEDIDO" = H6; no Fechamento,
// Embarque = DADOS!H6, Chegada Porto = DADOS!E4, Data Registro D.I = DADOS!E4.
// Enquanto ninguém digita, as três mostram o dia em que a planilha foi salva
// — e entravam no processo como embarque, chegada e registro da DI.
console.log('\n── Fechamento: datas automáticas da planilha (=HOJE(), =E4) ──');
function montarComDatas(dadosCel){
  const UTC = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const wb = XLSX.read(montarFechamento([{ numero: '8531', valor: 240000, cliente: 'CLIENTE A' }]), { type: 'buffer', cellDates: true });
  const dados = XLSX.utils.aoa_to_sheet([['', 'DADOS']]);
  Object.entries(dadosCel).forEach(([addr, c]) => { dados[addr] = { t: 'd', v: UTC(c.v), f: c.f }; if (!c.f) delete dados[addr].f; });
  dados['!ref'] = 'A1:J10';
  XLSX.utils.book_append_sheet(wb, dados, 'DADOS');
  // Fechamento passa a apontar pra aba DADOS, como no modelo de verdade
  const fe = wb.Sheets['Fechamento'];
  Object.keys(fe).filter(a => /^D\d+$/.test(a)).forEach(a => {
    const rotulo = String(fe[a].v || '').trim().toUpperCase();
    const ref = rotulo === 'EMBARQUE' ? 'H6' : /^CHEGADA/.test(rotulo) ? 'E4' : /^DATA DO PEDIDO/.test(rotulo) ? 'H4' : null;
    if (ref) fe['F' + a.slice(1)] = { t: 'd', v: dados[ref].v, f: 'DADOS!' + ref };
  });
  fe['I4'] = { t: 'd', v: dados['E4'].v, f: "'DADOS'!$E$4" };
  return pi.importarFechamentoBase(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
}
teste('planilha com as datas ainda automáticas (=HOJE()): nenhuma data entra no processo, com aviso claro', () => {
  const r = montarComDatas({ E4: { v: '2026-03-10', f: 'TODAY()' }, H6: { v: '2026-03-10', f: 'E4' }, H4: { v: '2026-03-10', f: 'H6' } });
  iguais(r.datas, {});
  const av = r.avisos.find(a => /Nao importei/.test(a)) || '';
  ok(/Embarque \(DADOS!H6 =E4\)/.test(av) && /Chegada \(DADOS!E4 =HOJE\(\)\)/.test(av) && /Registro da D\.I\./.test(av) && /10\/03\/2026/.test(av), av);
  ok(!r.avisos.some(a => /Data do Pedido/.test(a)), 'data do pedido automática não vira aviso de "confira"');
});
teste('Data da D.I. digitada mas embarque ainda copiando (=E4): importa só o registro da DI', () => {
  const r = montarComDatas({ E4: { v: '2026-04-20' }, H6: { v: '2026-04-20', f: 'E4' }, H4: { v: '2026-04-20', f: 'H6' } });
  iguais(r.datas, { data_registro_di: '2026-04-20' });
  ok(r.avisos.some(a => /Nao importei Embarque \(DADOS!H6 =E4\)/.test(a)), r.avisos.join(' | '));
});
teste('datas digitadas na aba DADOS: importa embarque e registro da DI; "Chegada Porto" (= Data da D.I.) não vira chegada', () => {
  const r = montarComDatas({ E4: { v: '2026-04-20' }, H6: { v: '2026-02-25' }, H4: { v: '2026-01-12' } });
  iguais(r.datas, { data_embarque: '2026-02-25', data_registro_di: '2026-04-20' });
  ok(!r.avisos.some(a => /Nao importei/.test(a)));
  ok(r.avisos.some(a => /Chegada nao importada: .*Data da D\.I\. \(DADOS!E4\)/.test(a)), r.avisos.join(' | '));
  ok(r.avisos.some(a => /Data do Pedido na planilha: 2026-01-12/.test(a)));
});

console.log('\n──────────────────────────────────────────────────');

// ── Import do Calculador (DADOS/MODELO) — valores fictícios ──
// Monta uma planilha mínima com DADOS, MIX - COMPLETO e as duas abas MODELO.
function montarModelo(opt){
  opt = opt || {};
  const wb = XLSX.utils.book_new();
  const dados = [];
  const put = (ref, v) => { const c = XLSX.utils.decode_cell(ref); dados[c.r] = dados[c.r] || []; dados[c.r][c.c] = v; };
  put('E3', 5); put('E5', 5.1); put('E6', 10000); put('E7', 0); put('E8', 1000); put('E9', 1); put('E11', 'CAMINHÃO'); put('E12', 'DIVERSOS');
  put('E13', 'SC'); put('E14', 'ENCOMENDA'); put('B15', 'Tem TTD'); put('E15', opt.ttd || 'NÃO'); put('E16', 'NÃO'); put('E17', 'NÃO'); put('E18', 'CLIENTE X');
  put('E20', 'NÃO'); put('E24', 'NÃO'); put('E26', 'NÃO'); put('E28', opt.parcelado ? 'SIM' : 'NÃO'); put('E36', 0);
  if (opt.parcelado) { put('E29', 'SIM'); put('E30', 0.3); put('F31', 0.018); put('F32', '30/60/90dd'); }
  const wsD = XLSX.utils.aoa_to_sheet(dados.map(r => r || []));
  XLSX.utils.book_append_sheet(wb, wsD, 'DADOS');
  const mix = []; for (let i = 0; i < 8; i++) mix.push([]); mix[6][9] = 'Pedido'; mix[7][4] = '295/80R22.5'; mix[7][9] = 10; mix[7][13] = 100;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mix), 'MIX - COMPLETO');
  // MODELO: linha IMP. IMPORTACAO = rotulo | aliquota | USD | cambio | BRL | extra grande (base ST)
  const modelo = (ii, extra) => {
    const m = []; const p = (ref, v) => { const c = XLSX.utils.decode_cell(ref); m[c.r] = m[c.r] || []; m[c.r][c.c] = v; };
    p('E4', 5); p('E5', 5.1); p('B10', 'IMP. IMPORTACAO'); p('C10', 0.16); p('D10', ii / 5.1); p('E10', 5.1); p('F10', ii); if (extra) p('G10', extra);
    p('L11', 1.25); if (opt.parcelado) { p('J48', opt.fixo || 0); p('K47', 123456.78); }
    p('B49', 'TOTAL TAXAS'); p('F49', 20000); p('B50', 'CUSTO TOTAL'); p('F50', 100000);
    return XLSX.utils.aoa_to_sheet(m.map(r => r || []));
  };
  XLSX.utils.book_append_sheet(wb, modelo(8000, 240000), 'MODELO - COM S.T');
  XLSX.utils.book_append_sheet(wb, modelo(7000, null), 'MODELO - SEM S.T');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
teste('DADOS!E15 "Tem TTD": NÃO = tem ICMS ST (lê a aba COM S.T); SIM = sem ST (lê SEM S.T)', () => {
  const a = pi.importarPlanilhaBase(montarModelo({ ttd: 'NÃO' }));
  iguais(a.campos.tem_icms_st, true); iguais(a.campos.ii_planilha_brl, 8000, 'II da aba COM S.T');
  const b = pi.importarPlanilhaBase(montarModelo({ ttd: 'SIM' }));
  iguais(b.campos.tem_icms_st, false); iguais(b.campos.ii_planilha_brl, 7000, 'II da aba SEM S.T');
});
teste('II em R$ é a célula logo após o câmbio, não o maior valor da linha (G10 = base do ST na Rev97)', () => {
  const a = pi.importarPlanilhaBase(montarModelo({ ttd: 'NÃO' }));
  iguais(a.campos.ii_planilha_brl, 8000);
});
teste('parcelado com entrada (E28-F32), juros fixo no boleto (J48) e fator NFe (L11) — Jean 15/10/2026', () => {
  const a = pi.importarPlanilhaBase(montarModelo({ parcelado: true, fixo: 10000 }));
  iguais(a.campos.parcelado, true); iguais(a.campos.parcelado_com_entrada, true);
  iguais(a.campos.parcelado_pct_entrada, 30); iguais(a.campos.parcelado_taxa_am, 1.8); iguais(a.campos.parcelado_prazo, '30/60/90dd');
  iguais(a.campos.juros_boleto_fixo, 10000); iguais(a.campos.fator_nfe, 1.25); iguais(a.campos.total_cliente_planilha, 123456.78);
  const b = pi.importarPlanilhaBase(montarModelo({}));
  iguais(b.campos.parcelado, false); iguais(b.campos.juros_boleto_fixo, undefined);
});

// ── Planilha do despachante: coluna "DATA CI" → Data de Liberação (21/10/2026) ──
// Montada aqui (referências e números fictícios). Na planilha real a DATA CI
// vem como texto com o número de série do Excel ("46258") ou "-" quando ainda
// não houve desembaraço.
function montarDespachante(linhas, cab) {
  const cabecalho = cab || ['PROCESSOS', 'HBL', 'MBL', 'Nº CI', 'CIF USD', 'COMERCIAL', 'DATA CI', 'DEMANDA IMPAK'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cabecalho].concat(linhas), { cellDates: true }), 'EM ANDAMENTO');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
teste('DATA CI: número de série (texto ou número), data de verdade, D/M/AAAA e "-"', () => {
  const p = pi._parseDataCI;
  iguais(p('46258'), '2026-08-24'); iguais(p(46258), '2026-08-24'); iguais(p('46258,75'), '2026-08-24');
  iguais(p(new Date(Date.UTC(2026, 9, 5))), '2026-10-05'); iguais(p(new Date(2026, 9, 5)), '2026-10-05');
  iguais(p('05/10/2026'), '2026-10-05'); iguais(p('5/10/26'), '2026-10-05'); iguais(p('2026-10-05'), '2026-10-05');
  iguais(p('-'), null); iguais(p(''), null); iguais(p(null), null); iguais(p(' — '), null);
  iguais(p('8/24/26'), null, 'mês 24 não existe: não inventa data'); iguais(p('31/02/2026'), null); iguais(p('AGUARDANDO'), null);
  iguais(p(123), null, 'número pequeno não é data');
});
teste('DATA CI: acha a coluna pelo nome (não confunde com Nº CI, CIF ou COMERCIAL)', () => {
  const a = pi._acharColunaDataCI;
  iguais(a(['PROCESSOS', 'Nº CI', 'CIF USD', 'COMERCIAL', 'DATA CI']), 4);
  iguais(a(['PROCESSOS', 'Data da C.I.']), 1); iguais(a(['PROCESSOS', 'DT CI']), 1);
  iguais(a(['PROCESSOS', 'COMPROVANTE DE IMPORTAÇÃO']), 1);
  iguais(a(['PROCESSOS', 'PREVISÃO DATA DESEMBARAÇO', 'DATA DESEMBARAÇO']), 2, 'previsão não conta');
  iguais(a(['PROCESSOS', 'Nº CI', 'CIF', 'COMERCIAL']), -1);
});
teste('planilha do despachante: DATA CI vira data_liberacao; "-" fica sem data; ilegível volta para o relatório', () => {
  const r = pi.importarDespachanteBase(montarDespachante([
    ['TESTE-DESP-1', 'HBLTESTE1', '', 'CI-0001', '1000', '', '46258', ''],
    ['TESTE-DESP-2', 'HBLTESTE2', '', '', '', '', '-', ''],
    ['TESTE-DESP-3', '', '', '', '', '', new Date(Date.UTC(2026, 8, 30)), ''],
    ['TESTE-DESP-4', '', '', '', '', '', 'AGUARDANDO', ''],
  ]));
  iguais(r.tem_data_ci, true);
  iguais(r.linhas.map(l => l.data_liberacao), ['2026-08-24', null, '2026-09-30', null]);
  iguais(r.linhas.map(l => l.data_ci_ilegivel), ['', '', '', 'AGUARDANDO']);
  iguais(r.linhas[0].hbl, 'HBLTESTE1', 'as outras colunas continuam iguais');
});
teste('planilha do despachante sem a coluna DATA CI: nada muda', () => {
  const r = pi.importarDespachanteBase(montarDespachante([['TESTE-DESP-5', 'HBLTESTE5']], ['PROCESSOS', 'HBL']));
  iguais(r.tem_data_ci, false);
  iguais(r.linhas[0].data_liberacao, null); iguais(r.linhas[0].hbl, 'HBLTESTE5');
});

console.log(`Total: ${total} testes, ${passaram} passaram, ${total-passaram} falharam`);
process.exit(passaram===total?0:1);
