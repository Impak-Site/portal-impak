// Testes do esqueleto da integração Conexos (services/conexos.js) -- 19/09/2026.
// Roda sem rede: usa um Supabase fake e um transporte injetado.
const c = require('./services/conexos.js');
let total = 0, passaram = 0;
function teste(nome, fn){ total++; try { const r = fn(); if (r && r.then) return r.then(()=>{passaram++;console.log('  ✓ '+nome)}).catch(e=>console.log('  ✗ '+nome+'\n      '+e.message)); passaram++; console.log('  ✓ '+nome); } catch(e){ console.log('  ✗ '+nome+'\n      '+e.message); } }
function iguais(a,b,msg){ if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error((msg?msg+' — ':'')+`esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

function sbFake(){
  const st = { logs: [], updates: [] };
  const sb = {
    from(t){
      return {
        insert: async (l) => { if (t==='integracao_log') st.logs.push(l); return {}; },
        update: (patch) => ({ eq: async (k, v) => { st.updates.push({ t, patch, k, v }); return {}; } }),
      };
    },
  };
  return { sb, st };
}

(async () => {
  console.log('\n── mapearDoConexos ──');
  teste('só preenche campo vazio; igual é ignorado; diferente fica pendente (não sobrescreve)', () => {
    const r = c.mapearDoConexos({ 'di.numero':'26BR1', 'navio':'x', 'embarque.navio':'EVER', 'bl.house':'H1' }, { numero_di:'', navio:'EVER', hbl:'OUTRO' });
    iguais(r.campos, { numero_di:'26BR1' });
    iguais(r.ignorados.map(i=>i.campo+':'+i.motivo), ['hbl:ja_preenchido','navio:igual']);
  });
  teste('dados nulos/vazios não viram campo', () => {
    const r = c.mapearDoConexos({ 'di.numero': null, 'di.canal': '' }, {});
    iguais(r.campos, {});
  });
  teste('campo com sobrescreve:true troca valor diferente', () => {
    const orig = c.MAPA_CAMPOS.find(m=>m.nosso==='canal').sobrescreve;
    c.MAPA_CAMPOS.find(m=>m.nosso==='canal').sobrescreve = true;
    const r = c.mapearDoConexos({ 'di.canal':'VERDE' }, { canal:'AMARELO' });
    c.MAPA_CAMPOS.find(m=>m.nosso==='canal').sobrescreve = orig;
    iguais(r.campos, { canal:'VERDE' });
  });

  console.log('\n── sincronizarProcesso ──');
  await teste('sem conexos_id → ignorado, loga, não grava', async () => {
    const { sb, st } = sbFake();
    const r = await c.sincronizarProcesso(sb, { id:'p1', referencia:'UD1' }, { transporte:{ configurado:true } });
    iguais(r.status, 'sem_vinculo'); iguais(st.updates.length, 0); iguais(st.logs[0].status, 'ignorado');
  });
  await teste('transporte não configurado → pendente, loga, não grava', async () => {
    const { sb, st } = sbFake();
    const r = await c.sincronizarProcesso(sb, { id:'p1', referencia:'UD1', conexos_id:'C1' }, { transporte:{ configurado:false } });
    iguais(r.status, 'nao_configurado'); iguais(st.updates.length, 0); iguais(st.logs[0].status, 'pendente');
  });
  await teste('transporte injetado → aplica só o vazio, grava conexos_ultima_sync, loga ok', async () => {
    const { sb, st } = sbFake();
    const transporte = { configurado:true, buscarProcesso: async (id) => ({ configurado:true, dados:{ 'di.numero':'26BR9', 'embarque.navio':'MAERSK' } }) };
    const r = await c.sincronizarProcesso(sb, { id:'p1', referencia:'UD1', conexos_id:'C1', navio:'EVER' }, { transporte, usuario:'ayslan' });
    iguais(r.status, 'ok'); iguais(r.campos, { numero_di:'26BR9' });
    iguais(st.updates[0].patch.numero_di, '26BR9'); if(!st.updates[0].patch.conexos_ultima_sync) throw new Error('sem conexos_ultima_sync');
    iguais(st.logs[0].status, 'ok'); iguais(st.logs[0].usuario, 'ayslan');
  });
  await teste('data impossível vinda do Conexos não é gravada e fica no log como ignorada', async () => {
    const { sb, st } = sbFake();
    // liberação certa; NF de entrada com ano pela metade (erro) — o processo já tem embarque e chegada
    const transporte = { configurado:true, buscarProcesso: async () => ({ configurado:true, dados:{ 'di.numero':'26BR7', 'di.data_desembaraco':'2026-04-10', 'nf_entrada.data':'0026-04-12' } }) };
    const r = await c.sincronizarProcesso(sb, { id:'p1', referencia:'UD1', conexos_id:'C1', data_embarque:'2026-02-20', data_chegada:'2026-04-01' }, { transporte });
    iguais(r.status, 'ok'); iguais(r.campos, { numero_di:'26BR7', data_liberacao:'2026-04-10' });
    iguais(r.datas_recusadas.map(x => x.campo), ['nf_entrada_data']);
    iguais(st.updates[0].patch.nf_entrada_data, undefined);
    const ign = st.logs[0].payload.ignorados.find(i => i.motivo === 'data_impossivel');
    iguais([ign.campo, ign.novo], ['nf_entrada_data', '0026-04-12']);
  });
  await teste('ETA antes do ETD vindos juntos do Conexos: nenhum dos dois é gravado', async () => {
    const { sb, st } = sbFake();
    const transporte = { configurado:true, buscarProcesso: async () => ({ configurado:true, dados:{ 'embarque.etd':'2026-05-10', 'embarque.eta':'2026-05-01' } }) };
    const r = await c.sincronizarProcesso(sb, { id:'p1', referencia:'UD1', conexos_id:'C1' }, { transporte });
    iguais(r.campos, {}); iguais(r.datas_recusadas.map(x => x.campo).sort(), ['eta', 'etd']);
    iguais(Object.keys(st.updates[0].patch), ['conexos_ultima_sync']);
  });
  await teste('erro no transporte → status erro, loga, não grava', async () => {
    const { sb, st } = sbFake();
    const transporte = { configurado:true, buscarProcesso: async () => { throw new Error('timeout'); } };
    const r = await c.sincronizarProcesso(sb, { id:'p1', referencia:'UD1', conexos_id:'C1' }, { transporte });
    iguais(r.status, 'erro'); iguais(st.updates.length, 0); iguais(st.logs[0].status, 'erro'); iguais(st.logs[0].erro, 'timeout');
  });
  teste('statusIntegracao sem env → configurado:false', () => {
    delete process.env.CONEXOS_API_URL; delete process.env.CONEXOS_API_TOKEN;
    iguais(c.statusIntegracao().configurado, false);
  });

  // ── Planilhas do Conexos: códigos de processos e produtos (23/10/2026) ──
  console.log('\n── conexos-cadastro (CadProcessos / CadProdutos) ──');
  const CC = require('./conexos-cadastro.js');
  const RP = require('./referencia-processo.js');
  teste('lerPlanilha reconhece CadProcessos e CadProdutos pelo cabeçalho; outra planilha dá erro', () => {
    const pr = CC.lerPlanilha([['Benefício Fiscal', 'Cód. Processo', 'Referência Externa', 'Situação'], [null, 11, 'TST-001', 'ABERTO'], [null, 12, '', 'ABERTO'], [null, 'x', 'TST-9', '']]);
    iguais(pr.tipo, 'processos'); iguais(pr.itens.length, 1); iguais(pr.itens[0].codigo_conexos, 11); iguais(pr.itens[0].referencia, 'TST-001');
    const pd = CC.lerPlanilha([['Produto', 'Descrição Produto', 'NCM', 'Cód. Externo'], [7, 'PNEU TESTE 100/50R10 80H AB1', '40111000', 'TT0007'], [8, 'PNEU TESTE 10.0-20 120A6 XY9', '40112090', '']]);
    iguais(pd.tipo, 'produtos'); iguais(pd.itens.map(i => [i.codigo_conexos, i.codigo_interno]), [[7, 'TT0007'], [8, null]]);
    iguais(CC.lerPlanilha([['A', 'B'], [1, 2]]).tipo, null);
  });
  teste('planoProcessos: novo, troca, igual, sem prefixo IMPAK-, código de outro processo vira conflito, não achado', () => {
    const procs = [
      { id: 'a', referencia: 'TST-001', conexos_id: null },
      { id: 'b', referencia: 'TST-002', conexos_id: '50' },
      { id: 'c', referencia: 'TST-003', conexos_id: '60' },
      { id: 'd', referencia: 'IMPAK-TST-004', conexos_id: null },
      { id: 'e', referencia: 'TST-005', conexos_id: '99' },
    ];
    const itens = [
      { codigo_conexos: 10, referencia: 'TST-001' }, { codigo_conexos: 51, referencia: 'TST-002' },
      { codigo_conexos: 60, referencia: 'TST-003' }, { codigo_conexos: 40, referencia: 'TST-004' },
      { codigo_conexos: 99, referencia: 'TST-006' }, { codigo_conexos: 70, referencia: 'NAO-EXISTE' },
    ];
    const p = CC.planoProcessos(itens, procs, RP);
    iguais(p.mudar.map(m => [m.referencia, m.de, m.para]), [['TST-001', null, '10'], ['TST-002', '50', '51'], ['IMPAK-TST-004', null, '40']]);
    iguais(p.iguais.map(x => x.referencia), ['TST-003']);
    iguais(p.nao_encontrados.map(x => x.referencia), ['TST-006', 'NAO-EXISTE']);
    // troca de código entre dois processos (A tinha 5, B passa a ter 5): os dois mudam, sem conflito
    const q = CC.planoProcessos([{ codigo_conexos: 5, referencia: 'TST-002' }, { codigo_conexos: 6, referencia: 'TST-001' }], [{ id: 'a', referencia: 'TST-001', conexos_id: '5' }, { id: 'b', referencia: 'TST-002', conexos_id: '6' }], RP);
    iguais(q.mudar.length, 2); iguais(q.conflitos.length, 0);
    // código que fica com um processo que não muda → conflito
    const r = CC.planoProcessos([{ codigo_conexos: 50, referencia: 'TST-001' }], procs, RP);
    iguais(r.mudar.length, 0); iguais(r.conflitos.length, 1);
  });
  teste('planoProdutos: atualiza pelo código do Conexos, completa o código pelo Cód. Externo, insere o novo, não repete Cód. Externo', () => {
    const cat = [
      { id: 1, descricao: 'PNEU TESTE ANTIGO', codigo_interno: 'TT0001', codigo_conexos: 1 },
      { id: 2, descricao: 'PNEU TESTE DOIS', codigo_interno: 'TT0002', codigo_conexos: null },
      { id: 3, descricao: 'PNEU TESTE TRES', codigo_interno: 'TT0003', codigo_conexos: 3 },
    ];
    const p = CC.planoProdutos([
      { codigo_conexos: 1, descricao: 'PNEU TESTE NOVO NOME', codigo_interno: 'TT0001' },
      { codigo_conexos: 2, descricao: 'PNEU TESTE DOIS', codigo_interno: 'TT0002' },
      { codigo_conexos: 3, descricao: 'PNEU TESTE TRES', codigo_interno: 'TT0003' },
      { codigo_conexos: 4, descricao: 'PNEU TESTE QUATRO', codigo_interno: 'TT0003' },
      { codigo_conexos: 5, descricao: 'PNEU TESTE CINCO', codigo_interno: null },
    ], cat);
    iguais(p.atualizar.map(u => [u.id, Object.keys(u.campos).sort().join(',')]), [[1, 'descricao'], [2, 'codigo_conexos']]);
    iguais(p.iguais, ['3']);
    iguais(p.inserir.map(x => [x.codigo_conexos, x.codigo_interno]), [[4, null], [5, null]]);
    iguais(p.avisos.length, 1);
  });
  teste('acharProduto: medida + pattern + índice de carga; empate não escolhe; sem medida não chuta', () => {
    const cat = [
      { codigo_conexos: 101, descricao: 'PNEU MARCA 12.4-24 128A6 PT01' },
      { codigo_conexos: 102, descricao: 'PNEU MARCA 18.4-34 151A6 12PR PT01' },
      { codigo_conexos: 103, descricao: 'PNEU MARCA 295/80R22.5 18PR 154/149L PT02' },
      { codigo_conexos: 104, descricao: 'PNEU MARCA 295/80R22.5 18PR 152/149M PT02' },
    ];
    iguais(CC.acharProduto('12.4-24 PT01 128A6 12 PLY RATIN G', cat).produto.codigo_conexos, 101);
    iguais(CC.acharProduto('18.4-34 PT01 151A6 12 PLY RATING', cat).produto.codigo_conexos, 102);
    iguais(CC.acharProduto('295/80 R22.5 18PR 152/149M PT02', cat).produto.codigo_conexos, 104);
    iguais(CC.acharProduto('295/80R22.5 PT02', cat).produto, null, 'empate entre 103 e 104');
    iguais(CC.acharProduto('PNEU PT01', cat).produto, null);
    iguais(CC.acharProduto('12.4-24', cat).produto, null, 'só a medida não basta');
  });

  // ── Gravação do "Atualizar pelo Conexos" (lib/conexos-aplicar.js, 24/10/2026) ──
  // Banco de mentira; valores fictícios.
  console.log('\n── aplicarPlanoConexos / emParalelo / referenciaJaUsada ──');
  const CA = require('./lib/conexos-aplicar.js');
  const RU = require('./lib/referencia-unica.js');
  function dbFake(opts){
    const o = opts || {}, st = { ordem: [], processos: {}, produtos: {}, logs: [], novos: [], aoMesmoTempo: 0, maxAoMesmoTempo: 0 };
    const espera = async () => { st.aoMesmoTempo++; st.maxAoMesmoTempo = Math.max(st.maxAoMesmoTempo, st.aoMesmoTempo); await new Promise(r => setTimeout(r, 2)); st.aoMesmoTempo--; };
    return { st, db: {
      limparConexos: async ids => { st.ordem.push('limpar:' + ids.join(',')); ids.forEach(id => { st.processos[id] = { ...(st.processos[id] || {}), conexos_id: null }; }); return {}; },
      atualizarProcesso: async (id, c) => { await espera(); if ((o.falhar || []).includes(id)) return { error: { message: 'falhou' } }; st.ordem.push('proc:' + id); st.processos[id] = { ...(st.processos[id] || {}), ...c }; return {}; },
      inserirLogs: async l => { st.logs.push(...l); return {}; },
      atualizarProduto: async (id, c) => { await espera(); st.produtos[id] = c; return {}; },
      inserirProdutos: async l => { st.novos.push(...l); return {}; },
    } };
  }
  await teste('processos: limpa primeiro quem troca de código, grava todos, Histórico só dos gravados', async () => {
    const { st, db } = dbFake({ falhar: ['p3'] });
    const plano = { mudar: [
      { id: 'p1', referencia: 'TESTE-1', de: '10', para: '20' },
      { id: 'p2', referencia: 'TESTE-2', de: '20', para: '10' },
      { id: 'p3', referencia: 'TESTE-3', de: null, para: '30' },
    ] };
    const r = await CA.aplicarPlanoConexos({ tipo: 'processos', plano }, db, { usuario: 'teste', agora: '2026-01-01T00:00:00.000Z' });
    iguais(st.ordem[0], 'limpar:p1,p2', 'limpa antes de gravar');
    iguais(r.gravados, 2); iguais(r.falhas.map(f => f.referencia), ['TESTE-3']);
    iguais(st.processos.p1.conexos_id, '20'); iguais(st.processos.p2.conexos_id, '10');
    iguais(st.logs.map(l => l.processo_id + ':' + l.valor_antes + '>' + l.valor_depois).sort(), ['p1:10>20', 'p2:20>10']);
  });
  await teste('produtos: atualiza em paralelo (no máx. 10 ao mesmo tempo), insere em lotes, marca ativo e nunca apaga', async () => {
    const { st, db } = dbFake();
    const atualizar = Array.from({ length: 35 }, (_, i) => ({ id: 'x' + i, campos: { descricao: 'PNEU TESTE ' + i }, antes: {} }));
    const inserir = Array.from({ length: 450 }, (_, i) => ({ codigo_conexos: 9000 + i, descricao: 'NOVO ' + i }));
    const r = await CA.aplicarPlanoConexos({ tipo: 'produtos', plano: { atualizar, inserir } }, db, { paralelo: 10 });
    iguais(r.gravados, 485); iguais(r.falhas, []);
    iguais(st.maxAoMesmoTempo <= 10 && st.maxAoMesmoTempo > 1, true, 'paralelo limitado: ' + st.maxAoMesmoTempo);
    iguais(st.produtos.x7.ativo, true); iguais(st.novos.length, 450); iguais(st.novos.every(n => n.ativo === true), true);
    iguais(typeof db.apagar, 'undefined', 'o db nem tem como apagar');
  });
  await teste('emParalelo devolve na ordem e lista vazia não quebra', async () => {
    iguais(await CA.emParalelo([3, 1, 2], 2, async n => { await new Promise(r => setTimeout(r, n)); return n * 10; }), [30, 10, 20]);
    iguais(await CA.emParalelo([], 5, async () => 1), []);
  });
  await teste('referência repetida: ignora maiúsculas/espaços e processo cancelado', async () => {
    const buscar = async () => [{ id: 'a', referencia: 'TESTE-REF-1 ' }, { id: 'b', referencia: 'TESTE-REF-2', cancelado: true }];
    iguais((await RU.referenciaJaUsada(' teste-ref-1', buscar)).id, 'a');
    iguais(await RU.referenciaJaUsada('TESTE-REF-2', buscar), null, 'cancelado não conta');
    iguais(await RU.referenciaJaUsada('TESTE-REF-9', buscar), null);
    iguais(await RU.referenciaJaUsada('  ', buscar), null, 'vazia');
  });

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total-passaram} falharam`);
  process.exit(passaram===total?0:1);
})();
