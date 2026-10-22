// agenda-servidor.js — a Agenda calculada no SERVIDOR (14/10/2026).
//
// A agenda (agenda-core.js) sempre rodou só no navegador, porque precisa
// de calcularFase() e listarPagamentosPI() do controle-core.js, que espera
// `document`/`window`. Aqui a gente carrega esses módulos do front num
// sandbox de `vm` com stubs de DOM (exatamente o truque de testes_controle.js)
// e reaproveita o CÓDIGO REAL — nada de reimplementar regra.
//
// Pra quê: (1) histórico — todo dia o job compara as tarefas abertas com a
// tabela agenda_historico e registra quando cada uma abriu e fechou (antes
// só existia "o que está aberto agora"); (2) resumo semanal por e-mail pros
// gerentes (abertas, atrasadas, mais antiga, fechadas na semana, com atraso).
//
// Uso (server.js): const AgendaServidor = require('./agenda-servidor.js');
//   AgendaServidor.carregarMotor()      → { calcularFase, listarPagamentosPI } (lazy, 1x)
//   AgendaServidor.gerarTarefas(ctx)    → tarefas abertas (e feitas, se pedir)
//   AgendaServidor.atualizarHistorico(ctx, hoje) → { novas, fechadas, abertas }
//   AgendaServidor.resumoPorPessoa(...) → dados do e-mail / tela
//   ctx = { sb, carregarListas, log }
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const AgendaCore = require('./agenda-core.js');
const FaturasCore = require('./faturas-core.js');

// ── 1. motor do front num sandbox ─────────────────────────────────────
// Mesma lista/ordem de testes_controle.js (controle-core.js precisa de
// taxas-catalogo/listas-padrao antes, e listarPagamentosPI usa
// paisDoProcesso() que mora em controle-campos.js).
const MODULOS_FRONT = ['taxas-catalogo.js', 'listas-padrao.js', 'controle-core.js', 'controle-modal.js',
  'controle-campos.js', 'controle-export.js', 'controle-contatos.js', 'controle-import-ia.js', 'controle-dashboards.js'];
