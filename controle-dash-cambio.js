// controle-dash-cambio.js
//
// Dashboard Câmbio — tela dedicada pra controlar os pagamentos de câmbio
// (entrada, saldo, parcelado) por processo, com foco em "o que tenho pra
// pagar essa semana/mês" (pedido do Ayslan, 09/09/2026). Reaproveita
// listarPagamentosPI() (controle-core.js) — a mesma fonte de dados já
// usada no Dashboard Financeiro — e as funções renderFluxoCaixaHtml()/
// renderControleCambialHtml() (controle-dashboards.js) pra não duplicar
// a lógica de fluxo de caixa mensal nem a comparação previsto x fechado.
//
// Parte do controle_v2.html, carregado via <script src> — não é ES
// module. Depende de: _processos, _cambio, listarPagamentosPI(), esc(),
// abrirProcesso(), fecharTodosDashboards(), ELEMENTOS_TOPO_DASHBOARD
// (controle-core.js) e renderFluxoCaixaHtml()/renderControleCambialHtml()
// (controle-dashboards.js — precisa carregar ANTES deste arquivo).

function toggleDashCambio(){
  const el = document.getElementById('dash-cambio');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  ELEMENTOS_TOPO_DASHBOARD.forEach(id => { const alvo = document.getElementById(id); if(alvo) alvo.style.display = visivel ? '' : 'none'; });
  const toolbarCam = document.querySelector('.toolbar');
  if(toolbarCam) toolbarCam.style.display = visivel ? '' : 'none';
  if(!visivel) renderDashCambio();
  document.getElementById('menu-cambio')?.classList.toggle('active', !visivel);
}

// Filtro do calendário (clicar numa semana/mês/fornecedor filtra a tabela
// de baixo) — estado simples em memória, resetado toda vez que a tela é
// reaberta (não precisa persistir entre sessões).
let _cambioFiltro = null; // {tipo:'semana'|'mes'|'fornecedor', ini, fim, label} ou {tipo:'fornecedor', nome}

