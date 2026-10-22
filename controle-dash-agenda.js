// controle-dash-agenda.js — tela /agenda ("Minha agenda") e aba Agenda do
// processo (#675, 13/10/2026). Cálculo das tarefas: agenda-core.js.
// Responsáveis/atividades: /cadastros → Listas → "Agenda — …".

let _agConclusoes = null;      // [{chave,tipo,usuario,em,obs}]
let _agSemTabela = false;
let _agFiltro = { ver: null, busca: '', funcao: '', mostrarFuturas: false };

function _agHoje(){ const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function _agEsc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function _agDataBR(s){ if(!s) return '—'; const [y,m,d] = String(s).slice(0,10).split('-'); return `${d}/${m}`; }

async function _agCarregarConclusoes(forcar){
  if(_agConclusoes && !forcar) return _agConclusoes;
  try{
    const r = await fetch('/api/agenda/conclusoes').then(x => x.json());
    _agSemTabela = !!r.semTabela;
    _agConclusoes = r.conclusoes || [];
  }catch(e){ _agConclusoes = _agConclusoes || []; }
  return _agConclusoes;
}
let _agHist = null;
async function _agHistorico(dias){
  if(_agHist && _agHist.dias === dias && Date.now() - _agHist.ts < 5*60*1000) return _agHist;
  try{
    const r = await fetch('/api/agenda/historico?dias=' + (dias || 7)).then(x => x.json());
    _agHist = { ok: !!r.ok, dias, lista: r.historico || [], erro: r.erro, ts: Date.now() };
  }catch(e){ _agHist = { ok: false, dias, lista: [], erro: e.message, ts: Date.now() }; }
  return _agHist;
}
async function _agListas(){
  try{ if(typeof _listasPromise !== 'undefined' && _listasPromise){ const l = await _listasPromise; if(l) return l; } }catch(e){}
  if(typeof _listasCompletas !== 'undefined' && _listasCompletas) return _listasCompletas;
  try{ const r = await fetch('/api/listas').then(x=>x.json()); return r.listas || null; }catch(e){ return null; }
}
// Faturas pra agenda (Faturas fase 2, 21/10/2026): resumo enxuto vindo do
// servidor (/api/agenda/faturas), guardado 60 s. Qualquer mudança numa
// fatura (aba Faturas, tela /faturas) chama _agInvalidarFaturas().
let _agFaturas = null; // { ts, lista }
function _agInvalidarFaturas(){ _agFaturas = null; }
async function _agCarregarFaturas(){
  if(_agFaturas && Date.now() - _agFaturas.ts < 60000) return _agFaturas.lista;
  try{
    const r = await fetch('/api/agenda/faturas').then(x => x.json());
    _agFaturas = { ts: Date.now(), lista: (r && r.ok && Array.isArray(r.faturas)) ? r.faturas : [] };
  }catch(e){ _agFaturas = { ts: Date.now(), lista: (_agFaturas && _agFaturas.lista) || [] }; }
  return _agFaturas.lista;
}
async function _agGerar(processos, incluirFeitas){
  const [listas, , faturas] = await Promise.all([_agListas(), _agCarregarConclusoes(), _agCarregarFaturas()]);
  const cfg = AgendaCore.montarConfig(listas);
  const tarefas = AgendaCore.gerarTarefas(processos, {
    hoje: _agHoje(), cfg, conclusoes: _agConclusoes, incluirFeitas, faturas,
    fase: p => (typeof calcularFase === 'function' ? calcularFase(p) : p.fase),
    listarPagamentosPI: (typeof listarPagamentosPI === 'function') ? listarPagamentosPI : null,
  });
  return { cfg, tarefas };
}

// ── Marcar "Feito" / "Não se aplica" / "Reabrir" ─────────────────────
async function agendaMarcar(chave, tipo){
  let obs = '';
  if(tipo === 'nao_aplica'){
    obs = prompt('Por que esta atividade não se aplica? (opcional)') ;
    if(obs === null) return;
  }
  try{
    const r = await fetch('/api/agenda/conclusao', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chave, tipo, obs }) }).then(x=>x.json());
    if(!r.ok){
      showToast(r.semTabela ? 'Falta criar a tabela da agenda no Supabase (migration 0046). Avise o Ayslan.' : ('Não foi possível salvar: ' + (r.erro||'erro')), 'err', 6000);
      return;
    }
    await _agCarregarConclusoes(true);
    atualizarResumoAgenda();
    showToast(tipo === 'reaberta' ? 'Atividade reaberta' : (tipo === 'feita' ? 'Atividade concluída' : 'Marcada como "não se aplica"'), 'ok');
    if(document.getElementById('dash-agenda')?.style.display === 'block') renderDashAgenda();
    if(_editando && _editando.id && document.getElementById('pane-agenda')?.classList.contains('active')) renderAgendaProcesso(_editando);
  }catch(e){ showToast('Erro de rede ao salvar a agenda', 'err'); }
}

