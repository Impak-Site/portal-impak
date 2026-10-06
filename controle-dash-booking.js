// ════════════════════════════════════════════════════════════════
// PROGRAMAÇÃO SEMANAL DE EMBARQUES (Ayslan/Paula 06/10/2026)
// Vários pedidos ficam prontos juntos na fábrica; a equipe espalha os
// embarques semana a semana. Quadro com uma coluna por semana (semana de
// booking efetiva = campo "Semana de Booking" ou, vazio, a semana do ETD)
// + coluna "Prontos sem semana". Arrastar um processo para outra coluna
// grava a Semana de Booking dele (com histórico).
// Entram: processos ativos ainda não embarcados com prontidão ou semana.
// ════════════════════════════════════════════════════════════════
let _bookingArrastandoId = null;

function toggleDashBooking(){
  const el = document.getElementById('dash-booking');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  const tw = document.querySelector('.table-wrap');
  if(tw) tw.style.display = visivel ? '' : 'none';
  el.style.display = visivel ? 'none' : 'block';
  ELEMENTOS_TOPO_DASHBOARD.forEach(id => { const a = document.getElementById(id); if(a) a.style.display = visivel ? '' : 'none'; });
  const tb = document.querySelector('.toolbar');
  if(tb) tb.style.display = visivel ? '' : 'none';
  if(!visivel) renderDashBooking();
}

function processosParaBooking(processos){
  return (processos || []).filter(p => p && !p.cancelado && p.fase !== 'FINALIZADO' && !p.data_embarque
    && !['EMBARCADO','DESEMBARCADO','REGISTRO_DI','PARAMETRIZACAO','CARREGAMENTO','FATURAMENTO','DEVOLUCAO_VAZIO'].includes(p.fase)
    && !(typeof ehAcompanhamento === 'function' && ehAcompanhamento(p))
    && (p.data_prontidao || semanaBookingEfetiva(p)));
}

function _bookingQtdCont(p){
  return containersDoProcesso(p).length || (parseInt(p.qtd_containers_prevista, 10) || 0) || (parseInt(p.qtd_containers, 10) || 0) || 1;
}

