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

  // ── Por Fornecedor (calculado aqui, ANTES dos alertas de concentração,
  // pra poder reaproveitar o ranking tanto no aviso quanto no bloco visual
  // "Por Fornecedor" mais abaixo — sem rodar o agrupamento duas vezes).
  const porFornecedor = {};
  abertos.forEach(x => { porFornecedor[x.fornecedor] = (porFornecedor[x.fornecedor]||0) + x.valorUsd; });
  const listaFornecedor = Object.entries(porFornecedor).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // ── Concentração de risco — pedido do Ayslan (09/09/2026): além de "o
  // que vence", alertar quando o vencimento está concentrado demais num
  // fornecedor só (risco de negociação: se precisar esticar prazo ou tiver
  // problema de caixa, é só 1 conversa) — tanto no total em aberto quanto,
  // de forma mais urgente, no que vence JÁ esta semana.
  const avisosConcentracao = [];
  if(totalAbertoUsd > 0 && listaFornecedor.length){
    const [topNome, topVal] = listaFornecedor[0];
    const pctTop = topVal/totalAbertoUsd;
    if(pctTop >= 0.35){
      avisosConcentracao.push(`<b>${esc(topNome)}</b> concentra ${(pctTop*100).toFixed(0)}% de todo o USD em aberto (${fmtUSD(topVal)}) — vale negociar prazo/câmbio com esse fornecedor primeiro se precisar aliviar o caixa.`);
    }
  }
  if(estaSemanaUsd > 0){
    const porFornecedorSemana = {};
    estaSemana.forEach(x => { porFornecedorSemana[x.fornecedor] = (porFornecedorSemana[x.fornecedor]||0) + x.valorUsd; });
    const topSemana = Object.entries(porFornecedorSemana).sort((a,b)=>b[1]-a[1])[0];
    if(topSemana){
      const pctSemana = topSemana[1]/estaSemanaUsd;
      if(pctSemana >= 0.6){
        avisosConcentracao.push(`${(pctSemana*100).toFixed(0)}% do que vence <b>esta semana</b> é de um fornecedor só (<b>${esc(topSemana[0])}</b>, ${fmtUSD(topSemana[1])}) — se atrasar, é um só telefonema.`);
      }
    }
  }
  const concentracaoHtml = !avisosConcentracao.length ? '' : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
    <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px;">⚠️ Concentração de risco</div>
    ${avisosConcentracao.map(a=>`<div style="font-size:12px;color:#78350f;margin-bottom:4px;">• ${a}</div>`).join('')}
  </div>`;

  // ── Mark-to-Market — pedido do Ayslan (09/09/2026): o card "Em Aberto"
  // já mostra o total ao câmbio ATUAL, mas não diz se isso é bom ou ruim
  // comparado ao câmbio que estava PREVISTO quando cada PI foi fechada.
  // Esse é o número que mais importa pra decidir comprar dólar agora ou
  // esperar: "se eu pagasse tudo hoje, eu ganharia ou perderia vs o que
  // estava planejado?". Só entra na conta a fatia que TEM câmbio previsto
  // definido na PI (usdComPrevisto) — parcelas sem previsto não geram
  // ganho/perda artificial (contam igual dos dois lados).
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
  const diffMtm = expostoComAtual - expostoComPrevisto; // >0: dólar subiu, pagaria mais (perda) · <0: dólar caiu, pagaria menos (ganho)
  const mtmCor = diffMtm > 0.5 ? 'var(--err)' : (diffMtm < -0.5 ? 'var(--ok)' : 'var(--muted)');
  const mtmTexto = diffMtm > 0.5
    ? `Se pagasse tudo hoje, gastaria <b>${fmtBRL(Math.abs(diffMtm))} a mais</b> do que o câmbio previsto nas PIs — o dólar subiu desde que essas compras foram fechadas.`
    : diffMtm < -0.5
    ? `Se pagasse tudo hoje, gastaria <b>${fmtBRL(Math.abs(diffMtm))} a menos</b> do que o câmbio previsto nas PIs — o dólar caiu desde que essas compras foram fechadas.`
    : `Câmbio previsto e atual estão praticamente iguais — sem ganho ou perda relevante no book aberto.`;
  const mtmHtml = usdComPrevisto <= 0 ? '' : `<div style="background:#fff;border:1px solid var(--border);border-left:3px solid ${mtmCor};border-radius:10px;padding:14px 16px;margin-bottom:16px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">📊 Mark-to-Market — câmbio previsto x atual</div>
    <div style="font-size:18px;font-weight:700;color:${mtmCor};font-family:'DM Sans',sans-serif;">${Math.abs(diffMtm)<0.5?'≈ R$ 0,00':fmtBRL(Math.abs(diffMtm))}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:4px;">${mtmTexto}</div>
    <div style="font-size:10px;color:var(--muted);margin-top:6px;">Câmbio atual: ${cambioAtual.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})} · base comparável: ${fmtUSD(usdComPrevisto)} com câmbio previsto definido na PI.</div>
  </div>`;

  // ── Simular câmbio (what-if) — pedido do Ayslan (09/09/2026): antes de
  // decidir travar câmbio ou esperar, o CFO quer ver "e se o dólar for a
  // R$X" sem precisar abrir planilha. _cambioSimulBase guarda os totais em
  // USD (que não mudam) pra atualizarSimulacaoCambio() recalcular só o BRL
  // a cada tecla digitada, sem re-renderizar a tela inteira (perderia o
  // foco do campo).
  _cambioSimulBase = { totalUsd: totalAbertoUsd, semanaUsd: estaSemanaUsd, mesUsd: esteMesUsd, cambioAtual };
  const simulacaoHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:2px;">🧮 Simular câmbio</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Digite um câmbio hipotético pra ver o impacto no total em aberto e no que vence esta semana/mês — útil antes de decidir travar câmbio.</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label style="font-size:12px;font-weight:600;">Câmbio simulado (R$):</label>
      <input id="cambio-simulado-input" type="number" step="0.01" value="${cambioAtual.toFixed(4)}" oninput="atualizarSimulacaoCambio(this.value)"
        style="width:100px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:'DM Sans',sans-serif;">
      <button type="button" onclick="document.getElementById('cambio-simulado-input').value='${cambioAtual.toFixed(4)}';atualizarSimulacaoCambio('${cambioAtual.toFixed(4)}');" style="font-size:11px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;">↺ câmbio atual</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:14px;">
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Total em aberto</div>
        <div id="sim-total-aberto" style="font-size:16px;font-weight:700;">${fmtBRL(totalAbertoUsd*cambioAtual)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Vence esta semana</div>
        <div id="sim-semana" style="font-size:16px;font-weight:700;">${fmtBRL(estaSemanaUsd*cambioAtual)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Vence este mês</div>
        <div id="sim-mes" style="font-size:16px;font-weight:700;">${fmtBRL(esteMesUsd*cambioAtual)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Vs. câmbio atual</div>
        <div id="sim-diff" style="font-size:16px;font-weight:700;color:var(--muted);">≈ igual ao atual</div>
      </div>
    </div>
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
  // com quem negociar prazo/câmbio primeiro se precisar. (porFornecedor/
  // listaFornecedor já foram calculados mais acima, reaproveitados pelo
  // alerta de concentração de risco.)
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

  // ── Consolidar câmbio por Fornecedor+Prazo — pedido do Ayslan
  // (09/09/2026): "são poucos fornecedores, podendo consolidar os câmbios".
  // Em vez de fechar câmbio parcela por parcela, mostra quanto cada
  // fornecedor tem vencendo nos próximos 7/15/30 dias — só entra na lista
  // quem tem 2+ parcelas nesses 30 dias (candidato real a virar 1 operação
  // de câmbio só em vez de várias).
  const JANELAS_CONSOLIDACAO = [7,15,30];
  const candidatosConsolidacao = listaFornecedor.map(([nome]) => {
    const doFornecedor = abertos.filter(x=>x.fornecedor===nome);
    const porJanela = JANELAS_CONSOLIDACAO.map(dias => {
      const lim = new Date(hoje); lim.setDate(hoje.getDate()+dias);
      const doPeriodo = doFornecedor.filter(x=>{ const d=new Date(x.vencimento+'T00:00:00'); return d>=hoje && d<=lim; });
      return { dias, qtd: doPeriodo.length, usd: doPeriodo.reduce((s,x)=>s+x.valorUsd,0) };
    });
    return { nome, porJanela };
  }).filter(f => f.porJanela[2].qtd >= 2); // 2+ parcelas nos próximos 30 dias
  const consolidacaoHtml = !candidatosConsolidacao.length ? '' : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:2px;">🔗 Consolidar Câmbio por Fornecedor</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Fornecedores com 2 ou mais parcelas vencendo nos próximos 30 dias — dá pra negociar 1 operação de câmbio só em vez de fechar parcela por parcela. Marque as parcelas dele na tabela abaixo pra fechar em lote.</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:6px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Fornecedor</th>
        <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Próx. 7d</th>
        <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Próx. 15d</th>
        <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Próx. 30d</th>
      </tr></thead>
      <tbody>
        ${candidatosConsolidacao.map(f => `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px;font-weight:600;">${esc(f.nome)}</td>
          ${f.porJanela.map(j => `<td style="padding:8px;text-align:right;">${j.qtd ? `${fmtUSD(j.usd)} <span style="color:var(--muted);font-weight:400;">(${j.qtd}x)</span>` : '<span style="color:var(--muted);">—</span>'}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
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

  // Fechamento em lote — pedido Ayslan (09/09/2026): checkbox por linha,
  // sempre reaplicando a seleção que já estava marcada (_cambioLoteSelecao
  // sobrevive a re-renders do filtro/clique), pra não perder a marcação ao
  // clicar numa semana/fornecedor diferente antes de fechar o lote.
  const tabelaHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div style="font-size:13px;font-weight:700;">${tituloFiltro} — ${linhasFiltradas.length} parcela(s)</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span id="lote-cambio-resumo" style="font-size:11px;color:var(--muted);">${_cambioLoteSelecao.size ? `${_cambioLoteSelecao.size} parcela(s) selecionada(s)` : 'Marque parcelas pra fechar câmbio em lote.'}</span>
        <button id="lote-cambio-btn" type="button" onclick="abrirPainelFechamentoLoteCambio()" ${_cambioLoteSelecao.size ? '' : 'disabled'}
          style="font-size:11px;font-weight:700;padding:6px 12px;border:none;border-radius:6px;background:var(--ac);color:#fff;cursor:pointer;${_cambioLoteSelecao.size ? '' : 'opacity:.5;cursor:not-allowed;'}">💱 Fechar câmbio em lote</button>
      </div>
    </div>
    <div id="lote-cambio-painel" style="display:none;padding:14px 16px;border-bottom:1px solid var(--border);background:#f0f9ff;align-items:center;gap:12px;flex-wrap:wrap;">
      <b id="lote-cambio-titulo-painel" style="font-size:12px;">Fechar câmbio de ${_cambioLoteSelecao.size} parcela(s) selecionada(s):</b>
      <label style="font-size:12px;">Câmbio: <input id="lote-cambio-taxa" type="number" step="0.0001" placeholder="ex: 5,15" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;"></label>
      <label style="font-size:12px;">Data: <input id="lote-cambio-data" type="date" value="${hoje.toISOString().slice(0,10)}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;"></label>
      <button type="button" onclick="executarFechamentoLoteCambio()" style="font-size:11px;font-weight:700;padding:6px 12px;border:none;border-radius:6px;background:var(--ok);color:#fff;cursor:pointer;">✓ Confirmar fechamento</button>
      <button type="button" onclick="fecharPainelFechamentoLoteCambio()" style="font-size:11px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;">Cancelar</button>
    </div>
    <div style="max-height:420px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:var(--bg);position:sticky;top:0;">
        <th style="padding:8px 8px 8px 16px;width:24px;"></th>
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Vencimento</th>
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Processo</th>
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Fornecedor</th>
        <th style="text-align:left;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Parcela</th>
        <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Valor USD</th>
        <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Câmbio Previsto</th>
        <th style="text-align:right;padding:8px 16px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">BRL Estimado</th>
      </tr></thead>
      <tbody>
        ${linhasFiltradas.map(x => {
          const key = chaveLoteCambio(x.processoId, x._tipo, x._parcelaIndex);
          const marcada = _cambioLoteSelecao.has(key);
          return `<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="abrirProcesso('${x.processoId}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
          <td style="padding:8px 8px 8px 16px;" onclick="event.stopPropagation()"><input type="checkbox" ${marcada?'checked':''} onclick="event.stopPropagation()" onchange="toggleSelecaoLoteCambio(this,'${x.processoId}','${x._tipo}',${x._parcelaIndex!=null?x._parcelaIndex:'null'},${x.valorUsd},'${(x.fornecedor||'').replace(/'/g,"\\'")}','${(x.referencia||'').replace(/'/g,"\\'")}')"></td>
          <td style="padding:8px 16px;white-space:nowrap;">${x.vencimento ? new Date(x.vencimento+'T00:00:00').toLocaleDateString('pt-BR') : '—'} ${x.vencimento ? badgeDias(x.vencimento) : ''}</td>
          <td style="padding:8px 16px;font-weight:600;white-space:nowrap;">${esc(x.referencia)}</td>
          <td style="padding:8px 16px;color:var(--muted);">${esc(x.fornecedor)}</td>
          <td style="padding:8px 16px;text-transform:capitalize;">${esc(x.parcela)}</td>
          <td style="padding:8px 16px;text-align:right;font-weight:700;">${fmtUSD(x.valorUsd)}</td>
          <td style="padding:8px 16px;text-align:right;color:var(--muted);">${x.cambioPrevisto ? x.cambioPrevisto.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4}) : '—'}</td>
          <td style="padding:8px 16px;text-align:right;">${fmtBRL(x.valorUsd*(x.cambioPrevisto||cambioAtual))}</td>
        </tr>`;
        }).join('') || `<tr><td colspan="8" style="padding:16px;text-align:center;color:var(--muted);">Nenhuma parcela em aberto neste filtro.</td></tr>`}
      </tbody>
    </table>
    </div>
    ${semData.length ? `<div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);">⚠ ${semData.length} parcela(s) sem forma de pagamento definida ainda (${fmtUSD(semData.reduce((s,x)=>s+x.valorUsd,0))}) — não entram no calendário acima. Abra o processo e defina Entrada+Saldo/Parcelado/À Vista/Prazo na aba PI.</div>` : ''}
  </div>`;

  el.innerHTML = kpisHtml + concentracaoHtml + mtmHtml + simulacaoHtml + semanasHtml + mesesHtml + fornecedorHtml + consolidacaoHtml + tabelaHtml
    + renderFluxoCaixaHtml(todosPagamentos) + renderControleCambialHtml(todosPagamentos);
}
