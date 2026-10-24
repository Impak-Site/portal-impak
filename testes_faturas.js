// testes_faturas.js — regras puras de faturas-core.js (valores fictícios).
const assert = require('assert');
const F = require('./faturas-core.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nome); }
  catch (e) { falhas++; console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}

console.log('\n── agruparLinhasEmFaturas ──');
const L = (o) => Object.assign({ processo_id: 'p1', referencia: 'UD26-TESTE', moeda: 'BRL', lado: 'pagar' }, o);
teste('mesma empresa + documento + moeda + lado = uma fatura; soma os itens', () => {
  const { faturas, semEmpresa } = F.agruparLinhasEmFaturas([
    L({ taxa: 'liberacao_bl', label: 'Liberação BL', empresa: 'MAERSK', documento: 'FAT 77102', valor: 420 }),
    L({ taxa: 'capatazia', label: 'Capatazia/THC', empresa: 'maersk', documento: 'fat 77102', valor: 10160 }),
    L({ taxa: 'frete', label: 'Frete', empresa: 'AG CARGA', documento: 'INV 1', valor: 4650, moeda: 'USD' }),
    L({ taxa: 'ii', label: 'II', empresa: '', documento: 'DARF', valor: 31204.1 }),
    L({ taxa: 'seguro', label: 'Seguro', empresa: 'SEGURADORA', documento: '', valor: 0 }),
  ]);
  assert.strictEqual(faturas.length, 2);
  const m = faturas.find(f => f.empresa_nome === 'MAERSK');
  assert.strictEqual(m.valor, 10580);
  assert.strictEqual(m.itens.length, 2);
  assert.strictEqual(m.documento, 'FAT 77102');
  const a = faturas.find(f => f.moeda === 'USD');
  assert.strictEqual(a.valor, 4650);
  assert.strictEqual(semEmpresa.length, 1, 'II sem empresa fica de fora (seguro valor 0 nem conta)');
});
teste('mesma empresa, documentos diferentes = faturas separadas; pagar e receber não se misturam', () => {
  const { faturas } = F.agruparLinhasEmFaturas([
    L({ taxa: 'a', label: 'A', empresa: 'DESPACHANTE X', documento: 'NF 10', valor: 100 }),
    L({ taxa: 'b', label: 'B', empresa: 'DESPACHANTE X', documento: 'NF 11', valor: 200 }),
    L({ taxa: 'c_cobrado', label: 'C', empresa: 'DESPACHANTE X', documento: 'NF 10', valor: 50, lado: 'receber' }),
  ]);
  assert.strictEqual(faturas.length, 3);
  assert.deepStrictEqual(faturas.map(f => f.tipo).sort(), ['pagar', 'pagar', 'receber']);
});
teste('linha já com data de pagamento → fatura nasce com pago_em; empresa_id propaga', () => {
  const { faturas } = F.agruparLinhasEmFaturas([
    L({ taxa: 'a', label: 'A', empresa: 'TERMINAL', empresa_id: null, documento: 'X', valor: 10 }),
    L({ taxa: 'b', label: 'B', empresa: 'TERMINAL', empresa_id: 'c-term', documento: 'X', valor: 20, pago_em: '2026-10-01' }),
  ]);
  assert.strictEqual(faturas.length, 1);
  assert.strictEqual(faturas[0].empresa_id, 'c-term');
  assert.strictEqual(faturas[0].pago_em, '2026-10-01');
});

console.log('\n── validarFatura ──');
teste('valor vem da soma dos itens quando não informado; pago_em vira status paga', () => {
  const v = F.validarFatura({ tipo: 'pagar', empresa_nome: ' MAERSK ', moeda: 'BRL', itens: [{ taxa: 'a', label: 'A', valor: '10.5' }, { taxa: 'b', valor: 20 }], pago_em: '2026-10-02' });
  assert.ok(v.ok);
  assert.strictEqual(v.fatura.valor, 30.5);
  assert.strictEqual(v.fatura.status, 'paga');
  assert.strictEqual(v.fatura.valor_pago, 30.5);
  assert.strictEqual(v.fatura.empresa_nome, 'MAERSK');
});
teste('rejeita tipo inválido, sem empresa e valor zero', () => {
  assert.strictEqual(F.validarFatura({ tipo: 'x', empresa_nome: 'A', valor: 1 }).ok, false);
  assert.strictEqual(F.validarFatura({ tipo: 'pagar', empresa_nome: '', valor: 1 }).ok, false);
  assert.strictEqual(F.validarFatura({ tipo: 'pagar', empresa_nome: 'A', valor: 0, itens: [] }).ok, false);
});
teste('moeda desconhecida cai pra BRL; status cancelada é preservado; datas inválidas viram null', () => {
  const v = F.validarFatura({ tipo: 'receber', empresa_nome: 'CLIENTE', moeda: 'XXX', valor: 5, status: 'cancelada', vencimento: '14/10/2026' });
  assert.ok(v.ok);
  assert.strictEqual(v.fatura.moeda, 'BRL');
  assert.strictEqual(v.fatura.status, 'cancelada');
  assert.strictEqual(v.fatura.vencimento, null);
});

teste('proximoNumero: sequencial por ano NNNNNN/AA', () => {
  assert.strictEqual(F.proximoNumero(null, 2026), '000001/26');
  assert.strictEqual(F.proximoNumero('000041/26', 2026), '000042/26');
  assert.strictEqual(F.proximoNumero('000999/25', 2026), '000001/26', 'virada de ano recomeça');
});
teste('validarFatura: câmbio informado fica; BRL vale 1; USD sem câmbio fica null', () => {
  assert.strictEqual(F.validarFatura({ tipo: 'pagar', empresa_nome: 'A', valor: 1, moeda: 'USD', cambio: '5,1' }).fatura.cambio, 5.1, 'aceita vírgula');
  assert.strictEqual(F.validarFatura({ tipo: 'pagar', empresa_nome: 'A', valor: 1, moeda: 'USD', cambio: 5.1 }).fatura.cambio, 5.1);
  assert.strictEqual(F.validarFatura({ tipo: 'pagar', empresa_nome: 'A', valor: 1 }).fatura.cambio, 1);
});

console.log('\n── situacao / resumoFaturas ──');
const hoje = '2026-10-14';
const lista = [
  { tipo: 'pagar', status: 'aberta', moeda: 'BRL', valor: 100, vencimento: '2026-10-10' },      // vencida
  { tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 10, vencimento: '2026-10-14' },       // hoje
  { tipo: 'pagar', status: 'aberta', moeda: 'BRL', valor: 50, vencimento: '2026-10-20' },       // semana
  { tipo: 'receber', status: 'aberta', moeda: 'BRL', valor: 300, vencimento: null },            // sem venc.
  { tipo: 'receber', status: 'aberta', moeda: 'BRL', valor: 40, vencimento: '2026-09-30' },     // vencida
  { tipo: 'pagar', status: 'paga', moeda: 'BRL', valor: 70, pago_em: '2026-10-03' },
  { tipo: 'receber', status: 'paga', moeda: 'BRL', valor: 90, pago_em: '2026-09-28' },           // mês passado
  { tipo: 'pagar', status: 'cancelada', moeda: 'BRL', valor: 999, vencimento: '2026-10-01' },
];
teste('situacao classifica vencida / hoje / semana / a_vencer / sem_vencimento / paga / cancelada', () => {
  assert.deepStrictEqual(lista.map(f => F.situacao(f, hoje)), ['vencida', 'hoje', 'semana', 'sem_vencimento', 'vencida', 'paga', 'paga', 'cancelada']);
  assert.strictEqual(F.situacao({ status: 'aberta', vencimento: '2026-12-01' }, hoje), 'a_vencer');
});
teste('resumo converte USD pelo câmbio, ignora canceladas e conta pago/recebido só do mês', () => {
  const r = F.resumoFaturas(lista, hoje, { USD: 5 });
  assert.strictEqual(r.pagar_aberto, 200);     // 100 + 10*5 + 50
  assert.strictEqual(r.pagar_vencido, 100);
  assert.strictEqual(r.receber_aberto, 340);
  assert.strictEqual(r.receber_vencido, 40);
  assert.strictEqual(r.pago_mes, 70);
  assert.strictEqual(r.recebido_mes, 0);
  assert.strictEqual(r.qtd_aberta, 5);
  assert.strictEqual(r.qtd_vencida, 2);
});


console.log('\n── IA: taxa por descrição / processo por pista ──');
teste('taxaPorDescricao reconhece as linhas comuns das faturas de armador/agente/despachante', () => {
  assert.strictEqual(F.taxaPorDescricao('FRETE MARITIMO - FCL'), 'frete');
  assert.strictEqual(F.taxaPorDescricao('LIBERAÇÃO DE BL'), 'liberacao_bl');
  assert.strictEqual(F.taxaPorDescricao('DESCONSOLIDAÇAO'), 'desconsolidacao');
  assert.strictEqual(F.taxaPorDescricao('THC DESTINO'), 'capatazia');
  assert.strictEqual(F.taxaPorDescricao('TERMINAL SECURITY CHARGE'), 'tsc', 'TSC é taxa própria (o catálogo tem "TSC - Terminal Sec. Charge")');
  assert.strictEqual(F.taxaPorDescricao('ISPS - TERMINAL'), 'isps');
  assert.strictEqual(F.taxaPorDescricao('EQUIPMENT LOGISTIC FEE'), 'import_logistics');
  // nota de débito do agente (22/10/2026): Costs at Origin = Additional Costs, Container Logistics Fee = CRS, Bunker = frete
  assert.strictEqual(F.taxaPorDescricao('Costs at Origin'), 'additional_costs');
  assert.strictEqual(F.taxaPorDescricao('Additional Costs'), 'additional_costs');
  assert.strictEqual(F.taxaPorDescricao('Container Logistics Fee'), 'trs');
  assert.strictEqual(F.taxaPorDescricao('Import Logistics Fee'), 'import_logistics', 'continua na linha própria');
  assert.strictEqual(F.taxaPorDescricao('Bunker of Origin'), 'frete');
  assert.strictEqual(F.taxaPorDescricao('Ocean Freight (carrier fees included)'), 'frete');
  assert.strictEqual(F.taxaPorDescricao('Honorários despachante'), 'despachante');
  assert.strictEqual(F.taxaPorDescricao('LOW WATER SURCHARGE'), null);
  assert.strictEqual(F.taxaPorDescricao(''), null);
});
teste('acharProcesso casa por referência, HBL ou container (ignora caixa/espaços)', () => {
  const ps = [{ id: 'a', referencia: 'UD26-TESTE', hbl: 'HBLX12345' }, { id: 'b', referencia: 'OUTRO-1', containers_json: JSON.stringify([{ numero: 'MSKU 1234567' }]) }];
  assert.strictEqual(F.acharProcesso(['hblx12345'], ps).id, 'a');
  assert.strictEqual(F.acharProcesso(['MSKU1234567'], ps).id, 'b');
  assert.strictEqual(F.acharProcesso(['ud26-teste'], ps).id, 'a');
  assert.strictEqual(F.acharProcesso(['abc'], ps), null, 'pista curta demais não casa');
});
teste('acharProcesso: pista com o rótulo junto ("Ref. Importador: X", "HBL Y") ainda acha o processo', () => {
  const ps = [{ id: 'a', referencia: 'TST2601-1', hbl: 'HBLT0000001' }, { id: 'b', referencia: 'QWE2602-9', containers_json: JSON.stringify([{ numero: 'ABCU1234567' }]) }];
  assert.strictEqual(F.acharProcesso(['Ref. Importador: TST2601-1'], ps).id, 'a');
  assert.strictEqual(F.acharProcesso(['Conhecimento: HBLT0000001'], ps).id, 'a');
  assert.strictEqual(F.acharProcesso(['Container ABCU1234567'], ps).id, 'b');
  assert.strictEqual(F.acharProcesso(['Navio EVER TESTE', 'Origem QINGDAO / Destino ITAJAI'], ps), null, 'palavras sem número não viram pista');
});
teste('acharProcesso: referência com ou sem o prefixo IMPAK- é o mesmo processo (19/10/2026)', () => {
  const ps = [{ id: 'a', referencia: 'IMPAK-TST2601A-1' }, { id: 'b', referencia: 'QWE2602-9' }];
  assert.strictEqual(F.acharProcesso(['TST2601A-1'], ps).id, 'a', 'documento sem o prefixo, Controle com');
  assert.strictEqual(F.acharProcesso(['IMPAK-QWE2602-9'], ps).id, 'b', 'documento com o prefixo, Controle sem');
  assert.strictEqual(F.acharProcesso(['IMPAKQWE2602-9'], ps), null, 'prefixo colado no resto não é cortado');
  assert.strictEqual(F.acharProcesso(['IMPAK COMERCIAL IMPORTADORA'], ps), null, 'nome da empresa não vira processo');
});

console.log('\n── alerta / fluxo de caixa ──');
teste('faturasParaAlerta: vencidas e as que vencem em até 3 dias, só abertas', () => {
  const r = F.faturasParaAlerta([
    { status: 'aberta', vencimento: '2026-10-10' }, { status: 'aberta', vencimento: '2026-10-14' },
    { status: 'aberta', vencimento: '2026-10-17' }, { status: 'aberta', vencimento: '2026-10-18' },
    { status: 'paga', vencimento: '2026-10-01' }, { status: 'aberta', vencimento: null },
  ], '2026-10-14', 3);
  assert.deepStrictEqual(r.vencidas.map(f => f.vencimento), ['2026-10-10']);
  assert.deepStrictEqual(r.proximas.map(f => f.vencimento), ['2026-10-14', '2026-10-17']);
});
teste('fluxoMensalFaturas: pagas pelo pago_em, abertas pelo vencimento, vencidas caem no mês corrente', () => {
  const r = F.fluxoMensalFaturas([
    { tipo: 'pagar', status: 'paga', moeda: 'BRL', valor: 100, valor_pago: 90, pago_em: '2026-10-02' },
    { tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 10, cambio: 5, vencimento: '2026-09-20' },
    { tipo: 'pagar', status: 'aberta', moeda: 'BRL', valor: 40, vencimento: '2026-11-05' },
    { tipo: 'receber', status: 'aberta', moeda: 'BRL', valor: 300, vencimento: '2026-11-10' },
    { tipo: 'receber', status: 'aberta', moeda: 'BRL', valor: 7, vencimento: null },
    { tipo: 'pagar', status: 'cancelada', moeda: 'BRL', valor: 999, vencimento: '2026-10-20' },
  ], ['2026-10', '2026-11'], '2026-10-14', { USD: 5.5 });
  assert.strictEqual(r.meses['2026-10'].pagar_pago, 90);
  assert.strictEqual(r.meses['2026-10'].pagar_previsto, 50, 'USD 10 × câmbio da fatura (5), vencida em set → out');
  assert.strictEqual(r.meses['2026-11'].pagar_previsto, 40);
  assert.strictEqual(r.meses['2026-11'].receber_previsto, 300);
  assert.strictEqual(r.semVencimento.receber, 7);
});

console.log('\n── conferirFatura (cross-check com o sistema) ──');
const PROC = {
  p1: { id: 'p1', referencia: 'UD26-TESTE', fechado: false, cancelado: false,
    real_json: { capatazia: { valor: 1500, moeda: 'BRL' }, frete: { porContainer: { C1: { valor: 1000, moeda: 'USD' }, C2: { valor: 1000, moeda: 'USD' } } },
      _meta: { capatazia: { para: 'TERMINAL EXEMPLO LTDA' }, liberacao_bl: { fatura_id: 'fx' } } },
    estimativa_json: { custos_cotados_json: { taxas_fixas: { despachante: 1000 } } } },
};
const FAT = o => Object.assign({ tipo: 'pagar', empresa_nome: 'Terminal Exemplo', documento: '7781', moeda: 'BRL', valor: 1500, itens: [] }, o);
const nivelDe = (r, re) => (r.checks.find(c => re.test(c.msg)) || {}).nivel;
teste('valor igual ao lançado → ok; soma bate', () => {
  const r = F.conferirFatura(FAT({ itens: [{ processo_id: 'p1', referencia: 'UD26-TESTE', taxa: 'capatazia', valor: 1500 }] }), PROC, [], { hoje: '2026-10-14' });
  assert.strictEqual(r.resumo.erro, 0); assert.strictEqual(r.resumo.aviso, 0);
  assert.strictEqual(nivelDe(r, /bate com o lançado/), 'ok');
});
teste('valor diferente do lançado → aviso (até 5%) / erro (acima)', () => {
  const r1 = F.conferirFatura(FAT({ valor: 1550, itens: [{ processo_id: 'p1', taxa: 'capatazia', valor: 1550 }] }), PROC, [], {});
  assert.strictEqual(nivelDe(r1, /sistema R\$/), 'aviso');
  const r2 = F.conferirFatura(FAT({ valor: 1800, itens: [{ processo_id: 'p1', taxa: 'capatazia', valor: 1800 }] }), PROC, [], {});
  assert.strictEqual(nivelDe(r2, /sistema R\$/), 'erro');
});
teste('documento já lançado pela mesma empresa → erro de duplicidade', () => {
  const r = F.conferirFatura(FAT({}), PROC, [{ id: 'a', numero: '000010/26', documento: 'Nº 7781', empresa_nome: 'TERMINAL EXEMPLO', status: 'aberta' }], {});
  assert.strictEqual(nivelDe(r, /já está lançado/), 'erro');
  const r2 = F.conferirFatura(FAT({}), PROC, [{ id: 'a', documento: '7781', empresa_nome: 'OUTRA EMPRESA', status: 'aberta' }], {});
  assert.strictEqual(nivelDe(r2, /ainda não foi lançado/), 'ok', 'outra empresa com o mesmo nº não é duplicidade');
  const r3 = F.conferirFatura(FAT({}), PROC, [{ id: 'a', documento: '7781', empresa_nome: 'Terminal Exemplo', status: 'cancelada' }], {});
  assert.strictEqual(nivelDe(r3, /ainda não foi lançado/), 'ok', 'cancelada não conta');
});
teste('taxa já em outra fatura → erro; pagar para diferente → aviso', () => {
  const r = F.conferirFatura(FAT({ empresa_nome: 'Despachante Exemplo', valor: 2000, itens: [
    { processo_id: 'p1', taxa: 'liberacao_bl', valor: 500 }, { processo_id: 'p1', taxa: 'capatazia', valor: 1500 }] }), PROC,
    [{ id: 'fx', numero: '000005/26', status: 'aberta' }], {});
  assert.strictEqual(nivelDe(r, /já está na fatura 000005\/26/), 'erro');
  assert.strictEqual(nivelDe(r, /pagar para TERMINAL/), 'aviso');
});
teste('moedas diferentes convertem pelo câmbio; sem lançamento compara com cotado', () => {
  const r = F.conferirFatura(FAT({ moeda: 'USD', cambio: 5, valor: 2000, itens: [{ processo_id: 'p1', taxa: 'frete', valor: 2000 }] }), PROC, [], {});
  assert.strictEqual(nivelDe(r, /bate com o lançado/), 'ok', 'US$ 2.000 = 2 containers × US$ 1.000');
  const r2 = F.conferirFatura(FAT({ valor: 1200, itens: [{ processo_id: 'p1', taxa: 'despachante', valor: 1200 }] }), PROC, [], {});
  assert.strictEqual(nivelDe(r2, /Cotado R\$/), 'aviso', '+20% acima do cotado');
});
teste('soma das linhas diferente do total e sem processo → avisos', () => {
  const r = F.conferirFatura(FAT({ valor: 2000, itens: [{ taxa: 'capatazia', valor: 1500 }] }), PROC, [], {});
  assert.strictEqual(nivelDe(r, /não bate com o total/), 'aviso');
  assert.strictEqual(nivelDe(r, /sem processo vinculado/), 'aviso');
});

console.log('\n── baixas (pagamentos parciais), estorno e sugestão por comprovante ──');
teste('duas baixas parciais quitam a fatura; estorno reabre', () => {
  const f = { valor: 1000, status: 'aberta', pagamentos: [{ id: 'a', data: '2026-10-01', valor: 400 }] };
  let r = F.aplicarPagamentos(f);
  assert.deepStrictEqual([r.status, r.valor_pago, r.saldo, r.pago_em], ['aberta', 400, 600, null]);
  f.pagamentos.push({ id: 'b', data: '2026-10-05', valor: 600 });
  r = F.aplicarPagamentos(f);
  assert.deepStrictEqual([r.status, r.valor_pago, r.saldo, r.pago_em], ['paga', 1000, 0, '2026-10-05']);
  f.pagamentos[1].estornado = { motivo: 'teste' };
  r = F.aplicarPagamentos(f);
  assert.deepStrictEqual([r.status, r.valor_pago, r.saldo], ['aberta', 400, 600]);
});
teste('fatura antiga paga sem lista de pagamentos continua paga', () => {
  const r = F.aplicarPagamentos({ valor: 500, status: 'paga', valor_pago: 480, pago_em: '2026-09-10' });
  assert.deepStrictEqual([r.status, r.valor_pago, r.pago_em], ['paga', 480, '2026-09-10']);
});
teste('validarPagamento: data, valor, pago a mais, fatura quitada/cancelada', () => {
  const f = { valor: 1000, status: 'aberta', valor_pago: 400 };
  assert.strictEqual(F.validarPagamento({ valor: 100 }, f).ok, false, 'sem data');
  assert.strictEqual(F.validarPagamento({ data: '2026-10-10', valor: 0 }, f).ok, false);
  const v = F.validarPagamento({ data: '10/10/2026', valor: '1.200,50', forma: 'pix' }, f);
  assert.strictEqual(v.ok, true); assert.strictEqual(v.pagamento.valor, 1200.5); assert.ok(v.aviso, 'pago a mais avisa');
  assert.strictEqual(F.validarPagamento({ data: '2026-10-10', valor: 1 }, { valor: 1, status: 'paga' }).ok, false);
  assert.strictEqual(F.validarPagamento({ data: '2026-10-10', valor: 1 }, { valor: 1, status: 'cancelada' }).ok, false);
});
teste('resumo e fluxo usam o saldo e lançam a parcial no mês pago', () => {
  const f = { tipo: 'pagar', moeda: 'BRL', valor: 1000, status: 'aberta', valor_pago: 400, vencimento: '2026-11-10', pagamentos: [{ data: '2026-10-03', valor: 400 }] };
  const r = F.resumoFaturas([f], '2026-10-14', {});
  assert.strictEqual(r.pagar_aberto, 600); assert.strictEqual(r.pago_mes, 400);
  const fl = F.fluxoMensalFaturas([f], ['2026-10', '2026-11'], '2026-10-14', {});
  assert.strictEqual(fl.meses['2026-10'].pagar_pago, 400); assert.strictEqual(fl.meses['2026-11'].pagar_previsto, 600);
});
teste('comprovante sugere a fatura pelo valor + empresa', () => {
  const abertas = [
    { id: 'x', status: 'aberta', empresa_nome: 'Terminal Exemplo Ltda', documento: '7781', valor: 1950, moeda: 'BRL' },
    { id: 'y', status: 'aberta', empresa_nome: 'Outra Empresa', documento: '55', valor: 1950, moeda: 'BRL' },
    { id: 'z', status: 'aberta', empresa_nome: 'Terminal Exemplo', documento: '9', valor: 300, moeda: 'BRL' },
  ];
  const s = F.sugerirFaturasParaComprovante({ valor: 1950, favorecido: 'TERMINAL EXEMPLO LTDA' }, abertas);
  assert.strictEqual(s[0].id, 'x'); assert.ok(s.length >= 2);
});

console.log('\n── juros, desconto, retenções, câmbio, lote ──');
teste('retenções e desconto abatem o saldo; juros não', () => {
  const f = { valor: 1000, status: 'aberta', moeda: 'BRL', pagamentos: [{ data: '2026-10-10', valor: 900, retencoes: { irrf: 15, pis: 6.5, cofins: 30, csll: 10 }, desconto: 38.5, juros: 5 }] };
  const r = F.aplicarPagamentos(f);
  assert.strictEqual(r.status, 'paga'); assert.strictEqual(r.valor_pago, 1000); assert.strictEqual(r.juros, 5); assert.strictEqual(r.retencoes, 61.5);
  assert.strictEqual(F.caixaBrlPagamento(f.pagamentos[0], f), 905, 'saída de caixa = valor + juros');
  const darf = F.darfRetencoes(f.pagamentos[0]);
  assert.deepStrictEqual(darf, { valor: 61.5, vencimento: '2026-11-20' });
  assert.deepStrictEqual(F.darfRetencoes({ data: '2026-12-05', retencoes: { irrf: 1 } }).vencimento, '2027-01-20');
});
teste('fatura em US$: câmbio efetivo → R$ pago e variação cambial', () => {
  const f = { valor: 1000, status: 'aberta', moeda: 'USD', cambio: 5 };
  const v = F.validarPagamento({ data: '2026-10-10', valor: '1.000,00', cambio_efetivo: '5,20' }, f);
  assert.strictEqual(v.ok, true); assert.strictEqual(v.pagamento.pago_brl, 5200); assert.strictEqual(v.pagamento.cambio_efetivo, 5.2);
  assert.strictEqual(F.variacaoCambial(v.pagamento, f), 200);
  const v2 = F.validarPagamento({ data: '2026-10-10', valor: 1000, pago_brl: '5.100,00' }, f);
  assert.strictEqual(v2.pagamento.cambio_efetivo, 5.1);
  assert.strictEqual(F.caixaBrlPagamento(v2.pagamento, f), 5100);
  assert.ok(F.validarPagamento({ data: '2026-10-10', valor: 10 }, f).aviso, 'sem câmbio avisa');
});
teste('baixa só com retenção/desconto (sem dinheiro) é aceita', () => {
  const v = F.validarPagamento({ data: '2026-10-10', valor: 0, desconto: 50 }, { valor: 50, status: 'aberta', moeda: 'BRL' });
  assert.strictEqual(v.ok, true);
});
teste('distribuirLote preenche os saldos na ordem e mostra sobra', () => {
  const r = F.distribuirLote(1500, [{ id: 'a', status: 'aberta', valor: 1000 }, { id: 'b', status: 'aberta', valor: 800, valor_pago: 300 }]);
  assert.deepStrictEqual(r, [{ id: 'a', valor: 1000 }, { id: 'b', valor: 500 }]);
  const r2 = F.distribuirLote(2000, [{ id: 'a', status: 'aberta', valor: 1000 }]);
  assert.deepStrictEqual(r2[1], { id: null, sobra: 1000 });
});

console.log('\n── extrato bancário ──');
const OFX = `OFXHEADER:100
<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261014100000[-3:BRT]<TRNAMT>-1950.00<FITID>ABC123<NAME>PIX TERMINAL EXEMPLO<MEMO>NF 7781</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261013<TRNAMT>5000.00<FITID>XYZ9<MEMO>TED CLIENTE TESTE</STMTTRN>
</BANKTRANLIST></OFX>`;
teste('parseOFX lê débito e crédito', () => {
  const t = F.parseOFX(OFX);
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual([t[0].data, t[0].valor, t[0].tipo, t[0].id], ['2026-10-14', 1950, 'debito', 'ABC123']);
  assert.strictEqual(t[1].tipo, 'credito');
});
teste('parseExtratoCSV com débito/crédito ou valor com sinal', () => {
  const a = F.parseExtratoCSV('Data;Histórico;Valor\n14/10/2026;PIX TERMINAL;-1.950,00\n13/10/2026;TED CLIENTE;5.000,00');
  assert.deepStrictEqual(a.map(x => [x.data, x.valor, x.tipo]), [['2026-10-14', 1950, 'debito'], ['2026-10-13', 5000, 'credito']]);
  const b = F.parseExtratoCSV('Data;Descrição;Débito;Crédito\n14/10/2026;PIX;1.950,00;\n13/10/2026;TED;;5.000,00');
  assert.deepStrictEqual(b.map(x => x.tipo), ['debito', 'credito']);
});
teste('conciliarExtrato sugere a fatura certa', () => {
  const t = F.parseOFX(OFX);
  const ab = [
    { id: 'x', tipo: 'pagar', status: 'aberta', moeda: 'BRL', empresa_nome: 'Terminal Exemplo Ltda', documento: '7781', valor: 1950, vencimento: '2026-10-15' },
    { id: 'y', tipo: 'pagar', status: 'aberta', moeda: 'BRL', empresa_nome: 'Outra', documento: '1', valor: 1950, vencimento: '2026-12-01' },
    { id: 'z', tipo: 'receber', status: 'aberta', moeda: 'BRL', empresa_nome: 'Cliente Teste', valor: 5000, vencimento: '2026-10-13' },
  ];
  const c = F.conciliarExtrato(t, ab);
  assert.strictEqual(c[0].sugerida, 'x'); assert.strictEqual(c[1].sugerida, 'z');
  assert.strictEqual(c[0].chave, 'EXT:ABC123');
});

console.log('\n── a receber das parcelas de câmbio e das vendas ──');
teste('receberDoProcesso gera parcelas fechadas e vendas, sem repetir as já criadas', () => {
  const p = { id: 'p1', referencia: 'UD26-TESTE', cliente: 'Cliente Teste',
    pi_parcelas_json: [{ label: 'Inicial', valor_usd: 1000, cambio_fechado: 5.1, data_fechamento_cambio: '2026-10-01' }, { label: 'Final', valor_usd: 2000, cambio_fechado: '' }],
    vendas_json: [{ cliente: 'Cliente Teste', nf_saida_numero: '123', nf_saida_valor: 20000, nf_saida_data: '2026-10-10', forma_pagamento: 'prazo', prazo_texto: '30 dias' }] };
  const r = F.receberDoProcesso(p, []);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].valor, 5100); assert.strictEqual(r[1].vencimento, '2026-11-09');
  const r2 = F.receberDoProcesso(p, [F.chaveOrigem(r[0].origem)]);
  assert.strictEqual(r2.length, 1);
});

