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

// Helpers de formatação em escopo de arquivo (não dentro de renderDashCambio)
// porque atualizarSimulacaoCambio() precisa deles sem disparar um re-render
// inteiro da tela — só atualiza 4 números na tela a cada tecla digitada.
function cambFmtBRL(v){ return `R$ ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function cambFmtUSD(v){ return `USD ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

// Base numérica do card "Simular câmbio" (pedido Ayslan 09/09/2026, depois
// de perguntar "isso é legal pra um CFO? melhoraria em algo?") — guarda só
// os totais em USD (que não mudam com a simulação) pra recalcular em BRL
// na hora, sem precisar rodar listarPagamentosPI() de novo a cada tecla.
let _cambioSimulBase = { totalUsd:0, semanaUsd:0, mesUsd:0, cambioAtual:5.10 };
function atualizarSimulacaoCambio(valorStr){
  const c = parseFloat(String(valorStr).replace(',','.'));
  const b = _cambioSimulBase;
  const totalEl = document.getElementById('sim-total-aberto');
  const semEl = document.getElementById('sim-semana');
  const mesEl = document.getElementById('sim-mes');
  const diffEl = document.getElementById('sim-diff');
  if(!totalEl || !isFinite(c) || c<=0) return;
  totalEl.textContent = cambFmtBRL(b.totalUsd*c);
  if(semEl) semEl.textContent = cambFmtBRL(b.semanaUsd*c);
  if(mesEl) mesEl.textContent = cambFmtBRL(b.mesUsd*c);
  if(diffEl){
    const diffTotal = (b.totalUsd*c) - (b.totalUsd*b.cambioAtual);
    if(Math.abs(diffTotal) < 0.01){ diffEl.textContent = '≈ igual ao atual'; diffEl.style.color = 'var(--muted)'; }
    else if(diffTotal > 0){ diffEl.textContent = '+' + cambFmtBRL(diffTotal) + ' vs. hoje'; diffEl.style.color = 'var(--err)'; }
    else { diffEl.textContent = '-' + cambFmtBRL(Math.abs(diffTotal)) + ' vs. hoje'; diffEl.style.color = 'var(--ok)'; }
  }
}

// ── Fechamento de câmbio em LOTE — pedido do Ayslan (09/09/2026): com
// poucos fornecedores, faz mais sentido consolidar várias parcelas numa
// única operação de câmbio com o banco (menos spread, menos trabalho) do
// que fechar uma por uma dentro de cada processo. _cambioLoteSelecao guarda
// as parcelas marcadas na tabela (chave própria por processo+tipo+índice,
// pra distinguir parcelas de um mesmo PARCELADO); sobrevive a re-renders da
// tela (só é limpa depois de um fechamento bem-sucedido ou se o usuário
// desmarcar manualmente).
let _cambioLoteSelecao = new Map();

function chaveLoteCambio(processoId, tipo, parcelaIndex){
  return `${processoId}__${tipo}__${parcelaIndex!=null?parcelaIndex:''}`;
}

function toggleSelecaoLoteCambio(checkbox, processoId, tipo, parcelaIndex, valorUsd, fornecedor, referencia){
  const key = chaveLoteCambio(processoId, tipo, parcelaIndex);
  if(checkbox.checked){
    _cambioLoteSelecao.set(key, { processoId, tipo, parcelaIndex, valorUsd, fornecedor, referencia });
  } else {
    _cambioLoteSelecao.delete(key);
  }
  atualizarBarraLoteCambio();
}

function atualizarBarraLoteCambio(){
  const n = _cambioLoteSelecao.size;
  let totalUsd = 0; _cambioLoteSelecao.forEach(v=>totalUsd+=v.valorUsd);
  const resumo = document.getElementById('lote-cambio-resumo');
  const btn = document.getElementById('lote-cambio-btn');
  const tituloPainel = document.getElementById('lote-cambio-titulo-painel');
  if(resumo) resumo.textContent = n ? `${n} parcela(s) selecionada(s) · ${cambFmtUSD(totalUsd)}` : 'Marque parcelas na tabela abaixo pra fechar câmbio em lote.';
  if(btn) btn.disabled = n===0;
  // O painel de confirmação pode já estar aberto quando o usuário marca/
  // desmarca mais uma parcela (não fecha sozinho) — mantém a contagem
  // exibida nele sincronizada em vez de deixar o número travado no que
  // era verdade só no instante em que a tabela foi renderizada.
  if(tituloPainel) tituloPainel.textContent = `Fechar câmbio de ${n} parcela(s) selecionada(s):`;
}

function abrirPainelFechamentoLoteCambio(){
  if(!_cambioLoteSelecao.size) return;
  const painel = document.getElementById('lote-cambio-painel');
  if(painel) painel.style.display = 'flex';
  const taxaInput = document.getElementById('lote-cambio-taxa');
  if(taxaInput) taxaInput.focus();
}
function fecharPainelFechamentoLoteCambio(){
  const painel = document.getElementById('lote-cambio-painel');
  if(painel) painel.style.display = 'none';
}

// Aplica UM câmbio fechado (+ data) em todas as parcelas selecionadas, de
// uma vez. Agrupa por processo antes de salvar porque um mesmo processo
// pode ter mais de uma parcela marcada (ex: 2 parcelas de um "Parcelado")
// — salvando uma de cada vez, o segundo save reescreveria pi_parcelas_json
// inteiro e apagaria o que o primeiro tinha acabado de gravar. Usa
// /api/controle/v2/processo direto (o mesmo endpoint de salvarProcesso em
// controle-core.js) mandando só os campos que mudam por processo — mesma
// lógica de "patch parcial" já usada pra evitar sobrescrever edição
// concorrente de outra pessoa.
async function executarFechamentoLoteCambio(){
  const taxaInput = document.getElementById('lote-cambio-taxa');
  const dataInput = document.getElementById('lote-cambio-data');
  const taxa = parseFloat(String(taxaInput?.value||'').replace(',','.'));
  const dataFechamento = dataInput?.value || new Date().toISOString().slice(0,10);
  if(!taxa || taxa<=0){ showToast('Digite um câmbio válido pra fechar o lote','err'); return; }
  if(!_cambioLoteSelecao.size){ showToast('Nenhuma parcela selecionada','err'); return; }

  const porProcesso = new Map();
  _cambioLoteSelecao.forEach(sel => {
    if(!porProcesso.has(sel.processoId)) porProcesso.set(sel.processoId, []);
    porProcesso.get(sel.processoId).push(sel);
  });

  const totalSelecionadas = _cambioLoteSelecao.size;
  showToast(`Fechando câmbio de ${taxa.toLocaleString('pt-BR',{minimumFractionDigits:4})} em ${totalSelecionadas} parcela(s)...`,'info');

  let ok = 0, falhas = 0;
  for(const [processoId, selecoes] of porProcesso){
    const proc = (_processos||[]).find(p=>p.id===processoId);
    if(!proc){ falhas += selecoes.length; continue; }
    const patch = { id: proc.id, updated_by: _user?.usuario, updated_at: new Date().toISOString() };
    let parcelasArr = null;
    selecoes.forEach(sel => {
      if(sel.tipo==='entrada'){
        patch.pi_cambio_entrada = taxa.toFixed(4);
        patch.pi_data_entrada = proc.pi_data_entrada || dataFechamento;
      } else if(sel.tipo==='saldo'){
        patch.pi_cambio_saldo = taxa.toFixed(4);
        patch.pi_data_saldo = proc.pi_data_saldo || dataFechamento;
        patch.pi_pago = true;
      } else if(sel.tipo==='unico'){
        patch.pi_cambio_fechado = taxa.toFixed(4);
        patch.pi_pago = true;
      } else if(sel.tipo==='parcelado'){
        if(!parcelasArr){
          try{ parcelasArr = proc.pi_parcelas_json ? JSON.parse(proc.pi_parcelas_json) : []; }catch(e){ parcelasArr = []; }
        }
        if(parcelasArr[sel.parcelaIndex]){
          parcelasArr[sel.parcelaIndex] = {...parcelasArr[sel.parcelaIndex], cambio_fechado: taxa.toFixed(4)};
        }
      }
    });
    if(parcelasArr) patch.pi_parcelas_json = JSON.stringify(parcelasArr);
    try{
      const r = await fetch('/api/controle/v2/processo', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ processo: patch }) });
      const d = await r.json();
      if(r.ok && d.ok){ ok += selecoes.length; } else { falhas += selecoes.length; }
    }catch(e){ falhas += selecoes.length; }
  }

  _cambioLoteSelecao.clear();
  fecharPainelFechamentoLoteCambio();
  await carregarProcessos(true);
  renderDashCambio();
  if(falhas===0) showToast(`✓ Câmbio de ${taxa.toLocaleString('pt-BR',{minimumFractionDigits:4})} fechado em ${ok} parcela(s)`,'ok');
  else showToast(`Fechado em ${ok} parcela(s) — ${falhas} falharam, confira e tente de novo`,'err');
}

