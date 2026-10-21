/**
 * TESTES — lib/carregamento-core.js (e-mail "qual será a transportadora?")
 * Roda com: node testes_carregamento.js
 * Valores fictícios (repositório público).
 */
const assert = require('assert');
const C = require('./lib/carregamento-core.js');

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); passou++; console.log(`  ✓ ${nome}`); }
  catch (e) { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); }
}
const conf = docs => JSON.stringify({ dadosDocs: Object.fromEntries(docs.map((d, i) => ['doc' + i, { tipo: d[0], dados: d[1] }])) });

console.log('\n── números dos documentos ──');
teste('peso em formato brasileiro e americano', () => {
  assert.strictEqual(C.numeroDoc('10.532,380 KGS'), 10532.38);
  assert.strictEqual(C.numeroDoc('10,504.08 KGS'), 10504.08);
  assert.strictEqual(C.numeroDoc('11846.4'), 11846.4);
  assert.strictEqual(C.numeroDoc('11.515,160 kg'), 11515.16);
  assert.strictEqual(C.numeroDoc('10.532'), 10532, 'um ponto + 3 dígitos = milhar');
  assert.strictEqual(C.numeroDoc(9876.5), 9876.5);
  assert.strictEqual(C.numeroDoc('sem número'), null);
});
teste('quantidade de peças escrita no documento', () => {
  assert.strictEqual(C.numeroDoc('1,308 PCS'), 1308);
  assert.strictEqual(C.numeroDoc('1328 PIECE ONLY'), 1328);
  assert.strictEqual(C.numeroDoc('1328 PACKAGES / 1328 PIECE'), 1328);
});

console.log('\n── peso bruto e peças ──');
teste('peso: digitado no processo > BL > CE > PL > CI', () => {
  const docs = conf([['CI', { peso_bruto: '9.000,00 KGS' }], ['PL', { peso_bruto: '9.100,00 KGS' }], ['BL', { peso_bruto: '9.200,500 KGS' }]]);
  assert.deepStrictEqual(C.pesoBruto({ conferencia_json: docs }), { kg: 9200.5, fonte: 'BL' });
  assert.deepStrictEqual(C.pesoBruto({ conferencia_json: docs, peso_bruto: 9300 }), { kg: 9300, fonte: 'processo' });
  assert.deepStrictEqual(C.pesoBruto({ conferencia_json: conf([['CI', { peso_bruto: '9,000.00 KGS' }]]) }), { kg: 9000, fonte: 'CI' });
  assert.deepStrictEqual(C.pesoBruto({}), { kg: null, fonte: null });
});
teste('peças: o embarcado (PL/CI/BL) vale mais que a PI e que os produtos do processo', () => {
  const docs = conf([['PI', { quantidade: '1000 PCS' }], ['CI', { quantidade: '1,012 PCS' }]]);
  assert.deepStrictEqual(C.pecasTotal({ conferencia_json: docs, produtos_json: JSON.stringify([{ quantidade: 1000 }]) }), { qtd: 1012, fonte: 'CI' });
  assert.deepStrictEqual(C.pecasTotal({ produtos_json: JSON.stringify([{ quantidade: 400 }, { quantidade: 600 }]) }), { qtd: 1000, fonte: 'produtos' });
});
teste('peças por container: 1 container = total; vários com a divisão = cada um; sem divisão = em aberto', () => {
  const um = { containers_json: JSON.stringify([{ numero: 'ABCU1234567' }]), produtos_json: JSON.stringify([{ quantidade: 800 }]) };
  assert.deepStrictEqual(C.pecasPorContainer(um), [{ numero: 'ABCU1234567', pecas: 800 }]);
  const doisComDivisao = { containers_json: JSON.stringify([{ numero: 'ABCU1234567', pecas: 500 }, { numero: 'ABCU7654321', pecas: 300 }]) };
  assert.deepStrictEqual(C.pecasPorContainer(doisComDivisao), [{ numero: 'ABCU1234567', pecas: 500 }, { numero: 'ABCU7654321', pecas: 300 }]);
  const doisSem = { containers_json: JSON.stringify([{ numero: 'ABCU1234567' }, { numero: 'ABCU7654321' }]), produtos_json: JSON.stringify([{ quantidade: 800 }]) };
  assert.deepStrictEqual(C.pecasPorContainer(doisSem), [{ numero: 'ABCU1234567', pecas: null }, { numero: 'ABCU7654321', pecas: null }]);
  assert.ok(C.htmlEmailCliente({ cliente: 'X', processos: [Object.assign({ referencia: 'R1' }, doisSem)] }).includes('800 no total'));
  assert.strictEqual(C.qtdContainers({ qtd_containers_prevista: 2 }), 2, 'sem a lista, usa a quantidade prevista');
});

