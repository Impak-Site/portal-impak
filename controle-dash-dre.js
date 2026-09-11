// controle-dash-dre.js
//
// Dashboard "DRE Consolidado" — pedido do Ayslan (11/09/2026): "fizemos um
// DRE por processo. tem como fazermos um DRE consolidado por semana, mes,
// ano... por cliente e alguns outros filtros?"
//
// Reusa a MESMA conta de montarDRE() (controle-core.js), só que somando
// vários processos ao mesmo tempo — ver montarDREConsolidado() lá pra
// entender como a soma é feita (rateio por venda, data de referência =
// Data NF de Saída, etc). Esta tela só cuida de: período (reaproveita
// renderPeriodoSeletor/calcularPeriodo, mesmo padrão do Executivo/
// Financeiro/Resultado — ver controle-dashboards.js), filtros (Cliente,
// Fornecedor/Marca, Status) e desenhar o resultado no mesmo layout visual
// da tabela do DRE por processo (renderDREModalHtml, controle-modal.js) —
// só que direto na tela, sem modal, e com botões de exportar Excel/PDF
// reaproveitando exportarDREExcel/exportarDREPDF (controle-export.js)
// passando null no lugar do processo (esses exports só usam o processo
// pra timeline, que é opcional/guardada por "if(p && ...)").
//
// Parte do controle_v2.html, carregado via <script src> — não é ES
// module. Depende de: _processos, montarDREConsolidado, calcularPeriodo,
// renderPeriodoSeletor, _periodoEstado, fecharTodosDashboards, esc(),
// exportarDREExcel/exportarDREPDF, clientesDoProcesso (controle-core.js).

let _dreFiltroCliente = '';
let _dreFiltroFornecedor = '';
let _dreFiltroMarca = '';
let _dreFiltroStatus = ''; // '' = todos (exceto cancelado), 'FINALIZADO', 'FECHADO'
let _dreUltimoResultado = null; // snapshot do último DRE consolidado renderizado, usado pelos botões de export

const DRE_ELEMENTOS_TOPO = ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'];

function toggleDashDRE(){
  const el = document.getElementById('dash-dre');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  DRE_ELEMENTOS_TOPO.forEach(id => {
    const alvo = document.getElementById(id);
    if(alvo) alvo.style.display = visivel ? '' : 'none';
  });
  const toolbar = document.querySelector('.toolbar');
  if(toolbar) toolbar.style.display = visivel ? '' : 'none';
  document.getElementById('menu-dre')?.classList.toggle('active', !visivel);
  if(!visivel) renderDashDRE();
}

function _dreAtualizarFiltro(campo, valor){
  if(campo === 'cliente') _dreFiltroCliente = valor;
  else if(campo === 'fornecedor') _dreFiltroFornecedor = valor;
  else if(campo === 'marca') _dreFiltroMarca = valor;
  else if(campo === 'status') _dreFiltroStatus = valor;
  renderDashDRE();
}

function _dreLimparFiltros(){
  _dreFiltroCliente = '';
  _dreFiltroFornecedor = '';
  _dreFiltroMarca = '';
  _dreFiltroStatus = '';
  renderDashDRE();
}

