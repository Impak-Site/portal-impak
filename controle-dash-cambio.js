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

// ── Exportar Relatório Mensal (Excel) — pedido do Ayslan (09/09/2026,
// "se você fosse o financeiro, o que gostaria de ver"): um arquivo pra
// levar pra uma reunião sem precisar printar a tela. Recalcula os mesmos
// números do renderDashCambio() (não guarda estado global só pra isso) —
// é um snapshot no momento em que o botão é clicado, não um recorte de um
// mês específico (por isso o nome genérico "Relatório Câmbio", a data de
// geração já fica no subtítulo).
async function exportarRelatorioMensalCambio(){
  if(typeof ExcelJS === 'undefined'){
    showToast('Biblioteca de exportação ainda carregando, tente novamente em 1 segundo','err');
    return;
  }
  try{
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const fmtBRL = v => `R$ ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const fmtUSD = v => `USD ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const cambioAtual = (_cambio && _cambio.USD) ? _cambio.USD : 5.10;

    const todosPagamentos = listarPagamentosPI(_processos);
    const abertos = todosPagamentos.filter(x => !x.pago && x.vencimento);
    const semData = todosPagamentos.filter(x => !x.pago && !x.vencimento);
    const pagos = todosPagamentos.filter(x => x.pago);
    const prontas = abertos.filter(x => new Date(x.vencimento+'T00:00:00') < hoje);
    function janela(dias){
      const lim = new Date(hoje); lim.setDate(hoje.getDate()+dias);
      return abertos.filter(x => { const d = new Date(x.vencimento+'T00:00:00'); return d>=hoje && d<=lim; });
    }
    const j7 = janela(7), j14 = janela(14), j30 = janela(30);
    const economiaTotal = pagos.filter(x=>x.cambioPrevisto && x.cambioFechado)
      .reduce((s,x)=> s + x.valorUsd*(x.cambioPrevisto - x.cambioFechado), 0);

    const { CORES, estilizarTitulo, estilizarSubtitulo, estilizarAba } = window.ExcelStyles;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'IMPAK';
    wb.created = new Date();

    // ── Aba Resumo ──
    const wsResumo = wb.addWorksheet('Resumo');
    wsResumo.mergeCells(1,1,1,2);
    const titulo = wsResumo.getCell(1,1);
    titulo.value = 'IMPAK — Relatório de Câmbio';
    estilizarTitulo(titulo);
    wsResumo.getRow(1).height = 28;
    wsResumo.mergeCells(2,1,2,2);
    const sub = wsResumo.getCell(2,1);
    sub.value = `Gerado em ${hoje.toLocaleDateString('pt-BR')} · câmbio de referência atual: ${cambioAtual.toLocaleString('pt-BR',{minimumFractionDigits:4})}`;
    estilizarSubtitulo(sub);
    const linhasResumo = [
      ['Prontos p/ Fechamento (atrasados)', fmtUSD(prontas.reduce((s,x)=>s+x.valorUsd,0)) + ` (${prontas.length})`],
      ['A Liquidar · 7 dias', fmtUSD(j7.reduce((s,x)=>s+x.valorUsd,0)) + ` (${j7.length})`],
      ['A Liquidar · 14 dias', fmtUSD(j14.reduce((s,x)=>s+x.valorUsd,0)) + ` (${j14.length})`],
      ['A Liquidar · 30 dias', fmtUSD(j30.reduce((s,x)=>s+x.valorUsd,0)) + ` (${j30.length})`],
      ['Câmbios Pagos (total)', fmtUSD(pagos.reduce((s,x)=>s+x.valorUsd,0)) + ` (${pagos.length})`],
      ['Sem forma de pagamento definida', fmtUSD(semData.reduce((s,x)=>s+x.valorUsd,0)) + ` (${semData.length})`],
      ['Economia de câmbio acumulada (Previsto x Fechado)', fmtBRL(economiaTotal)],
    ];
    let rr = 4;
    linhasResumo.forEach(([label,valor])=>{
      const row = wsResumo.getRow(rr);
      row.getCell(1).value = label; row.getCell(1).font = {name:'Calibri', bold:true, size:11};
      row.getCell(2).value = valor; row.getCell(2).font = {name:'Calibri', size:11};
      rr++;
    });
    wsResumo.getColumn(1).width = 42;
    wsResumo.getColumn(2).width = 30;

    // ── Aba Câmbios Pagos ──
    const wsPagos = wb.addWorksheet('Câmbios Pagos');
    const linhasPagos = [...pagos].sort((a,b)=>(b.vencimento||'0000').localeCompare(a.vencimento||'0000')).map(x=>[
      x.referencia||'', x.fornecedor||'', x.parcela||'', x.numeroDi||'—',
      x.vencimento ? new Date(x.vencimento+'T00:00:00').toLocaleDateString('pt-BR') : '—',
      x.valorUsd||0, x.cambioPrevisto||'', x.cambioFechado||'', x.banco||'—', x.custoOperacao||0,
    ]);
    estilizarAba(wsPagos,
      ['Referência','Fornecedor','Parcela','DI/DUIMP','Venc. Original','Valor USD','Câmbio Previsto','Câmbio Fechado','Banco/Corretora','Custo Operação (R$)'],
      linhasPagos, null, [16,26,12,16,14,14,14,14,20,16]);

    // ── Aba Em Aberto ──
    const wsAberto = wb.addWorksheet('Em Aberto');
    const linhasAberto = [...abertos, ...semData].sort((a,b)=>(a.vencimento||'9999').localeCompare(b.vencimento||'9999')).map(x=>[
      x.referencia||'', x.fornecedor||'', x.parcela||'', x.numeroDi||'—',
      x.vencimento ? new Date(x.vencimento+'T00:00:00').toLocaleDateString('pt-BR') : 'sem data',
      x.valorUsd||0, x.cambioPrevisto||'',
    ]);
    estilizarAba(wsAberto,
      ['Referência','Fornecedor','Parcela','DI/DUImp','Vencimento','Valor USD','Câmbio Previsto'],
      linhasAberto, null, [16,26,12,16,14,14,14]);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `IMPAK_Relatorio_Cambio_${hoje.toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast('✓ Relatório de câmbio exportado','ok');
  }catch(e){
    console.error(e);
    showToast('Erro ao exportar relatório: '+e.message,'err');
  }
}

// ── PTAX x Câmbio Fechado (gráfico) ─────────────────────────────────────
// Cache em memória do lado do cliente (o backend já cacheia por 6h também,
// isso aqui só evita re-buscar toda vez que o usuário clica num KPI e
// renderDashCambio() roda de novo — o gráfico não muda com o filtro).
let _ptaxHistoricoCache = null;
async function carregarGraficoPtaxCambio(pagos){
  const el = document.getElementById('cambio-grafico-ptax');
  if(!el) return;
  try{
    if(!_ptaxHistoricoCache){
      const r = await fetch('/api/cambio/ptax-historico?dias=90');
      const d = await r.json();
      if(!d.ok) throw new Error(d.erro || 'erro desconhecido');
      _ptaxHistoricoCache = d.dados;
    }
    el.innerHTML = renderGraficoPtaxCambioSvg(_ptaxHistoricoCache, pagos);
  }catch(e){
    el.innerHTML = `<div style="font-size:11px;color:var(--muted);">Não foi possível carregar o PTAX do Banco Central agora (${esc(e.message)}).</div>`;
  }
}

function renderGraficoPtaxCambioSvg(ptax, pagos){
  if(!ptax || !ptax.length) return `<div style="font-size:11px;color:var(--muted);">Sem dados de PTAX no período.</div>`;
  const fmtBRL2 = v => v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtBRL4 = v => v.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4});
  const fmtDataCurta = t => new Date(t).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});

  const pontos = [...ptax].sort((a,b)=>a.data.localeCompare(b.data))
    .map(p=>({t:new Date(p.data+'T00:00:00').getTime(), v:p.venda}))
    .filter(p=>isFinite(p.v));
  if(!pontos.length) return `<div style="font-size:11px;color:var(--muted);">Sem dados de PTAX no período.</div>`;

  const minT = pontos[0].t, maxT = pontos[pontos.length-1].t;
  const valores = pontos.map(p=>p.v);
  const minY = Math.min(...valores) * 0.997, maxY = Math.max(...valores) * 1.003;

  // Área útil do gráfico: reserva espaço à esquerda pros rótulos do eixo Y
  // (valores do câmbio) e embaixo pros rótulos do eixo X (datas) — antes o
  // gráfico não tinha nenhuma referência de escala, só a linha "boiando".
  const W = 780, H = 260, PAD_L = 46, PAD_R = 10, PAD_T = 14, PAD_B = 26;
  const x = t => PAD_L + (maxT>minT ? (t-minT)/(maxT-minT) : 0) * (W-PAD_L-PAD_R);
  const y = v => (H-PAD_B) - (maxY>minY ? (v-minY)/(maxY-minY) : 0.5) * (H-PAD_T-PAD_B);

  // Grade horizontal com 4 faixas (5 linhas), rotuladas com o valor do câmbio
  const N_FAIXAS = 4;
  const gradeH = [];
  for(let i=0;i<=N_FAIXAS;i++){
    const v = minY + (maxY-minY) * (i/N_FAIXAS);
    const yy = y(v).toFixed(1);
    gradeH.push(`<line x1="${PAD_L}" y1="${yy}" x2="${W-PAD_R}" y2="${yy}" stroke="#e5e7eb" stroke-width="1"/>`);
    gradeH.push(`<text x="${PAD_L-6}" y="${(+yy+3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#94a3b8">${fmtBRL2(v)}</text>`);
  }

  // Grade vertical com rótulos de data (até 6 marcas, espaçadas no tempo)
  const N_DATAS = Math.min(6, pontos.length);
  const gradeV = [];
  for(let i=0;i<N_DATAS;i++){
    const t = minT + (maxT-minT) * (i/(N_DATAS-1||1));
    const xx = x(t).toFixed(1);
    gradeV.push(`<line x1="${xx}" y1="${PAD_T}" x2="${xx}" y2="${H-PAD_B}" stroke="#f1f5f9" stroke-width="1"/>`);
    gradeV.push(`<text x="${xx}" y="${H-PAD_B+14}" text-anchor="middle" font-size="9.5" fill="#94a3b8">${fmtDataCurta(t)}</text>`);
  }

  const linha = pontos.map((p,i)=>`${i===0?'M':'L'} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');

  // Pontos da Impak: câmbios pagos com vencimento dentro da janela do PTAX
  // (proxy de data — ver comentário no card "Câmbios Pagos" acima sobre a
  // ausência de um campo de data de fechamento próprio).
  const pontosEmpresa = (pagos||[]).filter(p=>p.vencimento && p.cambioFechado).map(p=>{
    const t = new Date(p.vencimento+'T00:00:00').getTime();
    return {t, v:p.cambioFechado, ref:p.referencia};
  }).filter(p=>p.t>=minT && p.t<=maxT);

  // Cor por posição relativa ao PTAX do dia (ponto acima = pagou mais caro
  // que a referência oficial; abaixo = pagou mais barato) — facilita
  // identificar de longe se o câmbio fechado foi bom ou ruim sem precisar
  // passar o mouse em cada ponto.
  const ptaxNoDia = t => {
    let melhor = pontos[0];
    for(const p of pontos){ if(Math.abs(p.t-t) < Math.abs(melhor.t-t)) melhor = p; }
    return melhor.v;
  };
  const circulos = pontosEmpresa.map(p=>{
    const ref = ptaxNoDia(p.t);
    const cor = p.v > ref ? '#dc2626' : (p.v < ref ? '#16a34a' : 'var(--ac)');
    return `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="${cor}" fill-opacity="0.9" stroke="#fff" stroke-width="1.2"><title>${esc(p.ref)} · Fechado: R$ ${fmtBRL4(p.v)} · PTAX do dia: R$ ${fmtBRL4(ref)}</title></circle>`;
  }).join('');

  const dataIni = new Date(minT).toLocaleDateString('pt-BR');
  const dataFim = new Date(maxT).toLocaleDateString('pt-BR');

  return `<div style="width:100%;">
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:260px;display:block;">
      ${gradeV.join('')}
      ${gradeH.join('')}
      <path d="${linha}" fill="none" stroke="#94a3b8" stroke-width="1.75"/>
      ${circulos}
    </svg>
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:6px;">
      <div style="display:flex;gap:14px;font-size:11px;color:var(--muted);flex-wrap:wrap;">
        <span><span style="display:inline-block;width:10px;height:2px;background:#94a3b8;margin-right:4px;vertical-align:middle;"></span>PTAX venda (BCB)</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;margin-right:4px;vertical-align:middle;"></span>Abaixo do PTAX (mais barato)</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;margin-right:4px;vertical-align:middle;"></span>Acima do PTAX (mais caro)</span>
      </div>
      <div style="font-size:10.5px;color:var(--dim);">${pontosEmpresa.length} câmbios · ${dataIni} — ${dataFim}</div>
    </div>
  </div>`;
}


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
  const bancoInput = document.getElementById('lote-cambio-banco');
  const custoInput = document.getElementById('lote-cambio-custo');
  const taxa = parseFloat(String(taxaInput?.value||'').replace(',','.'));
  const dataFechamento = dataInput?.value || new Date().toISOString().slice(0,10);
  const banco = (bancoInput?.value||'').trim() || null;
  const custo = parseFloat(String(custoInput?.value||'').replace(',','.')) || null;
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
        if(banco) patch.pi_cambio_banco = banco;
        if(custo) patch.pi_cambio_custo = custo;
      } else if(sel.tipo==='saldo'){
        patch.pi_cambio_saldo = taxa.toFixed(4);
        patch.pi_data_saldo = proc.pi_data_saldo || dataFechamento;
        patch.pi_pago = true;
        if(banco) patch.pi_cambio_banco = banco;
        if(custo) patch.pi_cambio_custo = custo;
      } else if(sel.tipo==='unico'){
        patch.pi_cambio_fechado = taxa.toFixed(4);
        patch.pi_pago = true;
        if(banco) patch.pi_cambio_banco = banco;
        if(custo) patch.pi_cambio_custo = custo;
      } else if(sel.tipo==='parcelado'){
        if(!parcelasArr){
          try{ parcelasArr = proc.pi_parcelas_json ? JSON.parse(proc.pi_parcelas_json) : []; }catch(e){ parcelasArr = []; }
        }
        if(parcelasArr[sel.parcelaIndex]){
          parcelasArr[sel.parcelaIndex] = {...parcelasArr[sel.parcelaIndex], cambio_fechado: taxa.toFixed(4),
            ...(banco ? {banco} : {}), ...(custo ? {custo_operacao: custo} : {})};
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

  // ── Câmbios pagos — pedido da Paula (09/09/2026): "adiciona os cambios
  // pagos". Até aqui a tela só falava do que estava EM ABERTO (a
  // liquidar); os que já tinham câmbio fechado só apareciam (parcialmente,
  // só quando tinham previsto E fechado registrados) lá embaixo, na tabela
  // "Controle Cambial — Previsto x Fechado". Esse card cobre TODOS os
  // pagos (com ou sem previsto registrado) e, clicando, abre a lista
  // completa na tabela detalhada — mesmo padrão de clique dos outros KPIs.
  const pagos = todosPagamentos.filter(x => x.pago);
  const pagosUsd = pagos.reduce((s,x)=>s+x.valorUsd,0);

  function kpiCard(label, valorUsd, sub, cor, filtro){
    const tipoFiltro = filtro.tipo || 'prazo';
    const ativo = _cambioFiltro && _cambioFiltro.tipo===tipoFiltro && (tipoFiltro==='pagos' || _cambioFiltro.dias===filtro.dias);
    const proximoFiltro = tipoFiltro==='pagos' ? `{tipo:'pagos',label:'pagas'}` : `{tipo:'prazo',dias:${typeof filtro.dias==='string'?`'${filtro.dias}'`:filtro.dias},label:'${filtro.label}'}`;
    // Ao clicar, além de aplicar o filtro, rola a tela até a tabela
    // detalhada — pedido do Ayslan (09/09/2026): "os cards conseguem ser
    // interativos, apertar e abrir a lista com os processos?". O clique já
    // filtrava a tabela de baixo, mas sem indicação nenhuma de que algo
    // tinha acontecido se a tabela estivesse fora da tela — agora rola até
    // ela ficar visível, ficando óbvio que "abriu a lista".
    const onclick = `_cambioFiltro=${ativo?'null':proximoFiltro};renderDashCambio();document.getElementById('cambio-tabela-detalhada')?.scrollIntoView({behavior:'smooth',block:'start'});`;
    return `<div onclick="${onclick}" title="Clique para ver os processos na tabela abaixo" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;${ativo?'box-shadow:0 0 0 2px '+cor+';':''}">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
      <div style="font-size:20px;font-weight:600;color:${cor};${MONO}white-space:nowrap;">${fmtUSD(valorUsd)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>
    </div>`;
  }

  const toolbarHtml = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
    <button onclick="exportarRelatorioMensalCambio()" title="Baixa um Excel com Resumo, Câmbios Pagos e Em Aberto — pronto pra levar numa reunião"
      style="font-size:12px;font-weight:700;padding:7px 14px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--text);cursor:pointer;display:flex;align-items:center;gap:6px;">📥 Exportar Relatório (Excel)</button>
  </div>`;

  const kpisHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:14px;">
    ${kpiCard('✅ Prontos p/ Fechamento', prontasUsd, prontas.length+' parcela(s) atrasada(s) — ação imediata', prontas.length?'var(--err)':'var(--ok)', {dias:'vencidas',label:'atrasadas'})}
    ${kpiCard('A Liquidar · 7 dias', j7.usd, j7.itens.length+' parcela(s)', 'var(--err)', {dias:7,label:'próx. 7 dias'})}
    ${kpiCard('A Liquidar · 14 dias', j14.usd, j14.itens.length+' parcela(s)', 'var(--warn)', {dias:14,label:'próx. 14 dias'})}
    ${kpiCard('A Liquidar · 30 dias', j30.usd, j30.itens.length+' parcela(s)', 'var(--ac)', {dias:30,label:'próx. 30 dias'})}
    ${kpiCard('💰 Câmbios Pagos', pagosUsd, pagos.length+' parcela(s) já fechada(s)', 'var(--ok)', {tipo:'pagos'})}
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

  // ── Alerta "fora do radar" — pedido do Ayslan (09/09/2026, revisão do
  // que um controller/financeiro gostaria de ver): antes esse aviso era só
  // uma nota de rodapé de 11px embaixo da tabela, fácil de nunca ser vista
  // — mas é o pior tipo de risco cambial (parcela que nem aparece nos KPIs
  // de prazo porque ainda não tem Entrada+Saldo/Parcelado/À Vista/Prazo
  // definido na PI). Vira alerta vermelho no topo, clicável, igual peso
  // visual do aviso de concentração.
  const alertaSemDataHtml = !semData.length ? '' : `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 16px;margin-bottom:14px;font-size:12px;color:#7f1d1d;display:flex;flex-direction:column;gap:3px;">
    <div style="font-weight:700;color:#991b1b;">🚨 ${fmtUSD(semData.reduce((s,x)=>s+x.valorUsd,0))} fora do radar — sem forma de pagamento definida</div>
    <div>${semData.length} parcela(s) ainda sem Entrada+Saldo/Parcelado/À Vista/Prazo definido na PI — esse valor NÃO entra em nenhum KPI de prazo acima, então pode vencer sem ninguém perceber. <a href="#" onclick="_cambioFiltro={tipo:'semdata'};renderDashCambio();document.getElementById('cambio-tabela-detalhada')?.scrollIntoView({behavior:'smooth',block:'start'});return false;" style="color:#991b1b;font-weight:700;">Ver processos →</a></div>
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

  // ── PTAX x Câmbio Fechado — pedido do Ayslan (09/09/2026: "usar a API
  // do Banco Central pra PTAX", https://www.bcb.gov.br/estabilidadefinanceira/fechamentodolar).
  // O gráfico em si é montado depois, de forma assíncrona (carregarGraficoPtaxCambio),
  // porque depende de uma chamada de rede ao backend (que por sua vez consulta
  // o BCB) — aqui só entra o placeholder que reserva o espaço.
  const graficoPtaxHtml = `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px;">
    <div style="font-size:14px;font-weight:700;margin-bottom:2px;">📈 PTAX (Banco Central) x Câmbio Fechado pela Impak</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Linha cinza = PTAX de venda, cotação oficial do BCB. Pontos azuis = câmbio que a Impak fechou em cada parcela paga (usa o vencimento original como data, já que o sistema não guarda a data exata do fechamento).</div>
    <div id="cambio-grafico-ptax" style="min-height:200px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted);">Carregando PTAX do Banco Central...</div>
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
  const fornecedorHtml = !donutLista.length ? '' : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:20px 22px;height:100%;box-sizing:border-box;">
    <div style="font-size:14px;font-weight:700;margin-bottom:18px;">🏭 Exposição por Fornecedor</div>
    <div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap;">
      <div style="width:150px;height:150px;border-radius:50%;flex-shrink:0;background:conic-gradient(${donutStops || '#e2e8f0 0% 100%'});position:relative;">
        <div style="position:absolute;inset:22px;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:9.5px;color:var(--muted);font-weight:700;letter-spacing:0.03em;">TOTAL</div>
          <div style="font-size:14px;font-weight:800;${MONO}">${fmtUSD(totalDonut).replace('USD ','')}</div>
        </div>
      </div>
      <div style="flex:1;min-width:260px;display:flex;flex-direction:column;">
        ${donutLista.map(([nome,val],i) => {
          const pct = totalDonut>0 ? Math.round(val/totalDonut*100) : 0;
          const ativo = _cambioFiltro && _cambioFiltro.tipo==='fornecedor' && _cambioFiltro.nome===nome;
          const clicavel = nome !== 'Outros fornecedores';
          const ultima = i === donutLista.length-1;
          return `<div ${clicavel?`onclick="_cambioFiltro=${ativo?'null':`{tipo:'fornecedor',nome:'${nome.replace(/'/g,"\\'")}'}`};renderDashCambio()"`:''} style="display:flex;align-items:center;gap:10px;font-size:12.5px;padding:9px 8px;${ultima?'':'border-bottom:1px solid #f1f5f9;'}${clicavel?'cursor:pointer;':''}${ativo?'background:#f1f5f9;border-radius:6px;':''}">
            <span style="width:11px;height:11px;border-radius:3px;background:${DONUT_CORES[i]||'#e2e8f0'};flex-shrink:0;"></span>
            <span style="flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nome)}</span>
            <span style="color:var(--muted);width:34px;text-align:right;flex-shrink:0;">${pct}%</span>
            <span style="font-weight:700;width:130px;text-align:right;flex-shrink:0;${MONO}">${fmtUSD(val)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;

  // ── Concentração por Banco/Corretora + Custo da Operação — pedido do
  // Ayslan (09/09/2026, "se você fosse o financeiro, o que gostaria de
  // ver"). Só entra o que já foi FECHADO (banco/custo só se sabe depois de
  // fechar o câmbio, não faz sentido pro que ainda está em aberto) e só
  // conta o que tiver os campos novos preenchidos — dados históricos antes
  // desses campos existirem ficam de fora até alguém voltar e preencher.
  const pagosComBanco = pagos.filter(x=>x.banco);
  const porBanco = {};
  pagosComBanco.forEach(x=>{ porBanco[x.banco] = (porBanco[x.banco]||0) + x.valorUsd; });
  const rankingBanco = Object.entries(porBanco).sort((a,b)=>b[1]-a[1]);
  const totalBancoUsd = rankingBanco.reduce((s,[,v])=>s+v,0);
  const custoTotalOperacoes = pagos.reduce((s,x)=>s+(x.custoOperacao||0),0);
  const pagosComCusto = pagos.filter(x=>x.custoOperacao).length;

  const bancoCustoHtml = (!pagos.length) ? '' : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px;">
    <div style="font-size:14px;font-weight:700;margin-bottom:2px;">🏦 Concentração por Banco/Corretora + Custo da Operação</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Baseado nos câmbios já fechados com Banco/Corretora e Custo da Operação preenchidos (campos novos — registre ao fechar um câmbio pra essa seção ir enchendo).</div>
    <div style="display:flex;gap:24px;flex-wrap:wrap;">
      <div style="flex:1;min-width:220px;">
        ${!rankingBanco.length ? `<div style="font-size:12px;color:var(--muted);">Nenhum câmbio fechado com Banco/Corretora informado ainda.</div>` : rankingBanco.map(([nome,val])=>{
          const pct = totalBancoUsd>0 ? Math.round(val/totalBancoUsd*100) : 0;
          return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px;">
            <span style="flex:1;font-weight:600;">${esc(nome)}</span>
            <span style="color:var(--muted);">${pct}%</span>
            <span style="font-weight:700;${MONO}">${fmtUSD(val)}</span>
          </div>`;
        }).join('')}
      </div>
      <div style="flex:1;min-width:200px;border-left:1px solid var(--border);padding-left:20px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Custo total das operações</div>
        <div style="font-size:20px;font-weight:800;${MONO}">${fmtBRL(custoTotalOperacoes)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${pagosComCusto} de ${pagos.length} câmbio(s) pago(s) com custo informado</div>
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
  // mostrandoPagos controla as colunas da tabela logo abaixo: parcela já
  // paga não tem sentido de "selecionar pra fechar em lote" nem de mostrar
  // "Câmbio Previsto" (o que importa ali é o que foi de fato Fechado).
  let mostrandoPagos = false;
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
    } else if(_cambioFiltro.tipo==='pagos'){
      mostrandoPagos = true;
      linhasFiltradas = pagos;
      tituloFiltro = `Câmbios já pagos (<a href="#" onclick="_cambioFiltro=null;renderDashCambio();return false;" style="color:var(--ac);">limpar filtro</a>)`;
    } else if(_cambioFiltro.tipo==='semdata'){
      linhasFiltradas = semData;
      tituloFiltro = `Sem forma de pagamento definida — fora dos KPIs de prazo (<a href="#" onclick="_cambioFiltro=null;renderDashCambio();return false;" style="color:var(--ac);">limpar filtro</a>)`;
    }
  }
  // Sem uma data de pagamento própria guardada por parcela (só existe o
  // vencimento original + o câmbio fechado como marca de "pago"), a
  // ordenação por vencimento desc é a melhor aproximação de "mais recente
  // primeiro" pros câmbios já pagos.
  linhasFiltradas = [...linhasFiltradas].sort((a,b)=> mostrandoPagos
    ? (b.vencimento||'0000').localeCompare(a.vencimento||'0000')
    : (a.vencimento||'9999').localeCompare(b.vencimento||'9999'));

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
  const tabelaHtml = `<div id="cambio-tabela-detalhada" style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;scroll-margin-top:14px;">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;background:var(--bg);">
      <div style="font-size:13px;font-weight:700;">${tituloFiltro} — ${linhasFiltradas.length} parcela(s)</div>
      ${mostrandoPagos ? '' : `<div style="display:flex;align-items:center;gap:10px;">
        <span id="lote-cambio-resumo" style="font-size:12px;color:var(--muted);">${_cambioLoteSelecao.size ? `${_cambioLoteSelecao.size} parcela(s) selecionada(s)` : 'Marque parcelas pra fechar câmbio em lote.'}</span>
        <button id="lote-cambio-btn" type="button" onclick="abrirPainelFechamentoLoteCambio()" ${_cambioLoteSelecao.size ? '' : 'disabled'}
          style="font-size:12px;font-weight:700;padding:7px 14px;border:none;border-radius:7px;background:var(--ok);color:#fff;cursor:pointer;${_cambioLoteSelecao.size ? '' : 'opacity:.5;cursor:not-allowed;'}">💱 Fechar câmbio em lote</button>
      </div>`}
    </div>
    <div id="lote-cambio-painel" style="display:none;padding:14px 16px;border-bottom:1px solid var(--border);background:#f0f9ff;align-items:center;gap:12px;flex-wrap:wrap;">
      <b id="lote-cambio-titulo-painel" style="font-size:12px;">Fechar câmbio de ${_cambioLoteSelecao.size} parcela(s) selecionada(s):</b>
      <label style="font-size:12px;">Câmbio: <input id="lote-cambio-taxa" type="number" step="0.0001" placeholder="ex: 5,15" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;${MONO}"></label>
      <label style="font-size:12px;">Data: <input id="lote-cambio-data" type="date" value="${hoje.toISOString().slice(0,10)}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;"></label>
      <label style="font-size:12px;">Banco/Corretora: <input id="lote-cambio-banco" type="text" placeholder="opcional" style="width:130px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;"></label>
      <label style="font-size:12px;">Custo (R$): <input id="lote-cambio-custo" type="number" step="0.01" placeholder="opcional" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-left:4px;${MONO}"></label>
      <button type="button" onclick="executarFechamentoLoteCambio()" style="font-size:11px;font-weight:700;padding:6px 12px;border:none;border-radius:6px;background:var(--ok);color:#fff;cursor:pointer;">✓ Confirmar fechamento</button>
      <button type="button" onclick="fecharPainelFechamentoLoteCambio()" style="font-size:11px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;">Cancelar</button>
    </div>
    <div style="max-height:420px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:var(--bg);position:sticky;top:0;">
        <th style="padding:8px 8px 8px 16px;width:24px;"></th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">${mostrandoPagos ? 'Venc. Original' : 'Vencimento'}</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Processo</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Fornecedor</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Parcela</th>
        <th style="text-align:left;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">DI/DUIMP</th>
        <th style="text-align:right;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">Valor USD</th>
        <th style="text-align:right;padding:8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">${mostrandoPagos ? 'Câmbio Fechado' : 'Câmbio Previsto'}</th>
        <th style="text-align:right;padding:8px 8px 8px 8px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap;">${mostrandoPagos ? 'BRL Pago' : 'BRL Estimado'}</th>
      </tr></thead>
      <tbody>
        ${linhasFiltradas.map(x => {
          const key = chaveLoteCambio(x.processoId, x._tipo, x._parcelaIndex);
          const marcada = _cambioLoteSelecao.has(key);
          return `<tr style="border-top:1px solid var(--border);cursor:pointer;" onclick="abrirProcesso('${x.processoId}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
          <td style="padding:8px 8px 8px 16px;" onclick="event.stopPropagation()">${mostrandoPagos ? '' : `<input type="checkbox" ${marcada?'checked':''} onclick="event.stopPropagation()" onchange="toggleSelecaoLoteCambio(this,'${x.processoId}','${x._tipo}',${x._parcelaIndex!=null?x._parcelaIndex:'null'},${x.valorUsd},'${(x.fornecedor||'').replace(/'/g,"\\'")}','${(x.referencia||'').replace(/'/g,"\\'")}')">`}</td>
          <td style="padding:8px 8px;white-space:nowrap;">${x.vencimento ? new Date(x.vencimento+'T00:00:00').toLocaleDateString('pt-BR') : '—'} ${(x.vencimento && !mostrandoPagos) ? badgeDias(x.vencimento) : ''}</td>
          <td style="padding:8px 8px;font-weight:600;white-space:nowrap;${MONO}color:var(--ac);">${esc(x.referencia)}</td>
          <td style="padding:8px 8px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:1px;" title="${esc(x.fornecedor)}">${esc(x.fornecedor)}</td>
          <td style="padding:8px 8px;text-transform:capitalize;white-space:nowrap;">${esc(x.parcela)}</td>
          <td style="padding:8px 8px;white-space:nowrap;${MONO}color:${x.numeroDi?'var(--text)':'var(--dim)'};">${esc(x.numeroDi||'—')}</td>
          <td style="padding:8px 8px;text-align:right;font-weight:700;white-space:nowrap;${MONO}">${fmtUSD(x.valorUsd)}</td>
          <td style="padding:8px 8px;text-align:right;color:${mostrandoPagos?'var(--ok)':'var(--muted)'};font-weight:${mostrandoPagos?'700':'400'};white-space:nowrap;${MONO}">${(mostrandoPagos ? x.cambioFechado : x.cambioPrevisto) ? (mostrandoPagos ? x.cambioFechado : x.cambioPrevisto).toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4}) : '—'}</td>
          <td style="padding:8px 8px;text-align:right;white-space:nowrap;${MONO}">${fmtBRL(x.valorUsd*((mostrandoPagos ? x.cambioFechado : x.cambioPrevisto)||cambioAtual))}</td>
        </tr>`;
        }).join('') || `<tr><td colspan="9" style="padding:16px;text-align:center;color:var(--muted);">${mostrandoPagos ? 'Nenhum câmbio pago ainda.' : 'Nenhuma parcela em aberto neste filtro.'}</td></tr>`}
      </tbody>
    </table>
    </div>
  </div>`;

  el.innerHTML = toolbarHtml + kpisHtml + alertaSemDataHtml + concentracaoHtml + mtmHtml + graficoPtaxHtml
    + `<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:stretch;margin-bottom:14px;">${fornecedorHtml}${simulacaoHtml}</div>`
    + bancoCustoHtml + consolidacaoHtml + tabelaHtml
    + renderFluxoCaixaHtml(todosPagamentos) + renderControleCambialHtml(todosPagamentos);

  carregarGraficoPtaxCambio(pagos);
}
