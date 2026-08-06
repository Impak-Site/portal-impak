// controle-dash-narcelio.js
//
// Dashboard Narcélio — visão do dono da empresa: quantos containers estão
// em cada fase do funil (pedido/previsão de embarque/embarcado), quais
// chegam nos próximos meses, faturamento por período (NF de Saída), estoque
// parado no armazém (containers já nacionalizados mas ainda sem venda) e
// previsão de necessidade de caixa (combinando o cronograma de pagamento da
// PI com o restante dos custos reais do processo). Acesso restrito: ver
// GET /narcelio em server.js (só o usuário "narcelio" abre esta tela) e
// ativarTelaNarcelioExclusiva() em controle-core.js — a checagem de
// _user.usuario aqui é só cosmética (esconder o link do menu), não é a
// proteção real.
//
// Parte do controle_v2.html, carregado via <script src> — não é ES module.
// Depende de: _processos, _user, FASES/calcularFase, containersDoProcesso,
// listarPagamentosPI, calcularCustoRealTotal, esc(), parseDataLocal,
// renderPeriodoSeletor/calcularPeriodo/_periodoEstado (controle-core.js e
// controle-dashboards.js).

// Reaproveita o mesmo mecanismo de período (semana/mês/ano/personalizado)
// dos outros dashboards, com namespaces próprios pra não interferir no
// filtro de Faturamento do Dashboard Financeiro nem no do Resultado.
if (typeof _periodoEstado !== 'undefined') {
  _periodoEstado.narcelio = _periodoEstado.narcelio || { tipo: 'mes', ini: '', fim: '' };
  _periodoEstado.narcelioChegando = _periodoEstado.narcelioChegando || { tipo: 'mes', ini: '', fim: '' };
}

function toggleDashNarcelio(){
  const el = document.getElementById('dash-narcelio');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  el.style.display = visivel ? 'none' : 'block';
  if(!visivel) renderDashNarcelio();
  document.getElementById('menu-narcelio')?.classList.toggle('active', !visivel);
}