// Selecionar de uma vez todas as parcelas de um fornecedor nos próximos 30
// dias (botão "Selecionar Nx" no bloco de Consolidação) — evita ter que
// caçar cada linha dele na tabela abaixo pra marcar o checkbox uma por
// uma. Reaproveita _cambioLoteSelecao (mesma seleção da tabela) e só
// re-renderiza a tela pra refletir os checkboxes marcados.
function selecionarFornecedorLote(nome){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const lim = new Date(hoje); lim.setDate(hoje.getDate()+30);
  const todosPagamentos = listarPagamentosPI(_processos);
  const doFornecedor = todosPagamentos.filter(x => !x.pago && x.vencimento && x.fornecedor===nome).filter(x => {
    const d = new Date(x.vencimento+'T00:00:00'); return d>=hoje && d<=lim;
  });
  doFornecedor.forEach(x => {
    const key = chaveLoteCambio(x.processoId, x._tipo, x._parcelaIndex);
    _cambioLoteSelecao.set(key, { processoId:x.processoId, tipo:x._tipo, parcelaIndex:x._parcelaIndex, valorUsd:x.valorUsd, fornecedor:x.fornecedor, referencia:x.referencia });
  });
  renderDashCambio();
  showToast(`${doFornecedor.length} parcela(s) de ${nome} selecionada(s) — role até a tabela pra confirmar o fechamento em lote`, 'info');
}

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