// aba: onde a tarefa se resolve (as de fatura abrem direto na aba Faturas)
function _agAbrirProcesso(id, aba){
  if(!id || typeof abrirProcesso !== 'function') return;
  abrirProcesso(id);
  setTimeout(() => trocarAba(aba === 'faturas' ? 'faturas' : 'agenda'), 60);
}

const _AG_COR = { atrasada:['#fee2e2','#b91c1c'], hoje:['#fef3c7','#b45309'], semana:['#dbeafe','#1d4ed8'], futura:['#f1f5f9','#475569'], sem_prazo:['#f1f5f9','#64748b'], andamento:['#ede9fe','#6d28d9'], concluida:['#dcfce7','#15803d'] };
function _agBadgePrazo(t, hoje){
  const c = AgendaCore.classificar(t, hoje);
  const [bg, fg] = _AG_COR[c] || _AG_COR.futura;
  let txt = t.prazo ? _agDataBR(t.prazo) : 'sem prazo';
  if(c === 'atrasada') txt += ` · ${t.atraso}d atraso`;
  if(c === 'andamento') txt += ' · em andamento';
  if(c === 'hoje') txt = 'Hoje';
  if(c === 'concluida') txt = t.status === 'nao_aplica' ? 'Não se aplica' : 'Feita';
  return `<span style="display:inline-block;min-width:92px;text-align:center;background:${bg};color:${fg};font-weight:700;font-size:11px;padding:3px 8px;border-radius:999px;white-space:nowrap;">${_agEsc(txt)}</span>`;
}
function _agNomePessoas(logins){
  return (logins||[]).map(l => l.replace(/@.*$/, '')).map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(', ');
}
function _agLinha(t, hoje, opts){
  opts = opts || {};
  const aberta = t.status === 'aberta';
  const prio = t.prioridade === 'ALTA' ? '<span title="Prioridade alta" style="color:#b91c1c;font-weight:800;margin-right:4px;">●</span>' : '';
  const proc = t.referencia
    ? `<a href="javascript:void(0)" onclick="_agAbrirProcesso('${_agEsc(t.processoId)}','${t.aba === 'faturas' ? 'faturas' : 'agenda'}')" ${t.aba === 'faturas' ? 'title="Abrir o processo na aba Faturas"' : ''} style="font-weight:700;color:var(--accent,#2563eb);text-decoration:none;">${_agEsc(t.referencia)}</a>${t.cliente ? ` <span style="color:var(--muted);font-size:11px;">${_agEsc(t.cliente)}</span>` : ''}`
    : '<span style="color:var(--muted);font-size:11px;">Rotina</span>';
  const comoTxt = t.auto ? `Some sozinha quando: ${t.como}` : 'Atividade manual — clique em Feito ao concluir';
  // dentro do processo: tarefa de fatura leva direto pra aba Faturas
  const irFaturas = (opts.semProc && t.aba === 'faturas' && aberta) ? `<button class="btn btn-outline" style="padding:3px 8px;font-size:11px;" title="Resolver na aba Faturas do processo" onclick="trocarAba('faturas')">Abrir Faturas</button>` : '';
  const botoes = irFaturas + (aberta
    ? `${!t.auto ? `<button class="btn btn-primary" style="padding:3px 10px;font-size:11px;" onclick="agendaMarcar('${_agEsc(t.chave)}','feita')">✓ Feito</button>` : ''}
       <button class="btn btn-outline" style="padding:3px 8px;font-size:11px;" title="Esta atividade não vale para este caso" onclick="agendaMarcar('${_agEsc(t.chave)}','nao_aplica')">Não se aplica</button>`
    : (t.conclusao ? `<span style="font-size:11px;color:var(--muted);">${_agEsc(t.conclusao.usuario||'')} · ${_agDataBR(t.conclusao.em)}</span> <button class="btn btn-outline" style="padding:2px 8px;font-size:11px;" onclick="agendaMarcar('${_agEsc(t.chave)}','reaberta')">Reabrir</button>` : '<span style="font-size:11px;color:#15803d;">concluída automaticamente</span>'));
  return `<div class="ag-linha" style="display:grid;grid-template-columns:110px minmax(0,1fr) ${opts.semProc?'':'minmax(120px,240px) '}150px 210px;gap:10px;align-items:center;padding:8px 10px;border-top:1px solid var(--border);">
    <div>${_agBadgePrazo(t, hoje)}</div>
    <div style="min-width:0;">
      <div style="font-weight:600;color:var(--text);font-size:13px;">${prio}${_agEsc(t.nome)}</div>
      <div style="font-size:11px;color:var(--muted);" title="${_agEsc(comoTxt)}">${t.detalhe ? `<b style="color:#92400e;">${_agEsc(t.detalhe)}</b> · ` : ''}${_agEsc(t.etapa)} · ${_agEsc(comoTxt)}</div>
    </div>
    ${opts.semProc ? '' : `<div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${proc}</div>`}
    <div style="font-size:11px;color:var(--muted);"><b style="color:var(--text);">${_agEsc(t.funcaoNome)}</b><br>${_agEsc(_agNomePessoas(t.responsaveis))}</div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">${botoes}</div>
  </div>`;
}

