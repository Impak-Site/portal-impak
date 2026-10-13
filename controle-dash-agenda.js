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
async function _agListas(){
  try{ if(typeof _listasPromise !== 'undefined' && _listasPromise){ const l = await _listasPromise; if(l) return l; } }catch(e){}
  if(typeof _listasCompletas !== 'undefined' && _listasCompletas) return _listasCompletas;
  try{ const r = await fetch('/api/listas').then(x=>x.json()); return r.listas || null; }catch(e){ return null; }
}
async function _agGerar(processos, incluirFeitas){
  const [listas] = await Promise.all([_agListas(), _agCarregarConclusoes()]);
  const cfg = AgendaCore.montarConfig(listas);
  const tarefas = AgendaCore.gerarTarefas(processos, {
    hoje: _agHoje(), cfg, conclusoes: _agConclusoes, incluirFeitas,
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
    showToast(tipo === 'reaberta' ? 'Atividade reaberta' : (tipo === 'feita' ? 'Atividade concluída' : 'Marcada como "não se aplica"'), 'ok');
    if(document.getElementById('dash-agenda')?.style.display === 'block') renderDashAgenda();
    if(_editando && _editando.id && document.getElementById('pane-agenda')?.classList.contains('active')) renderAgendaProcesso(_editando);
  }catch(e){ showToast('Erro de rede ao salvar a agenda', 'err'); }
}

function _agAbrirProcesso(id){
  if(!id || typeof abrirProcesso !== 'function') return;
  abrirProcesso(id);
  setTimeout(() => trocarAba('agenda'), 60);
}

const _AG_COR = { atrasada:['#fee2e2','#b91c1c'], hoje:['#fef3c7','#b45309'], semana:['#dbeafe','#1d4ed8'], futura:['#f1f5f9','#475569'], sem_prazo:['#f1f5f9','#64748b'], concluida:['#dcfce7','#15803d'] };
function _agBadgePrazo(t, hoje){
  const c = AgendaCore.classificar(t, hoje);
  const [bg, fg] = _AG_COR[c] || _AG_COR.futura;
  let txt = t.prazo ? _agDataBR(t.prazo) : 'sem prazo';
  if(c === 'atrasada') txt += ` · ${t.atraso}d atraso`;
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
    ? `<a href="javascript:void(0)" onclick="_agAbrirProcesso('${_agEsc(t.processoId)}')" style="font-weight:700;color:var(--accent,#2563eb);text-decoration:none;">${_agEsc(t.referencia)}</a>${t.cliente ? ` <span style="color:var(--muted);font-size:11px;">${_agEsc(t.cliente)}</span>` : ''}`
    : '<span style="color:var(--muted);font-size:11px;">Rotina</span>';
  const comoTxt = t.auto ? `Some sozinha quando: ${t.como}` : 'Atividade manual — clique em Feito ao concluir';
  const botoes = aberta
    ? `${!t.auto ? `<button class="btn btn-primary" style="padding:3px 10px;font-size:11px;" onclick="agendaMarcar('${_agEsc(t.chave)}','feita')">✓ Feito</button>` : ''}
       <button class="btn btn-outline" style="padding:3px 8px;font-size:11px;" title="Esta atividade não vale para este caso" onclick="agendaMarcar('${_agEsc(t.chave)}','nao_aplica')">Não se aplica</button>`
    : (t.conclusao ? `<span style="font-size:11px;color:var(--muted);">${_agEsc(t.conclusao.usuario||'')} · ${_agDataBR(t.conclusao.em)}</span> <button class="btn btn-outline" style="padding:2px 8px;font-size:11px;" onclick="agendaMarcar('${_agEsc(t.chave)}','reaberta')">Reabrir</button>` : '<span style="font-size:11px;color:#15803d;">concluída automaticamente</span>');
  return `<div class="ag-linha" style="display:grid;grid-template-columns:110px minmax(0,1fr) ${opts.semProc?'':'minmax(120px,220px) '}150px auto;gap:10px;align-items:center;padding:8px 10px;border-top:1px solid var(--border);">
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

// ── Tela /agenda ─────────────────────────────────────────────────────
async function renderDashAgenda(){
  const el = document.getElementById('dash-agenda-content');
  if(!el) return;
  if(typeof AgendaCore === 'undefined'){ el.innerHTML = '<div class="empty">Agenda indisponível (agenda-core.js não carregou).</div>'; return; }
  const hoje = _agHoje();
  const { cfg, tarefas } = await _agGerar(_processos || [], false);
  const login = (_user && _user.usuario || '').toLowerCase();
  const minhasFuncoes = AgendaCore.funcoesDoUsuario(cfg, login);
  if(_agFiltro.ver === null) _agFiltro.ver = minhasFuncoes.length ? 'eu' : 'equipe';

  // Pessoas (todas que aparecem em alguma função)
  const pessoas = [...new Set(Object.values(cfg.funcoes).flatMap(f => f.usuarios))];
  let lista = tarefas;
  if(_agFiltro.ver === 'eu') lista = lista.filter(t => minhasFuncoes.includes(t.funcao));
  else if(_agFiltro.ver.startsWith('p:')){ const l = _agFiltro.ver.slice(2); const fs = AgendaCore.funcoesDoUsuario(cfg, l); lista = lista.filter(t => fs.includes(t.funcao)); }
  if(_agFiltro.funcao) lista = lista.filter(t => t.funcao === _agFiltro.funcao);
  if(_agFiltro.busca){ const q = _agFiltro.busca.toLowerCase(); lista = lista.filter(t => [t.referencia,t.cliente,t.nome,t.detalhe].join(' ').toLowerCase().includes(q)); }

  const grupos = { atrasada:[], hoje:[], semana:[], sem_prazo:[], futura:[] };
  lista.forEach(t => { const c = AgendaCore.classificar(t, hoje); (grupos[c] || grupos.futura).push(t); });
  grupos.atrasada.sort((a,b) => (b.atraso||0) - (a.atraso||0) || (a.prioridade==='ALTA'?-1:1));

  const kpi = (id, label, n, cor) => `<div onclick="document.getElementById('ag-sec-${id}')?.scrollIntoView({behavior:'smooth'})" style="cursor:pointer;flex:1;min-width:120px;background:#fff;border:1px solid var(--border);border-left:4px solid ${cor};border-radius:10px;padding:10px 14px;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;">${label}</div>
      <div style="font-size:26px;font-weight:800;color:${cor};font-family:'DM Sans',sans-serif;">${n}</div></div>`;
  const secao = (id, titulo, arr, cor, recolhida) => !arr.length ? '' : `<div id="ag-sec-${id}" style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden;">
      <div style="padding:8px 12px;font-weight:800;font-size:12px;color:${cor};text-transform:uppercase;letter-spacing:.3px;background:var(--surface2,#f8fafc);display:flex;justify-content:space-between;align-items:center;">
        <span>${titulo} · ${arr.length}</span>
        ${recolhida ? `<button class="btn btn-outline" style="padding:2px 10px;font-size:11px;" onclick="_agFiltro.mostrarFuturas=!_agFiltro.mostrarFuturas;renderDashAgenda()">${_agFiltro.mostrarFuturas?'Esconder':'Mostrar'}</button>` : ''}
      </div>
      ${recolhida && !_agFiltro.mostrarFuturas ? '' : arr.map(t => _agLinha(t, hoje)).join('')}
    </div>`;

  // Resumo por pessoa (visão da equipe)
  let resumoEquipe = '';
  if(_agFiltro.ver === 'equipe'){
    const linhas = pessoas.map(l => {
      const fs = AgendaCore.funcoesDoUsuario(cfg, l);
      const ts = tarefas.filter(t => fs.includes(t.funcao));
      const c = k => ts.filter(t => AgendaCore.classificar(t, hoje) === k).length;
      return { l, atr: c('atrasada'), hoje: c('hoje'), sem: c('semana'), total: ts.length, fs };
    }).sort((a,b) => b.atr - a.atr || b.hoje - a.hoje);
    resumoEquipe = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:var(--surface2,#f8fafc);text-align:left;"><th style="padding:7px 10px;">Pessoa</th><th>Funções</th><th style="text-align:center;color:#b91c1c;">Atrasadas</th><th style="text-align:center;color:#b45309;">Hoje</th><th style="text-align:center;color:#1d4ed8;">7 dias</th><th style="text-align:center;">Abertas</th></tr></thead>
        <tbody>${linhas.map(x => `<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="_agFiltro.ver='p:${_agEsc(x.l)}';renderDashAgenda()">
          <td style="padding:6px 10px;font-weight:700;">${_agEsc(_agNomePessoas([x.l]))}</td>
          <td style="color:var(--muted);">${_agEsc(x.fs.map(f => (cfg.funcoes[f]||{}).nome || f).join(', '))}</td>
          <td style="text-align:center;font-weight:800;color:${x.atr?'#b91c1c':'var(--muted)'};">${x.atr}</td>
          <td style="text-align:center;font-weight:700;">${x.hoje}</td><td style="text-align:center;">${x.sem}</td><td style="text-align:center;">${x.total}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  const optsVer = [`<option value="eu" ${_agFiltro.ver==='eu'?'selected':''} ${minhasFuncoes.length?'':'disabled'}>Minha agenda${minhasFuncoes.length?'':' (sem função cadastrada)'}</option>`,
    `<option value="equipe" ${_agFiltro.ver==='equipe'?'selected':''}>Toda a equipe</option>`,
    ...pessoas.map(l => `<option value="p:${_agEsc(l)}" ${_agFiltro.ver==='p:'+l?'selected':''}>${_agEsc(_agNomePessoas([l]))}</option>`)].join('');
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
      ${kpi('sem_prazo','Sem prazo',grupos.sem_prazo.length,'#64748b')}
      ${kpi('futura','Mais adiante',grupos.futura.length,'#475569')}
    </div>
    ${resumoEquipe}
    ${secao('atrasada','Atrasadas',grupos.atrasada,'#b91c1c')}
    ${secao('hoje','Vencem hoje',grupos.hoje,'#b45309')}
    ${secao('semana','Próximos 7 dias',grupos.semana,'#1d4ed8')}
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
  const { tarefas } = await _agGerar([base], true);
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
  const d = document.getElementById('dash-agenda'); if(d) d.style.display = 'block';
  renderDashAgenda();
}