function renderDashBooking(){
  const el = document.getElementById('dash-booking-content');
  if(!el) return;
  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
  const atual = semanaIsoDe(hojeIso);
  const lista = processosParaBooking(_processos);

  // Colunas: "Prontos sem semana", "Atrasadas" (semana já passou e ainda
  // não embarcou), semana atual até +8 e "Depois".
  const semanas = [];
  for(let i = 0; i <= 8; i++){
    const seg = segundaDaSemanaIso(atual.ano, atual.semana);
    seg.setUTCDate(seg.getUTCDate() + i*7);
    const w = semanaIsoDe(seg.toISOString().slice(0,10));
    const dom = new Date(seg); dom.setUTCDate(seg.getUTCDate() + 6);
    const f = d => d.toISOString().slice(8,10) + '/' + d.toISOString().slice(5,7);
    semanas.push({ chave: 'S' + w.semana, semana: w.semana, titulo: `Semana ${String(w.semana).padStart(2,'0')}`, sub: `${f(seg)} a ${f(dom)}${i===0?' · atual':''}`, itens: [] });
  }
  const colSem = { chave:'SEM', titulo:'Prontos sem semana', sub:'arraste para uma semana', itens:[], destaque:true };
  const colAtras = { chave:'ATRASO', titulo:'Semana já passou', sub:'ainda sem embarque', itens:[] };
  const colDepois = { chave:'DEPOIS', titulo:'Mais adiante', sub:'depois de 8 semanas', itens:[] };

  // Distância em semanas (lida com virada de ano: semana pequena logo
  // depois do fim do ano conta como ano seguinte).
  const distancia = n => { let d = n - atual.semana; if(d < -26) d += 52; if(d > 26) d -= 52; return d; };
  lista.forEach(p => {
    const w = semanaBookingEfetiva(p);
    if(!w){ colSem.itens.push(p); return; }
    const d = distancia(w.semana);
    if(d < 0) colAtras.itens.push(p);
    else if(d > 8) colDepois.itens.push(p);
    else semanas[d].itens.push(p);
  });
  const colunas = [colSem, ...(colAtras.itens.length ? [colAtras] : []), ...semanas, ...(colDepois.itens.length ? [colDepois] : [])];
  const fmtD = s => s ? String(s).slice(8,10) + '/' + String(s).slice(5,7) : '—';

  const card = p => {
    const w = semanaBookingEfetiva(p);
    const origem = w ? (w.origem === 'etd' ? 'pelo ETD' : 'definida') : '';
    return `<div class="bk-card" draggable="true" data-id="${esc(p.id)}"
        ondragstart="_bookingArrastandoId='${esc(p.id)}';this.style.opacity='.5'" ondragend="this.style.opacity='1'"
        onclick="abrirProcesso('${esc(p.id)}')" title="Clique para abrir · arraste para mudar a semana"
        style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:7px 9px;margin-bottom:6px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.05);">
      <div style="display:flex;justify-content:space-between;gap:6px;align-items:baseline;">
        <span style="font-weight:800;font-size:12.5px;color:var(--ac);word-break:break-all;">${esc(p.referencia || '—')}</span>
        <span style="font-size:11px;font-weight:700;color:#334155;white-space:nowrap;">${_bookingQtdCont(p)} cont.</span>
      </div>
      <div style="font-size:11px;color:#475569;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.cliente || '—')} · ${esc(p.fornecedor || '—')}</div>
      <div style="font-size:10.5px;color:#64748b;margin-top:2px;">Pronto ${fmtD(p.data_prontidao)} · ETD ${fmtD(p.etd)}${origem ? ` · <span style="color:${w.origem==='etd'?'#0f766e':'#2563eb'};font-weight:700;">${origem}</span>` : ''}</div>
    </div>`;
  };

  const totCont = itens => itens.reduce((s,p) => s + _bookingQtdCont(p), 0);
  const maxCont = Math.max(1, ...semanas.map(c => totCont(c.itens)));
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
      <div>
        <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:var(--text);">Programação Semanal de Embarques</div>
        <div style="font-size:12px;color:var(--muted);">${lista.length} processo(s) pronto(s) ou programado(s) ainda não embarcado(s) · semana pelo campo Semana de Booking ou, se vazio, pelo ETD. Arraste um processo para outra semana para programar.</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;align-items:flex-start;">
      ${colunas.map(c => {
        const n = c.itens.length, tc = totCont(c.itens);
        const pct = c.semana ? Math.round(tc / maxCont * 100) : 0;
        return `<div class="bk-col" data-col="${c.chave}" ondragover="event.preventDefault();this.style.outline='2px dashed var(--ac)'" ondragleave="this.style.outline=''"
            ondrop="this.style.outline='';soltarBooking(event,'${c.chave}',${c.semana||'null'})"
            style="flex:0 0 220px;background:${c.destaque ? 'rgba(234,88,12,.06)' : 'var(--bg)'};border:1px solid ${c.destaque ? 'rgba(234,88,12,.35)' : 'var(--border)'};border-radius:10px;padding:8px;min-height:120px;">
          <div style="font-weight:800;font-size:13px;color:${c.destaque ? '#c2410c' : 'var(--text)'};">${esc(c.titulo)}</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${esc(c.sub)}</div>
          <div style="font-size:11.5px;font-weight:700;color:#334155;margin-bottom:${c.semana ? '3px' : '8px'};">${n} processo(s) · ${tc} container(s)</div>
          ${c.semana ? `<div style="height:5px;background:#e2e8f0;border-radius:3px;margin-bottom:8px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct>=100?'#dc2626':pct>=70?'#d97706':'#0f766e'};"></div></div>` : ''}
          <div style="max-height:62vh;overflow-y:auto;">${c.itens.sort((a,b)=>String(a.data_prontidao||'').localeCompare(String(b.data_prontidao||''))).map(card).join('') || '<div style="font-size:11px;color:var(--muted);padding:6px 2px;">—</div>'}</div>
        </div>`;
      }).join('')}
    </div>`;
}

// Soltou um processo numa coluna: grava a Semana de Booking (com log).
// "Prontos sem semana" limpa o campo — se o processo tiver ETD ele volta a
// cair na semana do ETD (avisa).
async function soltarBooking(ev, chave, semana){
  ev.preventDefault();
  const id = _bookingArrastandoId; _bookingArrastandoId = null;
  const proc = (_processos || []).find(p => p.id === id);
  if(!proc) return;
  if(proc.fechado){ showToast('Processo fechado — não dá pra mudar a semana', 'warn'); return; }
  if(chave === 'ATRASO' || chave === 'DEPOIS') return;
  const novo = chave === 'SEM' ? null : semana;
  const antes = proc.semana_booking || null;
  if(String(antes || '') === String(novo || '')) return;
  proc.semana_booking = novo;
  proc.log = proc.log || [];
  proc.log.push({ campo:'semana_booking', valor_antes: antes ? String(antes) : '', valor_depois: novo ? String(novo) : '', usuario:_user.usuario, created_at:new Date().toISOString() });
  renderDashBooking();
  const ok = await salvarProcesso(proc, ['semana_booking']);
  if(ok === false){ proc.semana_booking = antes; renderDashBooking(); showToast('Não foi possível salvar a semana', 'err'); return; }
  if(!novo && proc.etd) showToast(`${proc.referencia}: semana manual removida — segue a semana do ETD`, 'warn');
  else showToast(`${proc.referencia}: ${novo ? 'Semana ' + novo : 'sem semana'}`, 'ok');
}