function renderDashDRE(){
  const el = document.getElementById('dash-dre-content');
  if(!el) return;

  renderPeriodoSeletor('periodo-seletor-dre', 'dre', renderDashDRE);
  const {ini, fim, label: periodoLabel} = calcularPeriodo('dre');

  // Opções dos selects sempre com base em TODOS os processos não
  // cancelados (não só nos já filtrados) — senão a lista ia encolhendo
  // conforme o usuário filtrava, igual ao Dashboard Financeiro.
  const processosBase = (_processos||[]).filter(p=>p && !p.cancelado);
  const uniq = arr => [...new Set(arr.filter(v=>v && v.trim()))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const opClientes = uniq(processosBase.flatMap(p => typeof clientesDoProcesso==='function' ? clientesDoProcesso(p) : [p.cliente]));
  const opFornecedores = uniq(processosBase.map(p=>p.fornecedor));
  const opMarcas = uniq(processosBase.map(p=>p.brand||p.fornecedor));

  const dre = montarDREConsolidado({
    periodoIni: ini, periodoFim: fim,
    cliente: _dreFiltroCliente, fornecedor: _dreFiltroFornecedor,
    marca: _dreFiltroMarca, status: _dreFiltroStatus,
    rotulo: periodoLabel,
  });
  _dreUltimoResultado = dre;

  const temFiltroAtivo = !!(_dreFiltroCliente || _dreFiltroFornecedor || _dreFiltroMarca || _dreFiltroStatus);

  const selectHtml = (campo, label, valorAtual, opcoes) => `
    <select onchange="_dreAtualizarFiltro('${campo}', this.value)" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--text);outline:none;min-width:160px;">
      <option value="">${esc(label)}</option>
      ${opcoes.map(o=>`<option value="${esc(o)}" ${o===valorAtual?'selected':''}>${esc(o)}</option>`).join('')}
    </select>`;

  const filtrosHtml = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
      ${selectHtml('cliente', '👤 Todos os clientes', _dreFiltroCliente, opClientes)}
      ${selectHtml('fornecedor', '🏭 Todos os fornecedores', _dreFiltroFornecedor, opFornecedores)}
      ${selectHtml('marca', '🏷 Todas as marcas', _dreFiltroMarca, opMarcas)}
      <select onchange="_dreAtualizarFiltro('status', this.value)" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--text);outline:none;min-width:140px;">
        <option value="">📌 Todos os status</option>
        <option value="FINALIZADO" ${_dreFiltroStatus==='FINALIZADO'?'selected':''}>Finalizado</option>
        <option value="FECHADO" ${_dreFiltroStatus==='FECHADO'?'selected':''}>Fechado</option>
      </select>
      ${temFiltroAtivo ? `<button type="button" class="btn btn-outline" onclick="_dreLimparFiltros()" style="font-size:12px;padding:6px 12px;">✕ Limpar filtros</button>` : ''}
    </div>`;

  if(!dre){
    el.innerHTML = filtrosHtml + `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px;">Nenhum processo com NF de Saída lançada no período/filtros selecionados.</div>`;
    return;
  }

  el.innerHTML = filtrosHtml + `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
      <div style="font-size:12px;color:var(--muted);">${esc(periodoLabel)} · ${dre._meta.qtdProcessos} processo${dre._meta.qtdProcessos===1?'':'s'} incluído${dre._meta.qtdProcessos===1?'':'s'}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="exportarDREPDF(_dreUltimoResultado, null)" style="font-size:12px;">📄 Exportar PDF</button>
        <button class="btn btn-primary" onclick="exportarDREExcel(_dreUltimoResultado, null)" style="font-size:12px;">⬇️ Exportar Excel</button>
      </div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md,12px);padding:16px 20px;">
      ${_dreConsolidadoTabelaHtml(dre)}
    </div>
    ${dre._meta.qtdProcessos ? `<details style="margin-top:12px;">
      <summary style="cursor:pointer;font-size:12px;color:var(--muted);">Ver ${dre._meta.qtdProcessos} processo${dre._meta.qtdProcessos===1?'':'s'} incluído${dre._meta.qtdProcessos===1?'':'s'} nesta soma</summary>
      <div style="font-size:12px;color:var(--muted);margin-top:6px;line-height:1.6;">${dre._meta.referencias.map(r=>esc(r)).join(', ')}</div>
    </details>` : ''}
  `;
}