// ── Perfil: quem pode ver a agenda dos outros ────────────────────────
// Analista vê só a própria função; gerente (role) vê "Toda a equipe" e o
// filtro por pessoa. Pedido Ayslan 14/10/2026.
function _agPodeVerEquipe(){ return !!(_user && _user.role === 'gerente'); }

// ── Resumo (atrasadas/hoje da pessoa) → faixa no Controle + contador na nav ──
let _agResumo = null;
async function atualizarResumoAgenda(){
  if(typeof AgendaCore === 'undefined' || !_user) return;
  try{
    const hoje = _agHoje();
    const { cfg, tarefas } = await _agGerar(_processos || [], false);
    const login = (_user.usuario || '').toLowerCase();
    const fs = AgendaCore.funcoesDoUsuario(cfg, login);
    const minhas = tarefas.filter(t => fs.includes(t.funcao));
    const n = k => minhas.filter(t => AgendaCore.classificar(t, hoje) === k).length;
    _agResumo = { usuario: login, atrasadas: n('atrasada'), hoje: n('hoje'), semana: n('semana'), temFuncao: fs.length > 0, ts: Date.now() };
    try{ localStorage.setItem('impak_agenda_resumo', JSON.stringify(_agResumo)); }catch(e){}
    if(typeof window.impakAgendaBadge === 'function') window.impakAgendaBadge(_agResumo);
    renderFaixaAgenda();
  }catch(e){ console.warn('resumo agenda', e); }
}
// Faixa "Você tem X atrasadas e Y para hoje" no topo do Controle (dentro do
// #stats-grid, pra sumir junto com ele nas telas exclusivas/dashboards).
function renderFaixaAgenda(){
  const grid = document.getElementById('stats-grid');
  if(!grid) return;
  let el = document.getElementById('agenda-faixa');
  const r = _agResumo;
  if(!r || !r.temFuncao || (!r.atrasadas && !r.hoje)){ if(el) el.remove(); return; }
  if(!el){ el = document.createElement('div'); el.id = 'agenda-faixa'; }
  const atr = r.atrasadas, hj = r.hoje;
  const cor = atr ? '#b91c1c' : '#b45309', fundo = atr ? '#fef2f2' : '#fffbeb', borda = atr ? '#fecaca' : '#fde68a';
  const partes = [];
  if(atr) partes.push(`<b>${atr}</b> atrasada${atr>1?'s':''}`);
  if(hj) partes.push(`<b>${hj}</b> para hoje`);
  el.style.cssText = `grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:${fundo};border:1px solid ${borda};border-left:4px solid ${cor};border-radius:10px;padding:9px 14px;font-size:13px;color:${cor};`;
  el.innerHTML = `<span style="font-size:16px;">📅</span><span>Você tem ${partes.join(' e ')} na sua agenda.</span>
    <a href="/agenda" style="margin-left:auto;font-weight:700;color:${cor};text-decoration:none;border:1px solid ${cor};border-radius:8px;padding:4px 12px;background:#fff;">Ver agenda →</a>`;
  if(grid.firstChild !== el) grid.insertBefore(el, grid.firstChild);
}

