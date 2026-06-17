/**
 * IMPAK Portal — Servidor v2.0
 * Banco de dados: Supabase PostgreSQL
 *
 * Variáveis Railway obrigatórias:
 *   SUPABASE_URL  → URL do projeto Supabase
 *   SUPABASE_KEY  → service_role key
 *
 * Variáveis Railway opcionais:
 *   ANTHROPIC_API_KEY → chave da API Anthropic
 *   SESSION_SECRET    → segredo da sessão
 *   SENHA_*           → senhas dos usuários
 */

const express = require('express');
const session = require('express-session');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

function gerarUUID(){ return randomUUID(); }

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SUPABASE ──────────────────────────────────────────────────
// Inicialização lazy — variáveis de ambiente disponíveis somente
// após o processo iniciar, não no momento do require()
let _sb = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_KEY não configurados no Railway');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  console.log('✓ Supabase conectado:', url.slice(0, 40) + '...');
  return _sb;
}

// ── USUÁRIOS ──────────────────────────────────────────────────
function env(key, fallback) { return process.env[key] || fallback; }

const USUARIOS = [
  { usuario: 'narcelio',  senha: env('SENHA_NARCELIO',  'Narcelio@2026'),      modulos: ['tyredesk','processos'], nome: 'Narcelio',  role: 'gerente',  displayName: 'Narcelio',  home: '/'           },
  { usuario: 'jean',      senha: env('SENHA_JEAN',      'Jeanimpak2026'),      modulos: ['tyredesk','processos'], nome: 'Jean',      role: 'gerente',  displayName: 'Jean',      home: '/'           },
  { usuario: 'paula',     senha: env('SENHA_PAULA',     'Paula@2026'),         modulos: ['tyredesk','processos'], nome: 'Paula',     role: 'gerente',  displayName: 'Paula',     home: '/processos'  },
  { usuario: 'bianca',    senha: env('SENHA_BIANCA',    'Bianca@2026'),        modulos: ['tyredesk','processos'], nome: 'Bianca',    role: 'gerente',  displayName: 'Bianca',    home: '/processos'  },
  { usuario: 'emanuelly', senha: env('SENHA_EMANUELLY', 'EmanuellyImpak2026'), modulos: ['tyredesk','processos'], nome: 'Emanuelly', role: 'analista', displayName: 'Emanuelly', home: '/processos'  },
  { usuario: 'italo',     senha: env('SENHA_ITALO',     'Italo@2026'),         modulos: ['tyredesk','processos'], nome: 'Italo',     role: 'analista', displayName: 'Italo',     home: '/processos'  },
  { usuario: 'maria',     senha: env('SENHA_MARIA',     'Maria@2026'),         modulos: ['tyredesk','processos'], nome: 'Maria',     role: 'analista', displayName: 'Maria',     home: '/processos'  },
  { usuario: 'joyce',     senha: env('SENHA_JOYCE',     'Joyce@2026'),         modulos: ['tyredesk','processos'], nome: 'Joyce',     role: 'analista', displayName: 'Joyce',     home: '/processos'  },
  { usuario: 'neide',     senha: env('SENHA_NEIDE',     'Neide@2026'),         modulos: ['tyredesk','processos'], nome: 'Neide',     role: 'analista', displayName: 'Neide',     home: '/processos'  },
];

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: env('SESSION_SECRET', 'impak-secret-2026'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));
app.use(express.static(__dirname));

