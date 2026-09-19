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

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total-passaram} falharam`);
  process.exit(passaram===total?0:1);
})();
