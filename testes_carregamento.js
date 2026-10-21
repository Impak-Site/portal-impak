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
teste('conferência antiga (grupos de comparação): peso do BL, total ganha do item, líquido e PI ficam de fora', () => {
  const campo = (nome, l1, v1, l2, v2) => ({ campo: nome, doc1_label: l1, doc1_valor: v1, doc2_label: l2, doc2_valor: v2 });
  const antiga = JSON.stringify({ data: '01/01/2030, 10:00:00', grupos: [
    { titulo: 'Identificacao', campos: [campo('Numero B/L', 'BL', 'ABC123', 'CI', 'ABC123')] },
    { titulo: 'Quantidades', campos: [
      campo('Quantidade Item 1 (MODELO A)', 'CI', '700 PCS', 'PL', '700 PCS'),
      campo('Quantidade 205/55R16 91V', 'CI', '300 PCS', 'PL', '300 PCS'),
      campo('Quantidade Total', 'CI', '1.000 PCS', 'BL', '1000 PIECE ONLY'),
      campo('Quantidade — CI x PI', 'CI', '1000 PCS', 'PI', '990 PCS'),
      campo('Peso Liquido — PL', 'PL', 'G.W/N.W = 9.999 KG', 'Regra', 'x'),
      campo('Peso Bruto — CI x BL', 'CI/BL', '9.100,00 KG', 'BL', '9.200,000 KG'),
      campo('Peso Bruto CI x PL', 'CI', '9.100,00 KG', 'PL', '9.150 KGS'),
    ] },
  ] });
  const p = { conferencia_json: antiga, produtos_json: JSON.stringify([{ quantidade: 990 }]) };
  assert.deepStrictEqual(C.pesoBruto(p), { kg: 9200, fonte: 'BL' });
  assert.deepStrictEqual(C.pecasTotal(p), { qtd: 1000, fonte: 'CI' }, 'PL só tem itens (fora); CI pelo total, não pelo item 1');
  const soLiquido = JSON.stringify({ grupos: [{ campos: [campo('Peso Líquido / Bruto (sem embalagem)', 'PL', '9.999 KG', '', '')] }] });
  assert.deepStrictEqual(C.pesoBruto({ conferencia_json: soLiquido }), { kg: null, fonte: null });
  assert.strictEqual(C.pecasTotal({ conferencia_json: JSON.stringify({ grupos: [{ campos: [campo('Quantidade', 'PI', '50 PCS', 'X', '1')] }] }) }).qtd, null, 'PI não conta');
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
  assert.strictEqual(C.precisaTransportadora({ eta: '2030-05-20', transportadora_id: 't1' }, hoje), false, 'transportadora escolhida pelo cadastro');
  assert.strictEqual(C.precisaTransportadora({ data_chegada: '2030-05-09', data_agendamento: '2030-05-12' }, hoje), false, 'carregamento já agendado');
  assert.strictEqual(C.precisaTransportadora({ data_chegada: '2030-05-09', data_agendamento: '2030-05-12', agendamento_cancelado: true }, hoje), true, 'agendamento cancelado volta para a lista');
  assert.strictEqual(C.precisaTransportadora({ data_chegada: '2030-05-09', data_agendamento: '2030-05-12', agendamento_cancelado: 'sim' }, hoje), true);
  assert.strictEqual(C.precisaTransportadora({ data_chegada: '2030-05-09', data_agendamento: '2030-05-12', agendamento_cancelado: false }, hoje), false);
});
teste('servidor: a busca não pede coluna que não existe (qtd_containers → erro 500 em 20/10/2026)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
  const ini = src.indexOf('async function montarPedidosTransportadora');
  assert.ok(ini > 0, 'função não encontrada');
  const sel = (src.slice(ini, ini + 1500).match(/\.select\('([^']+)'\)/) || [])[1] || '';
  const cols = sel.split(',').map(s => s.trim());
  assert.ok(cols.includes('qtd_containers_prevista') && !cols.includes('qtd_containers'), 'colunas: ' + sel);
  ['transportadora_id', 'despachante_id', 'data_agendamento', 'agendamento_cancelado'].forEach(c => assert.ok(cols.includes(c), 'faltou ' + c));
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

teste('reenvio: assunto marcado', () => {
  assert.strictEqual(C.assuntoEmail({ cliente: 'Y', processos: [{}] }, { teste: true, reenvio: true }), '[TESTE · reenvio] IMPAK — Transportadora para 1 processo · Y');
});

console.log('\n── envio em sequência (limite do provedor) ──');
async function testeAsync(nome, fn) {
  try { await fn(); passou++; console.log(`  ✓ ${nome}`); }
  catch (e) { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); }
}
(async () => {
  await testeAsync('espera entre um e-mail e outro, tenta de novo no 429 e registra o que falhou', async () => {
    const esperas = [], tentativas = {};
    const enviar = async m => {
      tentativas[m] = (tentativas[m] || 0) + 1;
      if (m === 'B' && tentativas[m] === 1) throw new Error('Resend respondeu 429: rate_limit_exceeded');
      if (m === 'C') throw new Error('Resend respondeu 422: invalid');
      if (m === 'D') return { pulado: true };
      return { id: 'x' };
    };
    const r = await C.enviarEmSequencia(['A', 'B', 'C', 'D'], enviar, { esperar: async ms => { esperas.push(ms); }, intervaloMs: 700, esperaRetryMs: 1500 });
    assert.deepStrictEqual(r.map(x => [x.item, x.ok]), [['A', true], ['B', true], ['C', false], ['D', false]]);
    assert.strictEqual(tentativas.B, 2, '429 → tenta de novo uma vez');
    assert.strictEqual(tentativas.C, 1, 'outro erro → não repete');
    assert.ok(/422/.test(r[2].erro) && /domínio/.test(r[3].erro));
    assert.deepStrictEqual(esperas, [700, 1500, 700, 700], 'intervalo entre envios + espera do 429');
  });
  await testeAsync('429 duas vezes seguidas: falha registrada (sem laço infinito)', async () => {
    let n = 0;
    const r = await C.enviarEmSequencia(['A'], async () => { n++; throw new Error('Resend respondeu 429'); }, { esperar: async () => {} });
    assert.strictEqual(n, 2); assert.strictEqual(r[0].ok, false);
  });
  console.log(`\n════════════════════════════════════════`);
  console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
  console.log(`════════════════════════════════════════\n`);
  if (falhou > 0) process.exit(1);
})();
