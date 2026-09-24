// controle-dash-conferencia.js
//
// Tela "Fila de Conferência" (/conferencia-fila) — task #636/#645, pedido
// Ayslan (14/09/2026): a antiga tela em processos.html listava todos os
// processos conferidos numa fila só, sem precisar abrir um por um pra
// achar quem tinha divergência pendente. Isso ficou faltando na fase 1 da
// unificação (só a aba "Conferência" dentro do painel do processo foi
// feita — ver controle-conferencia.js). Esta tela cobre essa lacuna,
// reaproveitando _processos e conferencia_json (já vive no processo do
// Controle desde a migration 0031) em vez de duplicar estado.
//
// Não depende mais da tabela conferencia_processos/API antiga — lê
// direto de controle_processos.conferencia_json de cada processo.

let _confFilaFiltro = 'pendentes'; // 'pendentes' | 'todos' | 'nunca'
let _confFilaBusca = ''; // pedido Emanuelly 15/09/2026: buscar processo por referência/fornecedor/cliente na fila

function _confFilaDados(){
  const linhas = (_processos||[]).filter(p => !p.cancelado).map(p => {
    let analise = null;
    try{ analise = p.conferencia_json ? JSON.parse(p.conferencia_json) : null; }catch(e){}
    // A lista agora traz só o resumo (conferencia_resumo, calculado no
    // servidor); o histórico completo vem ao abrir o processo.
    if(!analise && p.conferencia_resumo){
      const r = p.conferencia_resumo;
      return { p, analise: { data: r.data }, pendentes: r.pendentes||0, bloqueantes: r.bloqueantes||0, aceitas: r.aceitas||0 };
    }
    if(!analise) return { p, analise: null, pendentes: 0, bloqueantes: 0, aceitas: 0 };
    const resolvedMap = analise.divResolvedMap || {};
    let pendentes = 0, bloqueantes = 0, aceitas = 0;
    (analise.grupos||[]).forEach((grupo, gi) => {
      (grupo.campos||[]).forEach((c, ci) => {
        if(c.status==='DIVERGENCIA' || c.status==='AUSENTE' || (c.status==='ALERTA' && c.campo)){
          const key = gi+'-'+ci;
          if(resolvedMap[key]) aceitas++;
          else { pendentes++; if(c.severidade==='BLOQUEANTE') bloqueantes++; }
        }
      });
    });
    return { p, analise, pendentes, bloqueantes, aceitas };
  });
  return linhas;
}

function renderDashConferenciaFila(){
  const el = document.getElementById('dash-conferencia-fila-content');
  if(!el) return;

  const todos = _confFilaDados();
  const nuncaConferidos = todos.filter(l => !l.analise).length;
  const comPendente = todos.filter(l => l.pendentes > 0).length;
  const comBloqueante = todos.filter(l => l.bloqueantes > 0).length;

  const aba = (nome, label, count) => `<button class="btn btn-sm ${_confFilaFiltro===nome?'btn-primary':'btn-outline'}" onclick="_confFilaMudarFiltro('${nome}')">${label}${count!=null?' ('+count+')':''}</button>`;

  el.innerHTML = `
    <div style="display:flex;gap:14px;margin-bottom:16px;flex-wrap:wrap;">
      <div style="background:rgba(220,38,38,.06);border:1px solid var(--err);border-radius:8px;padding:10px 16px;">
        <div style="font-size:20px;font-weight:700;color:var(--err);">${comBloqueante}</div>
        <div style="font-size:11px;color:var(--muted);">com divergência bloqueante</div>
      </div>
      <div style="background:rgba(217,119,6,.06);border:1px solid var(--warn);border-radius:8px;padding:10px 16px;">
        <div style="font-size:20px;font-weight:700;color:var(--warn);">${comPendente}</div>
        <div style="font-size:11px;color:var(--muted);">com pendência (qualquer severidade)</div>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 16px;">
        <div style="font-size:20px;font-weight:700;">${nuncaConferidos}</div>
        <div style="font-size:11px;color:var(--muted);">nunca conferidos</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
      ${aba('pendentes','⚠ Com pendência', comPendente)}
      ${aba('nunca','◻ Nunca conferidos', nuncaConferidos)}
      ${aba('todos','Todos já conferidos', todos.length - nuncaConferidos)}
      <input type="text" id="conf-fila-busca" placeholder="🔍 Buscar por referência, fornecedor ou cliente..." value="${esc(_confFilaBusca)}" oninput="_confFilaMudarBusca(this.value)" style="margin-left:auto;min-width:260px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
    </div>
    <div id="conf-fila-lista"></div>
  `;
  _confFilaRenderLista();
}