console.log('\n── filtro jsonb "contém" (itens / pagamentos) ──');
teste('filtroJsonbContem devolve uma lista JSON com o objeto', () => {
  assert.strictEqual(F.filtroJsonbContem({ processo_id: 'p1' }), '[{"processo_id":"p1"}]');
  assert.deepStrictEqual(JSON.parse(F.filtroJsonbContem({ identificador: 'AUT-TESTE-1' })), [{ identificador: 'AUT-TESTE-1' }]);
});
teste('no supabase-js o filtro vira cs.[{...}] (jsonb) — o array cru virava cs.{[object Object]}', () => {
  let PostgrestClient;
  try { ({ PostgrestClient } = require('@supabase/postgrest-js')); } catch (e) { return; } // sem node_modules: pula
  const c = new PostgrestClient('http://exemplo.invalid/rest/v1');
  const bom = c.from('faturas').select('id').contains('itens', F.filtroJsonbContem({ processo_id: 'p1' }));
  assert.strictEqual(bom.url.searchParams.get('itens'), 'cs.[{"processo_id":"p1"}]');
  const ruim = c.from('faturas').select('id').contains('itens', [{ processo_id: 'p1' }]);
  assert.strictEqual(ruim.url.searchParams.get('itens'), 'cs.{[object Object]}', 'o formato antigo (bug) continua inválido');
});
teste('server.js não usa mais .contains() com array de objetos em itens/pagamentos', () => {
  const src = ['server.js', 'lib/rotas-faturas.js'].map(f => require('fs').readFileSync(require('path').join(__dirname, f), 'utf8')).join('\n') /* faturas saíram para lib/rotas-faturas.js (24/10/2026) */;
  const ruins = src.match(/\.contains\(\s*'(itens|pagamentos)'\s*,\s*\[/g) || [];
  assert.strictEqual(ruins.length, 0, 'achou: ' + ruins.join(' | '));
  assert.ok((src.match(/filtroJsonbContem\(/g) || []).length >= 5, 'as 5 buscas usam o filtro novo');
});

console.log('\n── Custos Reais: documento de custo lido pela IA (19/10/2026, valores fictícios) ──');
teste('taxaPorDescricao: linhas da nota de débito do agente de carga', () => {
  const casos = {
    'Ocean Freight (carrier fees included)': 'frete', 'THC at Destination': 'capatazia', 'BL Fee (Destination)': 'liberacao_bl',
    'ISPS (Destination)': 'isps', 'Drop Off Fee': 'drop_off', 'Deconsolidation Tax': 'desconsolidacao', 'Import Logistics Fee': 'import_logistics',
    'Additional Costs': 'additional_costs', 'IOF': 'iof', 'Impostos (IR/PCC/ISS)': 'agente', 'TSC - Terminal Security Charge': 'tsc',
    'Destination Terminal Security Charge - 1 40HC': 'tsc', 'Taxa de Desconsolidação - 1 House Bill(s)': 'desconsolidacao',
    'Imposto sobre Operações Financeiras (IOF) - 0,38%': 'iof', 'Destination Terminal Handling Charges - 1 40HC': 'capatazia',
  };
  Object.entries(casos).forEach(([d, id]) => assert.strictEqual(F.taxaPorDescricao(d), id, d));
  assert.strictEqual(F.taxaPorDescricao('IR Retido'), null, 'retenção não é taxa');
});
teste('taxaPorDescricao: linhas do faturamento do despachante (tributos, licenças, armazenagem)', () => {
  const casos = {
    'II': 'ii', 'I.I.': 'ii', 'IMP. IMPORTACAO': 'ii', 'Imposto de Importação': 'ii', 'IPI': 'ipi', 'PIS': 'pis', 'COFINS': 'cofins', 'ICMS': 'icms', 'ICMS/SP': 'icms',
    'TAXA SISCOMEX': 'siscomex', 'MARINHA MERCANTE': 'marinha', 'AFRMM': 'marinha', 'ARMAZENAGEM (PORTO TESTE)': 'armazenagem', 'ARMAZENAGEM + LEVANTE': 'armazenagem',
    'LICENÇAS DE IMPORTAÇÃO (3 LPCOs)': 'emissao_li', 'LICENÇAS DE IMPORTAÇÃO - INMETRO': 'emissao_li', 'TAXA LPCO': 'emissao_li', "EMISSÃO DE LI's": 'emissao_li',
    'DIREITOS ANTIDUMPING': 'antidumping', 'MARJORAÇÃO DE 0,8%': 'marjoracao', 'LAVAÇÃO DE CONTAINER (TSTU0000001)': 'lavacao',
  };
  Object.entries(casos).forEach(([d, id]) => assert.strictEqual(F.taxaPorDescricao(d), id, d));
  assert.strictEqual(F.taxaPorDescricao('HANDLING AVULSA (SAÍDA) + PIS/COFINS:9,25% + ISS 5%'), 'handling', 'PIS/COFINS dentro da descrição de outra taxa não vira PIS');
  assert.strictEqual(F.taxaPorDescricao('PIS/COFINS'), null, 'PIS e COFINS juntos: a pessoa escolhe');
  assert.strictEqual(F.taxaPorDescricao('FRETE RODOVIÁRIO'), null, 'frete rodoviário não é o frete internacional');
  assert.strictEqual(F.taxaPorDescricao('Import Logistics Fee'), 'import_logistics', '"Import" não vira Imposto de Importação');
});

const NOTA_AGENTE = {
  tipo_documento: 'nota_debito_agente', emitente: 'AGENTE TESTE LTDA', documento: 'ND 9001', taxa_cambio_usd: 5.0,
  linhas: [
    { descricao: 'Ocean Freight (carrier fees included)', moeda: 'USD', valor: 1000, valor_brl: 5000 },
    { descricao: 'THC at Destination', moeda: 'BRL', valor: 900, valor_brl: 900 },
    { descricao: 'ISPS (Destination)', moeda: 'USD', valor: 10, valor_brl: 50 },
    { descricao: 'Drop Off Fee', moeda: 'USD', valor: 20, valor_brl: 100 },
    { descricao: 'Deconsolidation Tax', moeda: 'USD', valor: 50, valor_brl: 250 },
    { descricao: 'Additional Costs', moeda: 'USD', valor: 80, valor_brl: 400 },
    { descricao: 'IOF', moeda: 'USD', valor: 3.8, valor_brl: 19 },
    { descricao: 'Impostos (IR/PCC/ISS)', moeda: 'BRL', valor: 300, valor_brl: 300 },
    { descricao: 'IR Retido', moeda: 'BRL', valor: -25, valor_brl: -25 },
    { descricao: 'Total da Fatura', moeda: 'BRL', valor: 6994, valor_brl: 6994 },
  ],
  total_brl: 6994, pistas_processo: ['TST2601-1', 'HBLTESTE001'],
};
teste('linhasCustoDocumento: nota de débito do agente — valor em R$ impresso, IR retido e total de fora, soma confere', () => {
  const r = F.linhasCustoDocumento(NOTA_AGENTE, {});
  assert.strictEqual(r.tipo, 'nota_debito_agente');
  assert.strictEqual(r.linhas.length, 8, 'IR retido e Total da Fatura não são linhas de custo');
  assert.deepStrictEqual(r.linhas.map(l => l.taxa), ['frete', 'capatazia', 'isps', 'drop_off', 'desconsolidacao', 'additional_costs', 'iof', 'agente']);
  assert.strictEqual(r.linhas.find(l => l.taxa === 'isps').valor_brl, 50, 'ISPS no valor em R$ do documento (US$ 10)');
  assert.strictEqual(r.linhas.find(l => l.taxa === 'drop_off').valor_brl, 100);
  assert.strictEqual(r.ir_retido_brl, 25);
  assert.strictEqual(r.soma_brl, 7019);
  assert.strictEqual(r.confere, true, 'soma das linhas = total a pagar + IR retido');
  assert.strictEqual(r.fora.length, 2);
});
teste('linhasCustoDocumento: faturamento do despachante — base do CIF, total e adiantamento ficam de fora; saldo informado', () => {
  const r = F.linhasCustoDocumento({
    tipo_documento: 'acerto_despachante', emitente: 'DESPACHANTE TESTE',
    linhas: [
      { descricao: 'VALOR MLE', moeda: 'USD', valor: 20000, valor_brl: 100000 }, { descricao: 'VALOR FRETE', moeda: 'USD', valor: 1000, valor_brl: 5000 },
      { descricao: 'TAXA CE PREPAID', moeda: 'USD', valor: 100, valor_brl: 500 }, { descricao: 'SEGURO', moeda: 'USD', valor: 10, valor_brl: 50 },
      { descricao: 'II', moeda: 'BRL', valor: 12000, valor_brl: 12000 }, { descricao: 'IPI', moeda: 'BRL', valor: 3000, valor_brl: 3000 },
      { descricao: 'PIS', moeda: 'BRL', valor: 2000, valor_brl: 2000 }, { descricao: 'COFINS', moeda: 'BRL', valor: 9000, valor_brl: 9000 },
      { descricao: 'TAXA SISCOMEX', moeda: 'BRL', valor: 150, valor_brl: 150 }, { descricao: 'MARINHA MERCANTE', moeda: 'BRL', valor: 400, valor_brl: 400 },
      { descricao: 'ICMS', moeda: 'BRL', valor: 1500, valor_brl: 1500 }, { descricao: 'ARMAZENAGEM (PORTO TESTE)', moeda: 'BRL', valor: 1800, valor_brl: 1800 },
      { descricao: 'TOTAL DESPESAS ADUANEIRAS', moeda: 'BRL', valor: 29850, valor_brl: 29850 },
      { descricao: 'ADIANTAMENTO NUMERÁRIO EM 01/09/2026', moeda: 'BRL', valor: 30000, valor_brl: 30000 },
    ],
    total_brl: 29850, adiantamento_brl: 30000, saldo_brl: 150, saldo_a_favor: 'importadora',
  }, {});
  assert.deepStrictEqual(r.linhas.map(l => l.taxa), ['ii', 'ipi', 'pis', 'cofins', 'siscomex', 'marinha', 'icms', 'armazenagem']);
  assert.strictEqual(r.fora.length, 6, 'MLE, frete, taxa CE, seguro (base do CIF), total e adiantamento');
  assert.strictEqual(r.soma_brl, 29850);
  assert.strictEqual(r.confere, true);
  assert.strictEqual(r.saldo_brl, 150);
  assert.strictEqual(r.saldo_a_favor, 'importadora');
});
teste('linhasCustoDocumento: sem valor em R$ usa o câmbio do documento, depois o do processo; sem câmbio não inventa', () => {
  const doc = c => ({ tipo_documento: 'nota_debito_agente', taxa_cambio_usd: c, linhas: [{ descricao: 'Drop Off Fee', moeda: 'USD', valor: 20 }], total_brl: 0 });
  assert.strictEqual(F.linhasCustoDocumento(doc(5.5), {}).linhas[0].valor_brl, 110);
  assert.strictEqual(F.linhasCustoDocumento(doc(0), { cambio: { USD: 5.25 } }).linhas[0].valor_brl, 105);
  const sem = F.linhasCustoDocumento(doc(0), {});
  assert.strictEqual(sem.linhas[0].valor_brl, null);
  assert.strictEqual(sem.sem_brl, 1);
  assert.strictEqual(sem.confere, null);
});
teste('linhasCustoDocumento: fatura do terminal — pesagem, levante e handling entram na Armazenagem', () => {
  const r = F.linhasCustoDocumento({ tipo_documento: 'fatura_terminal', linhas: [
    { descricao: 'ARMAZENAGEM IMP', moeda: 'BRL', valor: 1000, valor_brl: 1000 }, { descricao: 'PESAGEM LC CH', moeda: 'BRL', valor: 100, valor_brl: 100 },
    { descricao: 'LEVANTE IMP', moeda: 'BRL', valor: 300, valor_brl: 300 }, { descricao: 'HANDLING AVULSA CNTR', moeda: 'BRL', valor: 200, valor_brl: 200 },
  ], total_brl: 1600 }, {});
  assert.deepStrictEqual(r.linhas.map(l => l.taxa), ['armazenagem', 'armazenagem', 'armazenagem', 'armazenagem']);
  assert.strictEqual(r.confere, true);
});
teste('linhasCustoDocumento: taxa fora da lista da aba vira "sem taxa" (a pessoa escolhe)', () => {
  const r = F.linhasCustoDocumento({ linhas: [{ descricao: 'Seguro RC', moeda: 'BRL', valor: 40, valor_brl: 40 }] }, { ids: ['frete', 'isps'] });
  assert.strictEqual(r.linhas[0].taxa, null);
  assert.strictEqual(r.linhas[0].usar, false);
});
teste('planoCustosDocumento: vazio/cotado preenche, centavos = igual, lançado diferente fica (a pessoa escolhe), linhas da mesma taxa somam', () => {
  const linhas = [
    { descricao: 'THC', taxa: 'capatazia', valor_brl: 900, usar: true }, { descricao: 'THC extra', taxa: 'capatazia', valor_brl: 100, usar: true },
    { descricao: 'ISPS', taxa: 'isps', valor_brl: 50, usar: true }, { descricao: 'II', taxa: 'ii', valor_brl: 12000.01, usar: true },
    { descricao: 'IPI', taxa: 'ipi', valor_brl: 3000, usar: true }, { descricao: 'PIS', taxa: 'pis', valor_brl: 2000, usar: true },
    { descricao: 'Drop Off', taxa: 'drop_off', valor_brl: 100, usar: true }, { descricao: 'Ignorada', taxa: 'iof', valor_brl: 19, usar: false },
    { descricao: 'Frete', taxa: 'frete', valor_brl: 5000, usar: true }, { descricao: 'LPCO', taxa: 'emissao_li', valor_brl: 800, usar: true },
  ];
  const atuais = {
    capatazia: { valor: 850, origem: null, prefill: true },            // só o cotado pré-preenchido
    ii: { valor: 12000, origem: 'DUIMP' },                              // 1 centavo de diferença
    ipi: { valor: 2900, origem: 'digitado' },                           // alguém digitou
    pis: { valor: 2100, origem: 'DUIMP' },                              // outro documento
    drop_off: { valor: 50, origem: 'fatura do agente' },                // o mesmo tipo de documento, lido de novo
    frete: { valor: 4800, origem: 'cotado' },                           // "usar cotado" (estimativa)
    emissao_li: { valor: 2300, origem: null },                          // pode somar mais de um documento
  };
  const { itens } = F.planoCustosDocumento(linhas, atuais, { labels: { capatazia: 'Capatazia/THC' }, origem: 'fatura do agente' });
  const por = Object.fromEntries(itens.map(i => [i.id, i]));
  assert.strictEqual(por.capatazia.valor, 1000, 'duas linhas de THC somam');
  assert.strictEqual(por.capatazia.acao, 'preencher', 'cotado pré-preenchido conta como vazio');
  assert.strictEqual(por.capatazia.label, 'Capatazia/THC');
  assert.strictEqual(por.isps.acao, 'preencher');
  assert.strictEqual(por.ii.acao, 'igual', 'DUIMP × faturamento com 1 centavo de diferença: mantém');
  assert.strictEqual(por.ipi.acao, 'manter', 'valor digitado à mão: o padrão é manter');
  assert.strictEqual(por.pis.acao, 'manter', 'veio de outro documento: a pessoa escolhe');
  assert.strictEqual(por.emissao_li.acao, 'manter', 'lançado maior que o documento pode somar outra cobrança — não troca sozinho');
  assert.strictEqual(por.emissao_li.soma, 3100, 'oferece somar os dois');
  assert.strictEqual(por.drop_off.acao, 'substituir', 'mesmo tipo de documento lido de novo: troca');
  assert.strictEqual(por.drop_off.diferenca, 50);
  assert.strictEqual(por.frete.acao, 'substituir', 'o lançado era só o cotado: troca pelo real');
  assert.ok(!por.iof, 'linha desmarcada não entra');
});
teste('planoCustosDocumento: pacote lançado (Agente Frete) é avisado quando as linhas são taxas de dentro dele', () => {
  const pacotes = [{ id: 'agente_frete', nome: 'Agente Frete (fatura do agente de carga)', itens: ['frete', 'isps', 'drop_off'], valor: 7000 },
    { id: 'adiantamento_porto', nome: 'Adiantamento Porto', itens: ['ii'], valor: 0 }];
  const r = F.planoCustosDocumento([{ descricao: 'Frete', taxa: 'frete', valor_brl: 5000, usar: true }, { descricao: 'ISPS', taxa: 'isps', valor_brl: 50, usar: true }], {}, { pacotes });
  assert.strictEqual(r.pacotes.length, 1, 'só o pacote com valor e com taxas do documento');
  assert.strictEqual(r.pacotes[0].id, 'agente_frete');
  assert.deepStrictEqual(r.pacotes[0].itens, ['frete', 'isps']);
});
teste('planoCustosDocumento: linha sem valor em R$ vai na moeda dela; moedas misturadas sem R$ não entram', () => {
  const r1 = F.planoCustosDocumento([{ descricao: 'ISPS', taxa: 'isps', moeda: 'USD', valor: 10, valor_brl: null, usar: true }], {});
  assert.strictEqual(r1.itens[0].moeda, 'USD');
  assert.strictEqual(r1.itens[0].valor, 10);
  assert.strictEqual(r1.itens[0].acao, 'preencher');
  const r2 = F.planoCustosDocumento([{ descricao: 'A', taxa: 'handling', moeda: 'USD', valor: 10, valor_brl: null, usar: true }, { descricao: 'B', taxa: 'handling', moeda: 'EUR', valor: 5, valor_brl: null, usar: true }], {});
  assert.strictEqual(r2.itens[0].acao, 'ignorar');
  assert.ok(r2.itens[0].erro);
});
teste('servidor: leitura em modo custos usa o prompt próprio (linhas com valor em R$, IR retido, saldo)', () => {
  const src = ['server.js', 'lib/rotas-faturas.js'].map(f => require('fs').readFileSync(require('path').join(__dirname, f), 'utf8')).join('\n') /* faturas saíram para lib/rotas-faturas.js (24/10/2026) */;
  assert.ok(/const PROMPT_LER_CUSTOS = `/.test(src));
  assert.ok(/modo === 'custos'/.test(src));
  ['ir_retido_brl', 'valor_brl', 'saldo_a_favor', 'acerto_despachante', 'nota_debito_agente', 'fatura_terminal'].forEach(k => assert.ok(src.indexOf(k) > 0, k));
});
teste('Faturas: fatura em R$ com linhas em US$ usa o valor em reais de cada linha (ftMontarDaIA)', () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = { FaturasCore: F, _processos: [{ id: 'p1', referencia: 'TST2601-1' }], esc: s => String(s == null ? '' : s), console,
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] }, window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'controle-faturas.js'), 'utf8'), ctx, { filename: 'controle-faturas.js' });
  const f = vm.runInContext('ftMontarDaIA', ctx)({ moeda: 'BRL', emitente: 'AGENTE TESTE', valor_total: 1050, pistas_processo: ['TST2601-1'], itens: [
    { descricao: 'Ocean Freight', moeda: 'USD', valor: 200, valor_brl: 1000 }, { descricao: 'ISPS (Destination)', moeda: 'USD', valor: 10, valor_brl: 50 },
  ] }, 'nd-teste.pdf');
  assert.deepStrictEqual(f.itens.map(i => i.valor), [1000, 50]);
  assert.deepStrictEqual(f.itens.map(i => i.taxa), ['frete', 'isps']);
  assert.strictEqual(f.itens[0].referencia, 'TST2601-1');
});

console.log('\n── a receber: quem adianta o câmbio e a NF com o valor total (21/10/2026) ──');
const PROC_AR = (o) => Object.assign({ id: 'p9', referencia: 'TST-AR-1', cliente: 'Cliente Ficticio', pi_pagamento: 'PARCELADO',
  pi_parcelas_json: JSON.stringify([{ label: 'Inicial', valor_usd: 1000, cambio_fechado: 5 }, { label: 'Final', valor_usd: 2000, cambio_fechado: '5,5' }]),
  vendas_json: JSON.stringify([{ cliente: 'Cliente Ficticio', nf_saida_numero: '900', nf_saida_valor: 30000, nf_saida_data: '2026-10-10', forma_pagamento: 'prazo', prazo_texto: '30/60/90' }]) }, o);
teste('encomenda: adiantamento de cada câmbio + NF menos os adiantamentos, em 3 parcelas', () => {
  const r = F.receberDoProcesso(PROC_AR({ finalidade: 'ENCOMENDA' }), []);
  const ad = r.filter(x => x.tipo_receber === 'adiantamento'), vd = r.filter(x => x.tipo_receber === 'venda');
  assert.deepStrictEqual(ad.map(x => x.valor), [5000, 11000]);
  assert.strictEqual(vd.length, 3);
  assert.deepStrictEqual(vd.map(x => x.valor), [4666.66, 4666.66, 4666.68]);
  assert.deepStrictEqual(vd.map(x => x.vencimento), ['2026-11-09', '2026-12-09', '2027-01-08']);
  assert.deepStrictEqual(vd.map(x => x.origem.parcela + '/' + x.origem.de), ['1/3', '2/3', '3/3']);
  assert.strictEqual(vd[0].adiantamento_abatido, 16000);
  const soma = r.reduce((s, x) => s + x.valor, 0);
  assert.ok(Math.abs(soma - 30000) < 0.005, 'a soma do a receber é o valor da NF: ' + soma);
});
teste('conta e ordem também abate; importação própria não gera a receber do câmbio; acompanhamento não gera nada', () => {
  assert.strictEqual(F.receberDoProcesso(PROC_AR({ finalidade: 'CONTA_E_ORDEM' }), []).filter(x => x.tipo_receber === 'adiantamento').length, 2);
  const prop = F.receberDoProcesso(PROC_AR({ finalidade: 'IMPORTACAO_DIRETA' }), []);
  assert.ok(prop.every(x => x.tipo_receber === 'venda'));
  assert.deepStrictEqual(prop.map(x => x.valor), [10000, 10000, 10000]);
  assert.deepStrictEqual(F.receberDoProcesso(PROC_AR({ finalidade: 'ACOMPANHAMENTO' }), []), []);
});
teste('adiantamento só abate a venda do encomendante; juros do boleto (fora da NF) entram no a receber', () => {
  const p = PROC_AR({ finalidade: 'ENCOMENDA', vendas_json: [
    { cliente: 'Revenda Exemplo', nf_saida_numero: '901', nf_saida_valor: 2000, nf_saida_data: '2026-10-10' },
    { cliente: 'Cliente Ficticio', nf_saida_numero: '902', nf_saida_valor: 20000, juros_valor: 300, juros_fora_nf: true, nf_saida_data: '2026-10-10' },
    { cliente: 'Cliente Ficticio', nf_saida_numero: '905', nf_saida_valor: 1000, juros_valor: 50, nf_saida_data: '2026-10-10' },
  ] });
  const vd = F.receberDoProcesso(p, []).filter(x => x.tipo_receber === 'venda');
  assert.deepStrictEqual(vd.map(x => x.documento + ':' + x.valor), ['NF 901:2000', 'NF 902:4300', 'NF 905:1000'], 'juros só somam quando estão fora da NF');
});
teste('venda toda coberta pelo adiantamento não gera a receber; remessa (CFOP 5905) não é venda', () => {
  const p = PROC_AR({ finalidade: 'ENCOMENDA', vendas_json: [{ cliente: 'Cliente Ficticio', nf_saida_numero: '903', nf_saida_valor: 16000, nf_saida_data: '2026-10-10' }, { nf_saida_numero: '904', nf_saida_cfop: '5905', nf_saida_valor: 50000, nf_saida_data: '2026-10-10' }] });
  assert.strictEqual(F.receberDoProcesso(p, []).filter(x => x.tipo_receber === 'venda').length, 0);
});
teste('parcela já faturada fica com o valor dela; o resto da venda se divide entre as que faltam', () => {
  const p = PROC_AR({ finalidade: 'IMPORTACAO_DIRETA' });
  const r = F.receberDoProcesso(p, ['venda:p9:0:1'], { valoresOrigem: { 'venda:p9:0:1': 12000 } });
  assert.deepStrictEqual(r.map(x => x.documento + ':' + x.valor), ['NF 900 · parcela 2/3:9000', 'NF 900 · parcela 3/3:9000']);
  assert.deepStrictEqual(F.receberDoProcesso(p, ['venda:p9:0']), [], 'venda com fatura única: não parcela de novo');
});
teste('à vista / a prazo e entrada + saldo também viram adiantamento do cliente (encomenda)', () => {
  const vista = F.receberDoProcesso({ id: 'p8', referencia: 'TST-AR-2', cliente: 'Cliente Ficticio', finalidade: 'ENCOMENDA', pi_pagamento: 'PRAZO', pi_valor_usd: 1000, ci_valor_usd: 1100, pi_cambio_fechado: 5, pi_data_saldo: '2026-11-01', pi_valor_recebido_cliente: 100 }, []);
  assert.deepStrictEqual(vista.map(x => [x.origem.idx, x.valor, x.vencimento, x.ja_recebido]), [[-1, 5500, '2026-11-01', 100]]);
  const es = F.receberDoProcesso({ id: 'p7', referencia: 'TST-AR-3', finalidade: 'ENCOMENDA', pi_pagamento: 'ENTRADA_SALDO', pi_valor_usd: 1000, pi_entrada_pct: 30, pi_cambio_entrada: 5, pi_cambio_saldo: '' }, []);
  assert.deepStrictEqual(es.map(x => [x.origem.idx, x.valor]), [[-2, 1500]], 'saldo sem câmbio fechado ainda não tem valor');
});
teste('parcelas do prazo: dias, datas escritas e prazo que não dá pra entender', () => {
  const venc = (txt, data, forma) => F.parcelasDaVenda({ forma_pagamento: forma || 'prazo', prazo_texto: txt, nf_saida_data: data || '2026-10-10' }, 900).map(x => x.vencimento);
  assert.deepStrictEqual(venc('30 / 60 / 90 DD'), ['2026-11-09', '2026-12-09', '2027-01-08']);
  assert.deepStrictEqual(venc('3 boletos: 17/10, 17/11 e 17/12/2026'), ['2026-10-17', '2026-11-17', '2026-12-17']);
  assert.deepStrictEqual(venc('15/12, 15/01', '2026-12-01'), ['2026-12-15', '2027-01-15'], 'o ano vira quando o mês volta');
  assert.deepStrictEqual(venc('28 DDL'), ['2026-11-07']);
  assert.deepStrictEqual(venc('', '2026-10-10', 'avista'), ['2026-10-10']);
  const inc = F.parcelasDaVenda({ forma_pagamento: 'prazo', prazo_texto: 'a combinar', nf_saida_data: '2026-10-10' }, 900);
  assert.strictEqual(inc.length, 1); assert.strictEqual(inc[0].incerto, true);
  assert.deepStrictEqual(F.parcelasDaVenda({ forma_pagamento: 'parcelado', parcelas: [{ dias: 30, percentual: 40 }, { dias: 60, percentual: 60 }], nf_saida_data: '2026-10-10' }, 1000).map(x => x.valor), [400, 600]);
});
teste('chave e validação da origem com parcela (só venda em 2+ parcelas)', () => {
  assert.strictEqual(F.chaveOrigem({ tipo: 'venda', processo_id: 'p', idx: 0 }), 'venda:p:0');
  assert.strictEqual(F.chaveOrigem({ tipo: 'venda', processo_id: 'p', idx: 0, parcela: 2, de: 3 }), 'venda:p:0:2');
  const v = F.validarFatura({ tipo: 'receber', empresa_nome: 'Cliente Ficticio', valor: 10, origem: { tipo: 'venda', processo_id: 'p', idx: 0, parcela: 2, de: 3 } });
  assert.deepStrictEqual([v.fatura.origem.parcela, v.fatura.origem.de], [2, 3]);
  const w = F.validarFatura({ tipo: 'receber', empresa_nome: 'Cliente Ficticio', valor: 10, origem: { tipo: 'parcela_cambio', processo_id: 'p', idx: -1, parcela: 2, de: 3 } });
  assert.strictEqual(w.fatura.origem.idx, -1); assert.strictEqual(w.fatura.origem.parcela, undefined);
});

console.log('\n── conferência: tipo de cada checagem e diferença de câmbio ──');
teste('diferença pequena em outra moeda é aviso de câmbio (não conta como diferença); grande é de valor', () => {
  const procs = { p1: { id: 'p1', referencia: 'TST-C-1', real_json: { frete: { valor: 5300, moeda: 'BRL' }, handling: { valor: 1040, moeda: 'BRL' } } } };
  const fat = { tipo: 'pagar', empresa_nome: 'Agente Ficticio', documento: 'ND 1', moeda: 'USD', cambio: 5.4, valor: 1200,
    itens: [{ processo_id: 'p1', referencia: 'TST-C-1', taxa: 'frete', valor: 1000 }, { processo_id: 'p1', referencia: 'TST-C-1', taxa: 'handling', valor: 200 }] };
  const r = F.conferirFatura(fat, procs, [], { hoje: '2026-10-21' });
  const frete = r.checks.find(c => c.item === 0 && (c.tipo === 'cambio' || c.tipo === 'valor'));
  assert.strictEqual(frete.tipo, 'cambio', '5.400 × 5.300 (1,9%) é câmbio');
  const hand = r.checks.find(c => c.item === 1 && (c.tipo === 'cambio' || c.tipo === 'valor'));
  assert.strictEqual(hand.tipo, 'valor'); assert.strictEqual(hand.nivel, 'aviso', '1.080 × 1.040 (3,8%): diferença de valor');
  assert.strictEqual(F.divergenciasConferencia({ checks: r.checks }), 1);
  assert.ok(r.checks.every(c => c.tipo), 'toda checagem tem tipo');
});
teste('divergências: erro conta; aviso de cotado/datas não; conferência antiga sem checks usa o resumo', () => {
  assert.strictEqual(F.divergenciasConferencia({ checks: [{ nivel: 'erro', tipo: 'processo' }, { nivel: 'aviso', tipo: 'cotado' }, { nivel: 'aviso', tipo: 'datas' }, { nivel: 'aviso', tipo: 'duplicidade' }] }), 2);
  assert.strictEqual(F.divergenciasConferencia({ resumo: { erro: 3 } }), 3);
  assert.strictEqual(F.divergenciasConferencia(null), 0);
});

console.log('\n── etapas da fatura, parte do processo, selo e extrato ──');
teste('etapa: prevista → recebida → conferida/divergente → aprovada → paga', () => {
  const base = { tipo: 'pagar', status: 'aberta', valor: 100 };
  assert.strictEqual(F.etapaFatura(base), 'prevista');
  assert.strictEqual(F.etapaFatura({ ...base, anexos: [{ tipo: 'fatura' }] }), 'recebida');
  assert.strictEqual(F.etapaFatura({ ...base, anexos: [{ tipo: 'comprovante' }] }), 'prevista', 'comprovante não é o documento da cobrança');
  assert.strictEqual(F.etapaFatura({ ...base, conferencia: { checks: [{ nivel: 'ok', tipo: 'valor' }] } }), 'conferida');
  assert.strictEqual(F.etapaFatura({ ...base, conferencia: { checks: [{ nivel: 'erro', tipo: 'valor' }] } }), 'divergente');
  assert.strictEqual(F.etapaFatura({ ...base, conferencia: { checks: [{ nivel: 'erro', tipo: 'valor' }] }, aprovacao: { por: 'gerente@exemplo.com' } }), 'aprovada');
  assert.strictEqual(F.etapaFatura({ ...base, status: 'paga' }), 'paga');
  assert.strictEqual(F.etapaFatura({ tipo: 'receber', status: 'aberta', valor: 100, valor_pago: 40 }), 'parcial');
  const passos = F.passosFatura({ ...base, anexos: [{ tipo: 'fatura' }], conferencia: { checks: [{ nivel: 'erro', tipo: 'valor' }] } });
  assert.deepStrictEqual(passos.map(x => x.estado), ['feito', 'alerta', 'pendente', 'pendente']);
  assert.deepStrictEqual(F.passosFatura({ ...base, status: 'paga' }).map(x => x.estado), ['pulado', 'pulado', 'pulado', 'feito']);
});
teste('fatura de dois processos entra em cada um só com a parte dele', () => {
  const f = { valor: 1000, itens: [{ processo_id: 'a', referencia: 'TST-A', valor: 750 }, { processo_id: 'b', referencia: 'TST-B', valor: 250 }] };
  assert.deepStrictEqual(F.processosDaFatura(f), ['a', 'b']);
  const pa = F.parteDoProcesso(f, 'a');
  assert.strictEqual(pa.valor, 750); assert.deepStrictEqual(pa.outros, ['TST-B']);
  assert.strictEqual(F.parteDoProcesso(f, 'c').fracao, 0);
  assert.strictEqual(F.parteDoProcesso({ valor: 500, itens: [], origem: { tipo: 'venda', processo_id: 'c', idx: 0 } }, 'c').valor, 500);
});
teste('selo: vermelho (vencida/diferença), amarelo (em aberto), verde (tudo pago), nada sem fatura', () => {
  const res = F.resumoPorProcesso([
    { id: '1', tipo: 'pagar', status: 'aberta', valor: 10, vencimento: '2026-10-01', itens: [{ processo_id: 'x', valor: 10 }] },
    { id: '2', tipo: 'receber', status: 'aberta', valor: 10, vencimento: '2026-12-01', origem: { tipo: 'venda', processo_id: 'y', idx: 0 } },
    { id: '3', tipo: 'pagar', status: 'paga', valor: 10, itens: [{ processo_id: 'z', valor: 10 }] },
    { id: '4', tipo: 'pagar', status: 'cancelada', valor: 10, itens: [{ processo_id: 'w', valor: 10 }] },
    { id: '5', tipo: 'pagar', status: 'aberta', valor: 10, vencimento: '2026-12-01', conferencia: { checks: [{ nivel: 'erro', tipo: 'valor' }] }, itens: [{ processo_id: 'v', valor: 10 }] },
  ], '2026-10-21');
  assert.strictEqual(F.seloProcesso(res.x).nivel, 'erro'); assert.strictEqual(F.seloProcesso(res.x).texto, '1 vencida');
  assert.strictEqual(F.seloProcesso(res.y).nivel, 'aviso');
  assert.strictEqual(F.seloProcesso(res.z).texto, 'Tudo pago');
  assert.strictEqual(res.w, undefined); assert.strictEqual(F.seloProcesso(res.w), null);
  assert.strictEqual(F.seloProcesso(res.v).texto, '1 diferença');
});
teste('extrato: baixas realizadas, saldo previsto no vencimento, parte do processo, compensação fora do caixa', () => {
  const faturas = [
    { id: 'f1', tipo: 'pagar', status: 'aberta', moeda: 'BRL', valor: 1000, valor_pago: 400, vencimento: '2026-11-05', empresa_nome: 'Despachante Ficticio',
      itens: [{ processo_id: 'p', valor: 1000 }], pagamentos: [{ data: '2026-10-10', valor: 400, forma: 'pix' }] },
    { id: 'f2', tipo: 'pagar', status: 'paga', moeda: 'USD', cambio: 5, valor: 100, empresa_nome: 'Agente Ficticio',
      itens: [{ processo_id: 'p', valor: 50 }, { processo_id: 'q', valor: 50 }], pagamentos: [{ data: '2026-10-12', valor: 100, pago_brl: 520, forma: 'cambio' }] },
    { id: 'f3', tipo: 'pagar', status: 'paga', moeda: 'BRL', valor: 300, empresa_nome: 'Despachante Ficticio', itens: [{ processo_id: 'p', valor: 300 }], pagamentos: [{ data: '2026-10-15', valor: 300, forma: 'compensacao' }] },
    { id: 'f4', tipo: 'receber', status: 'cancelada', valor: 999, origem: { processo_id: 'p' } },
  ];
  const outros = [{ data: '2026-10-01', descricao: 'Câmbio ao fornecedor', valor: 5000, sentido: 'saida', realizado: true },
    { data: '2026-10-20', descricao: 'Adiantamento do cliente', valor: 6000, sentido: 'entrada', realizado: true },
    { data: null, descricao: 'Custo sem fatura', valor: 200, sentido: 'saida', realizado: false }];
  const ex = F.extratoProcesso({ processo_id: 'p', faturas, outros }, '2026-10-21', {});
  assert.deepStrictEqual(ex.linhas.map(l => l.data), ['2026-10-01', '2026-10-10', '2026-10-12', '2026-10-15', '2026-10-20', '2026-11-05']);
  assert.strictEqual(ex.linhas[2].valor, 260, 'metade da fatura do agente, pelo que saiu em R$');
  assert.strictEqual(ex.linhas[3].valor, 0); assert.strictEqual(ex.linhas[3].compensacao, true);
  assert.strictEqual(ex.totais.realizado.saidas, 5660); assert.strictEqual(ex.totais.realizado.entradas, 6000);
  assert.strictEqual(ex.totais.realizado.saldo, 340);
  assert.strictEqual(ex.linhas[5].realizado, false); assert.strictEqual(ex.linhas[5].valor, 600);
  assert.strictEqual(ex.totais.saldo_com_previsto, -260);
  assert.strictEqual(ex.sem_data.length, 1); assert.strictEqual(ex.totais.saldo_final, -460);
});

// ── Fase 2 (21/10/2026): aceitar / contestar diferença da conferência ──
teste('decisão: aceita deixa de contar, contestada continua, desfazer volta', () => {
  const checks = [
    { nivel: 'erro', tipo: 'valor', item: 0, msg: 'REF-TESTE · Frete: fatura US$ 1.200,00 × sistema US$ 1.000,00 — diferença +200,00.' },
    { nivel: 'aviso', tipo: 'empresa', item: 1, msg: 'REF-TESTE · THC: no processo está "pagar para Agente A", mas a fatura é de Agente B.' },
    { nivel: 'aviso', tipo: 'datas', item: null, msg: 'Vencimento 01/10/2026 já passou.' },
    { nivel: 'ok', tipo: 'duplicidade', item: null, msg: 'Documento ND-0001 ainda não foi lançado.' },
  ];
  const conf = { em: '2026-10-21T10:00:00Z', checks };
  assert.deepStrictEqual(F.contagemConferencia(conf), { total: 2, aceitas: 0, contestadas: 0, abertas: 2 });
  const kValor = F.chaveCheck(checks[0]), kEmp = F.chaveCheck(checks[1]);
  assert.notStrictEqual(kValor, kEmp);
  assert.strictEqual(F.chaveCheck(checks[0]), kValor, 'chave estável');
  // aceitar sem motivo: recusa
  assert.ok(F.decidirDiferenca(conf, kValor, 'aceita', '  ', {}).erro);
  // checagem que não é diferença (datas) não pode ser decidida
  assert.ok(F.decidirDiferenca(conf, F.chaveCheck(checks[2]), 'aceita', 'x', {}).erro);
  assert.ok(F.decidirDiferenca(conf, kValor, 'ignorar', 'x', {}).erro, 'ação inválida');
  assert.ok(F.decidirDiferenca(null, kValor, 'aceita', 'x', {}).erro, 'sem conferência');
  const r1 = F.decidirDiferenca(conf, kValor, 'aceita', 'Diferença combinada com o fornecedor', { por: 'usuario.teste', nome: 'Usuário Teste', em: '2026-10-21T11:00:00Z' });
  assert.ok(!r1.erro);
  assert.strictEqual(r1.conferencia.divergencias, 1);
  assert.strictEqual(r1.conferencia.decisoes[kValor].acao, 'aceita');
  assert.strictEqual(r1.conferencia.decisoes[kValor].nome, 'Usuário Teste');
  assert.ok(!conf.decisoes, 'não muda a conferência original');
  const r2 = F.decidirDiferenca(r1.conferencia, kEmp, 'contestada', '', { por: 'usuario.teste' });
  assert.deepStrictEqual(F.contagemConferencia(r2.conferencia), { total: 2, aceitas: 1, contestadas: 1, abertas: 0 });
  assert.strictEqual(F.divergenciasConferencia(r2.conferencia), 1, 'contestada ainda conta');
  const f = { tipo: 'pagar', status: 'aberta', anexos: [{ tipo: 'fatura' }], conferencia: r2.conferencia };
  assert.strictEqual(F.etapaFatura(f), 'divergente');
  const ps = F.passosFatura(f).find(x => x.id === 'conferida');
  assert.strictEqual(ps.contestadas, 1); assert.strictEqual(ps.aceitas, 1); assert.strictEqual(ps.estado, 'alerta');
  // aceitando a contestada, a fatura fica conferida e o próximo passo é aprovar
  const r3 = F.decidirDiferenca(r2.conferencia, kEmp, 'aceita', 'Fornecedor corrigiu o cadastro', {});
  assert.strictEqual(F.etapaFatura({ ...f, conferencia: r3.conferencia }), 'conferida');
  assert.strictEqual(F.passosFatura({ ...f, conferencia: r3.conferencia }).find(x => x.id === 'aprovada').estado, 'atual');
  // desfazer
  const r4 = F.decidirDiferenca(r3.conferencia, kValor, '', '', {});
  assert.strictEqual(r4.conferencia.decisoes[kValor], undefined);
  assert.strictEqual(r4.conferencia.divergencias, 1);
  // resumo por processo conta só o que sobrou
  const res = F.resumoPorProcesso([{ id: 'a', tipo: 'pagar', status: 'aberta', valor: 1, itens: [{ processo_id: 'p' }], conferencia: r3.conferencia }], '2026-10-21');
  assert.strictEqual(res.p.divergentes, 0);
});
teste('decisão: conferir de novo mantém a decisão só se a diferença for a mesma', () => {
  const c1 = { nivel: 'erro', tipo: 'valor', item: 0, msg: 'REF-TESTE · Frete: fatura US$ 1.200,00 × sistema US$ 1.000,00 — diferença +200,00.' };
  const c2 = { nivel: 'aviso', tipo: 'soma', item: null, msg: 'Soma das taxas (US$ 1.150,00) não bate com o total do documento (US$ 1.200,00) — diferença US$ 50,00.' };
  let conf = { checks: [c1, c2] };
  conf = F.decidirDiferenca(conf, F.chaveCheck(c1), 'aceita', 'ok', {}).conferencia;
  conf = F.decidirDiferenca(conf, F.chaveCheck(c2), 'contestada', 'pedi correção', {}).conferencia;
  // nova conferência: c1 igual, c2 mudou de valor
  const c2b = { ...c2, msg: 'Soma das taxas (US$ 1.180,00) não bate com o total do documento (US$ 1.200,00) — diferença US$ 20,00.' };
  const nova = { checks: [c1, c2b] };
  const dec = F.mesclarDecisoes(nova, conf);
  assert.deepStrictEqual(Object.keys(dec), [F.chaveCheck(c1)]);
  assert.strictEqual(F.divergenciasConferencia({ ...nova, decisoes: dec }), 1);
  assert.deepStrictEqual(F.mesclarDecisoes(nova, null), {});
  assert.deepStrictEqual(F.mesclarDecisoes(nova, { checks: [] }), {});
  // mesma mensagem em outra linha da fatura = outra diferença
  assert.notStrictEqual(F.chaveCheck({ ...c1, item: 1 }), F.chaveCheck(c1));
});
teste('decisão: texto de contestação pro fornecedor', () => {
  const f = { empresa_nome: 'Agente Ficticio Ltda', documento: 'ND-0001', vencimento: '2026-11-05' };
  const t = F.textoContestacao(f, [
    { msg: 'REF-TESTE · Frete: fatura US$ 1.200,00 × sistema US$ 1.000,00 — diferença +200,00.' },
    { msg: 'REF-TESTE · THC: bate com o lançado no sistema (R$ 500,00).' },
  ], 'REF-TESTE');
  assert.ok(/^Olá, Agente Ficticio Ltda\./.test(t));
  assert.ok(t.includes('ND-0001') && t.includes('REF-TESTE') && t.includes('05/11/2026'));
  assert.ok(t.includes('× esperado US$ 1.000,00'), 'troca "sistema" por "esperado"');
  assert.ok(!/sistema/.test(t), 'não fala em "sistema" pro fornecedor');
  assert.ok(t.includes('estas diferenças'));
  assert.ok(F.textoContestacao({}, [{ msg: 'x' }]).includes('esta diferença'));
});

// ── Fase 2 (21/10/2026): numerário do despachante ──────────────────────
const NUM = { id: 'n1', numero: '000100/26', tipo: 'pagar', status: 'paga', moeda: 'BRL', valor: 10000, valor_pago: 10000, empresa_id: 'desp-1', empresa_nome: 'Despachante Ficticio',
  vencimento: '2026-10-01', origem: { tipo: 'numerario', processo_id: 'p', referencia: 'REF-TESTE' }, itens: [{ processo_id: 'p', valor: 10000 }],
  pagamentos: [{ id: 'pg1', data: '2026-10-01', valor: 10000, forma: 'pix' }] };
const ACERTO = { id: 'a1', numero: '000101/26', tipo: 'pagar', status: 'aberta', moeda: 'BRL', valor: 12500, valor_pago: 0, empresa_id: 'desp-1', empresa_nome: 'Despachante Ficticio',
  vencimento: '2026-10-20', itens: [{ processo_id: 'p', taxa: 'ii', valor: 8000 }, { processo_id: 'p', taxa: 'despachante', valor: 4500 }] };
teste('numerário: validarFatura aceita a origem (R$, a pagar) e a devolução (a receber)', () => {
  const v = F.validarFatura({ tipo: 'pagar', empresa_nome: 'Despachante Ficticio', moeda: 'BRL', valor: 1000, itens: [{ processo_id: 'p', valor: 1000 }], origem: { tipo: 'numerario', processo_id: 'p', referencia: 'REF-TESTE' } });
  assert.ok(v.ok); assert.strictEqual(v.fatura.origem.tipo, 'numerario'); assert.strictEqual(v.fatura.origem.processo_id, 'p');
  assert.ok(!F.validarFatura({ tipo: 'pagar', empresa_nome: 'X', moeda: 'USD', valor: 1, origem: { tipo: 'numerario', processo_id: 'p' } }).ok, 'numerário só em R$');
  assert.ok(!F.validarFatura({ tipo: 'receber', empresa_nome: 'X', valor: 1, origem: { tipo: 'numerario', processo_id: 'p' } }).ok, 'numerário é a pagar');
  assert.ok(!F.validarFatura({ tipo: 'receber', empresa_nome: 'X', valor: 1, origem: { tipo: 'devolucao_numerario', processo_id: 'p' } }).ok, 'devolução precisa do numerário');
  const d = F.validarFatura({ tipo: 'receber', empresa_nome: 'X', valor: 1, origem: { tipo: 'devolucao_numerario', processo_id: 'p', numerario_id: 'n1' } });
  assert.ok(d.ok); assert.strictEqual(d.fatura.origem.numerario_id, 'n1');
  assert.strictEqual(F.chaveOrigem(v.fatura.origem), null, 'numerário não entra no "a receber pendente"');
});
teste('numerário: uso (pago, abatido, devolvido, disponível) e abatimento validado', () => {
  let u = F.usoNumerario(NUM, []);
  assert.deepStrictEqual([u.pago, u.usado, u.devolvido, u.disponivel], [10000, 0, 0, 10000]);
  // não pago ainda: nada a abater
  const aberto = { ...NUM, status: 'aberta', valor_pago: 0, pagamentos: [] };
  assert.strictEqual(F.usoNumerario(aberto, []).a_pagar, 10000);
  assert.ok(/ainda não foi pago/.test(F.validarAbatimentoNumerario(ACERTO, aberto, null, []).erro));
  // abater o máximo: limita ao disponível (10.000), sobra 2.500 do acerto
  const v = F.validarAbatimentoNumerario(ACERTO, NUM, null, []);
  assert.ok(v.ok); assert.strictEqual(v.valor, 10000);
  assert.ok(/só tem R\$ 10000,00/.test(F.validarAbatimentoNumerario(ACERTO, NUM, 10500, []).erro));
  assert.ok(/mesmo despachante/.test(F.validarAbatimentoNumerario({ ...ACERTO, empresa_id: 'outro', empresa_nome: 'Agente Ficticio' }, NUM, null, []).erro));
  assert.ok(/em R\$/.test(F.validarAbatimentoNumerario({ ...ACERTO, moeda: 'USD' }, NUM, null, []).erro));
  assert.ok(F.validarAbatimentoNumerario(ACERTO, ACERTO, null, []).erro, 'precisa ser numerário');
  // depois do abatimento: usado 10.000, nada disponível
  const acertoComp = { ...ACERTO, pagamentos: [{ id: 'c1', data: '2026-10-21', valor: 10000, forma: 'compensacao', compensa: { tipo: 'numerario', fatura_id: 'n1' } }] };
  u = F.usoNumerario(NUM, [acertoComp]);
  assert.deepStrictEqual([u.usado, u.disponivel], [10000, 0]); assert.strictEqual(u.usos[0].fatura_id, 'a1');
  assert.strictEqual(F.aplicarPagamentos(acertoComp).saldo, 2500, 'compensação abate o saldo');
  // estornado ou fatura cancelada: libera o numerário
  assert.strictEqual(F.usoNumerario(NUM, [{ ...acertoComp, pagamentos: [{ ...acertoComp.pagamentos[0], estornado: { em: 'x' } }] }]).disponivel, 10000);
  assert.strictEqual(F.usoNumerario(NUM, [{ ...acertoComp, status: 'cancelada' }]).disponivel, 10000);
  // acerto menor (7.000): sobra 3.000 → devolução
  const menor = { ...ACERTO, valor: 7000, pagamentos: [{ id: 'c2', data: '2026-10-21', valor: 7000, forma: 'compensacao', compensa: { tipo: 'numerario', fatura_id: 'n1' } }] };
  const dev = { id: 'd1', tipo: 'receber', status: 'aberta', valor: 3000, origem: { tipo: 'devolucao_numerario', processo_id: 'p', numerario_id: 'n1' } };
  u = F.usoNumerario(NUM, [menor, dev]);
  assert.deepStrictEqual([u.usado, u.devolvido, u.disponivel], [7000, 3000, 0]);
  assert.strictEqual(F.numerariosComSaldo({ empresa_id: 'desp-1' }, [NUM], [menor]).length, 1);
  assert.strictEqual(F.numerariosComSaldo({ empresa_id: 'desp-1' }, [NUM], [menor, dev]).length, 0);
});
teste('numerário: etapa própria (não se confere taxa a taxa) e aprovação direto', () => {
  const n = { ...NUM, status: 'aberta', valor_pago: 0, pagamentos: [] };
  assert.strictEqual(F.etapaFatura(n), 'numerario');
  const ps = F.passosFatura(n);
  assert.strictEqual(ps.find(x => x.id === 'conferida').estado, 'pulado');
  assert.strictEqual(ps.find(x => x.id === 'aprovada').estado, 'atual');
  assert.strictEqual(F.etapaFatura(NUM), 'paga');
});
teste('numerário: compensação não é caixa (resumo do mês, fluxo, extrato sem dupla contagem)', () => {
  const acertoComp = { ...ACERTO, valor_pago: 12500, status: 'paga', pagamentos: [
    { id: 'c1', data: '2026-10-21', valor: 10000, forma: 'compensacao', compensa: { tipo: 'numerario', fatura_id: 'n1' } },
    { id: 'c3', data: '2026-10-21', valor: 2500, forma: 'pix' }] };
  const r = F.resumoFaturas([NUM, acertoComp], '2026-10-21', {});
  assert.strictEqual(r.pago_mes, 12500, 'saiu 10.000 (numerário) + 2.500 (saldo), não 22.500');
  const fl = F.fluxoMensalFaturas([NUM, acertoComp], ['2026-10'], '2026-10-21', {});
  assert.strictEqual(fl.meses['2026-10'].pagar_pago, 12500);
  const ex = F.extratoProcesso({ processo_id: 'p', faturas: [NUM, acertoComp] }, '2026-10-21', {});
  assert.strictEqual(ex.totais.realizado.saidas, 12500);
  assert.ok(ex.linhas.some(l => /^Numerário/.test(l.descricao)), 'linha do numerário identificada');
  // previsto: acerto em aberto com numerário a abater não sai de novo
  const ex2 = F.extratoProcesso({ processo_id: 'p', faturas: [NUM, ACERTO], abater: { a1: 10000 } }, '2026-10-15', {});
  assert.strictEqual(ex2.totais.saldo_com_previsto, -12500);
  assert.ok(ex2.linhas.some(l => /a abater do numerário/.test(l.descricao)));
});

// ── Fase 2 (21/10/2026): venda no cartão (REDE) / Trademaster ──────────
teste('operadora: taxa da tabela do Calculador (REDE + antecipação; Trademaster) ou a informada', () => {
  assert.ok(Math.abs(F.taxaOperadoraPadrao('cartao', 1) - (0.0291 + 0.018)) < 1e-9);
  assert.ok(Math.abs(F.taxaOperadoraPadrao('cartao', 3) - (0.0327 + 0.036)) < 1e-9);
  assert.ok(Math.abs(F.taxaOperadoraPadrao('trademaster', 6) - 0.0928600832612018) < 1e-12);
  assert.strictEqual(F.taxaOperadoraPadrao('prazo', 2), 0);
  const op = F.operadoraDaVenda({ forma_pagamento: 'cartao', cartao_parcelas: 3 }, 10000);
  assert.strictEqual(op.taxa_valor, 687); assert.strictEqual(op.liquido, 9313); assert.strictEqual(op.dias, 1); assert.strictEqual(op.nome, 'REDE (cartão)');
  const inf = F.operadoraDaVenda({ forma_pagamento: 'trademaster', cartao_parcelas: 2, taxa_operadora_pct: '3,5', dias_recebimento: '2' }, 10000);
  assert.strictEqual(inf.taxa_valor, 350); assert.strictEqual(inf.dias, 2); assert.strictEqual(inf.label, 'Trademaster 2x');
  assert.strictEqual(F.operadoraDaVenda({ forma_pagamento: 'avista' }, 100), null);
});
teste('operadora: a receber da venda no cartão sai contra a operadora, valor cheio, vence em D+1, com a taxa na origem', () => {
  const p = { id: 'p1', referencia: 'REF-TESTE', cliente: 'Cliente Ficticio', finalidade: 'IMPORTACAO_DIRETA',
    vendas_json: JSON.stringify([{ cliente: 'Cliente Ficticio', nf_saida_numero: '123', nf_saida_data: '2026-10-10', nf_saida_valor: '10000', forma_pagamento: 'cartao', cartao_parcelas: 3 }]) };
  const pend = F.receberDoProcesso(p, []);
  assert.strictEqual(pend.length, 1);
  const x = pend[0];
  assert.strictEqual(x.empresa_nome, 'REDE (cartão)'); assert.strictEqual(x.cliente, 'Cliente Ficticio');
  assert.strictEqual(x.valor, 10000); assert.strictEqual(x.vencimento, '2026-10-11');
  assert.strictEqual(x.origem.operadora, 'cartao'); assert.strictEqual(x.origem.taxa_operadora, 687);
  assert.strictEqual(F.chaveOrigem(x.origem), 'venda:p1:0', 'mesma chave de antes (não duplica)');
  assert.strictEqual(F.receberDoProcesso(p, ['venda:p1:0']).length, 0);
  const v = F.validarFatura({ tipo: 'receber', empresa_nome: x.empresa_nome, valor: x.valor, origem: x.origem });
  assert.ok(v.ok); assert.strictEqual(v.fatura.origem.taxa_operadora, 687); assert.strictEqual(v.fatura.origem.operadora, 'cartao');
  // extrato: previsto entra pelo líquido; recebido com a taxa no desconto quita
  const f = { id: 'r1', ...v.fatura, status: 'aberta', valor_pago: 0, vencimento: '2026-10-11', pagamentos: [] };
  const ex = F.extratoProcesso({ processo_id: 'p1', faturas: [f] }, '2026-10-10', {});
  assert.strictEqual(ex.totais.saldo_com_previsto, 9313);
  const pago = { ...f, pagamentos: [{ id: 'x', data: '2026-10-11', valor: 9313, desconto: 687, forma: 'pix' }] };
  assert.strictEqual(F.aplicarPagamentos(pago).status, 'paga');
});

// ── Conferência de fechamento (conferencia-fechamento.js, 22/10/2026) ──
console.log('\n── conferência de fechamento ──');
const CF = require('./conferencia-fechamento.js');
// Processo fictício: DI US$ 10.000 × 5,0000; frete US$ 1.000; câmbio fechado 4,9500
const CUSTOS_CF = { ii: 8000, ipi: 500, pis: 1100, cofins: 5000, siscomex: 150, marinha: 400, icms: 1200, armazenagem: 900,
  frete: 5100, capatazia: 800, iof: 100, agente: 300, isps: 50, liberacao_bl: 250, seguro: 60, lavacao: 300, ibs: 50, cbs: 450 };
const PROC_CF = { di_taxa_cambio: 5, valor_frete: 1000, moeda_frete: 'USD', pi_valor_usd: 10000 };
teste('conferência: débitos por grupo, frete da DI × variação, notas e câmbio DI × fechado', () => {
  const c = CF.montarConferencia({ custos: CUSTOS_CF, processo: PROC_CF, cambiosFechados: [{ usd: 10000, taxa: 4.95 }] });
  const g = id => c.grupos.find(x => x.id === id);
  assert.strictEqual(g('despachante').debito, 17250);
  assert.strictEqual(g('agente').debito, 6600);
  assert.strictEqual(g('seguro').debito, 60);
  assert.strictEqual(g('outros').debito, 300);
  assert.strictEqual(c.total_debitos, 24210, 'IBS/CBS ficam fora (2026: só destaque)');
  assert.deepStrictEqual(c.informativos.map(i => i.taxa), ['ibs', 'cbs']);
  assert.strictEqual(c.frete.frete_di, 5000); assert.strictEqual(c.frete.variacao, 100);
  assert.strictEqual(c.notas.total_nf_importacao, 20210, 'II+IPI+PIS+COFINS+Siscomex+AFRMM + frete DI + seguro');
  assert.strictEqual(c.notas.total_agrega_custo, 2200, 'ICMS + capatazia + IOF + variação do frete');
  assert.strictEqual(c.notas.total_fornecedores, 1800, 'armazenagem + NF do agente (agente+ISPS+liberação) + lavação');
  assert.strictEqual(c.notas.total, c.total_debitos, 'as notas somam os débitos');
  assert.strictEqual(c.cambio.brl_di, 50000); assert.strictEqual(c.cambio.brl_fechado, 49500); assert.strictEqual(c.cambio.variacao, 500);
  assert.strictEqual(c.status, 'sem_creditos');
});
teste('conferência: créditos pelas faturas pagas — numerário, devolução, agente com retenção; compensação não conta', () => {
  const pid = 'p-cf';
  const fat = [
    { id: 'n1', tipo: 'pagar', moeda: 'BRL', valor: 17300, status: 'paga', origem: { tipo: 'numerario', processo_id: pid }, pagamentos: [{ id: 'a', data: '2026-08-01', valor: 17300, forma: 'pix' }] },
    { id: 'd1', tipo: 'receber', moeda: 'BRL', valor: 50, status: 'paga', origem: { tipo: 'devolucao_numerario', processo_id: pid, numerario_id: 'n1' }, pagamentos: [{ id: 'b', data: '2026-08-20', valor: 50, forma: 'pix' }] },
    { id: 'ac', tipo: 'pagar', moeda: 'BRL', valor: 17250, status: 'paga', itens: [{ processo_id: pid, taxa: 'ii', valor: 8000 }, { processo_id: pid, taxa: 'cofins', valor: 9250 }], pagamentos: [{ id: 'c', data: '2026-08-20', valor: 17250, forma: 'compensacao' }] },
    { id: 'ag', tipo: 'pagar', moeda: 'BRL', valor: 6600, status: 'paga', itens: [{ processo_id: pid, taxa: 'frete', valor: 5100 }, { processo_id: pid, taxa: 'capatazia', valor: 1500 }], pagamentos: [{ id: 'd', data: '2026-08-05', valor: 6580, retencoes: 20, forma: 'pix' }] },
    { id: 'sg', tipo: 'pagar', moeda: 'BRL', valor: 60, status: 'aberta', itens: [{ processo_id: pid, taxa: 'seguro', valor: 60 }], pagamentos: [] },
    { id: 'x', tipo: 'pagar', moeda: 'BRL', valor: 999, status: 'cancelada', origem: { tipo: 'numerario', processo_id: pid }, pagamentos: [{ id: 'e', valor: 999 }] },
  ];
  const cr = CF.creditosDasFaturas(fat, pid, {}, F);
  const soma = l => Math.round(l.reduce((s, x) => s + x.valor, 0) * 100) / 100;
  assert.strictEqual(soma(cr.despachante), 17250, 'numerário − devolução; o acerto compensado não conta de novo');
  assert.strictEqual(soma(cr.agente), 6600, 'pago + retenção (IR)');
  assert.strictEqual(cr.seguro.length, 0, 'fatura em aberto não é crédito');
  const c = CF.montarConferencia({ custos: CUSTOS_CF, processo: PROC_CF, creditos: cr, manuais: { seguro: 60, outros: '300' }, cambiosFechados: [{ usd: 10000, taxa: 4.95 }] });
  assert.strictEqual(c.total_creditos, 24210);
  assert.strictEqual(c.diferenca, 0);
  assert.strictEqual(c.status, 'ok');
  assert.strictEqual(c.grupos.find(x => x.id === 'seguro').manual, 60, 'valor digitado (Conexos) vale para o grupo');
});
teste('conferência: diferença acima de R$ 1,00 aparece; câmbio parcial não calcula variação; pacote só sem taxas soltas', () => {
  const c = CF.montarConferencia({ custos: { ii: 1000, adiantamento_porto: 5000 }, processo: { pi_valor_usd: 2000, di_taxa_cambio: 5 }, manuais: { despachante: 990 }, cambiosFechados: [{ usd: 1000, taxa: 5.1 }] });
  assert.strictEqual(c.grupos[0].debito, 1000, 'pacote do despachante não soma com as taxas soltas');
  assert.strictEqual(c.grupos[0].diferenca, -10);
  assert.strictEqual(c.status, 'diferenca');
  assert.strictEqual(c.cambio.variacao, null);
  assert.ok(c.pendencias.some(p => /não fechado/.test(p)));
  const so = CF.montarConferencia({ custos: { adiantamento_porto: 5000 }, processo: {} });
  assert.strictEqual(so.grupos[0].debito, 5000);
  assert.strictEqual(CF.grupoDaTaxa('frete_cobrado'), 'agente');
  assert.strictEqual(CF.grupoDaTaxa('fob'), null);
});

console.log(`\n──────────────────────────────────────────────────\nTotal: ${ok + falhas} testes, ${ok} passaram, ${falhas} falharam`);
if (falhas) process.exit(1);
