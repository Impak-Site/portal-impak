// Testes do backup no Dropbox (services/dropbox-backup.js) -- 30/09/2026.
// Roda sem rede: Supabase fake (storage + tabelas) e fetch fake do Dropbox.
const d = require('./services/dropbox-backup.js');
let total = 0, passaram = 0;
async function teste(nome, fn){ total++; try { await fn(); passaram++; console.log('  ✓ '+nome); } catch(e){ console.log('  ✗ '+nome+'\n      '+e.message); } }
function ok(c, msg){ if(!c) throw new Error(msg || 'falhou'); }
function iguais(a,b,msg){ if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error((msg?msg+' — ':'')+`esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

function sbFake({ arquivos = [], processos = [], tabelas = {}, ged = {}, config = null } = {}){
  const buckets = { backups: {}, 'controle-arquivos': { ...ged } };
  if (config) buckets.backups[d._interno.CONFIG_PATH] = Buffer.from(JSON.stringify(config));
  const dados = { controle_arquivos: arquivos, controle_processos: processos, ...tabelas };
  const sb = {
    storage: {
      listBuckets: async () => ({ data: Object.keys(buckets).map(name => ({ name })) }),
      createBucket: async (n) => { buckets[n] = {}; return {}; },
      from: (b) => ({
        download: async (p) => buckets[b][p] ? ({ data: { arrayBuffer: async () => buckets[b][p], text: async () => buckets[b][p].toString('utf8') } }) : ({ error: { message: 'not found' } }),
        upload: async (p, buf) => { buckets[b][p] = Buffer.from(buf); return {}; },
        remove: async () => { throw new Error('backup NUNCA deve apagar nada'); },
      }),
    },
    from: (t) => ({ select: () => ({ range: async (a, z) => ({ data: (dados[t] || []).slice(a, z + 1) }) }) }),
  };
  return { sb, buckets };
}

function fetchFake({ existentes = new Set(), falharTokenRefresh = false, falhar429Uma = false } = {}){
  const log = { uploads: [], tokens: 0 };
  let deu429 = false;
  const fn = async (url, opt) => {
    if (url.includes('/oauth2/token')) {
      log.tokens++;
      const body = new URLSearchParams(opt.body);
      if (body.get('grant_type') === 'authorization_code') {
        if (!body.get('code_verifier')) return { ok: false, json: async () => ({ error: 'invalid_grant' }) };
        return { ok: true, json: async () => ({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 14400, account_id: 'dbid:x' }) };
      }
      if (falharTokenRefresh) return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
      return { ok: true, json: async () => ({ access_token: 'AT2', expires_in: 14400 }) };
    }
    if (url.includes('/files/upload')) {
      const arg = JSON.parse(opt.headers['Dropbox-API-Arg']);
      ok(/^[\x00-\x7e]*$/.test(opt.headers['Dropbox-API-Arg']), 'cabeçalho com caractere não-ASCII');
      if (falhar429Uma && !deu429) { deu429 = true; return { ok: false, status: 429, headers: { get: () => '0' }, text: async () => 'too_many' }; }
      if (arg.mode === 'add' && existentes.has(arg.path)) return { ok: false, status: 409, text: async () => '{"error_summary":"path/conflict/file/.."}' };
      log.uploads.push({ path: arg.path, mode: arg.mode, bytes: opt.body.length });
      existentes.add(arg.path);
      return { ok: true };
    }
    throw new Error('url inesperada ' + url);
  };
  return { fn, log };
}

(async () => {
  console.log('\n── utilitários ──');
  await teste('argHeader escapa acentos (cabeçalho HTTP só ASCII)', () => {
    const h = d._interno.argHeader({ path: '/GED/São Paulo/Fatura ção.pdf' });
    ok(/^[\x00-\x7e]*$/.test(h)); iguais(JSON.parse(h).path, '/GED/São Paulo/Fatura ção.pdf');
  });
  await teste('nomeSeguro troca caracteres proibidos e corta pontos finais', () => {
    iguais(d._interno.nomeSeguro('CI: 01/02 "final"?. '), 'CI_ 01_02 _final__');
    iguais(d._interno.nomeSeguro(''), 'sem_nome');
  });
  await teste('caminhoGed usa referência + data + id + nome, e completa extensão', () => {
    const p = d._interno.caminhoGed({ id: 'abcdef12-3456', processo_id: 'p1', nome: 'BL original', storage_path: 'p1/abcdef12.pdf', created_at: '2026-09-10T10:00:00Z' }, 'UD26-165');
    iguais(p, '/GED/UD26-165/2026-09-10_abcdef12_BL original.pdf');
  });
  await teste('URL de autorização pede refresh token (offline) com PKCE S256', () => {
    const { verifier, challenge } = d.gerarPkce();
    ok(verifier.length >= 43 && challenge.length >= 43);
    const u = new URL(d.urlAutorizacao({ appKey: 'K', redirectUri: 'https://x/cb', state: 's', challenge }));
    iguais([u.searchParams.get('token_access_type'), u.searchParams.get('code_challenge_method'), u.searchParams.get('client_id')], ['offline', 'S256', 'K']);
  });

  console.log('\n── conexão ──');
  await teste('trocarCodigo grava refresh token no bucket privado (sem secret)', async () => {
    d._interno.resetCache();
    const { sb, buckets } = sbFake(); const f = fetchFake();
    await d.trocarCodigo({ sb, fetchFn: f.fn, appKey: 'K', code: 'C', verifier: 'V', redirectUri: 'https://x/cb', usuario: 'suporte' });
    const cfg = JSON.parse(buckets.backups[d._interno.CONFIG_PATH].toString());
    iguais([cfg.refresh_token, cfg.conectado_por], ['RT1', 'suporte']);
    iguais((await d.status(sb)).conectado, true);
  });
  await teste('status: não conectado quando não há config', async () => {
    const { sb } = sbFake(); iguais((await d.status(sb)).conectado, false);
  });

  console.log('\n── executar ──');
  const arquivos = [
    { id: 'a1111111', processo_id: 'p1', nome: 'CI.pdf', storage_path: 'p1/a1.pdf', created_at: '2026-09-01' },
    { id: 'a2222222', processo_id: 'p1', nome: 'Nota São.pdf', storage_path: 'p1/a2.pdf', created_at: '2026-09-02' },
    { id: 'a3333333', processo_id: 'p2', nome: 'BL.pdf', storage_path: 'p2/a3.pdf', created_at: '2026-09-03' },
  ];
  const ged = { 'p1/a1.pdf': Buffer.from('um'), 'p1/a2.pdf': Buffer.from('dois'), 'p2/a3.pdf': Buffer.from('tres') };
  const processos = [{ id: 'p1', referencia: 'UD26-001' }, { id: 'p2', referencia: 'HK/60684' }];

  await teste('1ª execução envia todos os arquivos do GED + tabelas; usuarios sem hash', async () => {
    d._interno.resetCache();
    const { sb, buckets } = sbFake({ arquivos, processos, ged, config: { refresh_token: 'RT' },
      tabelas: { usuarios: [{ usuario: 'x', senha_hash: 'SEGREDO', totp_secret: 'T' }] } });
    const f = fetchFake();
    const r = await d.executar({ sb, fetchFn: f.fn, appKey: 'K', tabelas: ['usuarios'], incluirTabelas: true });
    iguais(r.ok, true, JSON.stringify(r.erros));
    iguais(r.ged.enviados, 3);
    ok(f.log.uploads.some(u => u.path === '/GED/HK_60684/2026-09-03_a3333333_BL.pdf'), 'referência com / vira _');
    const tab = f.log.uploads.find(u => u.path.startsWith('/Tabelas/'));
    ok(tab && tab.mode === 'overwrite');
    const manif = JSON.parse(buckets.backups[d._interno.MANIFESTO_PATH].toString());
    iguais(manif.ids.sort(), ['a1111111', 'a2222222', 'a3333333']);
    const st = await d.status(sb);
    ok(st.ultimo_ok_em && st.ultimas_tabelas_em, 'status gravado');
  });

  await teste('2ª execução é incremental: só o arquivo novo sobe', async () => {
    d._interno.resetCache();
    const { sb } = sbFake({ arquivos: [...arquivos, { id: 'a4444444', processo_id: 'p2', nome: 'NF.pdf', storage_path: 'p2/a4.pdf', created_at: '2026-09-04' }],
      processos, ged: { ...ged, 'p2/a4.pdf': Buffer.from('quatro') }, config: { refresh_token: 'RT' } });
    const f = fetchFake();
    await d.executar({ sb, fetchFn: f.fn, appKey: 'K', incluirTabelas: false });
    const f2 = fetchFake();
    // simula mais um arquivo depois do 1º ciclo
    const r2 = await d.executar({ sb, fetchFn: f2.fn, appKey: 'K', incluirTabelas: false });
    iguais(r2.ged.enviados, 0, 'nada novo no 2º ciclo');
    iguais(f.log.uploads.length, 4);
  });

  await teste('arquivo que já existe no Dropbox (409 conflict) conta como enviado, sem erro', async () => {
    d._interno.resetCache();
    const { sb } = sbFake({ arquivos: arquivos.slice(0, 1), processos, ged, config: { refresh_token: 'RT' } });
    const f = fetchFake({ existentes: new Set(['/GED/UD26-001/2026-09-01_a1111111_CI.pdf']) });
    const r = await d.executar({ sb, fetchFn: f.fn, appKey: 'K' });
    iguais([r.ok, r.ged.enviados, r.ged.ja_existiam], [true, 0, 1]);
  });

  await teste('429 (limite do Dropbox) tenta de novo e conclui', async () => {
    d._interno.resetCache();
    const { sb } = sbFake({ arquivos: arquivos.slice(0, 1), processos, ged, config: { refresh_token: 'RT' } });
    const f = fetchFake({ falhar429Uma: true });
    const r = await d.executar({ sb, fetchFn: f.fn, appKey: 'K' });
    iguais([r.ok, r.ged.enviados], [true, 1]);
  });

  await teste('arquivo sumido do storage vira erro mas não para os outros', async () => {
    d._interno.resetCache();
    const { sb } = sbFake({ arquivos, processos, ged: { 'p1/a1.pdf': Buffer.from('um'), 'p2/a3.pdf': Buffer.from('tres') }, config: { refresh_token: 'RT' } });
    const f = fetchFake();
    const r = await d.executar({ sb, fetchFn: f.fn, appKey: 'K' });
    iguais([r.ok, r.ged.enviados, r.ged.erros], [false, 2, 1]);
  });

  await teste('refresh token revogado: erro claro, nada enviado, não apaga nada', async () => {
    d._interno.resetCache();
    const { sb } = sbFake({ arquivos, processos, ged, config: { refresh_token: 'RT' } });
    const f = fetchFake({ falharTokenRefresh: true });
    const r = await d.executar({ sb, fetchFn: f.fn, appKey: 'K' });
    ok(!r.ok && /reconecte/i.test(r.erros[0]), r.erros[0]);
    iguais(f.log.uploads.length, 0);
    iguais(d.estaRodando(), false, 'libera a trava mesmo com erro');
  });

  await teste('sem conexão: erro "não conectado"', async () => {
    d._interno.resetCache();
    const { sb } = sbFake({ arquivos, processos, ged });
    const r = await d.executar({ sb, fetchFn: fetchFake().fn, appKey: 'K' });
    ok(/não conectado/.test(r.erros[0]));
  });

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total-passaram} falharam`);
  process.exit(passaram===total?0:1);
})();