// Filtro (clicar num KPI de prazo, no donut de fornecedor, ou num item da
// consolidação filtra a tabela de baixo) — estado simples em memória,
// resetado toda vez que a tela é reaberta (não precisa persistir entre
// sessões).
let _cambioFiltro = null; // {tipo:'prazo', dias:7|14|30|'vencidas', label} ou {tipo:'fornecedor', nome}

// Redesign completo da tela (pedido do Ayslan, 09/09/2026): a versão
// anterior empilhava 8 blocos verticais (KPIs, alerta, mark-to-market,
// simulação, semana, mês, fornecedor, consolidação, tabela) — cada um
// disputando a largura toda da tela, forçando 3+ telas de scroll pra
// enxergar tudo. Essa versão organiza em: (1) faixa de KPIs por prazo
// (pronto/7/14/30 dias, substituindo os gráficos "Por Semana"/"Por Mês"
// que ficavam redundantes com esses buckets), (2) grid de 2 colunas com
// exposição por fornecedor em donut chart (mais fácil de "bater o olho"
// que barras de progresso) + simulador de câmbio lado a lado, (3)
// consolidação por fornecedor com botão de seleção direta (marca as
// parcelas na tabela sem precisar caçar linha por linha), (4) tabela
// detalhada com a barra de ação (seleção + botão de lote) sempre visível
// no topo da própria tabela.
function renderDashCambio(){
  const el = document.getElementById('dash-cambio-content');
  if(!el) return;

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fmtBRL = v => `R$ ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtUSD = v => `USD ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const cambioAtual = (_cambio && _cambio.USD) ? _cambio.USD : 5.10;
  const MONO = "font-family:'DM Mono',monospace;";

  // Fonte única de dados — mesma usada no Dashboard Financeiro. Cada linha
  // já vem "achatada" por parcela (entrada/saldo/parcela N/único), pronta
  // pra agrupar por prazo sem repetir a lógica de Entrada+Saldo x
  // Parcelado x À Vista/Prazo (ver listarPagamentosPI em controle-core.js).
  const todosPagamentos = listarPagamentosPI(_processos);
  const abertos = todosPagamentos.filter(x => !x.pago && x.vencimento);
  const semData = todosPagamentos.filter(x => !x.pago && !x.vencimento);

  // ── KPIs por prazo — pedido do Ayslan (09/09/2026): "prontos pra
  // fechamento" (parcelas já vencidas, sem câmbio fechado — ação imediata)
  // + 3 janelas cumulativas (7/14/30 dias) em vez dos gráficos de barra
  // separados por semana/mês, que ocupavam 2 blocos inteiros de tela pra
  // mostrar basicamente a mesma informação.
  const prontas = abertos.filter(x => new Date(x.vencimento+'T00:00:00') < hoje);
  const prontasUsd = prontas.reduce((s,x)=>s+x.valorUsd,0);
  function janela(dias){
    const lim = new Date(hoje); lim.setDate(hoje.getDate()+dias);
    const itens = abertos.filter(x => { const d = new Date(x.vencimento+'T00:00:00'); return d>=hoje && d<=lim; });
    return { itens, usd: itens.reduce((s,x)=>s+x.valorUsd,0) };
  }
  const j7 = janela(7), j14 = janela(14), j30 = janela(30);

  function kpiCard(label, valorUsd, sub, cor, filtro){
    const ativo = _cambioFiltro && _cambioFiltro.tipo==='prazo' && _cambioFiltro.dias===filtro.dias;
    const onclick = `_cambioFiltro=${ativo?'null':`{tipo:'prazo',dias:${typeof filtro.dias==='string'?`'${filtro.dias}'`:filtro.dias},label:'${filtro.label}'}`};renderDashCambio()`;
    return `<div onclick="${onclick}" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;${ativo?'box-shadow:0 0 0 2px '+cor+';':''}">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
      <div style="font-size:20px;font-weight:600;color:${cor};${MONO}white-space:nowrap;">${fmtUSD(valorUsd)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>
    </div>`;
  }

  const kpisHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:14px;">
    ${kpiCard('✅ Prontos p/ Fechamento', prontasUsd, prontas.length+' parcela(s) atrasada(s) — ação imediata', prontas.length?'var(--err)':'var(--ok)', {dias:'vencidas',label:'atrasadas'})}
    ${kpiCard('A Liquidar · 7 dias', j7.usd, j7.itens.length+' parcela(s)', 'var(--err)', {dias:7,label:'próx. 7 dias'})}
    ${kpiCard('A Liquidar · 14 dias', j14.usd, j14.itens.length+' parcela(s)', 'var(--warn)', {dias:14,label:'próx. 14 dias'})}
    ${kpiCard('A Liquidar · 30 dias', j30.usd, j30.itens.length+' parcela(s)', 'var(--ac)', {dias:30,label:'próx. 30 dias'})}
  </div>`;

  // ── Por Fornecedor (calculado aqui, ANTES dos alertas de concentração,
  // pra poder reaproveitar o ranking tanto no aviso quanto no donut chart
  // "Exposição por Fornecedor" mais abaixo — sem rodar o agrupamento duas
  // vezes).
  const porFornecedor = {};
  abertos.forEach(x => { porFornecedor[x.fornecedor] = (porFornecedor[x.fornecedor]||0) + x.valorUsd; });
  const rankingFornecedor = Object.entries(porFornecedor).sort((a,b)=>b[1]-a[1]);
  const listaFornecedor = rankingFornecedor.slice(0,8); // usado pelo alerta de concentração e pela Consolidação

  // ── Concentração de risco — pedido do Ayslan (09/09/2026): além de "o
  // que vence", alertar quando o vencimento está concentrado demais num
  // fornecedor só (risco de negociação: se precisar esticar prazo ou tiver
  // problema de caixa, é só 1 conversa) — tanto no total em aberto quanto,
  // de forma mais urgente, no que vence JÁ nos próximos 7 dias.
  const totalAbertoUsd = abertos.reduce((s,x)=>s+x.valorUsd,0) + semData.reduce((s,x)=>s+x.valorUsd,0);
  const avisosConcentracao = [];
  if(totalAbertoUsd > 0 && rankingFornecedor.length){
    const [topNome, topVal] = rankingFornecedor[0];
    const pctTop = topVal/totalAbertoUsd;
    if(pctTop >= 0.35){
      avisosConcentracao.push(`<b>${esc(topNome)}</b> concentra ${(pctTop*100).toFixed(0)}% de todo o USD em aberto (${fmtUSD(topVal)}) — vale negociar prazo/câmbio com esse fornecedor primeiro se precisar aliviar o caixa.`);
    }
  }
  if(j7.usd > 0){
    const porFornecedorSemana = {};
    j7.itens.forEach(x => { porFornecedorSemana[x.fornecedor] = (porFornecedorSemana[x.fornecedor]||0) + x.valorUsd; });
    const topSemana = Object.entries(porFornecedorSemana).sort((a,b)=>b[1]-a[1])[0];
    if(topSemana){
      const pctSemana = topSemana[1]/j7.usd;
      if(pctSemana >= 0.6){
        avisosConcentracao.push(`${(pctSemana*100).toFixed(0)}% do que vence nos <b>próximos 7 dias</b> é de um fornecedor só (<b>${esc(topSemana[0])}</b>, ${fmtUSD(topSemana[1])}) — se atrasar, é um só telefonema.`);
      }
    }
  }
  const concentracaoHtml = !avisosConcentracao.length ? '' : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;margin-bottom:14px;font-size:12px;color:#78350f;display:flex;flex-direction:column;gap:3px;">
    <div style="font-weight:700;color:#92400e;">⚠️ Concentração de risco</div>
    ${avisosConcentracao.map(a=>`<div>• ${a}</div>`).join('')}
  </div>`;

  // ── Mark-to-Market — o número que mais importa pra decidir comprar
  // dólar agora ou esperar: "se eu pagasse tudo hoje, eu ganharia ou
  // perderia vs o que estava planejado?". Só entra na conta a fatia que
  // TEM câmbio previsto definido na PI (usdComPrevisto) — parcelas sem
  // previsto não geram ganho/perda artificial (contam igual dos dois
  // lados). Fica compacto (1 linha) porque é contexto, não o foco da tela.
  const todosEmAberto = abertos.concat(semData);
  let expostoComAtual = 0, expostoComPrevisto = 0, usdComPrevisto = 0;
  todosEmAberto.forEach(x => {
    expostoComAtual += x.valorUsd * cambioAtual;
    if(x.cambioPrevisto){
      expostoComPrevisto += x.valorUsd * x.cambioPrevisto;
      usdComPrevisto += x.valorUsd;
    } else {
      expostoComPrevisto += x.valorUsd * cambioAtual;
    }
  });
  const diffMtm = expostoComAtual - expostoComPrevisto; // >0: dólar subiu (perda) · <0: dólar caiu (ganho)
  const mtmCor = diffMtm > 0.5 ? 'var(--err)' : (diffMtm < -0.5 ? 'var(--ok)' : 'var(--muted)');
  const mtmHtml = usdComPrevisto <= 0 ? '' : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <span style="font-size:12px;font-weight:700;color:var(--muted);">📊 Mark-to-Market:</span>
    <span style="font-size:15px;font-weight:800;color:${mtmCor};${MONO}">${Math.abs(diffMtm)<0.5?'≈ R$ 0,00':fmtBRL(Math.abs(diffMtm))}</span>
    <span style="font-size:12px;color:var(--muted);">${diffMtm > 0.5 ? 'a mais do que o previsto nas PIs, se pagasse tudo hoje' : diffMtm < -0.5 ? 'de economia vs. o previsto nas PIs, se pagasse tudo hoje' : 'câmbio previsto e atual praticamente iguais'} · câmbio atual ${cambioAtual.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})} · base: ${fmtUSD(usdComPrevisto)}</span>
  </div>`;

  // ── Simular câmbio (what-if) — pedido do Ayslan (09/09/2026): antes de
  // decidir travar câmbio ou esperar, o CFO quer ver "e se o dólar for a
  // R$X" sem precisar abrir planilha. _cambioSimulBase guarda os totais em
  // USD (que não mudam) pra atualizarSimulacaoCambio() recalcular só o BRL
  // a cada tecla digitada, sem re-renderizar a tela inteira (perderia o
  // foco do campo).
  _cambioSimulBase = { totalUsd: totalAbertoUsd, semanaUsd: j7.usd, mesUsd: j30.usd, cambioAtual };
  const simulacaoHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;height:100%;">
    <div style="font-size:14px;font-weight:700;margin-bottom:2px;">🧮 Simular câmbio</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">E se o dólar fosse a R$X? Veja o impacto antes de decidir travar câmbio.</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <input id="cambio-simulado-input" type="number" step="0.01" value="${cambioAtual.toFixed(4)}" oninput="atualizarSimulacaoCambio(this.value)"
        style="width:100px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px;${MONO}">
      <button type="button" onclick="document.getElementById('cambio-simulado-input').value='${cambioAtual.toFixed(4)}';atualizarSimulacaoCambio('${cambioAtual.toFixed(4)}');" style="font-size:11px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;">↺ atual</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Total em aberto</span><span id="sim-total-aberto" style="font-weight:700;${MONO}">${fmtBRL(totalAbertoUsd*cambioAtual)}</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Próx. 7 dias</span><span id="sim-semana" style="font-weight:700;${MONO}">${fmtBRL(j7.usd*cambioAtual)}</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Próx. 30 dias</span><span id="sim-mes" style="font-weight:700;${MONO}">${fmtBRL(j30.usd*cambioAtual)}</span></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:8px;"><span style="color:var(--muted);font-weight:700;">vs. câmbio atual</span><span id="sim-diff" style="font-weight:800;color:var(--muted);${MONO}">≈ igual ao atual</span></div>
    </div>
  </div>`;

  // ── Exposição por Fornecedor — donut chart (pedido do Ayslan,
  // 09/09/2026: "algo como um dashboard mesmo, com gráficos em pizza") em
  // vez das barras de progresso: dá pra ver de cara quem concentra o risco
  // sem precisar ler número por número. Top 6 fornecedores nomeados +
  // "Outros" agregando o resto, pra não virar uma legenda de 15 linhas.
  const DONUT_CORES = ['#1e3a5f','#2a5298','#3b6ea5','#5b84c4','#7ba3cf','#9dbfe0','#c3d4ec'];
  const totalDonut = rankingFornecedor.reduce((s,[,v])=>s+v,0);
  let donutLista = rankingFornecedor.slice(0,6);
  if(rankingFornecedor.length > 6){
    const outrosVal = rankingFornecedor.slice(6).reduce((s,[,v])=>s+v,0);
    donutLista = [...donutLista, ['Outros fornecedores', outrosVal]];
  }
  let accDonut = 0;
  const donutStops = donutLista.map(([,val],i) => {
    const pct = totalDonut>0 ? (val/totalDonut*100) : 0;
    const start = accDonut; accDonut += pct;
    return `${DONUT_CORES[i]||'#e2e8f0'} ${start.toFixed(2)}% ${accDonut.toFixed(2)}%`;
  }).join(', ');
  const fornecedorHtml = !donutLista.length ? '' : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;height:100%;">
    <div style="font-size:14px;font-weight:700;margin-bottom:14px;">🏭 Exposição por Fornecedor</div>
    <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;">
      <div style="width:140px;height:140px;border-radius:50%;flex-shrink:0;background:conic-gradient(${donutStops || '#e2e8f0 0% 100%'});position:relative;">
        <div style="position:absolute;inset:20px;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:9.5px;color:var(--muted);font-weight:700;">TOTAL</div>
          <div style="font-size:14px;font-weight:800;${MONO}">${fmtUSD(totalDonut).replace('USD ','')}</div>
        </div>
      </div>
      <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:7px;">
        ${donutLista.map(([nome,val],i) => {
          const pct = totalDonut>0 ? Math.round(val/totalDonut*100) : 0;
          const ativo = _cambioFiltro && _cambioFiltro.tipo==='fornecedor' && _cambioFiltro.nome===nome;
          const clicavel = nome !== 'Outros fornecedores';
          return `<div ${clicavel?`onclick="_cambioFiltro=${ativo?'null':`{tipo:'fornecedor',nome:'${nome.replace(/'/g,"\\'")}'}`};renderDashCambio()"`:''} style="display:flex;align-items:center;gap:8px;font-size:12px;${clicavel?'cursor:pointer;':''}${ativo?'background:#f1f5f9;border-radius:6px;padding:3px 6px;margin:-3px -6px;':''}">
            <span style="width:10px;height:10px;border-radius:2px;background:${DONUT_CORES[i]||'#e2e8f0'};flex-shrink:0;"></span>
            <span style="flex:1;font-weight:600;">${esc(nome)}</span>
            <span style="color:var(--muted);">${pct}%</span>
            <span style="font-weight:700;${MONO}">${fmtUSD(val)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;

  // ── Consolidar câmbio por Fornecedor+Prazo — pedido do Ayslan
  // (09/09/2026): "são poucos fornecedores, podendo consolidar os
  // câmbios". Em vez de fechar câmbio parcela por parcela, mostra quanto
  // cada fornecedor tem vencendo nos próximos 7/14/30 dias — só entra na
  // lista quem tem 2+ parcelas nesses 30 dias (candidato real a virar 1
  // operação de câmbio só em vez de várias). Botão "Selecionar" marca
  // direto as parcelas dele na tabela abaixo, sem precisar caçar linha por
  // linha.
  const JANELAS_CONSOLIDACAO = [7,14,30];
  const candidatosConsolidacao = listaFornecedor.map(([nome]) => {
    const doFornecedor = abertos.filter(x=>x.fornecedor===nome);
    const porJanela = JANELAS_CONSOLIDACAO.map(dias => {
      const lim = new Date(hoje); lim.setDate(hoje.getDate()+dias);
      const doPeriodo = doFornecedor.filter(x=>{ const d=new Date(x.vencimento+'T00:00:00'); return d>=hoje && d<=lim; });
      return { dias, qtd: doPeriodo.length, usd: doPeriodo.reduce((s,x)=>s+x.valorUsd,0) };
    });
    return { nome, porJanela };
  }).filter(f => f.porJanela[2].qtd >= 2); // 2+ parcelas nos próximos 30 dias
  const consolidacaoHtml = !candidatosConsolidacao.length ? '' : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px;">
    <div style="font-size:14px;font-weight:700;margin-bottom:2px;">🔗 Consolidar Câmbio por Fornecedor</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Fornecedores com 2 ou mais parcelas vencendo nos próximos 30 dias — dá pra negociar 1 operação de câmbio só em vez de fechar parcela por parcela.</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:8px 10px;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;">Fornecedor</th>
        <th style="text-align:right;padding:8px 10px;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;">Próx. 7d</th>
        <th style="text-align:right;padding:8px 10px;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;">Próx. 14d</th>
        <th style="text-align:right;padding:8px 10px;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;">Próx. 30d</th>
        <th style="text-align:center;padding:8px 10px;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;">Ação</th>
      </tr></thead>
      <tbody>
        ${candidatosConsolidacao.map(f => `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:10px;font-weight:700;">${esc(f.nome)}</td>
          ${f.porJanela.map(j => `<td style="padding:10px;text-align:right;${MONO}">${j.qtd ? `${fmtUSD(j.usd)} <span style="color:var(--muted);font-weight:400;">(${j.qtd}x)</span>` : '<span style="color:var(--muted);">—</span>'}</td>`).join('')}
          <td style="padding:10px;text-align:center;"><button type="button" onclick="selecionarFornecedorLote('${f.nome.replace(/'/g,"\\'")}')" style="border:none;background:var(--ac);color:#fff;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Selecionar ${f.porJanela[2].qtd}</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

  // ── Tabela detalhada — aplica o filtro do KPI de prazo/fornecedor, se
  // algum estiver ativo; senão mostra tudo que está em aberto (vencidas
  // primeiro), mais uma seção separada pro que não tem forma de pagamento
  // definida ainda (sem data pra entrar nos buckets).
  let linhasFiltradas = abertos;
  let tituloFiltro = 'Todas as parcelas em aberto';
  if(_cambioFiltro){
    if(_cambioFiltro.tipo==='prazo'){
      if(_cambioFiltro.dias==='vencidas'){
        linhasFiltradas = prontas;
        tituloFiltro = `Parcelas atrasadas — prontas pra fechar (<a href="#" onclick="_cambioFiltro=null;renderDashCambio();return false;" style="color:var(--ac);">limpar filtro</a>)`;
      } else {
        const lim = new Date(hoje); lim.setDate(hoje.getDate()+_cambioFiltro.dias);
        linhasFiltradas = abertos.filter(x=>{ const d=new Date(x.vencimento+'T00:00:00'); return d>=hoje && d<=lim; });
        tituloFiltro = `Parcelas dos ${_cambioFiltro.label} (<a href="#" onclick="_cambioFiltro=null;renderDashCambio();return false;" style="color:var(--ac);">limpar filtro</a>)`;
      }
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

  // Fechamento em lote — checkbox por linha, sempre reaplicando a seleção
  // que já estava marcada (_cambioLoteSelecao sobrevive a re-renders do
  // filtro/clique), pra não perder a marcação ao clicar num KPI/fornecedor
  // diferente antes de fechar o lote. Barra de ação (contagem + botão)
  // fica no cabeçalho da própria tabela — sempre visível, sem precisar
  // rolar até o fim pra achar o botão de lote.
  const tabelaHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;background:var(--bg);">
      <div style="font-size:13px;font-weight:700;">${tituloFiltro} — ${linhasFiltradas.length} parcela(s)</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span id="lote-cambio-resumo" style="font-size:12px;color:var(--muted);">${_cambioLoteSelecao.size ? `${_cambioLoteSelecao.size} parcela(s) selecionada(s)` : 'Marque parcelas pra fechar câmbio em lote.'}</span>
        <button id="lote-cambio-btn" type="button" onclick="abrirPainelFechamentoLoteCambio()" ${_cambioLoteSelecao.size ? '' : 'disabled'}
          style="font-size:12px;font-weight:700;padding:7px 14px;border:none;border-radius:7px;background:var(--ok);color:#fff;cursor:pointer;${_cambioLoteSelecao.size ? '' : 'opacity:.5;cursor:not-allowed;'}">💱 Fechar câmbio em lote</button>
      </div>
    </div>
    <div id="lote-cambio-painel" style="display:none;padding:14px 16px;border-bottom:1px solid var(--border);background:#f0f9ff;align-items:center;gap:12px;flex-wrap:wrap;">
      <b id="lote-cambio-titulo-painel" style="font-size:12px;">Fechar câmbio de ${_cambioLoteSelecao.size} parcela(s) selecionada(s):</b>
      <label style="font-size:12px;">Câmbio: <input id="lote-cambio-taxa" type="number" step="0.0001" placeholder="ex: 5,15" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;${MONO}"></label>
      <label style="font-size:12px;">Data: <input id="lote-cambio-data" type="date" value="${hoje.toISOString().slice(0,10)}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;"></label>
      <button type="button" onclick="executarFechamentoLoteCambio()" style="font-size:11px;font-weight:700;padding:6px 12px;border:none;border-radius:6px;background:var(--ok);color:#fff;cursor:pointer;">✓ Confirmar fechamento</button>
      <button type="button" onclick="fecharPainelFechamentoLoteCambio()" style="font-size:11px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;">Cancelar</button>
    </div>
    <div style="max-height:420px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:var(--bg);position:sticky;top:0;">
        <th style="padding:8px 8px 8px 16px;width:24px;"></th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Vencimento</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Processo</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Fornecedor</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Parcela</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">DI/DUIMP</th>
        <th style="text-align:right;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Valor USD</th>
        <th style="text-align:right;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Câmbio Previsto</th>
        <th style="text-align:right;padding:8px 8px 8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">BRL Estimado</th>
      </tr></thead>
      <tbody>
        ${linhasFiltradas.map(x => {
          const key = chaveLoteCambio(x.processoId, x._tipo, x._parcelaIndex);
          const marcada = _cambioLoteSelecao.has(key);
          return `<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="abrirProcesso('${x.processoId}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
          <td style="padding:8px 8px 8px 16px;" onclick="event.stopPropagation()"><input type="checkbox" ${marcada?'checked':''} onclick="event.stopPropagation()" onchange="toggleSelecaoLoteCambio(this,'${x.processoId}','${x._tipo}',${x._parcelaIndex!=null?x._parcelaIndex:'null'},${x.valorUsd},'${(x.fornecedor||'').replace(/'/g,"\\'")}','${(x.referencia||'').replace(/'/g,"\\'")}')"></td>
          <td style="padding:8px 8px;white-space:nowrap;">${x.vencimento ? new Date(x.vencimento+'T00:00:00').toLocaleDateString('pt-BR') : '—'} ${x.vencimento ? badgeDias(x.vencimento) : ''}</td>
          <td style="padding:8px 8px;font-weight:600;white-space:nowrap;${MONO}color:var(--ac);">${esc(x.referencia)}</td>
          <td style="padding:8px 8px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:1px;" title="${esc(x.fornecedor)}">${esc(x.fornecedor)}</td>
          <td style="padding:8px 8px;text-transform:capitalize;white-space:nowrap;">${esc(x.parcela)}</td>
          <td style="padding:8px 8px;white-space:nowrap;${MONO}color:${x.numeroDi?'var(--text)':'var(--dim)'};">${esc(x.numeroDi||'—')}</td>
          <td style="padding:8px 8px;text-align:right;font-weight:700;white-space:nowrap;${MONO}">${fmtUSD(x.valorUsd)}</td>
          <td style="padding:8px 8px;text-align:right;color:var(--muted);white-space:nowrap;${MONO}">${x.cambioPrevisto ? x.cambioPrevisto.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4}) : '—'}</td>
          <td style="padding:8px 8px;text-align:right;white-space:nowrap;${MONO}">${fmtBRL(x.valorUsd*(x.cambioPrevisto||cambioAtual))}</td>
        </tr>`;
        }).join('') || `<tr><td colspan="9" style="padding:16px;text-align:center;color:var(--muted);">Nenhuma parcela em aberto neste filtro.</td></tr>`}
      </tbody>
    </table>
    </div>
    ${semData.length ? `<div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);">⚠ ${semData.length} parcela(s) sem forma de pagamento definida ainda (${fmtUSD(semData.reduce((s,x)=>s+x.valorUsd,0))}) — não entram nos KPIs de prazo acima. Abra o processo e defina Entrada+Saldo/Parcelado/À Vista/Prazo na aba PI.</div>` : ''}
  </div>`;

  el.innerHTML = kpisHtml + concentracaoHtml + mtmHtml
    + `<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:stretch;margin-bottom:14px;">${fornecedorHtml}${simulacaoHtml}</div>`
    + consolidacaoHtml + tabelaHtml
    + renderFluxoCaixaHtml(todosPagamentos) + renderControleCambialHtml(todosPagamentos);
}