function renderDashNarcelio(){
  const el = document.getElementById('dash-narcelio-content');
  if(!el) return;

  const fmtBRL = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  function card(label, val, sub, cor, key){
    const attrs = key ? ` onclick="abrirListaNarcelio('${key}')" title="Clique para ver a lista" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;"` : ` style="background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;"`;
    return `<div${attrs}>
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
    <div style="font-size:20px;font-weight:800;color:${cor};font-family:'DM Sans',sans-serif;white-space:nowrap;">${val}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>
    </div>`;
  }

  // ── 1/2/3: containers por fase do funil ──────────────────────
  // "Pedido" conta todo processo com PI recebida (ou seja, todos — PI é a
  // primeira fase de todo processo cadastrado). Previsão de embarque e
  // Embarcado usam a fase calculada (calcularFase), consistente com o resto
  // do sistema (não duplica a lógica de datas aqui).
  const periodo = calcularPeriodo('narcelio'); // período único, aplicado a todos os cards abaixo (exceto Estoque Parado)
  function dentroPeriodo(dataStr){
    if(!dataStr) return false;
    const d = parseDataLocal(String(dataStr).slice(0,10));
    return !!d && d >= periodo.ini && d <= periodo.fim;
  }
  let qtdPedido = 0, qtdPrevisaoEmbarque = 0, qtdEmbarcado = 0;
  const pedidoLista = [], previsaoEmbarqueLista = [], embarcadoLista = [];
  _processos.forEach(p => {
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0);
    if(!n) return;
    if(dentroPeriodo(p.created_at)){
      qtdPedido += n;
      pedidoLista.push({ id:p.id, referencia:p.referencia, fornecedor:p.fornecedor, n });
    }
    const fase = calcularFase(p);
    if(fase === 'AGUARDANDO_EMBARQUE' && dentroPeriodo(p.etd)){ qtdPrevisaoEmbarque += n; previsaoEmbarqueLista.push({ id:p.id, referencia:p.referencia, fornecedor:p.fornecedor, n }); }
    if(dentroPeriodo(p.data_embarque)){ qtdEmbarcado += n; embarcadoLista.push({ id:p.id, referencia:p.referencia, fornecedor:p.fornecedor, n }); }
  });

  // ── 4: containers chegando, com filtro de data (ETA) ─────────
  let qtdChegando = 0;
  const chegandoLista = [];
  _processos.forEach(p => {
    if(p.data_chegada || !p.eta) return; // já chegou de fato, ou sem ETA — não conta como "chegando"
    const eta = parseDataLocal(p.eta);
    if(!eta || eta < periodo.ini || eta > periodo.fim) return;
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0);
    if(!n) return;
    qtdChegando += n;
    chegandoLista.push({ id: p.id, referencia: p.referencia, eta: p.eta, n, fornecedor: p.fornecedor });
  });
  chegandoLista.sort((a,b) => (a.eta||'').localeCompare(b.eta||''));

  // ── 5: faturamento por período (NF de Saída) ─────────────────
  let faturamento = 0, qtdFaturados = 0;
  const faturadosLista = [];
  _processos.forEach(p => {
    if(!p.nf_saida_data || !p.nf_saida_valor) return;
    const d = parseDataLocal(p.nf_saida_data);
    if(!d || d < periodo.ini || d > periodo.fim) return;
    faturamento += parseFloat(p.nf_saida_valor) || 0;
    qtdFaturados++;
    faturadosLista.push({ id:p.id, referencia:p.referencia, fornecedor:p.cliente||p.fornecedor, valor: parseFloat(p.nf_saida_valor)||0, data: p.nf_saida_data });
  });

  // ── 6: estoque parado no armazém (importado, ainda sem venda) ─
  // Identificado por: NF de Entrada já lançada + (NF de Saída com CFOP 5905,
  // que é remessa/retorno interno e não representa venda real, OU NF de
  // Saída ainda não emitida). Agrupa por descrição do produto EXATAMENTE
  // como está cadastrada (sem tentar normalizar medida/marca) — combinação
  // simples e recomendada, conforme decisão do usuário.
  const estoqueParado = {}; // descricao -> quantidade
  let processosEstoqueParado = 0;
  const estoqueProcessosLista = [];
  _processos.forEach(p => {
    if(!p.nf_entrada_numero) return;
    const semVenda = p.nf_saida_cfop === '5905' || !p.nf_saida_numero;
    if(!semVenda) return;
    processosEstoqueParado++;
    estoqueProcessosLista.push({ id:p.id, referencia:p.referencia, fornecedor:p.fornecedor });
    let produtos = [];
    try { produtos = JSON.parse(p.produtos_json || '[]'); } catch(e) { /* ignora produtos_json inválido */ }
    if(!Array.isArray(produtos) || !produtos.length){
      if(p.produto) produtos = [{ descricao: p.produto, quantidade: null }];
    }
    produtos.forEach(it => {
      const desc = (it.descricao || 'Sem descrição').trim();
      const qtd = parseFloat(it.quantidade) || 0;
      estoqueParado[desc] = (estoqueParado[desc] || 0) + qtd;
    });
  });
  const estoqueParadoLista = Object.entries(estoqueParado).sort((a,b) => b[1]-a[1]);

  // ── 7: previsão de necessidade de numerário ───────────────────
  // Combina o cronograma de pagamento da PI (listarPagamentosPI — já traz
  // data de vencimento e câmbio previsto/fechado por parcela, cobrindo o
  // caso de FOB a prazo/entrada+saldo) com o RESTANTE dos custos reais do
  // processo (impostos, frete, taxas...), que não têm data própria — por
  // aproximação, esses ficam no mês do ETA (quando o processo desembaraça e
  // a maior parte desses custos é efetivamente paga). Só processos ainda
  // não fechados (processo fechado não tem mais desembolso pendente).
  const meses = {}; // 'AAAA-MM' -> valor em R$
  function addMes(dataStr, valor){
    if(!dataStr || !valor) return;
    const chave = String(dataStr).slice(0,7);
    meses[chave] = (meses[chave]||0) + valor;
  }
  const processosAbertos = _processos.filter(p => !p.fechado);
  const contribPorProcesso = {}; // processoId -> valor
  function addContrib(id, valor){ if(!id) return; contribPorProcesso[id] = (contribPorProcesso[id]||0) + valor; }
  let totalUsdFob = 0, totalFobBRL = 0, totalCustosBRL = 0;
  listarPagamentosPI(processosAbertos).forEach(pg => {
    if(pg.pago) return;
    const cambio = pg.cambioFechado || pg.cambioPrevisto;
    if(!cambio || !pg.valorUsd) return;
    if(!dentroPeriodo(pg.vencimento)) return;
    const valorPg = pg.valorUsd * cambio;
    addMes(pg.vencimento, valorPg);
    addContrib(pg.processoId, valorPg);
    totalUsdFob += pg.valorUsd;
    totalFobBRL += valorPg;
  });
  processosAbertos.forEach(p => {
    const custoReal = calcularCustoRealTotal(p);
    if(!custoReal || !custoReal.total) return;
    const cambioReal = parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || 0;
    const fobConvertido = (parseFloat(p.real_json && p.real_json.fob) || 0) * cambioReal;
    const restante = custoReal.total - fobConvertido;
    if(restante <= 0) return;
    const dataRef = p.eta || p.data_registro_di || p.previsao_prontidao;
    if(!dentroPeriodo(dataRef)) return;
    addMes(dataRef, restante);
    addContrib(p.id, restante);
    totalCustosBRL += restante;
  });
  const mesesOrdenados = Object.keys(meses).sort();
  const totalPrevisto = mesesOrdenados.reduce((s,k) => s + meses[k], 0);
  const caixaLista = Object.keys(contribPorProcesso).map(id => {
    const p = _processos.find(x => x.id === id);
    return { id, referencia: p ? p.referencia : id, fornecedor: p ? p.fornecedor : '', valor: contribPorProcesso[id] };
  }).sort((a,b) => b.valor - a.valor);

  const kpis = [
    card('Containers Pedidos (PI)', `${qtdPedido} containers`, `${pedidoLista.length} processo${pedidoLista.length!==1?'s':''} — ${periodo.label}`, 'var(--ac)', 'pedido'),
    card('Previsão de Embarque', `${qtdPrevisaoEmbarque} containers`, `aguardando embarque — ${periodo.label}`, '#b45309', 'embarque'),
    card('Embarcados / em água', `${qtdEmbarcado} containers`, `embarcado — ${periodo.label}`, 'var(--ac)', 'embarcado'),
    card('Chegando no período', `${qtdChegando} containers`, periodo.label, 'var(--ok)', 'chegando'),
    card('Faturamento no período', fmtBRL(faturamento), `${qtdFaturados} NF de saída — ${periodo.label}`, 'var(--ok)', 'faturamento'),
    card('Processos com Estoque Parado', `${processosEstoqueParado} processos`, `${estoqueParadoLista.length} descrições diferentes de produto`, 'var(--err)', 'estoque'),
    card('Previsão de Caixa (no período)', fmtBRL(totalPrevisto), `Câmbio (FOB): US$ ${totalUsdFob.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} → ${fmtBRL(totalFobBRL)} · Impostos/custos: ${fmtBRL(totalCustosBRL)} — ${periodo.label}`, 'var(--err)', 'caixa'),
  ];
  window._narcelioListas = {
    pedido: { titulo: 'Containers Pedidos (PI) — ' + periodo.label, rows: pedidoLista },
    embarque: { titulo: 'Previsão de Embarque — ' + periodo.label, rows: previsaoEmbarqueLista },
    embarcado: { titulo: 'Embarcados / em água — ' + periodo.label, rows: embarcadoLista },
    chegando: { titulo: 'Chegando no período — ' + periodo.label, rows: chegandoLista },
    faturamento: { titulo: 'Faturamento no período — ' + periodo.label, rows: faturadosLista },
    estoque: { titulo: 'Processos com Estoque Parado', rows: estoqueProcessosLista },
    caixa: { titulo: 'Previsão de Caixa — ' + periodo.label, rows: caixaLista },
  };

  const tabelaChegando = chegandoLista.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
        <th style="padding:6px 4px;">Referência</th><th style="padding:6px 4px;">Fornecedor</th>
        <th style="padding:6px 4px;">ETA</th><th style="padding:6px 4px;text-align:right;">Containers</th>
      </tr></thead>
      <tbody>${chegandoLista.map(c => `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:6px 4px;">${esc(c.referencia)}</td><td style="padding:6px 4px;">${esc(c.fornecedor||'—')}</td>
        <td style="padding:6px 4px;">${c.eta ? new Date(c.eta+'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td style="padding:6px 4px;text-align:right;">${c.n}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<div style="font-size:12px;color:var(--muted);">Nenhum container chegando no período selecionado.</div>`;

  const tabelaEstoque = estoqueParadoLista.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
        <th style="padding:6px 4px;">Pneu / Medida</th><th style="padding:6px 4px;text-align:right;">Quantidade</th>
      </tr></thead>
      <tbody>${estoqueParadoLista.map(([desc,qtd]) => `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:6px 4px;">${esc(desc)}</td><td style="padding:6px 4px;text-align:right;">${qtd.toLocaleString('pt-BR')}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<div style="font-size:12px;color:var(--muted);">Nenhum processo com estoque parado identificado.</div>`;

  const tabelaFluxo = mesesOrdenados.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
        <th style="padding:6px 4px;">Mês</th><th style="padding:6px 4px;text-align:right;">Previsão de saída (R$)</th>
      </tr></thead>
      <tbody>${mesesOrdenados.map(k => {
        const [ano,mes] = k.split('-');
        const label = new Date(parseInt(ano),parseInt(mes)-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
        return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:6px 4px;text-transform:capitalize;">${label}</td>
        <td style="padding:6px 4px;text-align:right;">${fmtBRL(meses[k])}</td>
      </tr>`;
      }).join('')}</tbody>
    </table>` : `<div style="font-size:12px;color:var(--muted);">Sem pagamentos ou custos pendentes previstos.</div>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div style="font-size:11px;color:var(--muted);">Período aplicado aos indicadores abaixo (exceto Estoque Parado):</div>
      <div id="periodo-seletor-narcelio-geral"></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px;">${kpis.join('')}</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">🚢 Containers Chegando</div>
        ${tabelaChegando}
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">📦 Estoque Parado no Armazém</div>
        ${tabelaEstoque}
      </div>
    </div>

    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">💰 Faturamento (NF de Saída)</div>
      <div style="font-size:20px;font-weight:800;color:var(--ok);font-family:'DM Sans',sans-serif;">${fmtBRL(faturamento)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${qtdFaturados} NF de saída emitida(s) em ${periodo.label}</div>
    </div>

    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">📅 Previsão de Recurso de Numerário</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Cronograma de pagamento da PI (FOB, por vencimento e câmbio previsto/fechado — cobre FOB a prazo) + demais custos reais do processo (aproximados no mês do ETA). Só processos ainda não fechados.</div>
      ${tabelaFluxo}
    </div>
  `;

  renderPeriodoSeletor('periodo-seletor-narcelio-geral', 'narcelio', renderDashNarcelio);
}


// ── Modal de lista (cards clicáveis) ──────────────────────────
function abrirListaNarcelio(key){
  const dados = (window._narcelioListas || {})[key];
  if(!dados) return;
  let modal = document.getElementById('narcelio-lista-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'narcelio-lista-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;align-items:center;justify-content:center;';
    modal.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:720px;width:92%;max-height:82vh;overflow:auto;padding:20px 22px;box-shadow:0 12px 40px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<h3 id="narcelio-lista-titulo" style="margin:0;font-size:16px;"></h3>' +
      '<button onclick="fecharListaNarcelio()" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--muted);">&times;</button>' +
      '</div><div id="narcelio-lista-corpo"></div></div>';
    modal.addEventListener('click', function(e){ if(e.target === modal) fecharListaNarcelio(); });
    document.body.appendChild(modal);
  }
  document.getElementById('narcelio-lista-titulo').textContent = dados.titulo + ' (' + dados.rows.length + ')';
  const fmtBRL2 = v => v==null ? '—' : `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const corpo = document.getElementById('narcelio-lista-corpo');
  if(!dados.rows.length){
    corpo.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px 0;text-align:center;">Nenhum processo encontrado.</div>';
  } else {
    const temN = dados.rows[0].n !== undefined;
    const temValor = dados.rows[0].valor !== undefined;
    const temData = dados.rows[0].eta !== undefined || dados.rows[0].data !== undefined;
    corpo.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
        <th style="padding:6px 8px;">Referência</th>
        <th style="padding:6px 8px;">Fornecedor/Cliente</th>
        ${temN || temValor ? '<th style="padding:6px 8px;text-align:right;">' + (temN?'Containers':'Valor') + '</th>' : ''}
        ${temData ? '<th style="padding:6px 8px;">Data</th>' : ''}
      </tr></thead>
      <tbody>
      ${dados.rows.map(r => `<tr style="border-bottom:1px solid var(--border);cursor:pointer;" onclick="fecharListaNarcelio();abrirProcesso('${r.id}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td style="padding:6px 8px;font-weight:600;">${esc(r.referencia||'—')}</td>
        <td style="padding:6px 8px;">${esc(r.fornecedor||'—')}</td>
        ${temN ? '<td style="padding:6px 8px;text-align:right;">' + r.n + '</td>' : (temValor ? '<td style="padding:6px 8px;text-align:right;">' + fmtBRL2(r.valor) + '</td>' : '')}
        ${temData ? '<td style="padding:6px 8px;">' + esc(r.eta||r.data||'') + '</td>' : ''}
      </tr>`).join('')}
      </tbody>
    </table>`;
  }
  modal.style.display = 'flex';
}
function fecharListaNarcelio(){
  const modal = document.getElementById('narcelio-lista-modal');
  if(modal) modal.style.display = 'none';
}