function renderDashCambio(){
  const el = document.getElementById('dash-cambio-content');
  if(!el) return;

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fmtBRL = v => `R$ ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtUSD = v => `USD ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const cambioAtual = (_cambio && _cambio.USD) ? _cambio.USD : 5.10;

  // Fonte única de dados — mesma usada no Dashboard Financeiro. Cada linha
  // já vem "achatada" por parcela (entrada/saldo/parcela N/único), pronta
  // pra agrupar por semana/mês sem repetir a lógica de Entrada+Saldo x
  // Parcelado x À Vista/Prazo (ver listarPagamentosPI em controle-core.js).
  const todosPagamentos = listarPagamentosPI(_processos);
  const abertos = todosPagamentos.filter(x => !x.pago && x.vencimento);
  const semData = todosPagamentos.filter(x => !x.pago && !x.vencimento);

  // ── KPIs ───────────────────────────────────────────────────────
  const fimSemana = new Date(hoje); fimSemana.setDate(hoje.getDate() + (7 - hoje.getDay() === 0 ? 7 : (7 - hoje.getDay())));
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0);

  const totalAbertoUsd = abertos.reduce((s,x)=>s+x.valorUsd,0) + semData.reduce((s,x)=>s+x.valorUsd,0);
  const vencidos = abertos.filter(x => new Date(x.vencimento+'T00:00:00') < hoje);
  const vencidosUsd = vencidos.reduce((s,x)=>s+x.valorUsd,0);
  const estaSemana = abertos.filter(x => { const d = new Date(x.vencimento+'T00:00:00'); return d >= hoje && d <= fimSemana; });
  const estaSemanaUsd = estaSemana.reduce((s,x)=>s+x.valorUsd,0);
  const esteMes = abertos.filter(x => { const d = new Date(x.vencimento+'T00:00:00'); return d >= hoje && d <= fimMes; });
  const esteMesUsd = esteMes.reduce((s,x)=>s+x.valorUsd,0);

  function kpiCard(label, valorUsd, sub, cor){
    return `<div style="background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
      <div style="font-size:20px;font-weight:600;color:${cor};font-family:'DM Sans',sans-serif;white-space:nowrap;">${fmtUSD(valorUsd)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>
    </div>`;
  }

  const kpisHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:16px;">
    ${kpiCard('Em Aberto (Total)', totalAbertoUsd, fmtBRL(totalAbertoUsd*cambioAtual)+' (câmbio atual)', 'var(--ac)')}
    ${kpiCard('Vencido', vencidosUsd, vencidos.length+' parcela(s) atrasada(s)', vencidosUsd>0?'var(--err)':'var(--ok)')}
    ${kpiCard('Vence Esta Semana', estaSemanaUsd, estaSemana.length+' parcela(s)', estaSemanaUsd>0?'var(--warn)':'var(--ok)')}
    ${kpiCard('Vence Este Mês', esteMesUsd, esteMes.length+' parcela(s)', 'var(--ac)')}
  </div>`;

  // ── Calendário por SEMANA (próximas 8 semanas, começando na semana
  // corrente) — o "coração" da tela: pedido do Ayslan foi justamente ver
  // de forma fácil o que vem pela frente semana a semana. Cor mais quente
  // (vermelho) pra semana atual, esfriando (azul) conforme se afasta —
  // mesma leitura visual de "urgência" que o resto do sistema já usa
  // (Demurrage, alertas).
  const inicioSemanaAtual = new Date(hoje);
  inicioSemanaAtual.setDate(hoje.getDate() - hoje.getDay()); // domingo da semana atual
  const semanas = [];
  for(let i=0;i<8;i++){
    const ini = new Date(inicioSemanaAtual); ini.setDate(inicioSemanaAtual.getDate() + i*7);
    const fim = new Date(ini); fim.setDate(ini.getDate()+6);
    const doPeriodo = abertos.filter(x => { const d = new Date(x.vencimento+'T00:00:00'); return d>=ini && d<=fim; });
    const total = doPeriodo.reduce((s,x)=>s+x.valorUsd,0);
    semanas.push({ ini, fim, total, qtd: doPeriodo.length,
      label: `${ini.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}–${fim.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}` });
  }
  const maxSemana = Math.max(1, ...semanas.map(s=>s.total));
  const PALETA_URGENCIA = ['#b91c1c','#dc2626','#ea580c','#d97706','#0891b2','#0e7490','#1e6091','#2a5298'];
  const semanasHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:2px;">📅 Por Semana — próximas 8 semanas</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Clique numa semana pra ver só as parcelas dela na tabela abaixo.</div>
    <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;align-items:end;height:150px;">
      ${semanas.map((s,idx) => {
        const alturaPct = s.total>0 ? Math.max(6, Math.round((s.total/maxSemana)*100)) : 3;
        const cor = s.total>0 ? PALETA_URGENCIA[idx] : '#e2e8f0';
        const ativo = _cambioFiltro && _cambioFiltro.tipo==='semana' && _cambioFiltro.label===s.label;
        return `<div onclick="_cambioFiltro=${ativo?'null':`{tipo:'semana',ini:'${s.ini.toISOString().slice(0,10)}',fim:'${s.fim.toISOString().slice(0,10)}',label:'${s.label}'}`};renderDashCambio()"
          title="${fmtUSD(s.total)} · ${s.qtd} parcela(s)"
          style="cursor:pointer;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;${ativo?'background:#f1f5f9;border-radius:8px;':''}">
          <div style="font-size:10px;font-weight:700;color:${s.total>0?'#334155':'var(--muted)'};margin-bottom:3px;white-space:nowrap;">${s.total>0?fmtUSD(s.total):''}</div>
          <div style="width:70%;background:${cor};border-radius:4px 4px 0 0;height:${alturaPct}%;min-height:3px;${ativo?'outline:2px solid #0f1f3d;':''}"></div>
          <div style="font-size:9px;color:var(--muted);margin-top:4px;white-space:nowrap;">${s.label}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // ── Calendário por MÊS (próximos 6 meses) — mesmo estilo visual da
  // semana, só que agregado por mês, pra ver mais pra frente.
  const meses = [];
  for(let i=0;i<6;i++){
    const ini = new Date(hoje.getFullYear(), hoje.getMonth()+i, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth()+i+1, 0);
    const doPeriodo = abertos.filter(x => { const d = new Date(x.vencimento+'T00:00:00'); return d>=ini && d<=fim; });
    const total = doPeriodo.reduce((s,x)=>s+x.valorUsd,0);
    meses.push({ ini, fim, total, qtd: doPeriodo.length, label: ini.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}).replace('.','') });
  }
  const maxMes = Math.max(1, ...meses.map(m=>m.total));
  const mesesHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:2px;">🗓️ Por Mês — próximos 6 meses</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Clique num mês pra ver só as parcelas dele na tabela abaixo.</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;align-items:end;height:130px;">
      ${meses.map((m,idx) => {
        const alturaPct = m.total>0 ? Math.max(6, Math.round((m.total/maxMes)*100)) : 3;
        const ativo = _cambioFiltro && _cambioFiltro.tipo==='mes' && _cambioFiltro.label===m.label;
        return `<div onclick="_cambioFiltro=${ativo?'null':`{tipo:'mes',ini:'${m.ini.toISOString().slice(0,10)}',fim:'${m.fim.toISOString().slice(0,10)}',label:'${m.label}'}`};renderDashCambio()"
          title="${fmtUSD(m.total)} · ${m.qtd} parcela(s)"
          style="cursor:pointer;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;${ativo?'background:#f1f5f9;border-radius:8px;':''}">
          <div style="font-size:10px;font-weight:700;color:${m.total>0?'#334155':'var(--muted)'};margin-bottom:3px;white-space:nowrap;">${m.total>0?fmtUSD(m.total):''}</div>
          <div style="width:60%;background:#2a5298;border-radius:5px 5px 0 0;height:${alturaPct}%;min-height:3px;${ativo?'outline:2px solid #0f1f3d;':''}"></div>
          <div style="font-size:10px;color:var(--muted);margin-top:4px;text-transform:capitalize;">${m.label}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // ── Por Fornecedor — quem concentra mais USD em aberto agora, pra saber
  // com quem negociar prazo/câmbio primeiro se precisar.
  const porFornecedor = {};
  abertos.forEach(x => { porFornecedor[x.fornecedor] = (porFornecedor[x.fornecedor]||0) + x.valorUsd; });
  const listaFornecedor = Object.entries(porFornecedor).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const fornecedorHtml = !listaFornecedor.length ? '' : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:10px;">🏭 Por Fornecedor — maior exposição em aberto</div>
    ${listaFornecedor.map(([nome,val]) => {
      const pct = Math.round((val/listaFornecedor[0][1])*100);
      const ativo = _cambioFiltro && _cambioFiltro.tipo==='fornecedor' && _cambioFiltro.nome===nome;
      return `<div onclick="_cambioFiltro=${ativo?'null':`{tipo:'fornecedor',nome:'${nome.replace(/'/g,"\\'")}'}`};renderDashCambio()" style="cursor:pointer;margin-bottom:8px;${ativo?'background:#f1f5f9;border-radius:6px;padding:4px 6px;margin:-4px -6px 4px -6px;':''}">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span style="font-weight:600;">${esc(nome)}</span><span style="font-weight:700;">${fmtUSD(val)}</span>
        </div>
        <div style="background:var(--bg);border-radius:4px;height:6px;"><div style="width:${pct}%;background:var(--ac);border-radius:4px;height:6px;"></div></div>
      </div>`;
    }).join('')}
  </div>`;

  // ── Tabela detalhada — aplica o filtro do calendário/fornecedor, se
  // algum estiver ativo; senão mostra tudo que está em aberto (vencidas
  // primeiro), mais uma seção separada pro que não tem forma de pagamento
  // definida ainda (sem data pra entrar no calendário).
  let linhasFiltradas = abertos;
  let tituloFiltro = 'Todas as parcelas em aberto';
  if(_cambioFiltro){
    if(_cambioFiltro.tipo==='semana' || _cambioFiltro.tipo==='mes'){
      const ini = new Date(_cambioFiltro.ini+'T00:00:00'), fim = new Date(_cambioFiltro.fim+'T00:00:00');
      linhasFiltradas = abertos.filter(x=>{ const d=new Date(x.vencimento+'T00:00:00'); return d>=ini && d<=fim; });
      tituloFiltro = `Parcelas de ${_cambioFiltro.label} (<a href="#" onclick="_cambioFiltro=null;renderDashCambio();return false;" style="color:var(--ac);">limpar filtro</a>)`;
    } else if(_cambioFiltro.tipo==='fornecedor'){
      linhasFiltradas = abertos.filter(x=>x.fornecedor===_cambioFiltro.nome);
      tituloFiltro = `Parcelas de ${esc(_cambioFiltro.nome)} (<a href="#" onclick="_cambioFiltro=null;renderDashCambio();return false;" style="color:var(--ac);">limpar filtro</a>)`;
    }
  }
  linhasFiltradas = [...linhasFiltradas].sort((a,b)=>(a.vencimento||'9999').localeCompare(b.vencimento||'9999'));

  function badgeDias(vencimento){
    const d = new Date(vencimento+'T00:00:00');
    const dias = Math.round((d-hoje)/86400000);
    if(dias < 0) return `<span style="background:rgba(220,38,38,.1);color:var(--err);font-weight:700;padding:2px 7px;border-radius:20px;font-size:11px;white-space:nowrap;">${Math.abs(dias)}d atrasado</span>`;
    if(dias === 0) return `<span style="background:rgba(217,119,6,.12);color:var(--warn);font-weight:700;padding:2px 7px;border-radius:20px;font-size:11px;white-space:nowrap;">hoje</span>`;
    if(dias <= 7) return `<span style="background:rgba(217,119,6,.12);color:var(--warn);font-weight:700;padding:2px 7px;border-radius:20px;font-size:11px;white-space:nowrap;">em ${dias}d</span>`;
    return `<span style="background:var(--bg);color:var(--muted);font-weight:600;padding:2px 7px;border-radius:20px;font-size:11px;white-space:nowrap;">em ${dias}d</span>`;
  }

  const tabelaHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;">${tituloFiltro} — ${linhasFiltradas.length} parcela(s)</div>
    <div style="max-height:420px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:var(--bg);position:sticky;top:0;">
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Vencimento</th>
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Processo</th>
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Fornecedor</th>
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Parcela</th>
        <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Valor USD</th>
        <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Câmbio Previsto</th>
        <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">BRL Estimado</th>
      </tr></thead>
      <tbody>
        ${linhasFiltradas.map(x => `<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="abrirProcesso('${x.processoId}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
          <td style="padding:8px 16px;white-space:nowrap;">${x.vencimento ? new Date(x.vencimento+'T00:00:00').toLocaleDateString('pt-BR') : '—'} ${x.vencimento ? badgeDias(x.vencimento) : ''}</td>
          <td style="padding:8px 16px;font-weight:600;white-space:nowrap;">${esc(x.referencia)}</td>
          <td style="padding:8px 16px;color:var(--muted);">${esc(x.fornecedor)}</td>
          <td style="padding:8px 16px;text-transform:capitalize;">${esc(x.parcela)}</td>
          <td style="padding:8px 16px;text-align:right;font-weight:700;">${fmtUSD(x.valorUsd)}</td>
          <td style="padding:8px 16px;text-align:right;color:var(--muted);">${x.cambioPrevisto ? x.cambioPrevisto.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4}) : '—'}</td>
          <td style="padding:8px 16px;text-align:right;">${fmtBRL(x.valorUsd*(x.cambioPrevisto||cambioAtual))}</td>
        </tr>`).join('') || `<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--muted);">Nenhuma parcela em aberto neste filtro.</td></tr>`}
      </tbody>
    </table>
    </div>
    ${semData.length ? `<div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);">⚠ ${semData.length} parcela(s) sem forma de pagamento definida ainda (${fmtUSD(semData.reduce((s,x)=>s+x.valorUsd,0))}) — não entram no calendário acima. Abra o processo e defina Entrada+Saldo/Parcelado/À Vista/Prazo na aba PI.</div>` : ''}
  </div>`;

  el.innerHTML = kpisHtml + semanasHtml + mesesHtml + fornecedorHtml + tabelaHtml
    + renderFluxoCaixaHtml(todosPagamentos) + renderControleCambialHtml(todosPagamentos);
}
