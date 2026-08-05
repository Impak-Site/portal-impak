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

  function card(label, val, sub, cor){
    return `<div style="background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;">
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
  let qtdPedido = 0, qtdPrevisaoEmbarque = 0, qtdEmbarcado = 0;
  _processos.forEach(p => {
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0);
    if(!n) return;
    qtdPedido += n;
    const fase = calcularFase(p);
    if(fase === 'AGUARDANDO_EMBARQUE') qtdPrevisaoEmbarque += n;
    if(fase === 'EMBARCADO') qtdEmbarcado += n;
  });

  // ── 4: containers chegando, com filtro de data (ETA) ─────────
  renderPeriodoSeletor('periodo-seletor-narcelio-chegando', 'narcelioChegando', renderDashNarcelio);
  const periodoChegando = calcularPeriodo('narcelioChegando');
  let qtdChegando = 0;
  const chegandoLista = [];
  _processos.forEach(p => {
    if(p.data_chegada || !p.eta) return; // já chegou de fato, ou sem ETA — não conta como "chegando"
    const eta = parseDataLocal(p.eta);
    if(!eta || eta < periodoChegando.ini || eta > periodoChegando.fim) return;
    const n = containersDoProcesso(p).length || (p.container ? 1 : 0);
    if(!n) return;
    qtdChegando += n;
    chegandoLista.push({ referencia: p.referencia, eta: p.eta, n, fornecedor: p.fornecedor });
  });
  chegandoLista.sort((a,b) => (a.eta||'').localeCompare(b.eta||''));

  // ── 5: faturamento por período (NF de Saída) ─────────────────
  renderPeriodoSeletor('periodo-seletor-narcelio-faturamento', 'narcelio', renderDashNarcelio);
  const periodoFat = calcularPeriodo('narcelio');
  let faturamento = 0, qtdFaturados = 0;
  _processos.forEach(p => {
    if(!p.nf_saida_data || !p.nf_saida_valor) return;
    const d = parseDataLocal(p.nf_saida_data);
    if(!d || d < periodoFat.ini || d > periodoFat.fim) return;
    faturamento += parseFloat(p.nf_saida_valor) || 0;
    qtdFaturados++;
  });

  // ── 6: estoque parado no armazém (importado, ainda sem venda) ─
  // Identificado por: NF de Entrada já lançada + (NF de Saída com CFOP 5905,
  // que é remessa/retorno interno e não representa venda real, OU NF de
  // Saída ainda não emitida). Agrupa por descrição do produto EXATAMENTE
  // como está cadastrada (sem tentar normalizar medida/marca) — combinação
  // simples e recomendada, conforme decisão do usuário.
  const estoqueParado = {}; // descricao -> quantidade
  let processosEstoqueParado = 0;
  _processos.forEach(p => {
    if(!p.nf_entrada_numero) return;
    const semVenda = p.nf_saida_cfop === '5905' || !p.nf_saida_numero;
    if(!semVenda) return;
    processosEstoqueParado++;
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
  listarPagamentosPI(processosAbertos).forEach(pg => {
    if(pg.pago) return;
    const cambio = pg.cambioFechado || pg.cambioPrevisto;
    if(!cambio || !pg.valorUsd) return;
    addMes(pg.vencimento, pg.valorUsd * cambio);
  });
  processosAbertos.forEach(p => {
    const custoReal = calcularCustoRealTotal(p);
    if(!custoReal || !custoReal.total) return;
    const cambioReal = parseFloat(p.real_cambio) || parseFloat(p.pi_cambio) || 0;
    const fobConvertido = (parseFloat(p.real_json && p.real_json.fob) || 0) * cambioReal;
    const restante = custoReal.total - fobConvertido;
    if(restante <= 0) return;
    addMes(p.eta || p.data_registro_di || p.previsao_prontidao, restante);
  });
  const mesesOrdenados = Object.keys(meses).sort();
  const totalPrevisto = mesesOrdenados.reduce((s,k) => s + meses[k], 0);

  const kpis = [
    card('Containers Pedidos (PI)', `${qtdPedido} containers`, `${_processos.length} processo${_processos.length!==1?'s':''} no total`, 'var(--ac)'),
    card('Previsão de Embarque', `${qtdPrevisaoEmbarque} containers`, 'aguardando embarque', '#b45309'),
    card('Embarcados / em água', `${qtdEmbarcado} containers`, 'em trânsito', 'var(--ac)'),
    card('Chegando no período', `${qtdChegando} containers`, periodoChegando.label, 'var(--ok)'),
    card('Faturamento no período', fmtBRL(faturamento), `${qtdFaturados} NF de saída — ${periodoFat.label}`, 'var(--ok)'),
    card('Processos com Estoque Parado', `${processosEstoqueParado} processos`, `${estoqueParadoLista.length} descrições diferentes de produto`, 'var(--err)'),
    card('Previsão de Caixa (total)', fmtBRL(totalPrevisto), 'FOB + custos reais pendentes', 'var(--err)'),
  ];

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
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px;">${kpis.join('')}</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);">🚢 Containers Chegando</div>
          <div id="periodo-seletor-narcelio-chegando"></div>
        </div>
        ${tabelaChegando}
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">📦 Estoque Parado no Armazém</div>
        ${tabelaEstoque}
      </div>
    </div>

    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);">💰 Faturamento (NF de Saída)</div>
        <div id="periodo-seletor-narcelio-faturamento"></div>
      </div>
      <div style="font-size:20px;font-weight:800;color:var(--ok);font-family:'DM Sans',sans-serif;">${fmtBRL(faturamento)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${qtdFaturados} NF de saída emitida(s) em ${periodoFat.label}</div>
    </div>

    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">📅 Previsão de Recurso de Numerário</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Cronograma de pagamento da PI (FOB, por vencimento e câmbio previsto/fechado — cobre FOB a prazo) + demais custos reais do processo (aproximados no mês do ETA). Só processos ainda não fechados.</div>
      ${tabelaFluxo}
    </div>
  `;
}
