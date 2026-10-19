// testes_assistente.js — Assistente (chat com ferramentas). Valores fictícios.
const assert = require('assert');
const A = require('./assistente.js');
let total = 0, passaram = 0;
function teste(nome, fn){ total++; try { fn(); passaram++; console.log('  ✓ ' + nome); } catch(e){ console.log('  ✗ ' + nome + '\n      ' + e.message); } }
async function testeAsync(nome, fn){ total++; try { await fn(); passaram++; console.log('  ✓ ' + nome); } catch(e){ console.log('  ✗ ' + nome + '\n      ' + e.message); } }

console.log('\n📋 assistente.js — ferramentas por permissão');
teste('analista só com Controle não vê faturamento/resultado/pagamentos', () => {
  const nomes = A.ferramentasPara({ modulos: ['controle'] }).map(f => f.nome);
  assert.ok(nomes.includes('buscar_processos') && nomes.includes('agenda_pendencias'));
  assert.ok(!nomes.includes('faturamento') && !nomes.includes('resultado_processo') && !nomes.includes('pagamentos_previstos'));
});
teste('quem tem Resultado vê faturamento e resultado_processo', () => {
  const nomes = A.ferramentasPara({ modulos: ['resultado'] }).map(f => f.nome);
  assert.ok(nomes.includes('faturamento') && nomes.includes('resultado_processo'));
});
teste('conta só-TV não tem nenhuma ferramenta', () => {
  assert.deepStrictEqual(A.ferramentasPara({ modulos: ['tv'] }), []);
});
teste('system prompt não cita chave, banco nem comissões por nome', () => {
  const sp = A.systemPrompt({ usuario: 'x', modulos: ['controle'] }, A.ferramentasPara({ modulos: ['controle'] }));
  assert.ok(!/supabase|api[_ ]key|service_role/i.test(sp));
  assert.ok(/comiss/i.test(sp) && /Nunca mostre/i.test(sp));
});
teste('filtrar: cliente casa também nas vendas multi-cliente; porto/fornecedor por trecho', () => {
  const lista = [
    { referencia: 'A1', cliente: 'CLIENTE ALFA', fornecedor: 'FORN X', porto_destino: 'ITJ', vendas_json: '[]' },
    { referencia: 'B2', cliente: 'CLIENTE BETA', fornecedor: 'FORN Y', porto_destino: 'NVT', vendas_json: JSON.stringify([{ cliente: 'CLIENTE ALFA' }]) },
  ];
  assert.deepStrictEqual(A.filtrar(lista, { cliente: 'alfa' }).map(p => p.referencia), ['A1', 'B2']);
  assert.deepStrictEqual(A.filtrar(lista, { porto: 'nvt' }).map(p => p.referencia), ['B2']);
  assert.deepStrictEqual(A.filtrar(lista, { fornecedor: 'forn x' }).map(p => p.referencia), ['A1']);
});
teste('resumoProcesso não expõe campos financeiros', () => {
  const r = A.resumoProcesso({ referencia: 'A1', nf_saida_valor: 123456, pi_valor_usd: 999, real_json: {}, fase: 'EMBARCADO' });
  assert.ok(!('nf_saida_valor' in r) && !('pi_valor_usd' in r) && !('real_json' in r));
  assert.strictEqual(r.fase, 'EMBARCADO');
});

