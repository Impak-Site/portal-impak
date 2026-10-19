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
  const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
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
  const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
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

console.log(`\n──────────────────────────────────────────────────\nTotal: ${ok + falhas} testes, ${ok} passaram, ${falhas} falharam`);
if (falhas) process.exit(1);