let _motor = null, _motorErro = null;
function carregarMotor() {
  if (_motor || _motorErro) return _motor;
  try {
    const js = MODULOS_FRONT.map(n => fs.readFileSync(path.join(__dirname, n), 'utf-8')).join('\n');
    const el = () => ({ value: '', innerHTML: '', style: {}, textContent: '', dataset: {}, checked: false,
      classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, dispatchEvent() { return true; }, setAttribute() {} });
    const document = { getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
      createElement: () => el(), body: { appendChild() {}, classList: { add() {}, remove() {} } } };
    const sb = {
      document, window: null,
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      fetch: () => new Promise(() => {}), // nunca resolve: o front dispara /api/me etc. no load; aqui não interessa
      console: { log() {}, warn() {}, error() {}, info() {} },
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      navigator: {}, location: { origin: 'http://localhost', href: 'http://localhost/controle', pathname: '/controle', search: '' },
      history: { replaceState() {}, pushState() {} }, addEventListener() {}, confirm: () => false, alert() {},
      Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Promise, URL, URLSearchParams, Map, Set,
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(js, sb, { filename: 'controle-front-sandbox.js' });
    if (typeof sb.calcularFase !== 'function' || typeof sb.listarPagamentosPI !== 'function') throw new Error('calcularFase/listarPagamentosPI não encontrados no sandbox');
    _motor = { calcularFase: sb.calcularFase, listarPagamentosPI: sb.listarPagamentosPI,
      // Usados pelo Assistente (assistente.js): resultado real x estimado do processo.
      calcularFechamento: sb.calcularFechamento, calcularVendasResumo: sb.calcularVendasResumo, parseVendas: sb.parseVendas,
      // Mesmas contas da tela Resultado/Análises (19/10/2026): partes por cliente, data da NF de venda.
      nfsSaidaVenda: sb.nfsSaidaVenda, dataNfSaidaProcesso: sb.dataNfSaidaProcesso, partesClienteProcesso: sb.partesClienteProcesso,
      fechamentoDaParte: sb.fechamentoDaParte, linhasResultadoPeriodo: sb.linhasResultadoPeriodo, paisDoProcesso: sb.paisDoProcesso,
      // Verificação diária dos dados (22/10/2026): mesma regra do Salvar.
      clienteDaVendaDoProcesso: sb.clienteDaVendaDoProcesso };
  } catch (e) {
    _motorErro = e;
    console.error('[agenda-servidor] não consegui carregar o motor do front:', e.message);
  }
  return _motor;
}

function hojeISO(d) {
  const x = d ? new Date(d) : new Date();
  // Fuso de Brasília (o servidor roda em UTC): "hoje" é o dia no Brasil.
  const br = new Date(x.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return br.getFullYear() + '-' + String(br.getMonth() + 1).padStart(2, '0') + '-' + String(br.getDate()).padStart(2, '0');
}
function diasEntre(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

// ── 2. tarefas ─────────────────────────────────────────────────────────
// Faturas pra agenda (Faturas fase 2, 21/10/2026): todas as não canceladas,
// no formato enxuto de FaturasCore.faturasParaAgenda (a mesma regra que o
// navegador usa — /api/agenda/faturas). Banco sem a tabela ou sem a coluna
// da conferência (migration 0058): segue sem faturas / sem conferência —
// a agenda nunca para por causa delas.
const COLS_FATURAS_AGENDA = 'id, numero, tipo, status, empresa_id, empresa_nome, documento, vencimento, moeda, valor, valor_pago, pago_em, itens, origem, aprovacao, anexos, pagamentos, created_at, conferencia';
async function carregarFaturasAgenda(sb) {
  try {
    const lista = [];
    let cols = COLS_FATURAS_AGENDA;
    for (let de = 0; de < 20000; de += 1000) {
      const ler = () => sb().from('faturas').select(cols).neq('status', 'cancelada').order('id').range(de, de + 999);
      let { data, error } = await ler();
      if (error && /conferencia/.test(error.message) && cols.includes('conferencia')) {
        cols = cols.replace(', conferencia', '');
        ({ data, error } = await ler());
      }
      if (error) return { faturas: [], erro: error.message, semTabela: /faturas/.test(error.message) };
      lista.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { faturas: FaturasCore.faturasParaAgenda(lista) };
  } catch (e) {
    return { faturas: [], erro: e.message };
  }
}

async function carregarInsumos(ctx) {
  const { sb, carregarListas } = ctx;
  const [{ data: processos, error: e1 }, listas, { data: conclusoes, error: e3 }, fat] = await Promise.all([
    sb().from('controle_processos').select('*').order('updated_at', { ascending: false }),
    carregarListas().then(r => r.listas),
    sb().from('agenda_conclusoes').select('chave,codigo,processo_id,tipo,obs,usuario,em'),
    carregarFaturasAgenda(sb),
  ]);
  if (e1) throw new Error('processos: ' + e1.message);
  if (e3 && !/agenda_conclusoes/.test(e3.message)) throw new Error('conclusoes: ' + e3.message);
  if (fat.erro && !fat.semTabela && ctx.log) ctx.log('[agenda] faturas indisponíveis: ' + fat.erro);
  return { processos: processos || [], listas, conclusoes: (conclusoes || []).filter(c => c.tipo !== 'reaberta'), faturas: fat.faturas || [] };
}

async function gerarTarefas(ctx, opts) {
  opts = opts || {};
  const motor = carregarMotor();
  if (!motor) throw new Error('motor da agenda indisponível: ' + (_motorErro && _motorErro.message));
  const { processos, listas, conclusoes, faturas } = await carregarInsumos(ctx);
  const cfg = AgendaCore.montarConfig(listas);
  const hoje = opts.hoje || hojeISO();
  const tarefas = AgendaCore.gerarTarefas(processos, {
    hoje, cfg, conclusoes, incluirFeitas: !!opts.incluirFeitas, faturas,
    fase: motor.calcularFase, listarPagamentosPI: motor.listarPagamentosPI,
  });
  return { hoje, cfg, tarefas, conclusoes };
}

// ── 3. histórico diário ────────────────────────────────────────────────
// Tabela agenda_historico: uma linha por tarefa (chave). aberta_em = 1º dia
// em que o job a viu aberta; fechada_em = 1º dia em que deixou de estar
// aberta (campo preenchido, marcada Feito/Não se aplica, processo fechado
// ou cancelado). Atraso = fechada_em > prazo. Idempotente: pode rodar
// várias vezes no dia.
async function atualizarHistorico(ctx, opts) {
  const { sb, log } = ctx;
  const { hoje, tarefas, conclusoes } = await gerarTarefas(ctx, opts);
  const abertas = tarefas.filter(t => t.status === 'aberta');
  const abertasPorChave = new Map(abertas.map(t => [t.chave, t]));
  const concl = new Map(conclusoes.map(c => [c.chave, c]));

  const { data: existentes, error } = await sb().from('agenda_historico').select('chave,prazo,funcao,fechada_em,aberta_em');
  if (error) throw new Error('agenda_historico: ' + error.message);
  const porChave = new Map((existentes || []).map(r => [r.chave, r]));

  const upserts = [];
  // (a) abertas hoje: cria ou atualiza (prazo/função podem mudar; reaberta volta pra aberta)
  abertas.forEach(t => {
    const ex = porChave.get(t.chave);
    const linha = { chave: t.chave, codigo: t.codigo, processo_id: t.processoId || null, referencia: t.referencia || null,
      funcao: t.funcao || null, atividade: t.nome || null, prazo: t.prazo || null, atualizado_em: new Date().toISOString() };
    // aberta_em vai em TODAS as linhas do upsert (22/10/2026): no upsert em lote
    // o PostgREST usa as mesmas colunas para todas as linhas, e a linha já
    // existente sem aberta_em ia como null (coluna NOT NULL) — o lote inteiro
    // falhava quando misturava tarefa nova com tarefa que mudou de prazo.
    if (!ex) Object.assign(linha, { aberta_em: hoje, fechada_em: null, tipo: null });
    else if (ex.fechada_em) Object.assign(linha, { aberta_em: ex.aberta_em || hoje, fechada_em: null, tipo: null }); // reaberta
    else if (ex.prazo === (t.prazo || null) && ex.funcao === (t.funcao || null)) return; // nada mudou
    else Object.assign(linha, { aberta_em: ex.aberta_em || hoje });
    upserts.push(linha);
  });
  // (b) estavam abertas e sumiram: fecha hoje
  const fechadas = [];
  (existentes || []).forEach(r => {
    if (r.fechada_em || abertasPorChave.has(r.chave)) return;
    const c = concl.get(r.chave);
    fechadas.push({ chave: r.chave, fechada_em: hoje, tipo: c ? c.tipo : 'auto', atualizado_em: new Date().toISOString() });
  });

  let novas = 0;
  for (let i = 0; i < upserts.length; i += 200) {
    const lote = upserts.slice(i, i + 200);
    const { error: e } = await sb().from('agenda_historico').upsert(lote, { onConflict: 'chave' });
    if (e) throw new Error('upsert agenda_historico: ' + e.message);
    novas += lote.filter(l => l.aberta_em === hoje).length;
  }
  for (const f of fechadas) {
    const { error: e } = await sb().from('agenda_historico').update(f).eq('chave', f.chave);
    if (e) throw new Error('fechar agenda_historico: ' + e.message);
  }
  if (log) log(`[agenda-historico] ${hoje}: ${abertas.length} abertas, ${novas} novas, ${fechadas.length} fechadas`);
  return { hoje, abertas: abertas.length, novas, fechadas: fechadas.length };
}

// ── 4. resumo por pessoa ───────────────────────────────────────────────
// hist = linhas de agenda_historico com fechada_em nos últimos N dias.
function resumoPorPessoa(cfg, tarefasAbertas, hist, hoje, dias) {
  dias = dias || 7;
  const desde = new Date(hoje + 'T00:00:00Z'); desde.setUTCDate(desde.getUTCDate() - dias);
  const desdeISO = desde.toISOString().slice(0, 10);
  const pessoas = [...new Set(Object.values(cfg.funcoes).filter(f => f.ativo).flatMap(f => f.usuarios))];
  const linhas = pessoas.map(login => {
    const fs = AgendaCore.funcoesDoUsuario(cfg, login);
    const abertas = tarefasAbertas.filter(t => fs.includes(t.funcao));
    const atrasadas = abertas.filter(t => AgendaCore.classificar(t, hoje) === 'atrasada');
    const maisAntiga = atrasadas.reduce((m, t) => Math.max(m, t.atraso || 0), 0);
    const fechadas = (hist || []).filter(h => fs.includes(h.funcao) && h.fechada_em && h.fechada_em >= desdeISO);
    const comAtraso = fechadas.filter(h => h.prazo && h.fechada_em > h.prazo);
    return { login, nome: nomePessoa(login), funcoes: fs.map(f => (cfg.funcoes[f] || {}).nome || f),
      abertas: abertas.length, atrasadas: atrasadas.length, maisAntiga, fechadas: fechadas.length, comAtraso: comAtraso.length,
      pctNoPrazo: fechadas.length ? Math.round(100 * (fechadas.length - comAtraso.length) / fechadas.length) : null };
  }).sort((a, b) => b.atrasadas - a.atrasadas || b.maisAntiga - a.maisAntiga);
  const piores = tarefasAbertas.filter(t => AgendaCore.classificar(t, hoje) === 'atrasada')
    .sort((a, b) => (b.atraso || 0) - (a.atraso || 0)).slice(0, 10)
    .map(t => ({ referencia: t.referencia, atividade: t.nome, funcao: t.funcaoNome || t.funcao, responsaveis: (t.responsaveis || []).map(nomePessoa).join(', '), prazo: t.prazo, atraso: t.atraso }));
  return { linhas, piores, desde: desdeISO, dias };
}
function nomePessoa(login) { const l = String(login || '').replace(/@.*$/, ''); return l.charAt(0).toUpperCase() + l.slice(1); }

module.exports = { carregarMotor, gerarTarefas, atualizarHistorico, resumoPorPessoa, hojeISO, diasEntre, nomePessoa, carregarFaturasAgenda };
