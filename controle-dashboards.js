// controle-dashboards.js
//
// Dashboard Executivo, Dashboard Financeiro (KPIs, filtros, fluxo de caixa, controle cambial) e showToast().
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
function toggleDashExecutivo(){
  const el = document.getElementById('dash-executivo');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  el.style.display = visivel ? 'none' : 'block';
  document.getElementById('menu-executivo')?.classList.toggle('active', !visivel);
  if(!visivel) renderDashExecutivo();
}

function renderDashExecutivo(){
  const el = document.getElementById('dash-exec-content');
  if(!el) return;

  renderPeriodoSeletor('periodo-seletor-executivo', 'executivo', renderDashExecutivo);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const {ini: mesIni, fim: mesFim, label: periodoLabel} = calcularPeriodo('executivo');
  const semFim = new Date(hoje); semFim.setDate(hoje.getDate()+7);

  const ativos    = _processos.filter(p=>p.fase!=='FINALIZADO');
  const finalizados = _processos.filter(p=>p.fase==='FINALIZADO');
  const brl = v => 'R$ '+(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const usd = v => 'USD '+(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

  const totalProvUSD = ativos.reduce((s,p)=>s+(parseFloat(p.pi_valor_usd)||0),0);
  const pagosUSD     = ativos.filter(p=>p.pi_pago).reduce((s,p)=>s+(parseFloat(p.pi_valor_usd)||0),0);
  const abertoUSD    = totalProvUSD - pagosUSD;
  const demurCrit    = ativos.filter(p=>{ const d=demurrageDias(p); return d!==null&&d<=5&&!p.data_devolucao_vazio; });
  const etaVencidos  = ativos.filter(p=>p.eta&&p.fase==='EMBARCADO'&&parseDataLocal(p.eta)<hoje);
  const piVencidos   = ativos.filter(p=>p.pi_data_saldo&&!p.pi_pago&&parseDataLocal(p.pi_data_saldo)<hoje);
  const piSemana     = ativos.filter(p=>p.pi_data_saldo&&!p.pi_pago&&parseDataLocal(p.pi_data_saldo)>=hoje&&parseDataLocal(p.pi_data_saldo)<=semFim);
  const etaSemana    = ativos.filter(p=>p.eta&&parseDataLocal(p.eta)>=hoje&&parseDataLocal(p.eta)<=semFim&&p.fase==='EMBARCADO');
  const porFase      = {};
  _processos.forEach(p=>{ porFase[p.fase]=(porFase[p.fase]||0)+1; });
  const porForn      = {};
  ativos.forEach(p=>{ if(p.fornecedor) porForn[p.fornecedor]=(porForn[p.fornecedor]||0)+1; });
  const topForn      = Object.entries(porForn).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const nfSaidaPeriodo = ativos.filter(p=>p.nf_saida_data&&parseDataLocal(p.nf_saida_data)>=mesIni&&parseDataLocal(p.nf_saida_data)<=mesFim);
  const nfEntradaPeriodo = ativos.filter(p=>p.nf_entrada_data&&parseDataLocal(p.nf_entrada_data)>=mesIni&&parseDataLocal(p.nf_entrada_data)<=mesFim);
  const totalNfMes   = nfSaidaPeriodo.reduce((s,p)=>s+(parseFloat(p.nf_saida_valor)||0),0);

  function card(label, val, sub, cor, fmt, filtro){
    const display = fmt==='usd' ? usd(val) : val;
    const clickAttr = filtro!==undefined ? ` onclick="abrirComFiltro('${filtro}')" style="cursor:pointer;` : ' style="';
    return '<div'+clickAttr+'background:#fff;border:1px solid var(--border);border-left:3px solid '+cor+';border-radius:10px;padding:14px 16px;">'
      +'<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">'+label+'</div>'
      +'<div style="font-size:20px;font-weight:600;color:'+cor+';font-family:\'DM Sans\',sans-serif;white-space:nowrap;">'+display+'</div>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+sub+'</div>'
      +'</div>';
  }

  const kpis = [
    card('Total Processos', _processos.length, ativos.length+' em andamento', 'var(--ac)', 'num', ''),
    card('Provisionado', totalProvUSD, brl(totalProvUSD*(_cambio&&_cambio.USD?_cambio.USD:5.1)), 'var(--ac)', 'usd', '__pi_aberto'),
    card('Em Aberto', abertoUSD, brl(abertoUSD*(_cambio&&_cambio.USD?_cambio.USD:5.1)), 'var(--err)', 'usd', '__pi_aberto'),
    card('Demurrage Critico', demurCrit.length, 'containers <=5 dias', demurCrit.length>0?'var(--err)':'var(--ok)', 'num', '__demur'),
    card('ETA Vencidos', etaVencidos.length, 'ainda Embarcado', etaVencidos.length>0?'var(--warn)':'var(--ok)', 'num', 'EMBARCADO'),
    card('PI Vencidas', piVencidos.length, 'pagamento atrasado', piVencidos.length>0?'var(--err)':'var(--ok)', 'num', '__pi_vencido'),
  ];

  const funil = FASES.map(f=>{
    const n = porFase[f.id]||0;
    if(!n) return '';
    const pct = _processos.length ? Math.round(n/_processos.length*100) : 0;
    const cor = f.id==='FINALIZADO' ? 'var(--ok)' : 'var(--ac)';
    const fid = f.id;
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;" onclick="setFaseFilter(\"'+fid+'\");toggleDashExecutivo()">'
      +'<div style="font-size:11px;min-width:115px;color:var(--text);">'+f.icon+' '+f.label+'</div>'
      +'<div style="flex:1;background:var(--bg);border-radius:4px;height:8px;">'
      +'<div style="width:'+pct+'%;background:'+cor+';border-radius:4px;height:8px;"></div></div>'
      +'<div style="font-size:11px;font-weight:700;color:'+cor+';min-width:24px;text-align:right;">'+n+'</div>'
      +'</div>';
  }).join('');

  const alertasHtml = (demurCrit.length===0&&etaVencidos.length===0&&piVencidos.length===0)
    ? '<div style="text-align:center;padding:20px;color:var(--ok);font-size:13px;font-weight:600;">Sem alertas criticos</div>'
    : [
        // referencia/armador/fornecedor são texto livre (fornecedor às vezes
        // vem de extração por IA) — sempre escapar antes de innerHTML, senão
        // um valor malicioso/malformado vira HTML executável pra quem vir
        // este dashboard (XSS persistente). Ver esc() em controle-campos.js.
        ...demurCrit.map(p=>{
          const d=demurrageDias(p);
          const pid=p.id;
          return '<div style="padding:8px 10px;margin-bottom:6px;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.15);border-radius:7px;cursor:pointer;" onclick="abrirProcesso(\"'+pid+'\");toggleDashExecutivo()">'
            +'<div style="font-size:11px;font-weight:700;color:var(--err);">Demurrage: '+esc(p.referencia)+'</div>'
            +'<div style="font-size:10px;color:var(--muted);">Vence em '+d+' dia(s) · '+esc(p.armador||'—')+'</div></div>';
        }),
        ...etaVencidos.slice(0,4).map(p=>'<div style="padding:8px 10px;margin-bottom:6px;background:rgba(217,119,6,.06);border:1px solid rgba(217,119,6,.15);border-radius:7px;cursor:pointer;" onclick="abrirProcesso(\"'+p.id+'\");toggleDashExecutivo()">'
          +'<div style="font-size:11px;font-weight:700;color:var(--warn);">ETA vencido: '+esc(p.referencia)+'</div>'
          +'<div style="font-size:10px;color:var(--muted);">ETA '+(p.eta?parseDataLocal(p.eta).toLocaleDateString('pt-BR'):'—')+' · ainda Embarcado</div></div>'),
        ...piVencidos.slice(0,4).map(p=>'<div style="padding:8px 10px;margin-bottom:6px;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.15);border-radius:7px;cursor:pointer;" onclick="abrirProcesso(\"'+p.id+'\");toggleDashExecutivo()">'
          +'<div style="font-size:11px;font-weight:700;color:var(--err);">PI vencida: '+esc(p.referencia)+'</div>'
          +'<div style="font-size:10px;color:var(--muted);">Venceu '+parseDataLocal(p.pi_data_saldo).toLocaleDateString('pt-BR')+' · '+usd(parseFloat(p.pi_valor_usd)||0)+'</div></div>'),
      ].join('');

  const agendaHtml = etaSemana.length===0
    ? '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Nenhum navio chegando esta semana</div>'
    : etaSemana.map(p=>'<div style="padding:8px 10px;margin-bottom:6px;background:var(--bg);border:1px solid var(--border);border-radius:7px;cursor:pointer;" onclick="abrirProcesso(\"'+p.id+'\");toggleDashExecutivo()">'
        +'<div style="font-size:11px;font-weight:700;color:var(--ac);">'+esc(p.referencia)+'</div>'
        +'<div style="font-size:10px;color:var(--muted);">ETA '+(p.eta?parseDataLocal(p.eta).toLocaleDateString('pt-BR'):'—')+' · '+esc(p.armador||'—')+' · '+esc(p.fornecedor||'—')+'</div></div>').join('')
      + (topForn.length>0
        ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Top Fornecedores</div>'
          + topForn.map(([f,n])=>'<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);"><span>'+esc(f)+'</span><span style="font-weight:700;color:var(--text);">'+n+'</span></div>').join('')+'</div>'
        : '');

  const secStyle = 'background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px;';
  const secTitle = t => '<div style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;">'+t+'</div>';
  const piSemanaHtml = piSemana.length>0
    ? '<div style="padding:8px 10px;margin-top:6px;background:rgba(217,119,6,.06);border:1px solid rgba(217,119,6,.15);border-radius:7px;">'
      +'<div style="font-size:11px;font-weight:700;color:var(--warn);">'+piSemana.length+' PI(s) vencem em 7 dias · '+usd(piSemana.reduce((s,p)=>s+(parseFloat(p.pi_valor_usd)||0),0))+'</div></div>' : '';

  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
    +'<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;">Dashboard Executivo</div>'
    +'<div style="font-size:12px;color:var(--muted);">'+hoje.toLocaleDateString('pt-BR')+' · '+_processos.length+' processos</div></div>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;">'+kpis.join('')+'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px;">'
    +'<div style="'+secStyle+'">'+secTitle('Pipeline de Processos')+funil+'</div>'
    +'<div style="'+secStyle+'">'+secTitle('Alertas Criticos')+alertasHtml+piSemanaHtml+'</div>'
    +'<div style="'+secStyle+'">'+secTitle('Chegando Esta Semana')+agendaHtml+'</div>'
    +'</div>'
    +(totalNfMes>0 || nfEntradaPeriodo.length>0
      ? '<div style="'+secStyle+'margin-bottom:16px;">'+secTitle('Faturamento — '+periodoLabel)
        +'<div style="display:flex;gap:24px;flex-wrap:wrap;">'
        +'<div><div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;">NFs Saída emitidas</div><div style="font-size:20px;font-weight:600;color:var(--ok);font-family:\'DM Sans\',sans-serif;white-space:nowrap;">'+nfSaidaPeriodo.length+'</div></div>'
        +'<div><div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;">NFs Entrada emitidas</div><div style="font-size:20px;font-weight:600;color:var(--info);font-family:\'DM Sans\',sans-serif;white-space:nowrap;">'+nfEntradaPeriodo.length+'</div></div>'
        +'<div><div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;">Total faturado (saída)</div><div style="font-size:20px;font-weight:600;color:var(--ok);font-family:\'DM Sans\',sans-serif;white-space:nowrap;">'+brl(totalNfMes)+'</div></div>'
        +'</div></div>' : '');
}

function toggleDashFinanceiro(){
  const el = document.getElementById('dash-financeiro');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  el.style.display = visivel ? 'none' : 'block';
  if(!visivel) renderDashFinanceiro();
  document.getElementById('menu-financeiro')?.classList.toggle('active', !visivel);
}

function toggleDashResultado(){
  const el = document.getElementById('dash-resultado');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  el.style.display = visivel ? 'none' : 'block';
  if(!visivel) renderDashResultado();
  document.getElementById('menu-resultado')?.classList.toggle('active', !visivel);
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD RESULTADO — "quanto lucramos de verdade": cruza o Lucro
// Estimado (gravado em estimativa_json quando a cotação do Calculador é
// aprovada) com o Lucro Real de cada processo (calcularFechamento, em
// controle-core.js: NF Saída − Custo Real Total quando a aba Custos Reais
// tem itens lançados, senão NF Saída − NF Entrada). Reaproveita
// calcularFechamento() em vez de duplicar essa conta.
// ══════════════════════════════════════════════════════════════════
let _filResultado = { cliente:'' };

function atualizarFiltroResultado(campo, valor){
  _filResultado[campo] = valor;
  renderDashResultado();
}

function renderDashResultado(){
  const el = document.getElementById('dash-resultado-content');
  if(!el) return;

  renderPeriodoSeletor('periodo-seletor-resultado', 'resultado', renderDashResultado);
  const {ini, fim, label: periodoLabel} = calcularPeriodo('resultado');
  const f = _filResultado;

  const fmtBRL = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtPct = v => v==null ? '—' : `${(v*100).toFixed(1)}%`;

  const opClientes = [...new Set(_processos.map(p=>p.cliente||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

  // "Realizado" no período = processos com NF Saída emitida dentro do
  // período selecionado — é o momento em que o resultado vira fato
  // (faturado), não mais só previsão.
  const realizados = _processos.filter(p=>{
    if(!p.nf_saida_data) return false;
    const d = parseDataLocal(p.nf_saida_data);
    if(d < ini || d > fim) return false;
    if(f.cliente && p.cliente !== f.cliente) return false;
    return true;
  }).map(p => ({ p, fch: calcularFechamento(p) }));

  const totalLucroReal     = realizados.reduce((s,x)=> s + (x.fch.lucroReal||0), 0);
  const totalLucroEstimado = realizados.reduce((s,x)=> s + (x.fch.lucroEstimado||0), 0);
  const totalFaturamento   = realizados.reduce((s,x)=> s + (x.fch.nfSaida||0), 0);
  const margemMedia        = totalFaturamento > 0 ? totalLucroReal / totalFaturamento : null;
  const deltaTotal         = totalLucroReal - totalLucroEstimado;

  // Processos já cotados (têm estimativa) mas ainda sem NF Saída no período
  // — só um contador informativo, não entra nos totais (evita inflar o
  // resultado com venda que ainda não aconteceu).
  const emAndamento = _processos.filter(p=>{
    if(f.cliente && p.cliente !== f.cliente) return false;
    if(p.nf_saida_data){ const d = parseDataLocal(p.nf_saida_data); if(d>=ini && d<=fim) return false; }
    return !!p.estimativa_json && !p.nf_saida_valor;
  });

  function card(label, val, sub, cor){
    return `<div style="background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
    <div style="font-size:20px;font-weight:800;color:${cor};font-family:'DM Sans',sans-serif;white-space:nowrap;">${val}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>
    </div>`;
  }

  const kpis = [
    card('Lucro Real', fmtBRL(totalLucroReal), `${realizados.length} processo${realizados.length!==1?'s':''} faturado(s) no período`, totalLucroReal>=0?'var(--ok)':'var(--err)'),
    card('Lucro Estimado (cotado)', fmtBRL(totalLucroEstimado), 'previsto no Calculador', 'var(--ac)'),
    card('Diferença (Real − Estimado)', (deltaTotal>=0?'+':'')+fmtBRL(deltaTotal), deltaTotal>=0?'rendeu a mais que o cotado':'rendeu a menos que o cotado', deltaTotal>=0?'var(--ok)':'var(--err)'),
    card('Margem Real Média', fmtPct(margemMedia), fmtBRL(totalFaturamento)+' faturado', 'var(--info)'),
    ];

  const linhas = realizados.slice().sort((a,b)=>(b.fch.lucroReal??-Infinity)-(a.fch.lucroReal??-Infinity));
  el.innerHTML = `
  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">
  <div>
  <label style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Cliente</label>
  <select onchange="atualizarFiltroResultado('cliente', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;max-width:180px;">
  <option value="">Todos</option>
  ${opClientes.map(v=>`<option value="${esc(v)}" ${f.cliente===v?'selected':''}>${esc(v)}</option>`).join('')}
  </select>
  </div>
  <div style="font-size:11px;color:var(--muted);">Considerando processos com NF Saída emitida em: <strong>${periodoLabel}</strong></div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;">${kpis.join('')}</div>

  ${emAndamento.length ? `<div style="font-size:11px;color:var(--muted);margin-bottom:12px;">+ ${emAndamento.length} processo${emAndamento.length!==1?'s':''} cotado(s) ainda sem NF Saída neste período (não entram nos totais acima).</div>` : ''}

  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
  <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;">Lucro por processo</div>
  <div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
  <thead>
  <tr style="background:var(--bg);">
  <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Referência</th>
  <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Cliente</th>
  <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">NF Saída</th>
  <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Lucro Estimado</th>
  <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Lucro Real</th>
  <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Margem Real</th>
  <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Δ (Real − Estimado)</th>
  </tr>
  </thead>
  <tbody>
  ${linhas.map(({p,fch})=>{
    const margem = fch.nfSaida ? (fch.lucroReal||0)/fch.nfSaida : null;
    return `<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="abrirProcesso('${p.id}');toggleDashResultado()">
    <td style="padding:8px 12px;font-family:DM Mono,monospace;font-weight:600;color:var(--ac);">${esc(p.referencia)}${p.fechado?' 🔒':''}</td>
    <td style="padding:8px 12px;">${esc(p.cliente||'—')}</td>
    <td style="padding:8px 12px;text-align:right;">${fmtBRL(fch.nfSaida)}</td>
    <td style="padding:8px 12px;text-align:right;">${fmtBRL(fch.lucroEstimado)}</td>
    <td style="padding:8px 12px;text-align:right;font-weight:700;color:${(fch.lucroReal||0)>=0?'var(--ok)':'var(--err)'};">${fmtBRL(fch.lucroReal)}</td>
    <td style="padding:8px 12px;text-align:right;">${fmtPct(margem)}</td>
    <td style="padding:8px 12px;text-align:right;font-weight:700;color:${fch.deltaValor==null?'var(--muted)':fch.deltaValor>=0?'var(--ok)':'var(--err)'};">${fch.deltaValor==null?'—':(fch.deltaValor>=0?'+':'')+fmtBRL(fch.deltaValor)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--muted);">Nenhum processo com NF Saída emitida neste período.</td></tr>'}
  </tbody>
  </table>
  </div>
  </div>
  `;
}
  

// ════════════════════════════════════════════════════════════════
// FILTRO DE PERÍODO — cada dashboard (executivo/financeiro) tem seu
// próprio estado independente, identificado por um namespace.
// ════════════════════════════════════════════════════════════════
let _periodoEstado = {
  executivo:  { tipo:'mes', ini:'', fim:'' },
  financeiro: { tipo:'mes', ini:'', fim:'' },
  resultado:  { tipo:'mes', ini:'', fim:'' },
  narcelio:   { tipo:'mes', ini:'', fim:'' },
};

// Calcula {ini, fim, label} a partir do tipo de período selecionado para
// o namespace informado ('executivo' ou 'financeiro').
function calcularPeriodo(ns){
  const estado = _periodoEstado[ns] || _periodoEstado.financeiro;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  let ini, fim, label;
  if(estado.tipo==='semana'){
    const diaSemana = hoje.getDay(); // 0=domingo
    ini = new Date(hoje); ini.setDate(hoje.getDate()-diaSemana);
    fim = new Date(ini); fim.setDate(ini.getDate()+6);
    label = `Semana de ${ini.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}`;
  } else if(estado.tipo==='ano'){
    ini = new Date(hoje.getFullYear(),0,1);
    fim = new Date(hoje.getFullYear(),11,31);
    label = `Ano ${hoje.getFullYear()}`;
  } else if(estado.tipo==='custom' && estado.ini && estado.fim){
    ini = parseDataLocal(estado.ini);
    fim = parseDataLocal(estado.fim);
    label = `${ini.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}`;
  } else if(estado.tipo === 'custom'){
    // "Personalizado" selecionado mas ainda faltam as duas datas — calcula
    // com o mês atual só pra não quebrar nada, mas SEM forçar o tipo de
    // volta pra "mes" (senão os campos de data somem antes do usuário
    // conseguir preenchê-los — era o bug reportado).
    ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0);
    label = 'Selecione as datas';
  } else {
    estado.tipo = 'mes';
    ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0);
    label = hoje.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  }
  fim.setHours(23,59,59,999);
  return {ini, fim, label};
}

// Desenha o seletor (Semana/Mês/Ano/Personalizado) num container, ligado ao
// namespace de período (ns: 'executivo' ou 'financeiro' — cada um com seu
// próprio estado independente), e religa ao callback informado para
// re-renderizar o painel correspondente quando o período mudar.
function renderPeriodoSeletor(containerId, ns, onChangeCallback){
  const el = document.getElementById(containerId);
  if(!el) return;
  const estado = _periodoEstado[ns] || _periodoEstado.financeiro;
  const opts = [['semana','Semana'],['mes','Mês'],['ano','Ano'],['custom','Personalizado']];
  el.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      ${opts.map(([v,l])=>`<button type="button" onclick="_periodoEstado['${ns}'].tipo='${v}';renderPeriodoSeletor('${containerId}','${ns}',${onChangeCallback.name});${onChangeCallback.name}()"
        style="padding:5px 12px;border-radius:6px;border:1px solid ${estado.tipo===v?'var(--ac)':'var(--border)'};background:${estado.tipo===v?'var(--ac)':'#fff'};color:${estado.tipo===v?'#fff':'var(--text)'};font-size:11px;font-weight:600;cursor:pointer;">${l}</button>`).join('')}
      ${estado.tipo==='custom' ? `
        <input type="date" onpaste="colarData(event,this)" id="periodo-custom-ini-${containerId}" value="${estado.ini}" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;"
          onchange="_periodoEstado['${ns}'].ini=this.value;${onChangeCallback.name}()">
        <span style="font-size:11px;color:var(--muted);">até</span>
        <input type="date" onpaste="colarData(event,this)" id="periodo-custom-fim-${containerId}" value="${estado.fim}" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;"
          onchange="_periodoEstado['${ns}'].fim=this.value;${onChangeCallback.name}()">
      ` : ''}
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD FINANCEIRO (v2 — simplificado)
// ════════════════════════════════════════════════════════════════
// Redesenhado a pedido do usuário: 3 números que importam de verdade (saldo
// a pagar em 30 dias, exposição em USD, capital parado em estoque/trânsito)
// + fluxo de caixa em calendário (sem DRE) + controle cambial (previsto x
// fechado). "Saldo a receber" e "lucro esperado" ficaram de fora de
// propósito — o sistema ainda não rastreia pagamento de clientes nem
// preço de venda/custo por processo, então mostrar esses números seria
// inventar dado. Entram numa fase 2, quando existir esse cadastro.
// Estado do filtro do Dashboard Financeiro — tudo vazio por padrão (mostra
// tudo, igual antes). Cada campo aqui filtra a lista de "Pagamentos a
// Fornecedor" e, por tabela, os KPIs/fluxo de caixa/controle cambial que
// dependem dela — e o Capital Parado (que vem direto de _processos).
let _filFinanceiro = { de:'', ate:'', fornecedor:'', pais:'', cliente:'', status:'' };

function atualizarFiltroFinanceiro(campo, valor){
  _filFinanceiro[campo] = valor;
  renderDashFinanceiro();
}

function limparFiltroFinanceiro(){
  _filFinanceiro = { de:'', ate:'', fornecedor:'', pais:'', cliente:'', status:'' };
  renderDashFinanceiro();
}

function renderDashFinanceiro(){
  const el = document.getElementById('dash-fin-content');
  if(!el) return;

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const todosPagamentos = listarPagamentosPI(_processos);
  const f = _filFinanceiro;

  // Opções dos selects sempre com base em TODOS os pagamentos (não só nos já
  // filtrados) — senão a lista de opções ia encolhendo conforme filtrava.
  const uniq = arr => [...new Set(arr.filter(v=>v && v!=='—'))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const opFornecedores = uniq(todosPagamentos.map(x=>x.fornecedor));
  const opPaises       = uniq(todosPagamentos.map(x=>x.pais));
  const opClientes      = uniq(todosPagamentos.map(x=>x.cliente));

  const estaVencido = x => x.vencimento && !x.pago && new Date(x.vencimento+'T00:00:00') < hoje;

  const pagamentos = todosPagamentos.filter(x=>{
    if(f.fornecedor && x.fornecedor!==f.fornecedor) return false;
    if(f.pais && x.pais!==f.pais) return false;
    if(f.cliente && x.cliente!==f.cliente) return false;
    if(f.de  && (!x.vencimento || x.vencimento < f.de))  return false;
    if(f.ate && (!x.vencimento || x.vencimento > f.ate)) return false;
    if(f.status==='pago'     && !x.pago) return false;
    if(f.status==='vencido'  && !estaVencido(x)) return false;
    if(f.status==='previsto' && (x.pago || estaVencido(x))) return false;
    return true;
  });
  const emAberto = pagamentos.filter(x=>!x.pago);

  // Pagamentos em aberto sem vencimento calculável (falta "Prazo (dias)" da
  // PI preenchido) — não entram no cálculo de "Saldo a Pagar (30 dias)" nem
  // de "Vencido", porque não há data pra comparar. Isso pode fazer o KPI de
  // 30 dias parecer "zerado" mesmo com muito pagamento em aberto — o aviso
  // abaixo existe pra deixar isso visível em vez de escondido.
  const semVencimento = emAberto.filter(x=>!x.vencimento);

  // Capital parado vem de _processos (não da lista de pagamentos) — aplica
  // só os filtros que fazem sentido aqui (fornecedor/país/cliente; período e
  // status são sobre vencimento de pagamento, não sobre estoque parado).
  const capitalParadoBase = _processos.filter(p=>p.pi_pago && p.fase!=='FINALIZADO');
  const capitalParado = capitalParadoBase.filter(p=>{
    if(f.fornecedor && (p.fornecedor||'—')!==f.fornecedor) return false;
    if(f.pais && paisDoProcesso(p)!==f.pais) return false;
    if(f.cliente && (p.cliente||'—')!==f.cliente) return false;
    return true;
  });

  const filtrosAtivos = !!(f.de||f.ate||f.fornecedor||f.pais||f.cliente||f.status);

  const fmt    = v => `USD ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtBRL = v => `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // KPI 1 — Saldo a pagar nos próximos 30 dias
  const limite30 = new Date(hoje); limite30.setDate(hoje.getDate()+30);
  const aPagar30d = emAberto.filter(x=>{
    if(!x.vencimento) return false;
    const d = new Date(x.vencimento+'T00:00:00');
    return d>=hoje && d<=limite30;
  });
  const totalAPagar30dUSD = aPagar30d.reduce((s,x)=>s+x.valorUsd,0);

  // KPI 1b — Total já vencido (não pago, vencimento < hoje). Fica separado
  // do "Saldo a Pagar (30 dias)" de propósito — aquele card olha só pra
  // frente (vencimento >= hoje), então um pagamento atrasado nunca aparecia
  // em lugar nenhum com o valor em R$/USD, só como contador no Dashboard
  // Executivo ("PI Vencidas"). Esse card cobre esse buraco.
  const vencidos = emAberto.filter(estaVencido);
  const totalVencidoUSD = vencidos.reduce((s,x)=>s+x.valorUsd,0);

  // KPI 2 — Exposição total em USD (tudo que ainda está em aberto)
  const totalExposicaoUSD = emAberto.reduce((s,x)=>s+x.valorUsd,0);

  // KPI 3 — Capital parado em estoque/trânsito: já pago integralmente, mas
  // o processo ainda não foi finalizado (mercadoria ainda não virou venda).
  // (lista já filtrada por fornecedor/país/cliente lá em cima)
  const totalCapitalParadoUSD = capitalParado.reduce((s,p)=>s+(parseFloat(p.pi_valor_usd)||0),0);

  el.innerHTML = `
    <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:12px;">
      Câmbio atual: USD R$ ${_cambio.USD.toFixed(2)} · EUR R$ ${(_cambio.EUR||0).toFixed(2)} · CNY R$ ${(_cambio.CNY||0).toFixed(4)}
    </div>

    ${semVencimento.length>0 ? `<div style="background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.25);border-radius:10px;padding:10px 16px;margin-bottom:16px;font-size:12px;color:var(--warn);display:flex;align-items:center;gap:8px;">
      <span style="font-size:16px;">⚠</span>
      <span><strong>${semVencimento.length} pagamento${semVencimento.length!==1?'s':''} em aberto sem vencimento calculável</strong> — falta o campo "Prazo (dias)" da PI. Esses pagamentos não entram no "Saldo a Pagar (30 dias)" nem aparecem como "Vencido" até esse campo ser preenchido.</span>
    </div>` : ''}

    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">
      <div>
        <label style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Vencimento de</label>
        <input type="date" value="${esc(f.de)}" onchange="atualizarFiltroFinanceiro('de', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
      </div>
      <div>
        <label style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">até</label>
        <input type="date" value="${esc(f.ate)}" onchange="atualizarFiltroFinanceiro('ate', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
      </div>
      <div>
        <label style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Fornecedor</label>
        <select onchange="atualizarFiltroFinanceiro('fornecedor', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;max-width:180px;">
          <option value="">Todos</option>
          ${opFornecedores.map(v=>`<option value="${esc(v)}" ${f.fornecedor===v?'selected':''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">País</label>
        <select onchange="atualizarFiltroFinanceiro('pais', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
          <option value="">Todos</option>
          ${opPaises.map(v=>`<option value="${esc(v)}" ${f.pais===v?'selected':''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Cliente</label>
        <select onchange="atualizarFiltroFinanceiro('cliente', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;max-width:180px;">
          <option value="">Todos</option>
          ${opClientes.map(v=>`<option value="${esc(v)}" ${f.cliente===v?'selected':''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Status</label>
        <select onchange="atualizarFiltroFinanceiro('status', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
          <option value="">Todos</option>
          <option value="pago" ${f.status==='pago'?'selected':''}>Pago</option>
          <option value="vencido" ${f.status==='vencido'?'selected':''}>Vencido</option>
          <option value="previsto" ${f.status==='previsto'?'selected':''}>Previsto</option>
        </select>
      </div>
      ${filtrosAtivos ? `<button type="button" onclick="limparFiltroFinanceiro()" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-size:12px;font-weight:600;cursor:pointer;color:var(--ac);">✕ Limpar filtros</button>` : ''}
      ${filtrosAtivos ? `<div style="font-size:11px;color:var(--muted);margin-left:auto;align-self:center;">Mostrando ${pagamentos.length} de ${todosPagamentos.length} pagamento${todosPagamentos.length!==1?'s':''}</div>` : ''}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;">
      <div onclick="abrirComFiltro('__pi_vence_30d')" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:3px solid var(--err);border-radius:10px;padding:14px 16px;" title="Ver pagamentos vencendo nos próximos 30 dias">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Saldo a Pagar (30 dias)</div>
        <div style="font-size:20px;font-weight:800;color:var(--err);">${fmt(totalAPagar30dUSD)}</div>
        <div style="font-size:12px;color:var(--muted);">${fmtBRL(totalAPagar30dUSD*_cambio.USD)} · ${aPagar30d.length} pagamento${aPagar30d.length!==1?'s':''}</div>
      </div>
      <div onclick="abrirComFiltro('__pi_vencido')" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:3px solid var(--err);border-radius:10px;padding:14px 16px;" title="Ver pagamentos já vencidos (vencimento no passado, ainda não pagos)">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Total Vencido</div>
        <div style="font-size:20px;font-weight:800;color:var(--err);">${fmt(totalVencidoUSD)}</div>
        <div style="font-size:12px;color:var(--muted);">${fmtBRL(totalVencidoUSD*_cambio.USD)} · ${vencidos.length} pagamento${vencidos.length!==1?'s':''}</div>
      </div>
      <div onclick="abrirComFiltro('__pi_aberto')" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:10px;padding:14px 16px;" title="Ver todos os processos com pagamento em aberto">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Exposição em USD</div>
        <div style="font-size:20px;font-weight:800;color:var(--warn);">${fmt(totalExposicaoUSD)}</div>
        <div style="font-size:12px;color:var(--muted);">${fmtBRL(totalExposicaoUSD*_cambio.USD)} · ${emAberto.length} pagamento${emAberto.length!==1?'s':''} em aberto</div>
      </div>
      <div onclick="abrirComFiltro('__capital_parado')" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:3px solid var(--info);border-radius:10px;padding:14px 16px;" title="Ver processos já pagos, aguardando finalizar (mercadoria em estoque/trânsito)">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Capital Parado (estoque/trânsito)</div>
        <div style="font-size:20px;font-weight:800;color:var(--info);">${fmt(totalCapitalParadoUSD)}</div>
        <div style="font-size:12px;color:var(--muted);">${fmtBRL(totalCapitalParadoUSD*_cambio.USD)} · ${capitalParado.length} processo${capitalParado.length!==1?'s':''} pago(s)</div>
      </div>
    </div>

    <!-- Lista de pagamentos -->
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;">Pagamentos a Fornecedor</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:var(--bg);">
              <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Referência</th>
              <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Fornecedor</th>
              <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">País</th>
              <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Moeda</th>
              <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Valor (USD)</th>
              <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Câmbio</th>
              <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Valor (BRL)</th>
              <th style="padding:8px 12px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Vencimento</th>
              <th style="padding:8px 12px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${pagamentos.slice().sort((a,b)=>(a.vencimento||'9999').localeCompare(b.vencimento||'9999')).map(x=>{
              const vencido = x.vencimento && !x.pago && new Date(x.vencimento+'T00:00:00') < hoje;
              const statusHtml = x.pago
                ? '<span style="color:var(--ok);font-weight:700;">✓ Pago</span>'
                : vencido ? '<span style="color:var(--err);font-weight:700;">⚠ Vencido</span>'
                : x.vencimento ? '<span style="color:var(--muted);">Previsto</span>'
                : '<span style="color:var(--warn);" title="Falta o Prazo (dias) da PI pra calcular quando vence">— sem vencimento</span>';
              // Câmbio usado pra converter USD→BRL nessa linha: se já foi pago,
              // usa o câmbio que REALMENTE fechou (fato); senão usa o previsto
              // na PI, se tiver; senão cai pro câmbio atual só como estimativa
              // (marcado com "~" pra não parecer um valor fechado).
              const cambioReal = x.pago ? x.cambioFechado : null;
              const cambioUsado = cambioReal || x.cambioPrevisto || _cambio.USD;
              const cambioLabel = cambioReal ? cambioReal.toFixed(4) : `~${cambioUsado.toFixed(4)}`;
              const valorBRL = x.valorUsd * cambioUsado;
              return `<tr style="border-top:1px solid var(--border);cursor:pointer;${vencido?'background:rgba(220,38,38,.03)':''}" onclick="abrirProcesso('${x.processoId}');toggleDashFinanceiro()">
                <td style="padding:8px 12px;font-family:DM Mono,monospace;font-weight:600;color:var(--ac);">${x.referencia}${x.parcela==='entrada'?' <span style="color:var(--muted);font-weight:400;">(entrada)</span>':x.parcela==='saldo'?' <span style="color:var(--muted);font-weight:400;">(saldo)</span>':''}</td>
                <td style="padding:8px 12px;">${x.fornecedor}</td>
                <td style="padding:8px 12px;">${x.pais}</td>
                <td style="padding:8px 12px;">${x.moeda}</td>
                <td style="padding:8px 12px;text-align:right;font-family:DM Mono,monospace;">${fmt(x.valorUsd)}</td>
                <td style="padding:8px 12px;text-align:right;font-family:DM Mono,monospace;" title="${cambioReal?'Câmbio fechado (real)':'Câmbio previsto — ainda não fechado'}">R$ ${cambioLabel}</td>
                <td style="padding:8px 12px;text-align:right;font-family:DM Mono,monospace;">${fmtBRL(valorBRL)}</td>
                <td style="padding:8px 12px;text-align:center;">${x.vencimento?new Date(x.vencimento+'T00:00:00').toLocaleDateString('pt-BR'):'—'}</td>
                <td style="padding:8px 12px;text-align:center;">${statusHtml}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="9" style="padding:16px;text-align:center;color:var(--muted);">Nenhum pagamento de PI registrado ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    ${renderFluxoCaixaHtml(pagamentos)}
    ${renderControleCambialHtml(pagamentos)}
  `;
}

// Calendário simples de saídas (sem DRE) — próximos 6 meses, separando o
// que já foi pago do que ainda é previsão. "Entradas" fica de fora por
// enquanto: o sistema não rastreia pagamento de cliente, só emissão de NF
// de Saída, que não é a mesma coisa (a NF pode ser emitida antes do cliente
// efetivamente pagar) — melhor não mostrar um número que pareceria "entrada
// de caixa" sem ser garantido.
function renderFluxoCaixaHtml(pagamentos){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fmtBRL = v => `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  const meses = [];
  for(let i=0;i<6;i++){
    const ini = new Date(hoje.getFullYear(), hoje.getMonth()+i, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth()+i+1, 0);
    fim.setHours(23,59,59,999);
    meses.push({ini, fim, label: ini.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})});
  }

  const linhas = meses.map(m=>{
    const doMes = pagamentos.filter(x=>{
      if(!x.vencimento) return false;
      const d = new Date(x.vencimento+'T00:00:00');
      return d>=m.ini && d<=m.fim;
    });
    const pagoBRL      = doMes.filter(x=>x.pago).reduce((s,x)=>s+x.valorUsd*(x.cambioFechado||_cambio.USD),0);
    const previstoBRL   = doMes.filter(x=>!x.pago).reduce((s,x)=>s+x.valorUsd*(x.cambioPrevisto||_cambio.USD),0);
    return {label:m.label, pagoBRL, previstoBRL, qtd:doMes.length};
  });

  return `
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);">
        <div style="font-size:13px;font-weight:700;">📅 Fluxo de Caixa — Saídas por mês</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Só pagamentos a fornecedor por enquanto — entradas de clientes ainda não são rastreadas no sistema.</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:var(--bg);">
          <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Mês</th>
          <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Saídas Pagas</th>
          <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Saídas Previstas</th>
          <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Total</th>
        </tr></thead>
        <tbody>
          ${linhas.map(l=>`<tr style="border-top:1px solid var(--border);">
            <td style="padding:8px 16px;text-transform:capitalize;font-weight:600;">${l.label}</td>
            <td style="padding:8px 16px;text-align:right;color:var(--ok);">${fmtBRL(l.pagoBRL)}</td>
            <td style="padding:8px 16px;text-align:right;color:var(--warn);">${fmtBRL(l.previstoBRL)}</td>
            <td style="padding:8px 16px;text-align:right;font-weight:700;">${fmtBRL(l.pagoBRL+l.previstoBRL)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Controle cambial: compara o câmbio previsto na PI com o que realmente foi
// fechado no pagamento, só pra parcelas já pagas com os dois valores
// registrados. Diferença positiva = fechou mais barato que o previsto
// (economia); negativa = fechou mais caro (perda).
function renderControleCambialHtml(pagamentos){
  const fmtBRL = v => `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const comparaveis = pagamentos.filter(x=>x.pago && x.cambioPrevisto && x.cambioFechado);

  if(!comparaveis.length){
    return `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;">💱 Controle Cambial — Previsto x Fechado</div>
      <div style="font-size:12px;color:var(--muted);">Ainda não há pagamentos com "Câmbio na PI" e "Câmbio Fechado" registrados pra comparar. Assim que confirmar um comprovante de câmbio de um processo que já tinha o câmbio previsto preenchido, a diferença aparece aqui.</div>
    </div>`;
  }

  const linhas = comparaveis.map(x=>({...x, diff:(x.cambioPrevisto-x.cambioFechado)*x.valorUsd}))
    .sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
  const diffTotal = linhas.reduce((s,x)=>s+x.diff,0);
  const economizou = diffTotal >= 0;
  const corDiff = economizou ? 'var(--ok)' : 'var(--err)';
  const fraseDiff = economizou
    ? `✓ Você economizou ${fmtBRL(Math.abs(diffTotal))} no câmbio`
    : `⚠ Você perdeu ${fmtBRL(Math.abs(diffTotal))} no câmbio`;

  return `
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);">
        <div style="font-size:13px;font-weight:700;margin-bottom:4px;">💱 Controle Cambial — Previsto x Fechado</div>
        <div style="font-size:17px;font-weight:800;color:${corDiff};">${fraseDiff}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:var(--bg);">
          <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Referência</th>
          <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Previsto</th>
          <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Fechado</th>
          <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Diferença</th>
        </tr></thead>
        <tbody>
          ${linhas.map(x=>`<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="abrirProcesso('${x.processoId}');toggleDashFinanceiro()">
            <td style="padding:8px 16px;font-family:DM Mono,monospace;font-weight:600;">${x.referencia}</td>
            <td style="padding:8px 16px;text-align:right;">R$ ${x.cambioPrevisto.toFixed(4)}</td>
            <td style="padding:8px 16px;text-align:right;">R$ ${x.cambioFechado.toFixed(4)}</td>
            <td style="padding:8px 16px;text-align:right;font-weight:700;color:${x.diff>=0?'var(--ok)':'var(--err)'};">${x.diff>=0?'+':''}${fmtBRL(x.diff)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}


function limparFiltroData(){
  const de  = document.getElementById('filtro-data-de');
  const ate = document.getElementById('filtro-data-ate');
  if(de)  de.value  = '';
  if(ate) ate.value = '';
  render();
}
function filtroEssaSemana(){
  const hoje = new Date();
  const dom  = new Date(hoje); dom.setDate(hoje.getDate() - hoje.getDay());
  const sab  = new Date(dom);  sab.setDate(dom.getDate() + 6);
  document.getElementById('filtro-data-de').value  = dom.toISOString().split('T')[0];
  document.getElementById('filtro-data-ate').value = sab.toISOString().split('T')[0];
  render();
}
function filtroEsseMes(){
  const hoje = new Date();
  const ini  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim  = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0);
  document.getElementById('filtro-data-de').value  = ini.toISOString().split('T')[0];
  document.getElementById('filtro-data-ate').value = fim.toISOString().split('T')[0];
  render();
}

function showToast(msg, tipo){
  const wrap = document.getElementById('toast-wrap');
  if(!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast '+(tipo||'');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}
