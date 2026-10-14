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
  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
  if (passaram !== total) process.exit(1);
})();