console.log('\n── quem entra no pedido ──');
teste('sem transportadora e chegando (chegou ou ETA em até 15 dias)', () => {
  const hoje = '2030-05-10';
  assert.strictEqual(C.precisaTransportadora({ eta: '2030-05-20' }, hoje), true);
  assert.strictEqual(C.precisaTransportadora({ eta: '2030-05-26' }, hoje), false, 'ETA além de 15 dias');
  assert.strictEqual(C.precisaTransportadora({ eta: '2030-05-26' }, hoje, 20), true, 'janela configurável');
  assert.strictEqual(C.precisaTransportadora({ data_chegada: '2030-05-09' }, hoje), true, 'já chegou');
  assert.strictEqual(C.precisaTransportadora({ eta: '2030-05-20', transportadora: 'TRANSP EXEMPLO' }, hoje), false);
  assert.strictEqual(C.precisaTransportadora({ data_chegada: '2030-05-09', data_carregamento: '2030-05-10' }, hoje), false);
  assert.strictEqual(C.precisaTransportadora({ eta: '2030-05-20', cancelado: true }, hoje), false);
  assert.strictEqual(C.precisaTransportadora({ eta: '2030-05-20', fase: 'FINALIZADO' }, hoje), false);
  assert.strictEqual(C.precisaTransportadora({}, hoje), false, 'sem ETA e sem chegada');
});
teste('cliente do pedido: importação própria com 1 venda vai para o cliente da venda; com várias, fica com a equipe', () => {
  assert.deepStrictEqual(C.clienteDoPedido({ cliente: 'CLIENTE EXEMPLO LTDA', cliente_id: 'c1' }), { cliente: 'CLIENTE EXEMPLO LTDA', clienteId: 'c1', proprio: false });
  const umaVenda = { cliente: 'IMPAK COMERCIAL EXEMPLO', vendas_json: JSON.stringify([{ cliente: 'COMPRADOR A LTDA', cliente_id: 'a' }]) };
  assert.strictEqual(C.clienteDoPedido(umaVenda).cliente, 'COMPRADOR A LTDA');
  const duasVendas = { cliente: 'IMPAK COMERCIAL EXEMPLO', vendas_json: JSON.stringify([{ cliente: 'COMPRADOR A LTDA' }, { cliente: 'COMPRADOR B LTDA' }]) };
  const r = C.clienteDoPedido(duasVendas);
  assert.ok(r.proprio); assert.deepStrictEqual(r.clientesVenda, ['COMPRADOR A LTDA', 'COMPRADOR B LTDA']);
});
teste('agrupa por cliente (pelo id do cadastro), importação própria por último, ordem de chegada', () => {
  const grupos = C.agruparPorCliente([
    { referencia: 'R3', cliente: 'IMPAK COMERCIAL EXEMPLO', eta: '2030-05-11' },
    { referencia: 'R2', cliente: 'Cliente Exemplo', cliente_id: 'c1', eta: '2030-05-20' },
    { referencia: 'R1', cliente: 'CLIENTE EXEMPLO LTDA', cliente_id: 'c1', eta: '2030-05-12' },
    { referencia: 'R4', cliente: 'OUTRO CLIENTE', eta: '2030-05-15' },
  ]);
  assert.deepStrictEqual(grupos.map(g => [g.cliente, g.processos.map(p => p.referencia)]), [
    ['Cliente Exemplo', ['R1', 'R2']], ['OUTRO CLIENTE', ['R4']], ['IMPAK — importação própria', ['R3']],
  ]);
});

console.log('\n── e-mail ──');
teste('tem os 5 dados pedidos + chegada, e escapa o que vem do cadastro', () => {
  const p = { referencia: 'REF-<b>1</b>', cliente: 'CLIENTE <script>alert(1)</script>', porto_destino: 'AAA', eta: '2030-05-20',
    containers_json: JSON.stringify([{ numero: 'ABCU1234567' }]),
    conferencia_json: conf([['BL', { peso_bruto: '9.200,500 KGS', quantidade: '800 PIECE' }]]) };
  const g = C.agruparPorCliente([p])[0];
  const html = C.htmlEmailCliente(g, { nomePorto: c => c === 'AAA' ? 'Porto Exemplo' : c });
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
  assert.ok(html.includes('REF-&lt;b&gt;1&lt;/b&gt;'));
  ['ABCU1234567', '>800<', '9.200,5 kg', 'Porto Exemplo', 'Previsão 20/05/2030', 'qual transportadora'].forEach(t => assert.ok(html.includes(t), 'faltou: ' + t));
  assert.ok(!html.includes('TESTE —'), 'sem o quadro de teste fora do modo teste');
});
teste('modo teste: quadro avisando que não foi ao cliente + dados faltando', () => {
  const g = C.agruparPorCliente([{ referencia: 'R9', cliente: 'CLIENTE X', eta: '2030-05-20' }])[0];
  const html = C.htmlEmailCliente(g, { teste: true, paraQuemHtml: 'Iria para: <strong>ninguém cadastrado</strong>' });
  assert.ok(html.includes('TESTE — este e-mail ainda não foi para o cliente'));
  assert.ok(html.includes('Dados faltando: R9 (peso bruto, quantidade de peças, quantidade de containers, porto de chegada)'));
  assert.strictEqual(C.assuntoEmail(g, { teste: true }), '[TESTE] IMPAK — Transportadora para 1 processo · CLIENTE X');
  assert.strictEqual(C.assuntoEmail({ cliente: 'Y', processos: [{}, {}] }), 'IMPAK — Transportadora para 2 processos · Y');
});

console.log(`\n════════════════════════════════════════`);
console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
console.log(`════════════════════════════════════════\n`);
if (falhou > 0) process.exit(1);
