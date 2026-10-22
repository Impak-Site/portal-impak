// testes_verificacao.js — verificação diária dos dados (verificacao-dados.js)
// e as tarefas D01–D05 da Agenda. Valores e nomes fictícios (repositório público).
const assert = require('assert');
const VD = require('./verificacao-dados.js');
const DP = require('./duimp-parcelas.js');
const A = require('./agenda-core.js');
const AgendaServidor = require('./agenda-servidor.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nome); }
  catch (e) { falhas++; console.log('  ✗ ' + nome + '\n      ' + e.message); }
}
const codigos = p => VD.pendenciasDados(p).map(x => x.codigo);

console.log('\n── verificação diária: dados para conferir ──');
teste('processo em ordem não gera pendência', () => {
  assert.deepStrictEqual(codigos({ id: 'v1', referencia: 'TESTE-V-1', fase: 'EMBARCADO', hbl: 'HBLTESTE01', mbl: 'MBLTESTE01',
    ce_master: '111111111111111', ce_house: '222222222222222', pi_valor_usd: 10000, ci_valor_usd: 10200 }), []);
});
teste('D01 HBL igual ao MBL e D02 CE Master igual ao CE House (ignora espaços e pontuação)', () => {
  assert.deepStrictEqual(codigos({ hbl: 'ABC 123', mbl: 'abc-123' }), ['D01']);
  assert.deepStrictEqual(codigos({ ce_master: '1111.2222', ce_house: '11112222' }), ['D02']);
  assert.deepStrictEqual(codigos({ hbl: '', mbl: '' }), [], 'vazios não contam');
});
teste('D03 DUIMP registrada sem taxa ou sem total; DI antiga não entra', () => {
  assert.deepStrictEqual(codigos({ numero_di: '26BR0000000001-1', di_taxa_cambio: 5.1, di_valor_aduaneiro: null }), ['D03']);
  assert.ok(/total em R\$/.test(VD.pendenciasDados({ numero_di: '26BR0000000001-1', di_taxa_cambio: 5.1 })[0].detalhe));
  assert.deepStrictEqual(codigos({ numero_di: '26BR0000000001-1', di_taxa_cambio: 5.1, di_valor_aduaneiro: 1000 }), []);
  assert.deepStrictEqual(codigos({ numero_di: '26/1234567-8' }), [], 'DI antiga');
});
teste('D04 finalizado sem custo da mercadoria (acompanhamento fica fora)', () => {
  assert.deepStrictEqual(codigos({ fase: 'FINALIZADO', real_json: { frete: { moeda: 'BRL', valor: 100 } } }), ['D04']);
  assert.deepStrictEqual(codigos({ fase: 'FINALIZADO', real_json: { fob: { moeda: 'BRL', valor: 50000 } } }), []);
  assert.deepStrictEqual(codigos({ fase: 'FINALIZADO', real_json: JSON.stringify({ fob: 1000 }) }), [], 'real_json em texto');
  assert.deepStrictEqual(codigos({ fase: 'FINALIZADO', finalidade: 'ACOMPANHAMENTO' }), []);
  assert.deepStrictEqual(codigos({ fase: 'CARREGAMENTO' }), []);
});
teste('D05 CI × PI com diferença acima de 5%', () => {
  const d = VD.pendenciasDados({ pi_valor_usd: 1000, ci_valor_usd: 830 });
  assert.deepStrictEqual(d.map(x => x.codigo), ['D05']);
  assert.ok(/-17%/.test(d[0].detalhe), d[0].detalhe);
  assert.deepStrictEqual(codigos({ pi_valor_usd: 1000, ci_valor_usd: 1040 }), []);
  assert.deepStrictEqual(codigos({ pi_valor_usd: 1000 }), [], 'sem CI');
});
teste('cancelado não gera nada', () => {
  assert.deepStrictEqual(codigos({ cancelado: true, hbl: 'X1', mbl: 'X1' }), []);
});

