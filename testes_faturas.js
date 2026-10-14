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

console.log(`\n──────────────────────────────────────────────────\nTotal: ${ok + falhas} testes, ${ok} passaram, ${falhas} falharam`);
if (falhas) process.exit(1);