// ── Tela /agenda ─────────────────────────────────────────────────────
async function renderDashAgenda(){
  const el = document.getElementById('dash-agenda-content');
  if(!el) return;
  if(typeof AgendaCore === 'undefined'){ el.innerHTML = '<div class="empty">Agenda indisponível (agenda-core.js não carregou).</div>'; return; }
  const hoje = _agHoje();
  const { cfg, tarefas } = await _agGerar(_processos || [], false);
  const login = (_user && _user.usuario || '').toLowerCase();
  const minhasFuncoes = AgendaCore.funcoesDoUsuario(cfg, login);
  const podeEquipe = _agPodeVerEquipe();
  if(_agFiltro.ver === null) _agFiltro.ver = (minhasFuncoes.length || !podeEquipe) ? 'eu' : 'equipe';
  if(!podeEquipe && _agFiltro.ver !== 'eu') _agFiltro.ver = 'eu';

  // Pessoas (todas que aparecem em alguma função)
  const pessoas = [...new Set(Object.values(cfg.funcoes).flatMap(f => f.usuarios))];
  let lista = tarefas;
  if(_agFiltro.ver === 'eu') lista = lista.filter(t => minhasFuncoes.includes(t.funcao));
  else if(_agFiltro.ver.startsWith('p:')){ const l = _agFiltro.ver.slice(2); const fs = AgendaCore.funcoesDoUsuario(cfg, l); lista = lista.filter(t => fs.includes(t.funcao)); }
  if(_agFiltro.funcao) lista = lista.filter(t => t.funcao === _agFiltro.funcao);
  if(_agFiltro.busca){ const q = _agFiltro.busca.toLowerCase(); lista = lista.filter(t => [t.referencia,t.cliente,t.nome,t.detalhe].join(' ').toLowerCase().includes(q)); }

  const grupos = { atrasada:[], hoje:[], semana:[], andamento:[], sem_prazo:[], futura:[] };
  lista.forEach(t => { const c = AgendaCore.classificar(t, hoje); (grupos[c] || grupos.futura).push(t); });
  grupos.atrasada.sort((a,b) => (b.atraso||0) - (a.atraso||0) || (a.prioridade==='ALTA'?-1:1));

  const kpi = (id, label, n, cor) => `<div onclick="document.getElementById('ag-sec-${id}')?.scrollIntoView({behavior:'smooth'})" style="cursor:pointer;flex:1;min-width:120px;background:#fff;border:1px solid var(--border);border-left:4px solid ${cor};border-radius:10px;padding:10px 14px;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;">${label}</div>
      <div style="font-size:26px;font-weight:800;color:${cor};font-family:'Inter',sans-serif;">${n}</div></div>`;
  const secao = (id, titulo, arr, cor, recolhida) => !arr.length ? '' : `<div id="ag-sec-${id}" style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden;">
      <div style="padding:8px 12px;font-weight:800;font-size:12px;color:${cor};text-transform:uppercase;letter-spacing:.3px;background:var(--surface2,#f8fafc);display:flex;justify-content:space-between;align-items:center;">
        <span>${titulo} · ${arr.length}</span>
        ${recolhida ? `<button class="btn btn-outline" style="padding:2px 10px;font-size:11px;" onclick="_agFiltro.mostrarFuturas=!_agFiltro.mostrarFuturas;renderDashAgenda()">${_agFiltro.mostrarFuturas?'Esconder':'Mostrar'}</button>` : ''}
      </div>
      ${recolhida && !_agFiltro.mostrarFuturas ? '' : arr.map(t => _agLinha(t, hoje)).join('')}
    </div>`;

  // Resumo por pessoa (visão da equipe) + histórico dos últimos 7 dias
  // (agenda_historico, preenchida pelo job diário do servidor — 14/10/2026).
  let resumoEquipe = '';
  if(_agFiltro.ver === 'equipe'){
    const hist = await _agHistorico(7);
    const linhas = pessoas.map(l => {
      const fs = AgendaCore.funcoesDoUsuario(cfg, l);
      const ts = tarefas.filter(t => fs.includes(t.funcao));
      const c = k => ts.filter(t => AgendaCore.classificar(t, hoje) === k);
      const atrasadas = c('atrasada');
      const maisAntiga = atrasadas.reduce((m, t) => Math.max(m, t.atraso || 0), 0);
      const fech = (hist.lista || []).filter(h => fs.includes(h.funcao));
      const comAtraso = fech.filter(h => h.prazo && h.fechada_em > h.prazo).length;
      return { l, atr: atrasadas.length, maisAntiga, hoje: c('hoje').length, sem: c('semana').length, total: ts.length, fs, fech: fech.length, comAtraso };
    }).sort((a,b) => b.atr - a.atr || b.maisAntiga - a.maisAntiga);
    const th = (t, cor) => `<th style="text-align:center;${cor ? 'color:' + cor + ';' : ''}white-space:nowrap;padding:7px 8px;">${t}</th>`;
    resumoEquipe = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:var(--surface2,#f8fafc);text-align:left;"><th style="padding:7px 10px;">Pessoa</th><th>Funções</th>${th('Atrasadas','#b91c1c')}${th('Mais antiga','#b91c1c')}${th('Hoje','#b45309')}${th('7 dias','#1d4ed8')}${th('Abertas')}${th('Fechadas 7d','#15803d')}${th('c/ atraso','#b45309')}</tr></thead>
        <tbody>${linhas.map(x => `<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="_agFiltro.ver='p:${_agEsc(x.l)}';renderDashAgenda()">
          <td style="padding:6px 10px;font-weight:700;">${_agEsc(_agNomePessoas([x.l]))}</td>
          <td style="color:var(--muted);">${_agEsc(x.fs.map(f => (cfg.funcoes[f]||{}).nome || f).join(', '))}</td>
          <td style="text-align:center;font-weight:800;color:${x.atr?'#b91c1c':'var(--muted)'};">${x.atr}</td>
          <td style="text-align:center;color:${x.maisAntiga?'#b91c1c':'var(--muted)'};">${x.maisAntiga ? x.maisAntiga + 'd' : '—'}</td>
          <td style="text-align:center;font-weight:700;">${x.hoje}</td><td style="text-align:center;">${x.sem}</td><td style="text-align:center;">${x.total}</td>
          <td style="text-align:center;color:#15803d;font-weight:700;">${hist.ok ? x.fech : '—'}</td>
          <td style="text-align:center;color:${x.comAtraso?'#b45309':'var(--muted)'};">${hist.ok ? x.comAtraso : '—'}</td></tr>`).join('')}</tbody>
      </table>
      <div style="padding:6px 10px;font-size:11px;color:var(--muted);">${hist.ok ? 'Fechadas 7d: tarefas concluídas nos últimos 7 dias (registro diário do servidor); c/ atraso: concluídas depois do prazo. Os gerentes recebem este resumo por e-mail toda segunda.' : 'Histórico indisponível: ' + _agEsc(hist.erro || 'falta a tabela agenda_historico (migration 0047)')}</div></div>`;
  }

  const optsVer = [`<option value="eu" ${_agFiltro.ver==='eu'?'selected':''}>Minha agenda${minhasFuncoes.length?'':' (sem função cadastrada)'}</option>`,
    ...(podeEquipe ? [`<option value="equipe" ${_agFiltro.ver==='equipe'?'selected':''}>Toda a equipe</option>`,
      ...pessoas.map(l => `<option value="p:${_agEsc(l)}" ${_agFiltro.ver==='p:'+l?'selected':''}>${_agEsc(_agNomePessoas([l]))}</option>`)] : [])].join('');
  const optsFun = `<option value="">Todas as funções</option>` + Object.values(cfg.funcoes).map(f => `<option value="${_agEsc(f.codigo)}" ${_agFiltro.funcao===f.codigo?'selected':''}>${_agEsc(f.nome)}</option>`).join('');

  el.innerHTML = `
    ${_agSemTabela ? `<div style="background:#fef3c7;border:1px solid #fcd34d;color:#92400e;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;">A agenda já funciona, mas os botões "Feito" / "Não se aplica" só passam a salvar depois que a tabela <b>agenda_conclusoes</b> for criada no Supabase (migration 0046).</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <select class="form-input" style="width:auto;min-width:200px;" onchange="_agFiltro.ver=this.value;renderDashAgenda()">${optsVer}</select>
      <select class="form-input" style="width:auto;" onchange="_agFiltro.funcao=this.value;renderDashAgenda()">${optsFun}</select>
      <input class="form-input" style="width:auto;min-width:220px;" placeholder="Buscar processo, cliente ou atividade" value="${_agEsc(_agFiltro.busca)}" oninput="_agFiltro.busca=this.value;clearTimeout(window._agT);window._agT=setTimeout(renderDashAgenda,250)">
      <span style="font-size:11px;color:var(--muted);margin-left:auto;">${minhasFuncoes.length && _agFiltro.ver==='eu' ? 'Suas funções: ' + _agEsc(minhasFuncoes.map(f => (cfg.funcoes[f]||{}).nome||f).join(', ')) + ' · ' : ''}Responsáveis em Cadastros → Listas → "Agenda — Funções"</span>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      ${kpi('atrasada','Atrasadas',grupos.atrasada.length,'#b91c1c')}
      ${kpi('hoje','Vencem hoje',grupos.hoje.length,'#b45309')}
      ${kpi('semana','Próximos 7 dias',grupos.semana.length,'#1d4ed8')}
      ${kpi('andamento','Em andamento',grupos.andamento.length,'#6d28d9')}
      ${kpi('sem_prazo','Sem prazo',grupos.sem_prazo.length,'#64748b')}
      ${kpi('futura','Mais adiante',grupos.futura.length,'#475569')}
    </div>
    ${resumoEquipe}
    ${secao('atrasada','Atrasadas',grupos.atrasada,'#b91c1c')}
    ${secao('hoje','Vencem hoje',grupos.hoje,'#b45309')}
    ${secao('semana','Próximos 7 dias',grupos.semana,'#1d4ed8')}
    ${secao('andamento','Em andamento (aguardando depot / terceiros)',grupos.andamento,'#6d28d9')}
    ${secao('sem_prazo','Sem prazo definido',grupos.sem_prazo,'#64748b')}
    ${secao('futura','Mais adiante',grupos.futura,'#475569', true)}
    ${!lista.length ? '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">Nada pendente aqui.</div></div>' : ''}
  `;
}

// ── Aba "Agenda" dentro do processo ──────────────────────────────────
async function renderAgendaProcesso(p){
  const el = document.getElementById('pane-agenda-conteudo');
  if(!el || !p || !p.id || typeof AgendaCore === 'undefined') return;
  const base = (_processos || []).find(x => x.id === p.id) || p;
  const hoje = _agHoje();
  const tarefas = (await _agGerar([base], true)).tarefas.filter(t => t.processoId === base.id); // sem as rotinas mensais
  const abertas = tarefas.filter(t => t.status === 'aberta');
  const feitas = tarefas.filter(t => t.status !== 'aberta');
  el.innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Atividades deste processo conforme a etapa. As automáticas somem sozinhas quando o campo é preenchido (após salvar). Responsáveis: Cadastros → Listas → "Agenda — Funções".</div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px;">
      <div style="padding:7px 12px;font-weight:800;font-size:12px;text-transform:uppercase;background:var(--surface2,#f8fafc);">Em aberto · ${abertas.length}</div>
      ${abertas.length ? abertas.map(t => _agLinha(t, hoje, { semProc:true })).join('') : '<div style="padding:10px 12px;font-size:12px;color:var(--muted);">Nenhuma atividade pendente.</div>'}
    </div>
    ${feitas.length ? `<details style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <summary style="padding:7px 12px;font-weight:800;font-size:12px;text-transform:uppercase;cursor:pointer;">Concluídas · ${feitas.length}</summary>
      ${feitas.map(t => _agLinha(t, hoje, { semProc:true })).join('')}
    </details>` : ''}`;
}

// Tela exclusiva /agenda (mesmo esquema de /reciclagem).
function ativarTelaAgendaExclusiva(){
  document.title = 'ImpakOS - Agenda';
  const titulo = document.querySelector('.topbar-title');
  if(titulo) titulo.textContent = 'Agenda';
  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id=>{ const e = document.getElementById(id); if(e) e.style.display='none'; });
  const toolbar = document.querySelector('.toolbar'); if(toolbar) toolbar.style.display = 'none';
  const sidebar = document.querySelector('.sidebar'); if(sidebar) sidebar.style.display = 'none';
  const tw = document.querySelector('.table-wrap'); if(tw) tw.style.display = 'none';
  const d = document.getElementById('dash-agenda'); if(d) d.style.display = 'block';
  renderDashAgenda();
}