// Mesma tabela visual de renderDREModalHtml (controle-modal.js), sem o
// wrapper de modal/overlay — o dre aqui é o retorno de
// montarDREConsolidado(), com o MESMO formato de campos que montarDRE()
// por processo, então a marcação é idêntica (só o título muda).
function _dreConsolidadoTabelaHtml(dre){
  const r2 = v => `R$ ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const linhaSimples = (label,valor) => `
    <tr><td style="padding:5px 8px;">${esc(label)}</td><td colspan="3" style="padding:5px 8px;text-align:right;">${r2(valor)}</td></tr>`;
  const linhaGrupo = itens => itens.map(i=>linhaSimples('   '+i.label, i.valor)).join('');
  const linhaDif = i => `
    <tr><td style="padding:5px 8px;">   ${esc(i.label)}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--muted);">${r2(i.valorNfe)}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--muted);">${r2(i.creditoEntrada)}</td>
        <td style="padding:5px 8px;text-align:right;">${r2(i.diferenca)}</td></tr>`;

  const linhaJuros = dre.jurosCobrado ? linhaSimples('Juros', dre.jurosCobrado.valor) : '';
  const linhaTotalReceita = dre.jurosCobrado
    ? `<tr><td style="padding:5px 8px;font-weight:700;border-top:1px solid var(--border);">TOTAL</td><td colspan="3" style="padding:5px 8px;text-align:right;font-weight:700;border-top:1px solid var(--border);">${r2(dre.totalReceita)}</td></tr>`
    : '';
  const rotuloLucro1 = dre.notasBoss ? 'LUCRO BRUTO — IMPAK' : 'LUCRO BRUTO';
  const linhaBoss = dre.notasBoss
    ? `
        <tr><td colspan="4" style="padding:10px 8px 4px;"></td></tr>
        ${linhaSimples('Nfe BOSS', dre.notasBoss.valorBoss)}
        ${linhaSimples('Custos', dre.notasBoss.irRetido+dre.notasBoss.iss+dre.notasBoss.pis+dre.notasBoss.cofins+dre.notasBoss.irpj+dre.notasBoss.csll)}
        <tr><td style="padding:2px 8px 5px 24px;color:var(--muted);font-size:11px;">Impostos (IR+ISS+PIS+COFINS+IRPJ+CSLL)</td></tr>
        <tr><td style="padding:5px 8px;font-weight:600;">Total a Receber</td><td colspan="3" style="padding:5px 8px;text-align:right;font-weight:600;">${r2(dre.notasBoss.totalReceber)}</td></tr>
        <tr><td style="padding:8px;font-weight:700;color:var(--ok);border-top:2px solid var(--border);">LUCRO BRUTO</td>
            <td colspan="3" style="padding:8px;text-align:right;font-weight:700;color:var(--ok);border-top:2px solid var(--border);">${r2(dre.lucroBruto)} ${dre.pctLucro!=null?'('+(dre.pctLucro*100).toFixed(1)+'%)':''}</td></tr>`
    : '';

  return `
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr><td style="padding:5px 8px;font-weight:600;">NF de Saída (soma do período/filtros)</td>
        <td colspan="3" style="padding:5px 8px;text-align:right;font-weight:600;">${r2(dre.nfSaidaValor)}</td></tr>
    ${linhaJuros}
    ${linhaTotalReceita}
    <tr><td colspan="4" style="padding:10px 8px 4px;font-weight:700;border-top:1px solid var(--border);">CUSTOS</td></tr>
    ${linhaSimples('FOB', dre.fob)}
    <tr><td style="padding:5px 8px;">Adiantamento Porto (Liberação)</td><td colspan="3" style="padding:5px 8px;text-align:right;">${r2(dre.totalAdiantamento)}</td></tr>
    ${linhaGrupo(dre.adiantamentoItens)}
    <tr><td style="padding:5px 8px;">Agente Frete</td><td colspan="3" style="padding:5px 8px;text-align:right;">${r2(dre.totalAgenteFrete)}</td></tr>
    ${linhaGrupo(dre.agenteFreteItens)}
    <tr><td></td><td style="padding:8px 8px 4px;color:var(--muted);font-size:11px;">Valores ref. NFe</td><td style="padding:8px 8px 4px;color:var(--muted);font-size:11px;">Créditos entrada</td><td style="padding:8px 8px 4px;color:var(--muted);font-size:11px;">Diferença</td></tr>
    ${dre.diferencasItens.map(linhaDif).join('')}
    ${linhaSimples('Reciclagem', dre.reciclagem)}
    ${linhaSimples('Lavação', dre.lavacao)}
    ${(dre.comissaoItens||[]).filter(i=>i.valor>0).map(i=>linhaSimples(i.label, i.valor)).join('')}
    ${linhaSimples('Despesas - Baixa Pátio para Venda/Devolução', dre.despesasBaixaPatio)}
    ${linhaSimples('Seguro Efetivo Pago', dre.seguro)}
    <tr><td style="padding:8px;font-weight:700;border-top:2px solid var(--border);">TOTAL CUSTOS</td><td colspan="3" style="padding:8px;text-align:right;font-weight:700;border-top:2px solid var(--border);">${r2(dre.totalCustos)}</td></tr>
    <tr><td style="padding:8px;font-weight:700;color:${dre.notasBoss?'var(--text)':'var(--ok)'};">${rotuloLucro1}</td>
        <td colspan="3" style="padding:8px;text-align:right;font-weight:700;color:${dre.notasBoss?'var(--text)':'var(--ok)'};">${r2(dre.lucroBrutoImpak)} ${dre.pctLucroBrutoImpak!=null?'('+(dre.pctLucroBrutoImpak*100).toFixed(1)+'%)':''}</td></tr>
    ${linhaBoss}
  </table>`;
}