(async () => {
  // Execução das ferramentas com um Supabase falso (sem rede) e sem motor.
  const procs = [
    { referencia: 'P1', cliente: 'CLIENTE ALFA', fornecedor: 'F1', porto_destino: 'ITJ', eta: '2026-10-20', fase: 'EMBARCADO', qtd_containers_prevista: 2, vendas_json: JSON.stringify([{ cliente: 'CLIENTE ALFA', nf_saida_data: '2026-09-10', nf_saida_valor: 100000 }]) },
    { referencia: 'P2', cliente: 'CLIENTE BETA', fornecedor: 'F2', porto_destino: 'NVT', eta: '2026-11-05', fase: 'PI_RECEBIDA', qtd_containers_prevista: 1, nf_saida_data: '2026-09-20', nf_saida_valor: 50000 },
    { referencia: 'P3', cliente: 'CLIENTE ALFA', fornecedor: 'F1', porto_destino: 'ITJ', fase: 'FINALIZADO', data_chegada: '2026-08-01' },
  ];
  const ctx = { sessao: { usuario: 'teste', role: 'analista', modulos: ['controle', 'resultado'] }, motor: null, processos: async () => procs.map(p => Object.assign({ _fase: p.fase }, p)), sb: () => ({ from: () => ({ select: () => ({ limit: async () => ({ data: [{ id: '1', razao_social: 'CLIENTE ALFA', uf: 'SC', papeis: ['cliente'], ativo: true }], error: null }) }) }) }) };
  const f = n => A.FERRAMENTAS.find(x => x.nome === n);
  await testeAsync('buscar_processos: fase ATIVOS exclui finalizados; filtro por ETA', async () => {
    const r = await f('buscar_processos').executar({ fase: 'ATIVOS' }, ctx);
    assert.strictEqual(r.total, 2);
    const r2 = await f('buscar_processos').executar({ eta_de: '2026-11-01' }, ctx);
    assert.deepStrictEqual(r2.processos.map(p => p.referencia), ['P2']);
  });
  await testeAsync('chegadas_por_periodo agrupa por porto e soma containers', async () => {
    const r = await f('chegadas_por_periodo').executar({ de: '2026-10-01', ate: '2026-11-30' }, ctx);
    assert.strictEqual(r.total, 2); assert.strictEqual(r.containers_total, 3);
    assert.deepStrictEqual(Object.keys(r.por_porto).sort(), ['ITJ', 'NVT']);
  });
  await testeAsync('faturamento: soma NFs (vendas_json e legado) por cliente, sem lucro quando não apurado', async () => {
    const r = await f('faturamento').executar({ de: '2026-09-01', ate: '2026-09-30' }, ctx);
    assert.strictEqual(r.total_faturamento, 150000);
    assert.strictEqual(r.grupos[0].grupo, 'CLIENTE ALFA'); assert.strictEqual(r.grupos[0].lucro_real, null);
  });
  await testeAsync('listar_clientes: filtro por UF e contagem de processos', async () => {
    const r = await f('listar_clientes').executar({ uf: 'sc' }, ctx);
    assert.strictEqual(r.total, 1); assert.strictEqual(r.empresas[0].razao_social, 'CLIENTE ALFA');
  });
  await testeAsync('detalhe_processo: sem Financeiro, nf_valor fica de fora', async () => {
    const r = await f('detalhe_processo').executar({ referencia: 'p1' }, Object.assign({}, ctx, { sessao: { modulos: ['controle'] } }));
    assert.strictEqual(r.referencia, 'P1'); assert.strictEqual(r.vendas[0].nf_valor, undefined);
    const r2 = await f('detalhe_processo').executar({ referencia: 'P1' }, ctx);
    assert.strictEqual(r2.vendas[0].nf_valor, 100000);
  });
  // Com o motor real do Controle (mesmas contas da tela Resultado) — 19/10/2026.
  const motor = require('./agenda-servidor.js').carregarMotor();
  const V = a => JSON.stringify(a);
  const procsM = [
    { id: 'm1', referencia: 'M1', cliente: 'CLIENTE ALFA', fornecedor: 'FORN X', fase: 'FINALIZADO',
      produtos_json: V([{ descricao: 'PNEU A', quantidade: 10 }]), real_json: { fob: { valor: 1500, moeda: 'BRL' } },
      vendas_json: V([{ cliente: 'CLIENTE ALFA', nf_saida_numero: '1', nf_saida_data: '2026-07-01', nf_saida_cfop: '5102', nf_saida_valor: 1000, itens: [{ descricao: 'PNEU A', quantidade: 4 }] },
                      { cliente: 'CLIENTE BETA', nf_saida_numero: '2', nf_saida_data: '2026-08-02', nf_saida_cfop: '6102', nf_saida_valor: 1500, itens: [{ descricao: 'PNEU A', quantidade: 6 }] }]) },
    { id: 'm2', referencia: 'M2', cliente: 'CLIENTE BETA', fornecedor: 'FORN Y', fase: 'FINALIZADO', nf_saida_numero: '9', nf_saida_data: '2026-07-15', nf_saida_cfop: '5102', nf_saida_valor: 2000, nf_entrada_valor: 1900 },
    { id: 'm3', referencia: 'M3', cliente: 'CLIENTE GAMA', fornecedor: 'FORN X', fase: 'FINALIZADO', nf_saida_numero: '10', nf_saida_data: '2026-07-20', nf_saida_cfop: '5905', nf_saida_valor: 5000 },
    { id: 'm5', referencia: 'M5', cliente: 'CLIENTE GAMA', fornecedor: 'FORN Z', fase: 'FINALIZADO', nf_saida_numero: '11', nf_saida_data: '2026-09-01', nf_saida_cfop: '5102', nf_saida_valor: 1000 },
    { id: 'm4', referencia: 'M4', cliente: 'CLIENTE ALFA', fornecedor: 'FORN Y', fase: 'EMBARCADO', pi_valor_usd: 10000, pi_pagamento: 'ENTRADA_SALDO', pi_entrada_pct: 30, pi_data_entrada: '2026-01-10', pi_cambio_entrada: 5.1, pi_data_saldo: '2099-01-01' },
  ];
  const ctxM = Object.assign({}, ctx, { motor, processos: async () => procsM.map(p => Object.assign({ _fase: p.fase }, p)) });
  await testeAsync('faturamento (motor): por cliente com a parte de cada um; remessa 5905 não fatura', async () => {
    const r = await f('faturamento').executar({ de: '2026-01-01', ate: '2026-12-31', agrupar: 'cliente', ordenar: 'lucro' }, ctxM);
    assert.strictEqual(r.total_faturamento, 5500); // 1000 + 1500 + 2000 + 1000 (M3 é remessa)
    const beta = r.grupos.find(g => g.grupo === 'CLIENTE BETA');
    assert.strictEqual(beta.faturamento, 3500); assert.strictEqual(beta.lucro_real, 600 + 100);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.grupos.map(g => g.grupo))), ['CLIENTE GAMA', 'CLIENTE BETA', 'CLIENTE ALFA'], 'ordenado por lucro');
    assert.ok(r.processos_para_conferir.some(x => x.referencia === 'M5'), 'M5 sem nenhum custo (margem 100%) é sinalizado');
    assert.ok(!r.processos_para_conferir.some(x => x.referencia === 'M1'), 'M1 (40%) não');
  });
  await testeAsync('faturamento (motor): por fornecedor soma o processo inteiro', async () => {
    const r = await f('faturamento').executar({ de: '2026-01-01', ate: '2026-12-31', agrupar: 'fornecedor' }, ctxM);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.grupos.map(g => [g.grupo, g.faturamento]).sort())), [['FORN X', 2500], ['FORN Y', 2000], ['FORN Z', 1000]]);
  });
  await testeAsync('resultado_processo: por cliente soma o lucro do processo; lista as NFs', async () => {
    const r = await f('resultado_processo').executar({ referencia: 'm1' }, ctxM);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.por_cliente.map(c => [c.cliente, c.lucro_real]))), [['CLIENTE BETA', 600], ['CLIENTE ALFA', 400]]);
    assert.strictEqual(r.real.lucro_real, 1000);
    assert.strictEqual(r.vendas.length, 2);
    assert.ok(Array.isArray(r.custos_reais) && r.custos_reais.length === 1, 'custos reais lançados aparecem');
  });
  await testeAsync('pagamentos_previstos: lista os pagamentos (antes dava erro e voltava vazio)', async () => {
    const r = await f('pagamentos_previstos').executar({ dias: 30, incluir_pagos: true }, Object.assign({}, ctxM, { sessao: { modulos: ['financeiro'] } }));
    assert.ok(r.pagamentos.some(x => x.processo === 'M4' && x.etapa === 'entrada' && x.pago === true));
    const r2 = await f('pagamentos_previstos').executar({ dias: 30 }, ctxM);
    assert.ok(!r2.pagamentos.some(x => x.processo === 'M4' && x.etapa === 'saldo'), 'saldo de 2099 fora do horizonte');
  });
  // Teste ao vivo 19/10/2026: "vencidos ou vencendo em 15 dias" voltava 361
  // linhas (318 sem data) e a IA respondia vazio. Agora: resumo primeiro e as
  // parcelas sem data só na contagem. Valores fictícios.
  await testeAsync('pagamentos_previstos: resumo primeiro; parcelas sem data só entram na contagem', async () => {
    const em = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const extra = [
      { id: 'm6', referencia: 'M6', fornecedor: 'FORN W', fase: 'EMBARCADO', pi_valor_usd: 1000, pi_pagamento: 'ENTRADA_SALDO', pi_entrada_pct: 50 },
      { id: 'm7', referencia: 'M7', fornecedor: 'FORN W', fase: 'EMBARCADO', pi_valor_usd: 2000, pi_pagamento: 'ENTRADA_SALDO', pi_entrada_pct: 50, pi_data_entrada: em(-20), pi_data_saldo: em(5) },
    ];
    const ctxP = Object.assign({}, ctxM, { processos: async () => procsM.concat(extra).map(p => Object.assign({ _fase: p.fase }, p)) });
    const r = await f('pagamentos_previstos').executar({ dias: 15 }, ctxP);
    assert.strictEqual(r.resumo.sem_data, 2); assert.strictEqual(r.resumo.sem_data_usd, 1000);
    assert.strictEqual(r.resumo.vencidos, 1); assert.strictEqual(r.resumo.vencidos_usd, 1000);
    assert.strictEqual(r.resumo.vencem_ate, 1); assert.strictEqual(r.resumo.vencem_ate_usd, 1000);
    assert.ok(!r.pagamentos.some(x => x.processo === 'M6'), 'sem data fica fora da lista');
    assert.strictEqual(r.pagamentos[0].processo, 'M7'); assert.strictEqual(r.pagamentos[0].vencido, true);
    assert.ok(/sem data/.test(r.obs || ''), r.obs);
    const r2 = await f('pagamentos_previstos').executar({ dias: 15, incluir_sem_data: true }, ctxP);
    assert.ok(r2.pagamentos.some(x => x.processo === 'M6'));
  });
  await testeAsync('detalhe_processo: pagamentos ao fornecedor vêm como lista', async () => {
    const r = await f('detalhe_processo').executar({ referencia: 'M4' }, ctxM);
    assert.ok(Array.isArray(r.pagamentos_fornecedor) && r.pagamentos_fornecedor.length === 2, JSON.stringify(r.pagamentos_fornecedor));
  });
  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
  if (passaram !== total) process.exit(1);
})();