// ── LOGIN PAGE ────────────────────────────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Acesso</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e8f0f8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'DM Sans',sans-serif;}
.wrap{width:400px;max-width:94vw;}
.logo-row{display:flex;align-items:center;gap:12px;justify-content:center;margin-bottom:28px;}
.logo-badge{background:#1a7fd4;color:#fff;font-family:'Syne',sans-serif;font-size:22px;font-weight:800;padding:6px 14px;border-radius:6px;letter-spacing:1px;}
.logo-sub{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#4a6480;letter-spacing:2px;text-transform:uppercase;}
.box{background:#fff;border:1px solid #c8d8e8;border-top:3px solid #1a7fd4;border-radius:14px;padding:36px 32px;box-shadow:0 8px 32px rgba(26,127,212,.1);}
h1{font-family:'Syne',sans-serif;font-size:17px;font-weight:700;color:#0d1e2e;text-align:center;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
.sub{font-size:11px;color:#1a7fd4;text-align:center;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:28px;}
label{display:block;font-size:10px;font-weight:700;color:#4a6480;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;}
input{width:100%;background:#dce8f5;border:1px solid #c8d8e8;border-radius:7px;color:#0d1e2e;font-family:'DM Sans',sans-serif;font-size:14px;padding:11px 14px;outline:none;transition:all .15s;margin-bottom:16px;}
input:focus{border-color:#1a7fd4;background:#c8ddf0;}
button{width:100%;background:#1a7fd4;border:none;border-radius:7px;color:#fff;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;padding:12px;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;transition:background .15s;margin-top:4px;}
button:hover{background:#1567b8;}
.err{background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:6px;padding:10px 14px;font-size:12px;color:#c0392b;font-weight:600;text-align:center;margin-bottom:16px;}
.footer{text-align:center;margin-top:18px;font-size:10px;color:#a8bfd4;}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo-row">
    <div class="logo-badge">IMPAK</div>
    <div class="logo-sub">Portal</div>
  </div>
  <div class="box">
    <h1>Acesso ao Sistema</h1>
    <div class="sub">TyreDesk + Gestão de Processos</div>
    ERRO_PLACEHOLDER
    <form method="POST" action="/login">
      <label>Usuário</label>
      <input name="usuario" type="text" placeholder="seu usuário" autocomplete="username" required autofocus>
      <label>Senha</label>
      <input name="senha" type="password" placeholder="sua senha" autocomplete="current-password" required>
      <input type="hidden" name="destino" value="DESTINO_PLACEHOLDER">
      <button type="submit">Entrar</button>
    </form>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
</body>
</html>`;

function loginPage(erro, destino) {
  return LOGIN_HTML
    .replace('ERRO_PLACEHOLDER', erro ? `<div class="err">${erro}</div>` : '')
    .replace('DESTINO_PLACEHOLDER', destino || '/');
}

// ── AUTENTICAÇÃO ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect(req.query.destino || '/');
  res.send(loginPage('', req.query.destino || '/'));
});

app.post('/login', (req, res) => {
  const { usuario, senha, destino } = req.body;
  const login = (usuario || '').trim().toLowerCase();
  const u = USUARIOS.find(x => x.usuario === login && x.senha === senha);
  if (!u) return res.send(loginPage('Usuário ou senha incorretos.', destino || '/'));
  req.session.usuario     = u.usuario;
  req.session.nome        = u.nome;
  req.session.modulos     = u.modulos;
  req.session.role        = u.role;
  req.session.displayName = u.displayName;
  req.session.senha       = u.senha;
  req.session.home        = u.home || '/';
  res.redirect(destino && destino !== '/' ? destino : (u.home || '/'));
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

function auth(modulo) {
  return (req, res, next) => {
    if (!req.session.usuario) return res.redirect('/login?destino=' + req.path);
    if (modulo && !req.session.modulos.includes(modulo)) return res.status(403).send('<h2>Acesso negado</h2>');
    next();
  };
}

// ── PÁGINAS ───────────────────────────────────────────────────
app.get('/',          auth('tyredesk'),  (req, res) => res.sendFile(path.join(__dirname, 'tyredesk.html')));
app.get('/processos', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'processos.html')));

// ── API: SESSÃO ───────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.usuario) return res.json({ logado: false });
  res.json({
    logado:      true,
    usuario:     req.session.usuario,
    nome:        req.session.nome,
    modulos:     req.session.modulos,
    role:        req.session.role,
    displayName: req.session.displayName,
    senha:       req.session.senha,
  });
});

// ── API: CONFERÊNCIA ──────────────────────────────────────────
app.get('/api/conferencia/index', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('conferencia_processos')
      .select('id, ref, exportador, obs, status, data, created_by, updated_at, dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const index = (data || []).map(p => ({
      id:           p.id,
      ref:          p.ref        || '',
      exportador:   p.exportador || '',
      obs:          p.obs        || '',
      status:       p.status     || 'ok',
      data:         p.data       || '',
      _user:        p.created_by || '',
      _updatedAt:   new Date(p.updated_at).getTime(),
      _divResolvedMap: (p.dados && p.dados._divResolvedMap) ? p.dados._divResolvedMap : {},
      analises:     (p.dados && p.dados.analises) ? p.dados.analises.map(a => ({
        id: a.id, data: a.data, docs: a.docs, resumo: a.resumo,
        grupos: a.grupos || [],
        alertas: a.alertas || [],
      })) : [],
    }));
    console.log(`/api/conferencia/index: ${index.length} processos`);
    res.json({ ok: true, index, total: index.length });
  } catch (e) {
    console.error('conferencia/index erro:', e.message);
    res.json({ ok: true, index: [], total: 0 });
  }
});

app.get('/api/conferencia/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('conferencia_processos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return res.json({ ok: false, processo: null });
    const proc = { ...data.dados, id: data.id, ref: data.ref,
      exportador: data.exportador, obs: data.obs, status: data.status,
      data: data.data, _user: data.created_by,
      _updatedAt: new Date(data.updated_at).getTime() };
    res.json({ ok: true, processo: proc });
  } catch (e) {
    console.error('conferencia/processo GET erro:', e.message);
    res.json({ ok: false, processo: null });
  }
});

app.post('/api/conferencia/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.id) return res.status(400).json({ erro: 'Processo inválido' });
    const row = {
      id:         processo.id,
      ref:        processo.ref        || '',
      exportador: processo.exportador || '',
      obs:        processo.obs        || '',
      status:     processo.status     || 'ok',
      data:       processo.data       || new Date().toLocaleDateString('pt-BR'),
      created_by: processo._user      || req.session.usuario,
      updated_by: req.session.usuario,
      updated_at: new Date().toISOString(),
      dados:      processo,
    };
    const { error } = await sb()
      .from('conferencia_processos')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`conferencia salvo: ${processo.ref} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('conferencia/processo POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/conferencia/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { error } = await sb()
      .from('conferencia_processos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('conferencia/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── API: CONTROLE v2 ──────────────────────────────────────────
app.get('/controle', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
app.get('/calculador', auth('tyredesk'), (req, res) => res.sendFile(path.join(__dirname, 'calculador.html'), {headers:{'Content-Type':'text/html; charset=utf-8'}}));

app.get('/api/controle/v2/processos', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: data || [] });
  } catch (e) {
    console.error('controle v2 GET erro:', e.message);
    res.json({ ok: true, processos: [] });
  }
});

app.post('/api/controle/v2/importar', auth('processos'), async (req, res) => {
  try {
    const { processos } = req.body;
    if (!processos || !processos.length) return res.json({ ok: true, total: 0 });
    const agora = new Date().toISOString();

    // Buscar referências já existentes para evitar duplicatas
    const refs = processos.map(p => p.referencia).filter(Boolean);
    const { data: existentes } = await sb()
      .from('controle_processos')
      .select('id, referencia')
      .in('referencia', refs);

    const refsExistentes = new Set((existentes||[]).map(e => e.referencia));

    // Só inserir os que não existem
    const novos = processos
      .filter(p => p.referencia && !refsExistentes.has(p.referencia))
      .map(p => ({
        ...p,
        id: p.id || gerarUUID(),
        updated_at: agora,
        created_at: p.created_at || agora,
      }));

    if (!novos.length) {
      return res.json({ ok: true, total: 0, msg: 'Todos os processos já existem' });
    }

    // Inserir em lotes de 50
    for (let i = 0; i < novos.length; i += 50) {
      const { error } = await sb()
        .from('controle_processos')
        .insert(novos.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }

    console.log(`controle v2 importar: ${novos.length} novos de ${processos.length} por ${req.session.usuario}`);
    res.json({ ok: true, total: novos.length, ignorados: processos.length - novos.length });
  } catch (e) {
    console.error('controle v2 importar erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.referencia) return res.status(400).json({ erro: 'Referência obrigatória' });
    if (!processo.id) processo.id = gerarUUID();
    processo.updated_at = new Date().toISOString();

    // Log de auditoria no banco
    const logEntries = (processo.log || []).filter(l => !l._saved);
    if (logEntries.length) {
      const rows = logEntries.map(l => ({
        processo_id: processo.id,
        usuario: l.usuario || req.session.usuario,
        campo: l.campo || '',
        valor_antes: String(l.valor_antes || ''),
        valor_depois: String(l.valor_depois || ''),
        created_at: l.created_at || new Date().toISOString(),
      }));
      try {
        await sb().from('controle_log').insert(rows);
      } catch(logErr) {
        console.warn('log erro:', logErr.message);
      }
      processo.log = (processo.log || []).map(l => ({ ...l, _saved: true }));
    }

    // Remover campos internos antes de salvar no banco
    const { log: _log, _fasePrevista, _savedAt, ...processoLimpo } = processo;

    const { error } = await sb()
      .from('controle_processos')
      .upsert(processoLimpo, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    // Criar notificação de demurrage se necessário
    if (processo.demurrage_vencimento) {
      const venc = new Date(processo.demurrage_vencimento);
      const dias = Math.ceil((venc - new Date()) / 86400000);
      if (dias <= 5 && dias >= 0 && !processo.data_devolucao_vazio) {
        try {
          await sb().from('controle_notificacoes').insert({
            processo_id: processo.id,
            tipo: 'urgente',
            titulo: `Demurrage: ${processo.referencia}`,
            mensagem: `Container vence em ${dias} dia(s)!`,
            created_by: req.session.usuario,
          });
        } catch(notifErr) {
          console.warn('notificacao erro:', notifErr.message);
        }
      }
    }

    console.log(`controle v2 salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle v2 POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/controle/v2/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { error } = await sb().from('controle_processos').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/v2/notificacoes', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_notificacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    res.json({ ok: true, notificacoes: data || [] });
  } catch (e) {
    res.json({ ok: true, notificacoes: [] });
  }
});

app.post('/api/controle/v2/notificacao', auth('processos'), async (req, res) => {
  try {
    const { processo_id, tipo, titulo, mensagem } = req.body;
    await sb().from('controle_notificacoes').insert({
      processo_id, tipo, titulo, mensagem, created_by: req.session.usuario,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/notificacao/:id/lida', auth('processos'), async (req, res) => {
  try {
    const { usuario } = req.body;
    const { data } = await sb().from('controle_notificacoes').select('lida_por').eq('id', req.params.id).single();
    const lidaPor = [...(data?.lida_por || [])];
    if (!lidaPor.includes(usuario)) lidaPor.push(usuario);
    await sb().from('controle_notificacoes').update({ lida_por: lidaPor }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});


app.get('/api/controle/index', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('id, referencia, cliente, fase, status, updated_at, dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const index = (data || []).map(p => {
      const d = p.dados || {};
      return {
        id: p.id, referencia: p.referencia, cliente: p.cliente,
        fase: p.fase, status: p.status,
        exportador: d.exportador||'', eta: d.eta||'',
        data_chegada: d.data_chegada||'', data_embarque: d.data_embarque||'',
        porto: d.porto||'', armador: d.armador||'', free_time: d.free_time||21,
        canal_parametrizacao: d.canal_parametrizacao||'', hbl: d.hbl||'',
        numero_di: d.numero_di||'', data_presenca: d.data_presenca||'',
        data_retirada: d.data_retirada||'', data_ric: d.data_ric||'',
        navio: d.navio||'', previsao_prontidao: d.previsao_prontidao||'',
        agente: d.agente||'', despachante: d.despachante||'',
        produtos: d.produtos||'', quant_containers: d.quant_containers||'',
        _updatedAt: new Date(p.updated_at).getTime(),
      };
    });
    res.json({ ok: true, index, processos: index, total: index.length });
  } catch (e) {
    console.error('controle/index erro:', e.message);
    res.json({ ok: true, index: [], processos: [], total: 0 });
  }
});

app.get('/api/controle/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return res.json({ ok: false, processo: null });
    const proc = { ...data.dados, id: data.id, referencia: data.referencia,
      cliente: data.cliente, fase: data.fase };
    res.json({ ok: true, processo: proc });
  } catch (e) {
    console.error('controle/processo GET erro:', e.message);
    res.json({ ok: false, processo: null });
  }
});

app.post('/api/controle/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.id) return res.status(400).json({ erro: 'Processo inválido' });
    const row = {
      id:         processo.id,
      referencia: processo.referencia || '',
      cliente:    processo.cliente    || '',
      fase:       processo.fase       || 'PRODUCAO',
      status:     processo.status     || 'ativo',
      updated_by: req.session.usuario,
      updated_at: new Date().toISOString(),
      dados:      processo,
    };
    const { error } = await sb()
      .from('controle_processos')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`controle salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/controle/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { error } = await sb()
      .from('controle_processos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/importar', auth('processos'), async (req, res) => {
  try {
    const { processos } = req.body;
    if (!processos || !processos.length) return res.json({ ok: true, total: 0 });

    const agora = new Date().toISOString();

    // Buscar referências já existentes
    const refs = processos.map(p => p.referencia).filter(Boolean);
    const { data: existentes } = await sb()
      .from('controle_processos')
      .select('referencia')
      .in('referencia', refs);
    const refsExistentes = new Set((existentes||[]).map(e => e.referencia));

    const novos = processos
      .filter(p => p.referencia && !refsExistentes.has(p.referencia))
      .map(p => {
        // Suportar tanto formato antigo (com dados{}) quanto novo (campos diretos)
        const d = p.dados || p;
        return {
          id:                  p.id || gerarUUID(),
          referencia:          p.referencia || d.referencia || '',
          fornecedor:          d.fornecedor  || '',
          cliente:             d.cliente     || p.cliente || '',
          produto:             d.produto     || '',
          fase:                d.fase        || p.fase || 'PI',
          eta:                 d.eta         || null,
          etd:                 d.etd         || null,
          data_embarque:       d.data_embarque || null,
          data_chegada:        d.data_chegada  || null,
          data_presenca:       d.data_presenca || null,
          armador:             d.armador     || '',
          navio:               d.navio       || '',
          container:           d.container   || '',
          hbl:                 d.hbl         || '',
          mbl:                 d.mbl         || '',
          numero_di:           d.numero_di   || '',
          obs:                 d.obs         || '',
          free_time:           d.free_time   || 21,
          demurrage_vencimento: d.demurrage_vencimento || null,
          created_by:          p.created_by || req.session.usuario,
          updated_by:          req.session.usuario,
          updated_at:          agora,
          created_at:          p.created_at || agora,
        };
      });

    if (!novos.length) {
      return res.json({ ok: true, total: 0, msg: 'Todos já existem' });
    }

    for (let i = 0; i < novos.length; i += 50) {
      const { error } = await sb()
        .from('controle_processos')
        .insert(novos.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }

    console.log(`controle/importar: ${novos.length} novos de ${processos.length} por ${req.session.usuario}`);
    res.json({ ok: true, total: novos.length, ignorados: processos.length - novos.length });
  } catch (e) {
    console.error('controle/importar erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/carregar', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: (data || []).map(r => r.dados) });
  } catch (e) { res.json({ ok: true, processos: [] }); }
});

// ── API: TYREDESK ─────────────────────────────────────────────
app.post('/api/base/salvar', auth('tyredesk'), async (req, res) => {
  try {
    const { base } = req.body;
    const { error } = await sb()
      .from('tyredesk_base')
      .upsert({ id: 1, dados: base, updated_by: req.session.usuario, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`TyreDesk base salva por ${req.session.usuario}: ${base.length} itens`);
    res.json({ ok: true, total: base.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_base')
      .select('dados')
      .eq('id', 1)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    const base = data ? data.dados : null;
    res.json({ ok: !!base, base, total: base ? base.length : 0 });
  } catch (e) { res.json({ ok: false, base: null }); }
});

app.post('/api/base/salvar-fornecedores', auth('tyredesk'), async (req, res) => {
  try {
    const { fornecedores } = req.body;
    const { error } = await sb()
      .from('tyredesk_fornecedores')
      .upsert({ id: 1, dados: fornecedores, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar-fornecedores', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_fornecedores')
      .select('dados')
      .eq('id', 1)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    res.json({ ok: true, fornecedores: data ? data.dados : null });
  } catch (e) { res.json({ ok: false, fornecedores: null }); }
});

app.post('/api/base/salvar-snapshots', auth('tyredesk'), async (req, res) => {
  try {
    const { snapshots } = req.body;
    const { error } = await sb()
      .from('tyredesk_fornecedores')
      .upsert({ id: 2, dados: snapshots, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar-snapshots', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_fornecedores')
      .select('dados')
      .eq('id', 2)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    res.json({ ok: true, snapshots: data ? data.dados : [] });
  } catch (e) { res.json({ ok: true, snapshots: [] }); }
});

// ── API: ANÁLISE DOCUMENTAL ───────────────────────────────────
app.post('/api/analisar', auth('processos'), async (req, res) => {
  try {
    const { content, apiKey } = req.body;
    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ erro: 'Conteúdo inválido' });
    }
    const keyCliente = (apiKey || '').trim();
    const keyEnv     = (process.env.ANTHROPIC_API_KEY || '').trim();
    const key        = keyCliente.length > 20 ? keyCliente : keyEnv;
    if (!key || key.length < 20) {
      return res.status(400).json({ erro: 'API key não configurada.' });
    }
    console.log(`/api/analisar: key=${key.length}chars fonte=${keyCliente.length > 20 ? 'cliente' : 'env'}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    let respData;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content }] }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return res.status(resp.status).json({ erro: `API Anthropic erro ${resp.status}: ${err?.error?.message || resp.statusText}` });
      }
      respData = await resp.json();
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ erro: 'Análise demorou mais de 3 minutos. Tente com menos documentos.' });
      }
      throw fetchErr;
    }
    res.json({ ok: true, data: respData });
  } catch (e) {
    console.error('Erro /api/analisar:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── CONTATOS (Clientes, Fornecedores, Despachantes, Agentes) ──
app.get('/api/contatos', auth(), async (req, res) => {
  try {
    const { q, tipo, uf } = req.query;
    let query = sb().from('contatos_clientes').select('id,cnpj,razao_social,nome_fantasia,cidade,uf,email,telefone,tipo').eq('ativo', true);
    if (tipo) query = query.eq('tipo', tipo.toUpperCase());
    if (uf)   query = query.eq('uf', uf.toUpperCase());
    if (q && q.length >= 2) {
      query = query.or(`razao_social.ilike.%${q}%,cnpj.ilike.%${q}%,nome_fantasia.ilike.%${q}%`);
    }
    query = query.order('razao_social').limit(30);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json({ ok: true, contatos: data || [] });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/contatos', auth('processos'), async (req, res) => {
  try {
    const c = req.body;
    if (!c.razao_social) return res.status(400).json({ erro: 'Razão social obrigatória' });
    if (!c.id) c.id = require('crypto').randomUUID();
    c.updated_at = new Date().toISOString();
    const { error } = await sb().from('contatos_clientes').upsert(c, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true, id: c.id });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/contatos/:id', auth('processos'), async (req, res) => {
  try {
    const { error } = await sb().from('contatos_clientes').update({ ativo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── HEALTH ────────────────────────────────────────────────────

// Servir chat.js
app.get('/chat.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'chat.js'));
});

// ════════════════════════════════════════════════════════════════
// CHAT COM IA — consulta inteligente sobre processos
// ════════════════════════════════════════════════════════════════
app.post('/api/chat', auth('processos'), async (req, res) => {
  try {
    const { mensagem, historico = [] } = req.body;
    if (!mensagem) return res.status(400).json({ erro: 'Mensagem vazia' });

    // Buscar todos os processos do banco para contexto
    const { data: processos, error } = await sb()
      .from('controle_processos')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);

    const hoje = new Date();
    const ativos = (processos || []).filter(p => p.fase !== 'FINALIZADO');
    const finalizados = (processos || []).filter(p => p.fase === 'FINALIZADO');

    // Calcular demurrage para cada processo ativo
    function demDias(p) {
      if (!p.demurrage_vencimento || p.data_devolucao_vazio) return null;
      const d = new Date(p.demurrage_vencimento);
      return Math.ceil((d - hoje) / 86400000);
    }

    // Resumo executivo para contexto da IA
    const porFase = {};
    ativos.forEach(p => { porFase[p.fase] = (porFase[p.fase] || 0) + 1; });

    const demCrit = ativos.filter(p => { const d = demDias(p); return d !== null && d <= 5; });
    const etaVenc = ativos.filter(p => p.eta && p.fase === 'EMBARCADO' && new Date(p.eta) < hoje);
    const semana  = new Date(hoje); semana.setDate(hoje.getDate() + 7);
    const etaSem  = ativos.filter(p => p.eta && new Date(p.eta) >= hoje && new Date(p.eta) <= semana && p.fase === 'EMBARCADO');
    const piVenc  = ativos.filter(p => p.pi_data_saldo && !p.pi_pago && new Date(p.pi_data_saldo) < hoje);

    // Montar contexto compacto (evitar context window enorme)
    const ctx = {
      data_hoje: hoje.toLocaleDateString('pt-BR'),
      total_processos: processos.length,
      em_andamento: ativos.length,
      finalizados: finalizados.length,
      por_fase: porFase,
      alertas: {
        demurrage_critico: demCrit.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, armador: p.armador,
          dias: demDias(p), container: p.container
        })),
        eta_vencido: etaVenc.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, eta: p.eta, armador: p.armador
        })),
        pi_vencida: piVenc.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, vencimento: p.pi_data_saldo,
          valor: p.pi_valor_usd
        })),
        chegando_semana: etaSem.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, eta: p.eta, armador: p.armador
        }))
      },
      processos_ativos: ativos.map(p => ({
        ref: p.referencia, fornecedor: p.fornecedor, cliente: p.cliente,
        fase: p.fase, eta: p.eta, hbl: p.hbl, mbl: p.mbl,
        container: p.container, armador: p.armador, navio: p.navio,
        numero_di: p.numero_di, pi_valor_usd: p.pi_valor_usd,
        pi_pago: p.pi_pago, pi_data_saldo: p.pi_data_saldo,
        nf_entrada_numero: p.nf_entrada_numero, nf_saida_numero: p.nf_saida_numero,
        nf_saida_valor: p.nf_saida_valor, obs: p.obs,
        demurrage_vencimento: p.demurrage_vencimento,
        data_embarque: p.data_embarque, data_chegada: p.data_chegada,
      }))
    };

    const systemPrompt = `Você é o assistente de importação da IMPAK COMERCIAL IMPORTADORA LTDA, especializado em pneus importados da Ásia (Vietnam e China) para o Brasil.

Você tem acesso em tempo real a todos os processos de importação. Responda de forma direta, objetiva e em português brasileiro.

DADOS ATUAIS (${hoje.toLocaleDateString('pt-BR')}):
${JSON.stringify(ctx, null, 2)}

INSTRUÇÕES:
- Responda perguntas sobre status de processos, ETAs, demurrage, pagamentos e faturamento
- Dê alertas proativos quando identificar riscos (demurrage, pagamentos vencidos, ETA vencido)
- Use os dados reais acima para responder com precisão
- Quando listar processos, use o formato: REF | FORNECEDOR | FASE | detalhe relevante
- Seja conciso mas completo
- Sugira ações quando pertinente (ex: "Recomendo contatar o armador X sobre o container Y")
- Valores em USD mantenha em USD, valores em BRL no formato R$ X.XXX,XX`;

    // Chamar Claude API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

    const messages = [
      ...historico.slice(-8), // últimas 8 mensagens para contexto
      { role: 'user', content: mensagem }
    ];

    // Timeout de 25s para evitar conexão pendurada no Railway
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const resposta = data.content?.[0]?.text || 'Não consegui processar sua pergunta.';
    console.log(`chat: ${req.session.usuario} → "${mensagem.slice(0,50)}..."`);

    res.json({ ok: true, resposta });
  } catch (e) {
    console.error('chat erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── HISTÓRICO TYREDESK (email de cotações) ──────────────────────
app.get('/api/drive/historico', auth('tyredesk'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_historico')
      .select('*')
      .order('data', { ascending: false })
      .limit(100);
    if (error) {
      // Tabela pode não existir ainda — retornar vazio sem erro
      return res.json({ ok: true, historico: [] });
    }
    res.json({ ok: true, historico: data || [] });
  } catch(e) {
    res.json({ ok: true, historico: [] });
  }
});

app.post('/api/drive/historico', auth('tyredesk'), async (req, res) => {
  try {
    const { entrada } = req.body;
    if (!entrada) return res.json({ ok: true });
    entrada.id = entrada.id || gerarUUID();
    const { error } = await sb()
      .from('tyredesk_historico')
      .insert([entrada]);
    // Ignorar erro se tabela não existir — não é crítico
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true }); // não crítico
  }
});

app.post('/api/drive/historico/limpar', auth('tyredesk'), async (req, res) => {
  try {
    await sb().from('tyredesk_historico').delete().neq('id', '');
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true });
  }
});

app.get('/health', async (req, res) => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_KEY || '';

  // Decodificar role da key sem dependência externa
  let keyRole = 'desconhecido';
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
    keyRole = payload.role || 'desconhecido';
  } catch(e) {}

  let supabaseOk = false;
  let supabaseErro = null;
  try {
    const { data, error } = await sb().from('conferencia_processos').select('id').limit(1);
    supabaseOk = !error;
    supabaseErro = error ? (error.message + ' | code: ' + error.code + ' | hint: ' + error.hint) : null;
  } catch (e) {
    supabaseErro = e.message;
  }

  res.json({
    ok: true,
    supabase: supabaseOk,
    supabase_erro: supabaseErro,
    key_role: keyRole,
    key_len: key.length,
    url_ok: url.includes('supabase.co'),
    node: process.version,
  });
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`IMPAK Portal v2.0 na porta ${PORT}`);
});