console.log('\n── verificação diária: correções automáticas ──');
const motorFalso = { clienteDaVendaDoProcesso: p => (/IMPAK/i.test(p.cliente || '') ? { nome: 'CLIENTE EXEMPLO LTDA' } : null) };
teste('cliente IMPAK com venda toda para um cliente → corrige o cliente, com linha de Histórico', () => {
  const cs = VD.correcoesAutomaticas({ id: 'c1', cliente: 'IMPAK COMERCIAL' }, motorFalso, DP);
  assert.strictEqual(cs.length, 1);
  assert.deepStrictEqual(cs[0].patch, { cliente: 'CLIENTE EXEMPLO LTDA' });
  assert.deepStrictEqual(cs[0].log, [{ campo: 'cliente', valor_antes: 'IMPAK COMERCIAL', valor_depois: 'CLIENTE EXEMPLO LTDA' }]);
});
teste('processo fechado ou cancelado nunca é corrigido sozinho', () => {
  assert.deepStrictEqual(VD.correcoesAutomaticas({ cliente: 'IMPAK', fechado: true }, motorFalso, DP), []);
  assert.deepStrictEqual(VD.correcoesAutomaticas({ cliente: 'IMPAK', cancelado: true }, motorFalso, DP), []);
});
teste('Nº DUIMP: parcela com câmbio fechado sem número recebe a DUIMP do processo', () => {
  const p = { id: 'd1', pi_pagamento: 'PARCELADO', numero_di: '26BR0000000002-2', pi_parcelas_json: JSON.stringify([
    { label: 'Inicial', valor_usd: '3000', cambio_fechado: '5.1000', duimp_numero: '' },
    { label: 'Final', valor_usd: '7000', cambio_fechado: '', duimp_numero: '' }]) };
  const cs = VD.correcoesAutomaticas(p, null, DP);
  assert.strictEqual(cs.length, 1);
  const parcelas = JSON.parse(cs[0].patch.pi_parcelas_json);
  assert.strictEqual(parcelas[0].duimp_numero, '26BR0000000002-2');
  assert.strictEqual(parcelas[1].duimp_numero, '', 'sem câmbio fechado continua vazia');
});
teste('Nº DUIMP no pagamento único', () => {
  const cs = VD.correcoesAutomaticas({ id: 'd2', pi_pagamento: 'VISTA', numero_di: '26BR0000000003-3', pi_pago: true, pi_cambio_fechado: '5.2' }, null, DP);
  const r = DP.completar({ pi_pagamento: 'VISTA', numero_di: '26BR0000000003-3', pi_pago: true, pi_cambio_fechado: '5.2' });
  if (r) assert.deepStrictEqual(cs.map(c => c.patch), [{ pi_duimp_numero: r.numero }]);
  else assert.deepStrictEqual(cs, []);
});
teste('resumir agrupa correções e pendências por regra', () => {
  const r = VD.resumir([
    { id: 'r1', referencia: 'TESTE-R-1', cliente: 'IMPAK', hbl: 'Z9', mbl: 'Z9' },
    { id: 'r2', referencia: 'TESTE-R-2', fase: 'FINALIZADO' },
    { id: 'r3', referencia: 'TESTE-R-3', cancelado: true, hbl: 'Q', mbl: 'Q' },
  ], motorFalso, DP);
  assert.deepStrictEqual(r.correcoes.map(c => c.referencia + ':' + c.regra), ['TESTE-R-1:cliente_pela_nf']);
  assert.deepStrictEqual(r.pendencias.map(x => x.codigo + ':' + x.processos.map(p => p.referencia).join(',')), ['D01:TESTE-R-1', 'D04:TESTE-R-2']);
});

console.log('\n── Agenda: tarefas D01–D05 ──');
teste('pendência vira tarefa da Agenda sem prazo, com o responsável da Lista', () => {
  const ts = A.gerarTarefas([{ id: 'a1', referencia: 'TESTE-A-1', created_at: '2025-01-10', fase: 'EMBARCADO', hbl: 'H1', mbl: 'H1' }], { hoje: '2026-10-22' });
  const d = ts.filter(t => t.codigo === 'D01');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].prazo, null);
  assert.strictEqual(d[0].funcao, 'IMPORTACAO');
  assert.ok(/HBL e MBL/.test(d[0].detalhe));
  // a tela mostra "Some sozinha quando: <como>" — o texto não pode repetir o prefixo
  assert.strictEqual(d[0].como, 'HBL e MBL diferentes');
  ['D01', 'D02', 'D03', 'D04', 'D05'].forEach(c => assert.ok(A.ATIVIDADES[c].como && !/some sozinha/i.test(A.ATIVIDADES[c].como), c));
});
teste('"Não se aplica" tira a tarefa; processo fechado não gera D', () => {
  const p = { id: 'a2', referencia: 'TESTE-A-2', created_at: '2025-01-10', fase: 'FINALIZADO' };
  const chave = A.chaveTarefa('D04', 'a2', '');
  assert.strictEqual(A.gerarTarefas([p], { hoje: '2026-10-22' }).filter(t => t.codigo === 'D04').length, 1);
  assert.strictEqual(A.gerarTarefas([p], { hoje: '2026-10-22', conclusoes: [{ chave, tipo: 'nao_aplica' }] }).filter(t => t.codigo === 'D04').length, 0);
  assert.strictEqual(A.gerarTarefas([Object.assign({}, p, { fechado: true })], { hoje: '2026-10-22' }).filter(t => /^D/.test(t.codigo)).length, 0);
});

console.log('\n── servidor: regra real do Controle no sandbox ──');
teste('motor do servidor expõe clienteDaVendaDoProcesso e a verificação usa a regra real', () => {
  const motor = AgendaServidor.carregarMotor();
  assert.ok(motor && typeof motor.clienteDaVendaDoProcesso === 'function');
  const p = { id: 's1', referencia: 'TESTE-S-1', cliente: 'IMPAK COMERCIAL E IMPORTADORA LTDA',
    produtos_json: JSON.stringify([{ descricao: 'PNEU TESTE', quantidade: 10 }]),
    vendas_json: JSON.stringify([{ cliente: 'CLIENTE EXEMPLO LTDA', nf_saida_numero: '9101', nf_saida_cfop: '5102', itens: [{ descricao: 'PNEU TESTE', quantidade: 10 }] }]) };
  const cs = VD.correcoesAutomaticas(p, motor, DP);
  assert.deepStrictEqual(cs.map(c => c.patch), [{ cliente: 'CLIENTE EXEMPLO LTDA' }]);
});

console.log('\n' + '─'.repeat(50));
console.log(`Total: ${ok + falhas} testes, ${ok} passaram, ${falhas} falharam`);
if (falhas) process.exit(1);