function _confFilaMudarBusca(valor){
  _confFilaBusca = valor;
  _confFilaRenderLista();
}

function _confFilaMudarFiltro(f){
  _confFilaFiltro = f;
  renderDashConferenciaFila();
}

function _confFilaRenderLista(){
  const cont = document.getElementById('conf-fila-lista');
  if(!cont) return;
  const todos = _confFilaDados();

  let lista;
  if(_confFilaFiltro === 'pendentes') lista = todos.filter(l => l.pendentes > 0);
  else if(_confFilaFiltro === 'nunca') lista = todos.filter(l => !l.analise);
  else lista = todos.filter(l => l.analise);

  // Busca por referência/fornecedor/cliente — pedido Emanuelly 15/09/2026
  // ("da pra colocar uma lupa aqui? pra pesquisar e achar mais facil o
  // processo"). Não distingue maiúscula/minúscula nem acento, pra achar
  // mesmo digitando diferente do cadastro.
  const termo = _confFilaBusca.trim().toLowerCase();
  if(termo){
    const normalizar = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const termoNorm = normalizar(termo);
    lista = lista.filter(l => {
      const p = l.p;
      return normalizar(p.referencia).includes(termoNorm)
        || normalizar(p.fornecedor).includes(termoNorm)
        || normalizar(p.cliente).includes(termoNorm);
    });
  }

  // Prioriza quem tem mais divergência bloqueante, depois pendente, depois
  // mais recente — pra quem tem menos tempo separar o que precisa de
  // atenção primeiro sem precisar reordenar manualmente.
  lista = lista.slice().sort((a,b) => (b.bloqueantes-a.bloqueantes) || (b.pendentes-a.pendentes) || 0);

  if(!lista.length){
    cont.innerHTML = termo
      ? '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">Nenhum processo encontrado pra "'+esc(_confFilaBusca)+'".</div></div>'
      : '<div class="empty"><div class="empty-icon">✓</div><div class="empty-text">Nada por aqui — nenhum processo nessa condição no momento.</div></div>';
    return;
  }

  cont.innerHTML = lista.map(l => {
    const p = l.p;
    const fase = faseParaExibir(p);
    let statusHtml;
    if(!l.analise){
      statusHtml = '<span style="font-size:11px;color:var(--muted);">Nunca conferido</span>';
    } else if(l.pendentes === 0){
      statusHtml = '<span style="font-size:11px;color:var(--ok);">✓ Sem pendência</span>';
    } else {
      statusHtml = `<span style="font-size:11px;color:${l.bloqueantes?'var(--err)':'var(--warn)'};font-weight:600;">${l.pendentes} pendente${l.pendentes>1?'s':''}${l.bloqueantes?' ('+l.bloqueantes+' bloqueante'+(l.bloqueantes>1?'s':'')+')':''}</span>`;
    }
    return `
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;" onclick="_confFilaAbrirProcesso('${p.id}')">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;">${esc(p.referencia)} <span class="fase-badge fase-${fase.id}" style="margin-left:6px;">${fase.icon} ${fase.label}</span></div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(p.fornecedor||'—')} ${p.cliente?'→ '+esc(p.cliente):''}</div>
          ${l.analise ? `<div style="font-size:10px;color:var(--dim);margin-top:2px;">Última conferência: ${esc(l.analise.data||'')}</div>` : ''}
        </div>
        <div style="flex-shrink:0;">${statusHtml}</div>
      </div>`;
  }).join('');
}

// Abre o painel do processo já direto na aba Conferência — evita o passo
// extra de abrir o processo e depois clicar na aba manualmente, que é
// exatamente o atrito que essa fila existe pra eliminar.
function _confFilaAbrirProcesso(id){
  abrirProcesso(id);
  setTimeout(() => trocarAba('conferencia'), 50);
}
