// controle-modal.js
//
// Painel lateral do processo: abrir/fechar, render das abas (timeline, alertas, conteúdo), histórico, arquivos GED, parametrização, troca de aba, pagamento (PI).
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
function abrirNovo(){
  // _camposIA rastreia, NESTA sessão de edição, quais campos foram preenchidos
  // pela última leitura de IA (não pelo usuário digitando) — usado por
  // extrairComIA() pra saber se pode corrigir um campo já preenchido quando
  // um documento novo (ex: o certo, depois de um errado) trouxer outro valor.
  // Não é salvo no banco (propositalmente prefixado com _, igual _fasePrevista
  // e _savedAt já removidos antes do save) — reseta a cada vez que o processo
  // é reaberto, o que cobre o caso real relatado (corrigir dentro da mesma
  // sessão de edição, logo após perceber o documento errado).
  _editando = { fase:'PI', free_time:21, _camposIA: {} };
  _editandoOriginal = {};
  renderModal();
}

async function abrirProcesso(id){
  const proc = _processos.find(p=>p.id===id);
  if(!proc) return;
  _editando = {...proc, _camposIA: {}};
  _editandoOriginal = {...proc};
  renderModal();
  // URL por processo (task #59) — deep link/bookmark + botão voltar do navegador
  const novaUrl = _baseUrlPath.replace(/\/$/,'') + '/' + encodeURIComponent(proc.referencia);
  if(location.pathname !== novaUrl) history.pushState({processoId:proc.id}, '', novaUrl);
}

function fecharModal(){
  _editando = null;
  document.getElementById('modal-bg').classList.remove('open');
  // Volta a URL pra tela de baixo (/controle ou /financeiro) sem recarregar a página.
  if(location.pathname !== _baseUrlPath) history.pushState(null, '', _baseUrlPath);
}

// Se o usuário editar manualmente um campo que a IA tinha preenchido antes,
// esse campo "vira dele" — deixa de poder ser sobrescrito automaticamente por
// uma leitura de IA seguinte, protegendo a correção manual do usuário. Só
// reage a eventos reais do teclado/mouse: setar .value via JS (como a própria
// extração faz) não dispara 'input', então isso nunca conflita com a IA.
document.addEventListener('input', function(e){
  if(!_editando || !_editando._camposIA) return;
  const id = e.target && e.target.id;
  if(!id || !id.startsWith('f_')) return;
  const campo = id.slice(2);
  if(_editando._camposIA[campo]) delete _editando._camposIA[campo];
});

// ════════════════════════════════════════════════════════════════
// MODAL — RENDER
// ════════════════════════════════════════════════════════════════
function renderModal(){
  const p = _editando;
  const isNovo = !p.id;
  const fase = FASES.find(f=>f.id===p.fase)||FASES[0];

  document.getElementById('modal-title').textContent = isNovo ? 'Novo Processo' : p.referencia;
  document.getElementById('modal-fase-badge').innerHTML = `<span class="fase-badge fase-${p.fase}">${fase.icon} ${fase.label}</span>`;
  document.getElementById('modal-bg').classList.add('open');


  // ── ABAS ──
  const TABS = [
    {id:'identificacao', label:'📄 Identificação'},
    {id:'financeiro',    label:'💰 Financeiro'},
    {id:'fechamento',    label:'📐 Fechamento'},
    {id:'custosreais',   label:'💵 Custos Reais'},
    {id:'logistica',     label:'🚢 Logística'},
    {id:'documentos',    label:'📋 Documentos'},
    {id:'historico',     label:'📜 Histórico'},
  ];
  const temAlerta = verificarAlertas(p, false).length > 0;
  const tabsHtml = TABS.map(t =>
    `<div class="modal-tab ${t.id==='identificacao'?'active':''}" onclick="trocarAba('${t.id}')" id="tab-${t.id}">
      ${t.label}${t.id==='identificacao'&&temAlerta?'<span class="tab-alert"></span>':''}
    </div>`
  ).join('');
  document.getElementById('modal-tabs').innerHTML = tabsHtml;

  // ── TIMELINE com datas ──
  const faseIdx = FASES.findIndex(f=>f.id===p.fase);
  // Mapa fase → data do processo
  const faseDatas = {
    'PI':                  p.pi_data,
    'AGUARDANDO_EMBARQUE': p.previsao_prontidao||p.data_prontidao,
    'EMBARCADO':           p.data_embarque,
    'DESEMBARCADO':        p.data_chegada,
    'REGISTRO_DI':         p.data_registro_di,
    'PARAMETRIZACAO':      p.data_parametrizacao,
    'FATURAMENTO':         p.nf_entrada_data||p.nf_saida_data,
    'CARREGAMENTO':        p.data_agendamento||p.data_carregamento,
    'DEVOLUCAO_VAZIO':     p.data_devolucao_vazio,
    'FINALIZADO':          p.data_devolucao_vazio,
  };
  const timeline = FASES.map((f,i) => {
    const done   = i < faseIdx;
    const active = i === faseIdx;
    const cls    = done?'done':active?'active':'';
    const dataStr = faseDatas[f.id] ? `<div style="font-size:9px;color:var(--dim);margin-top:2px;">${parseDataLocal(faseDatas[f.id]).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</div>` : '';
    return `
      ${i>0?`<div class="tl-line ${done?'done':''}"></div>`:''}
      <div class="tl-step">
        <div class="tl-dot ${cls}">${done?'✓':f.icon}</div>
        <div class="tl-label">${f.label}</div>
        ${dataStr}
      </div>`;
  }).join('');

  // ── ALERTAS ──
  const alertas = verificarAlertas(p, false);
  const alertasHtml = alertas.map(a=>
    `<div style="padding:8px 12px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:8px;font-size:12px;color:var(--err);margin-bottom:8px;font-weight:600;">🚨 ${a.titulo}: ${a.mensagem}</div>`
  ).join('');

  // ── CONTEÚDO DAS ABAS ──
  const finInfo = p.pi_pagamento ? renderPagamentoInfo(p) : '';

  // Confirmação visual demurrage (calculada dinamicamente — ver renderDemurInfo)
  let demurInfo = renderDemurInfo(p);

  document.getElementById('modal-body').innerHTML = `
    <!-- ABA: IDENTIFICAÇÃO -->
    <div class="tab-pane active" id="pane-identificacao">
      <div class="timeline">${timeline}</div>
      ${alertasHtml}
      <!-- IA -->
      <div class="form-section" style="background:rgba(26,127,212,.04);border:1px solid rgba(26,127,212,.15);border-radius:10px;padding:14px 16px;margin-bottom:20px;">
        <div class="form-section-title" style="border:none;margin-bottom:8px;">🤖 Extração com IA</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Envie uma PI, CI ou BL para preencher os campos automaticamente</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="file" id="ia-doc-file" accept=".pdf,.png,.jpg,.jpeg" style="display:none" onchange="extrairComIA(this)">
          <button class="btn btn-outline" onclick="document.getElementById('ia-doc-file').click()">📎 Selecionar documento</button>
          <span id="ia-status" style="font-size:12px;color:var(--muted);"></span>
        </div>
      </div>
      <!-- Alerta de pendência de revisão (vem da importação de planilha) -->
      <div id="alerta-pendencia" style="display:${p.pendencia_revisao ? 'block' : 'none'};background:rgba(243,156,18,.1);border:1px solid rgba(243,156,18,.4);border-left:4px solid #f39c12;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
        <div style="font-weight:700;color:#f39c12;font-size:13px;margin-bottom:6px;">⚠ Pendência de revisão (da importação de planilha)</div>
        <div id="texto-pendencia" style="font-size:12px;color:var(--text);white-space:pre-line;line-height:1.6;">${esc(p.pendencia_revisao)}</div>
        <input type="hidden" id="f_pendencia_revisao" value="${esc(p.pendencia_revisao)}">
        <button type="button" class="btn btn-outline" style="margin-top:10px;font-size:12px;" onclick="marcarPendenciaRevisada()">✓ Marcar como revisado</button>
      </div>
      <!-- Identificação -->
      <div class="form-section">
        <div class="form-section-title">📄 Identificação</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Referência *</label>
            <input class="form-input" id="f_referencia" value="${esc(p.referencia)}" placeholder="Ex: UD25-340"></div>
          <div class="form-group"><label class="form-label">Finalidade</label>
            <select class="form-input" id="f_finalidade">
              <option value="">— selecionar —</option>
              <option value="IMPORTACAO_DIRETA" ${p.finalidade==='IMPORTACAO_DIRETA'?'selected':''}>Importação Própria (Direto)</option>
              <option value="ENCOMENDA" ${p.finalidade==='ENCOMENDA'?'selected':''}>Encomenda</option>
              <option value="CONTA_E_ORDEM" ${p.finalidade==='CONTA_E_ORDEM'?'selected':''}>Conta e Ordem</option>
            </select></div>
          <div class="form-group" style="position:relative"><label class="form-label">Fornecedor (Exportador)</label>
            <input class="form-input" id="f_fornecedor" value="${esc(p.fornecedor)}" placeholder="Ex: EUDEMON" autocomplete="off"
              oninput="autocompletarContato(this,'FORNECEDOR,EXPORTADOR','fornecedor-dropdown')">
            <div id="fornecedor-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group" style="position:relative"><label class="form-label">Cliente</label>
            <input class="form-input" id="f_cliente" value="${esc(p.cliente)}" autocomplete="off"
              oninput="autocompletarContato(this,'CLIENTE','cliente-dropdown')" placeholder="Digite razão social, CNPJ ou cidade...">
            <div id="cliente-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group full">
            <label class="form-label">Produtos</label>
            <div id="multi-produtos-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px;"></div>
            <button type="button" onclick="adicionarProdutoItem()" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:6px 14px;font-size:12px;color:var(--ac);cursor:pointer;font-weight:600;">+ Adicionar Item</button>
            <input type="hidden" id="f_produtos_json">
            <input type="hidden" id="f_produto" value="${esc(p.produto||'')}">
          </div>
          <div class="form-group" style="position:relative"><label class="form-label">Despachante</label>
            <input class="form-input" id="f_despachante" value="${esc(p.despachante)}" autocomplete="off"
              oninput="autocompletarContato(this,'DESPACHANTE','despachante-dropdown')">
            <div id="despachante-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group full"><label class="form-label">Observações</label>
            <input class="form-input" id="f_obs" value="${esc(p.obs)}"></div>
        </div>
      </div>
      <!-- Ações -->
      <div style="display:flex;gap:10px;justify-content:space-between;padding-top:16px;border-top:1px solid var(--border);">
        <div>${p.id?`<button class="btn" onclick="excluirProcesso('${p.id}')" style="background:var(--err-bg);color:var(--err);border:1px solid rgba(220,38,38,.2);">🗑 Excluir</button>`:''}</div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="coletarESalvar()">💾 Salvar</button>
        </div>
      </div>
    </div>

    <!-- ABA: FINANCEIRO -->
    <div class="tab-pane" id="pane-financeiro">
      <div class="form-section">
        <div class="form-section-title">💰 Proforma Invoice (PI)</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Nº PI</label>
            <input class="form-input" id="f_pi_numero" value="${esc(p.pi_numero)}"></div>
          <div class="form-group"><label class="form-label">Data PI</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data" value="${esc(p.pi_data)}"></div>
          <div class="form-group"><label class="form-label">Valor USD</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_pi_valor_usd" value="${exibirMoeda(p.pi_valor_usd)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">Câmbio na PI (R$)</label>
            <input class="form-input" type="number" id="f_pi_cambio" value="${p.pi_cambio||''}" placeholder="${_cambio.USD.toFixed(2)}" step="0.0001">
          </div>
          <div class="form-group"><label class="form-label">Câmbio Fechado (R$)</label>
            <input class="form-input" type="number" id="f_pi_cambio_fechado" value="${p.pi_cambio_fechado||''}" placeholder="preenchido ao confirmar o câmbio" step="0.0001"
              title="Taxa que realmente foi paga (vem do comprovante de câmbio, pra Pagamento Único/Prazo). Fica separado de 'Câmbio na PI' de propósito — aquele é a previsão, este é o fechado, pra dar pra comparar os dois no Dashboard Financeiro.">
          </div>
          <div class="form-group"><label class="form-label">Incoterm</label>
            <select class="form-input" id="f_pi_incoterm">
              <option value="">—</option>
              <option value="EXW" ${p.pi_incoterm==='EXW'?'selected':''}>EXW</option>
              <option value="FCA" ${p.pi_incoterm==='FCA'?'selected':''}>FCA</option>
              <option value="FOB" ${p.pi_incoterm==='FOB'?'selected':''}>FOB</option>
              <option value="CFR" ${p.pi_incoterm==='CFR'?'selected':''}>CFR</option>
              <option value="CIF" ${p.pi_incoterm==='CIF'?'selected':''}>CIF</option>
              <option value="CPT" ${p.pi_incoterm==='CPT'?'selected':''}>CPT</option>
            </select></div>
          <div class="form-group"><label class="form-label">Forma de Pagamento</label>
            <select class="form-input" id="f_pi_pagamento" onchange="renderPagamentoCampos()">
              <option value="">—</option>
              <option value="VISTA"        ${p.pi_pagamento==='VISTA'?'selected':''}>100% à Vista</option>
              <option value="PRAZO"        ${p.pi_pagamento==='PRAZO'?'selected':''}>100% a Prazo</option>
              <option value="ENTRADA_SALDO"${p.pi_pagamento==='ENTRADA_SALDO'?'selected':''}>Entrada + Saldo</option>
            </select></div>
          <div class="form-group"><label class="form-label">PI Paga?</label>
            <select class="form-input" id="f_pi_pago">
              <option value="false" ${!p.pi_pago?'selected':''}>Não</option>
              <option value="true"  ${p.pi_pago?'selected':''}>Sim ✓</option>
            </select></div>
        </div>
        <div id="pagamento-campos"></div>
        ${finInfo}
      </div>
      <div class="form-section">
        <div class="form-section-title">💵 Commercial Invoice (CI)</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Nº CI</label>
            <input class="form-input" id="f_ci_numero" value="${esc(p.ci_numero)}"></div>
          <div class="form-group"><label class="form-label">Data CI</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_ci_data" value="${esc(p.ci_data)}"></div>
          <div class="form-group"><label class="form-label">Valor CI (USD)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_ci_valor_usd" value="${exibirMoeda(p.ci_valor_usd)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">💾 Salvar</button>
      </div>
    </div>

    <!-- ABA: FECHAMENTO -->
    <div class="tab-pane" id="pane-fechamento">
      <div class="form-section">
        <div class="form-section-title">📐 Fechamento — Estimado × Real</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Compara o que foi cotado no Calculador (na hora de aprovar a cotação) com o resultado real do processo, calculado a partir da NF Entrada e NF Saída lançadas na aba Documentos.
        </div>
        ${renderFechamentoInfo(p)}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">💾 Salvar</button>
      </div>
    </div>

    <!-- ABA: CUSTOS REAIS -->
    <div class="tab-pane" id="pane-custosreais">
      <div class="form-section">
        <div class="form-section-title">💵 Custos Reais — apuração de lucro item a item</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Lance aqui o que realmente foi pago em cada item (FOB, frete, seguro, impostos, comissões e taxas operacionais). Quando o processo veio de uma cotação aprovada, cada campo já nasce preenchido com o valor cotado — ajuste só o que saiu diferente. Assim que tiver pelo menos um item aqui, o Lucro Real na aba Fechamento passa a usar esse detalhamento em vez do cálculo simples por NF.
        </div>
        ${renderCustosReaisTab(p)}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarCustosReaisTab()">💾 Salvar Custos Reais</button>
      </div>
    </div>

    <!-- ABA: LOGÍSTICA -->
    <div class="tab-pane" id="pane-logistica">
      <div class="form-section">
        <div class="form-section-title">🏭 Prontidão</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Previsão Prontidão</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_previsao_prontidao" value="${esc(p.previsao_prontidao)}"></div>
          <div class="form-group"><label class="form-label">Data Prontidão Real</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_prontidao" value="${esc(p.data_prontidao)}"
              onchange="moverDataFuturaParaPrevisao('f_data_prontidao','f_previsao_prontidao','Previsão Prontidão')"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">📦 Booking & Embarque</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Nº Booking</label>
            <input class="form-input" id="f_booking_numero" value="${esc(p.booking_numero)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group" style="position:relative"><label class="form-label">Armador</label>
            <input class="form-input" id="f_armador" value="${esc(p.armador)}" placeholder="Ex: PIL, COSCO, MSC" autocomplete="off"
              oninput="autocompletarContato(this,'ARMADOR','armador-dropdown')">
            <div id="armador-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group" style="position:relative"><label class="form-label">Agente de Carga</label>
            <input class="form-input" id="f_agente" value="${esc(p.agente)}" placeholder="Ex: ROYAL" autocomplete="off"
              oninput="autocompletarContato(this,'AGENTE','agente-dropdown')">
            <div id="agente-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group"><label class="form-label">Navio</label>
            <input class="form-input" id="f_navio" value="${esc(p.navio)}"></div>
          <div class="form-group"><label class="form-label">Valor do Frete</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_valor_frete" value="${exibirMoeda(p.valor_frete)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">Moeda do Frete</label>
            <select class="form-input" id="f_moeda_frete">
              <option value="USD" ${(!p.moeda_frete||p.moeda_frete==='USD')?'selected':''}>USD (US$)</option>
              <option value="BRL" ${p.moeda_frete==='BRL'?'selected':''}>BRL (R$)</option>
              <option value="EUR" ${p.moeda_frete==='EUR'?'selected':''}>EUR (€)</option>
            </select></div>
          <div class="form-group"><label class="form-label">Porto Origem</label>
            <select class="form-input" id="f_porto_origem" onchange="togglePortoOutro('origem')">${gerarOptionsPortoOrigem(p.porto_origem)}</select>
            <input class="form-input" id="f_porto_origem_outro" value="${esc(PORTOS_ORIGEM.includes((p.porto_origem||'').toUpperCase())?'':p.porto_origem)}"
              placeholder="Digite o porto de origem" style="display:${(p.porto_origem && !PORTOS_ORIGEM.includes(p.porto_origem.toUpperCase()))?'block':'none'};margin-top:6px;"></div>
          <div class="form-group"><label class="form-label">Porto Destino</label>
            <select class="form-input" id="f_porto_destino">${gerarOptionsPortoDestino(p.porto_destino)}</select></div>
          <div class="form-group"><label class="form-label">Previsão de Embarque (ETD)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_etd" value="${esc(p.etd)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">ETA (Previsão de Chegada)</label>
            <input class="form-input highlight" type="date" onpaste="colarData(event,this)" id="f_eta" value="${esc(p.eta)}">
          </div>
          <div class="form-group"><label class="form-label">Data de Embarque (Efetiva)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_embarque" value="${esc(p.data_embarque)}"
              onchange="moverDataFuturaParaPrevisao('f_data_embarque','f_etd','Previsão de Embarque (ETD)');atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Free Time (dias)</label>
            <input class="form-input" type="number" id="f_free_time" value="${p.free_time||''}" placeholder="Preencher após emissão do BL"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">🚛 Carregamento</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Agendamento</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_agendamento" value="${esc(p.data_agendamento)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Data Carregamento</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_carregamento" value="${esc(p.data_carregamento)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group" style="position:relative"><label class="form-label">Transportadora</label>
            <input class="form-input" id="f_transportadora" value="${esc(p.transportadora)}" autocomplete="off"
              oninput="autocompletarContato(this,'TRANSPORTADORA','transportadora-dropdown')">
            <div id="transportadora-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group"><label class="form-label">Placa</label>
            <input class="form-input" id="f_placa" value="${esc(p.placa)}"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">⚓ Chegada & Demurrage</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Data Chegada</label>
            <input class="form-input highlight" type="date" onpaste="colarData(event,this)" id="f_data_chegada" value="${esc(p.data_chegada)}"
              onchange="moverDataFuturaParaPrevisao('f_data_chegada','f_eta','ETA (Previsão de Chegada)');atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Presença de Carga</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_presenca" value="${esc(p.data_presenca)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Demurrage Vence</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_demurrage_vencimento" value="${esc(p.demurrage_vencimento)}" style="color:var(--err);font-weight:600;" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Data Devolução</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_devolucao_vazio" value="${esc(p.data_devolucao_vazio)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Valor Demurrage (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_demurrage_valor" value="${exibirMoeda(p.demurrage_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this);atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Demurrage Pago?</label>
            <select class="form-input" id="f_demurrage_pago">
              <option value="false" ${!p.demurrage_pago?'selected':''}>Não</option>
              <option value="true"  ${p.demurrage_pago?'selected':''}>Sim ✓</option>
            </select></div>
        </div>
        <div id="demur-info-wrap">${demurInfo}</div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">💾 Salvar</button>
      </div>
    </div>

    <!-- ABA: DOCUMENTOS -->
    <div class="tab-pane" id="pane-documentos">
      <div class="form-section">
        <div class="form-section-title">🔢 Números de Referência</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">HBL</label>
            <input class="form-input" id="f_hbl" value="${esc(p.hbl)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">MBL</label>
            <input class="form-input" id="f_mbl" value="${esc(p.mbl)}"></div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Containers</label>
            <div id="multi-containers-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px;"></div>
            <button type="button" onclick="adicionarContainer()" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:6px 14px;font-size:12px;color:var(--ac);cursor:pointer;font-weight:600;">+ Adicionar Container</button>
            <input type="hidden" id="f_containers_json">
            <input type="hidden" id="f_container" value="${esc(p.container||'')}">
            <input type="hidden" id="f_tipo_container" value="${esc(p.tipo_container||'40HC')}">
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">⚓ CE Mercante</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">CE Master</label>
            <input class="form-input" id="f_ce_master" value="${esc(p.ce_master)}"></div>
          <div class="form-group"><label class="form-label">CE House</label>
            <input class="form-input" id="f_ce_house" value="${esc(p.ce_house)}"></div>
          <div class="form-group"><label class="form-label">Data Embarque (CE)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_ce_data_embarque" value="${esc(p.ce_data_embarque)}"></div>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-top:6px;">Ao subir o CE Mercante na extração por IA, os campos Navio e Armador (aba Booking &amp; Embarque) são atualizados automaticamente — em caso de transbordo no exterior, o navio de conexão/último navio.</div>
      </div>
      <div class="form-section">
        <div class="form-section-title">📋 DI e Parametrização</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Data Registro DI</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_registro_di" value="${esc(p.data_registro_di)}" onchange="aplicarRegraParametrizacaoVerde();atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Número DI</label>
            <input class="form-input" id="f_numero_di" value="${esc(p.numero_di)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Canal</label>
            <select class="form-input" id="f_canal" onchange="aplicarRegraParametrizacaoVerde();atualizarFaseEmTempoReal()">
              <option value="">—</option>
              <option value="VERDE"   ${p.canal==='VERDE'?'selected':''}>🟢 Verde</option>
              <option value="AMARELO" ${p.canal==='AMARELO'?'selected':''}>🟡 Amarelo</option>
              <option value="VERMELHO"${p.canal==='VERMELHO'?'selected':''}>🔴 Vermelho</option>
            </select></div>
          <div class="form-group"><label class="form-label">Data Parametrização</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_parametrizacao" value="${esc(p.data_parametrizacao)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Data Liberação</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_liberacao" value="${esc(p.data_liberacao)}" onchange="atualizarFaseEmTempoReal()" placeholder="Data do desembaraço (CI)"></div>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-top:6px;">Canal Verde preenche a Data Parametrização automaticamente com a Data de Registro da DI (sem conferência separada). Data Liberação é a Data do Desembaraço informada no Comprovante de Importação.</div>
      </div>
      <div class="form-section">
        <div class="form-section-title">🧾 Faturamento</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">NF Entrada Nº</label>
            <input class="form-input" id="f_nf_entrada_numero" value="${esc(p.nf_entrada_numero)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">NF Entrada Data</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_nf_entrada_data" value="${esc(p.nf_entrada_data)}"></div>
          <div class="form-group"><label class="form-label">NF Entrada Valor (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_nf_entrada_valor" value="${exibirMoeda(p.nf_entrada_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">NF Saída Nº</label>
            <input class="form-input" id="f_nf_saida_numero" value="${esc(p.nf_saida_numero)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">NF Saída Data</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_nf_saida_data" value="${esc(p.nf_saida_data)}"></div>
          <div class="form-group"><label class="form-label">NF Saída Valor (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_nf_saida_valor" value="${exibirMoeda(p.nf_saida_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">📎 Arquivos do Processo (GED)</div>
        <div id="ged-upload-area" style="border:2px dashed var(--border);border-radius:8px;padding:20px;text-align:center;cursor:pointer;margin-bottom:12px;" onclick="document.getElementById('ged-file-input').click()">
          <input type="file" id="ged-file-input" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none" onchange="uploadArquivosGed(this.files)">
          <div style="color:var(--muted);font-size:13px;">📤 Clique para enviar PDF, JPEG ou PNG</div>
          <div style="color:var(--dim);font-size:11px;margin-top:4px;">Múltiplos arquivos permitidos</div>
        </div>
        <div id="ged-lista-arquivos" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">💾 Salvar</button>
      </div>
    </div>

    <!-- ABA: HISTÓRICO -->
    <div class="tab-pane" id="pane-historico">
      <div id="historico-lista">
        ${isNovo
          ? '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Salve o processo para começar a registrar alterações.</div></div>'
          : '<div style="font-size:11px;color:var(--dim);">Carregando histórico...</div>'
        }
      </div>
    </div>
  `;

  renderPagamentoCampos();
  atualizarTotalCustosReais();
  // Inicializar multi-containers
  try{
    if(p.containers_json) _containers = JSON.parse(p.containers_json);
    else if(p.container) _containers = [{numero:p.container||'', tipo:p.tipo_container||'40HC', lacre:p.lacre||''}];
    else _containers = [{numero:'', tipo:'40HC', lacre:''}];
  }catch(e){ _containers = [{numero:'', tipo:'40HC', lacre:''}]; }
  renderMultiContainers();
  // Inicializar multi-produtos (com retrocompatibilidade do campo "produto" legado em texto único)
  try{
    if(p.produtos_json) _produtos = JSON.parse(p.produtos_json);
    else if(p.produto) _produtos = [{descricao:p.produto||'', quantidade:''}];
    else _produtos = [{descricao:'', quantidade:''}];
  }catch(e){ _produtos = [{descricao:'', quantidade:''}]; }
  renderMultiProdutos();
  if(!isNovo){ carregarArquivosGed(p.id); carregarHistorico(p.id); }
  else document.getElementById('ged-lista-arquivos').innerHTML = '<div style="font-size:11px;color:var(--dim);">Salve o processo antes de enviar arquivos.</div>';
}

// ════════════════════════════════════════════════════════════════
// CUSTOS REAIS — apuração de lucro por processo, item a item
// ════════════════════════════════════════════════════════════════
// Config/cálculo (CUSTOS_REAIS_CONFIG, calcularCustoCotadoItem,
// calcularCustoRealTotal) vivem em controle-core.js — aqui só o HTML da aba
// e a coleta/salvamento dos campos, seguindo o mesmo padrão de "aba com
// botão de salvar próprio" que a aba Fechamento já usa (ela só lê, não tem
// campo editável; esta aba tem campos, então precisa de coletar+salvar).
function renderCustosReaisTab(p){
  const reais = p.real_json || {};
  const cotado = (p.estimativa_json && p.estimativa_json.custos_cotados_json) || null;
  const cambioDefault = p.real_cambio ?? (cotado && cotado.cambio) ?? p.pi_cambio ?? _cambio.USD;

  const gruposHtml = CUSTOS_REAIS_CONFIG.map(g => {
    const itensHtml = g.itens.map(item => {
      const valorCotado = calcularCustoCotadoItem(item, cotado);
      const valorSalvo = reais[item.id];
      // Pré-preenche com o real já salvo; sem isso, com o cotado (quando o
      // processo veio de uma cotação aprovada); sem cotado nem real, começa
      // vazio — é o caso normal de processo criado direto no Controle.
      const temSalvo = valorSalvo != null && valorSalvo !== '';
      const valorInicial = temSalvo ? valorSalvo : (valorCotado != null ? valorCotado.toFixed(2) : '');
      const simboloUnidade = item.unidade === 'USD' ? 'US$' : 'R$';
      const hintCotado = valorCotado != null
        ? ` <span style="font-weight:400;color:var(--dim);">· Cotado: ${simboloUnidade} ${valorCotado.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`
        : '';
      return `<div class="form-group">
        <label class="form-label">${item.label} (${simboloUnidade})${hintCotado}</label>
        <input class="form-input" type="number" step="0.01" id="f_cr_${item.id}" value="${valorInicial}" placeholder="0,00" oninput="atualizarTotalCustosReais()">
      </div>`;
    }).join('');
    return `<div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">${g.grupo}</div>
      <div class="form-grid">${itensHtml}</div>
    </div>`;
  }).join('');

  return `<div class="form-group" style="max-width:260px;margin-bottom:16px;">
      <label class="form-label">Câmbio USD usado nestes custos</label>
      <input class="form-input" type="number" step="0.0001" id="f_cr_cambio" value="${cambioDefault||''}" placeholder="${_cambio.USD.toFixed(4)}" oninput="atualizarTotalCustosReais()">
    </div>
    ${gruposHtml}
    <div id="custos-reais-total" style="margin-top:6px;"></div>`;
}

// Lê os valores atualmente digitados nos campos f_cr_* (sem depender de
// _editando estar sincronizado ainda) — usado tanto pra atualizar o total ao
// vivo quanto pra montar o que vai salvo em real_json/real_cambio. O câmbio
// vem separado (real_cambio é coluna própria, não fica dentro do real_json)
// pra bater com a migration 0004_add_custos_reais_processo.sql, que já
// criou as duas colunas assim.
function coletarCustosReaisDoForm(){
  const obj = {};
  custosReaisItensFlat().forEach(item => {
    const el = document.getElementById('f_cr_'+item.id);
    if(el && el.value !== '') obj[item.id] = parseFloat(el.value);
  });
  return obj;
}

function coletarCambioCustosReaisDoForm(){
  const el = document.getElementById('f_cr_cambio');
  return (el && el.value !== '') ? parseFloat(el.value) : null;
}

// Recalcula e redesenha o resumo (Custo Total Real / Lucro Real) conforme o
// usuário digita, sem precisar salvar — mesmo padrão do renderPagamentoInfoLive().
function atualizarTotalCustosReais(){
  if(!_editando) return;
  const wrap = document.getElementById('custos-reais-total');
  if(!wrap) return;
  const snapshot = { ..._editando, real_json: coletarCustosReaisDoForm(), real_cambio: coletarCambioCustosReaisDoForm() };
  const custosReais = calcularCustoRealTotal(snapshot);
  if(!custosReais){ wrap.innerHTML = ''; return; }
  const nfSaida = parseFloat(snapshot.nf_saida_valor);
  const temNf = !isNaN(nfSaida) && nfSaida > 0;
  const lucro = temNf ? (nfSaida - custosReais.total) : null;
  const r2 = v => 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  wrap.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:12px;display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Total Real (${custosReais.count} ${custosReais.count===1?'item':'itens'} lançados)</span><strong>${r2(custosReais.total)}</strong></div>
    ${temNf
      ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">Lucro Real (NF Saída − Custo Real Total)</span><strong style="color:${lucro>=0?'var(--ok)':'var(--err)'}">${r2(lucro)}</strong></div>`
      : `<div style="color:var(--dim);">Preencha a NF Saída na aba Documentos pra ver o lucro real aqui.</div>`}
  </div>`;
}

// Salva só os custos reais — segue o mesmo mecanismo de patchFields das
// outras abas (salvarProcesso em controle-core.js), então não sobrescreve
// nenhum outro campo alterado por outra pessoa nesse meio tempo.
async function salvarCustosReaisTab(){
  if(!_editando) return;
  _editando.real_json = coletarCustosReaisDoForm();
  _editando.real_cambio = coletarCambioCustosReaisDoForm();
  const ok = await salvarProcesso(_editando, ['real_json', 'real_cambio']);
  if(ok) atualizarTotalCustosReais();
}

// ════════════════════════════════════════════════════════════════
// HISTÓRICO — AUDITORIA DE ALTERAÇÕES
// ════════════════════════════════════════════════════════════════
// Marcador usado no campo "campo" de uma entrada de log pra indicar que ela
// não é uma alteração normal de campo, e sim o registro de "a IA leu este
// documento e preencheu estes campos" (ver extrairComIA() e o render abaixo).
const LOG_CAMPO_LEITURA_IA = '📄_leitura_ia';
const LABELS_CAMPOS_IA = {
  referencia:'Referência', fornecedor:'Fornecedor/Exportador', cliente:'Cliente',
  itens:'Itens/Produtos', pi_numero:'Nº PI', pi_data:'Data PI', pi_valor_usd:'Valor PI (USD)',
  pi_incoterm:'Incoterm', pi_pagamento:'Forma de pagamento', etd:'ETD', eta:'ETA',
  armador:'Armador', navio:'Navio', porto_origem:'Porto de origem', porto_destino:'Porto de destino',
  hbl:'HBL', mbl:'MBL', container:'Container', lacre:'Lacre', valor_frete:'Valor do frete',
  moeda_frete:'Moeda do frete', numero_di:'Nº DI', data_registro_di:'Data registro DI',
  canal:'Canal', data_liberacao:'Data liberação', ci_numero:'Nº CI', ci_valor_usd:'Valor CI (USD)',
  ci_data:'Data CI', data_chegada:'Data de chegada', ce_master:'CE Master', ce_house:'CE House',
  ce_data_embarque:'Data embarque (CE)', nf_entrada_numero:'Nº NF entrada', nf_entrada_data:'Data NF entrada',
  nf_entrada_valor:'Valor NF entrada', nf_saida_numero:'Nº NF saída', nf_saida_data:'Data NF saída',
  nf_saida_valor:'Valor NF saída', data_devolucao_vazio:'Data devolução vazio',
};
async function carregarHistorico(processoId){
  const lista = document.getElementById('historico-lista');
  if(!lista) return;
  lista.innerHTML = '<div style="font-size:11px;color:var(--dim);">Carregando histórico...</div>';
  try{
    const r = await fetch('/api/controle/v2/processo/'+processoId+'/log');
    const d = await r.json();
    if(!d.ok || !d.log.length){
      lista.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Nenhuma alteração registrada ainda</div></div>';
      return;
    }
    lista.innerHTML = '<div class="log-list">' + d.log.map(l=>{
      const isLeituraIA = l.campo === LOG_CAMPO_LEITURA_IA;
      const texto = isLeituraIA
        ? ` leu o documento <strong>${esc(l.valor_antes||'?')}</strong> com IA e preencheu: ${esc(l.valor_depois||'—')}`
        : ` alterou <strong>${esc(l.campo||'')}</strong>: ${esc(String(l.valor_antes||'—'))} → ${esc(String(l.valor_depois||'—'))}`;
      return `<div class="log-item">
        <div class="log-avatar">${isLeituraIA ? '🤖' : esc((l.usuario||'?').slice(0,2).toUpperCase())}</div>
        <div class="log-content">
          <span class="log-user">${esc(l.usuario||'?')}</span>
          <span class="log-text">${texto}</span>
          <div class="log-time">${l.created_at ? new Date(l.created_at).toLocaleString('pt-BR') : ''}</div>
        </div>
      </div>`;
    }).join('') + '</div>';
  }catch(e){
    lista.innerHTML = '<div style="font-size:11px;color:var(--err);">Erro ao carregar histórico.</div>';
  }
}

// ════════════════════════════════════════════════════════════════
// GED — UPLOAD E GESTÃO DE ARQUIVOS DO PROCESSO
// ════════════════════════════════════════════════════════════════
async function carregarArquivosGed(processoId){
  const lista = document.getElementById('ged-lista-arquivos');
  if(!lista) return;
  lista.innerHTML = '<div style="font-size:11px;color:var(--dim);">Carregando...</div>';
  try{
    const r = await fetch('/api/controle/v2/arquivos/'+processoId);
    const d = await r.json();
    if(!d.ok || !d.arquivos.length){
      lista.innerHTML = '<div style="font-size:11px;color:var(--dim);">Nenhum arquivo enviado ainda.</div>';
      return;
    }
    lista.innerHTML = d.arquivos.map(a=>{
      const icon = a.nome.toLowerCase().endsWith('.pdf') ? '📄' : '🖼️';
      const tamanho = a.tamanho ? (a.tamanho/1024).toFixed(0)+' KB' : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;">
        <span>${icon}</span>
        <a href="${a.url}" target="_blank" style="flex:1;color:var(--ac);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.nome}</a>
        <span style="color:var(--dim);font-size:10px;">${tamanho}</span>
        <button onclick="excluirArquivoGed('${a.id}','${processoId}')" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:13px;padding:2px 6px;" title="Excluir">✕</button>
      </div>`;
    }).join('');
  }catch(e){
    lista.innerHTML = '<div style="font-size:11px;color:var(--err);">Erro ao carregar arquivos.</div>';
  }
}

async function uploadArquivosGed(files){
  const p = _editando;
  if(!p || !p.id){ showToast('Salve o processo antes de enviar arquivos','warn'); return; }
  if(!files || !files.length) return;

  const lista = document.getElementById('ged-lista-arquivos');
  for(const file of files){
    const tiposPermitidos = ['application/pdf','image/jpeg','image/jpg','image/png'];
    if(!tiposPermitidos.includes(file.type)){
      showToast(`Tipo não permitido: ${file.name}`,'err');
      continue;
    }
    if(file.size > 15*1024*1024){
      showToast(`Arquivo muito grande (máx 15MB): ${file.name}`,'err');
      continue;
    }
    try{
      const base64 = await new Promise((res,rej)=>{
        const reader = new FileReader();
        reader.onload = ()=>res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      showToast(`Enviando ${file.name}...`,'ok');
      const r = await fetch('/api/controle/v2/arquivos', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          processo_id: p.id,
          nome: file.name,
          tipo: file.type,
          base64,
        })
      });
      const d = await r.json();
      if(!d.ok) showToast('Erro ao enviar '+file.name+': '+(d.erro||''),'err');
    }catch(e){
      showToast('Erro ao enviar '+file.name,'err');
    }
  }
  carregarArquivosGed(p.id);
}

async function excluirArquivoGed(arquivoId, processoId){
  if(!confirm('Excluir este arquivo?')) return;
  try{
    const r = await fetch('/api/controle/v2/arquivos/'+arquivoId, { method:'DELETE' });
    const d = await r.json();
    if(d.ok){ showToast('Arquivo excluído','ok'); carregarArquivosGed(processoId); }
    else showToast('Erro ao excluir','err');
  }catch(e){ showToast('Erro ao excluir','err'); }
}

// ════════════════════════════════════════════════════════════════
// ATUALIZAÇÃO AUTOMÁTICA DE FASE EM TEMPO REAL
// ════════════════════════════════════════════════════════════════

// Quando o canal sai VERDE, não há etapa de conferência separada — a
// parametrização ocorre na mesma data do registro da DI. Só preenche
// automaticamente se o campo ainda estiver vazio, para não sobrescrever
// uma data de parametrização já informada manualmente (ex: Amarelo/Vermelho
// que depois virou Verde após reanálise, mas já tinha data própria).
function aplicarRegraParametrizacaoVerde(){
  const canalEl = document.getElementById('f_canal');
  const paramEl = document.getElementById('f_data_parametrizacao');
  const regEl   = document.getElementById('f_data_registro_di');
  if(!canalEl || !paramEl || !regEl) return;
  if(canalEl.value === 'VERDE' && !paramEl.value && regEl.value){
    paramEl.value = regEl.value;
  }
}

// Datas "efetivas" (Data de Embarque, Data Chegada, Data Prontidão Real)
// registram algo que JÁ ACONTECEU. Se alguém digitar ali uma data no
// FUTURO — muito comum: o booking chega com uma previsão e a pessoa
// preenche direto no campo "de verdade" por hábito, sem notar que existe um
// campo de previsão separado — isso quase sempre é engano. Em vez de só
// avisar (como este arquivo fazia antes, só pra Data Chegada), move o valor
// automaticamente pro campo de previsão correspondente (ETD/ETA/Previsão
// Prontidão) e limpa o campo efetivo, porque por definição ele não pode ter
// uma data que ainda não aconteceu. Isso evita o processo aparecer como "já
// embarcado" ou "já chegou" antes da hora só por causa do campo errado —
// consistente com a 2ª camada de proteção que já existe em calcularFase().
function moverDataFuturaParaPrevisao(idEfetivo, idPrevisao, labelPrevisao){
  const elEfetivo = document.getElementById(idEfetivo);
  const elPrevisao = document.getElementById(idPrevisao);
  if(!elEfetivo || !elPrevisao || !elEfetivo.value) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const digitada = new Date(elEfetivo.value+'T00:00:00');
  if(digitada <= hoje) return false;

  const valor = elEfetivo.value;
  elEfetivo.value = '';
  elPrevisao.value = valor;
  showToast(`📅 Essa data ainda não aconteceu (é futura) — movida para "${labelPrevisao}" automaticamente.`, 'info');
  return true;
}

function atualizarFaseEmTempoReal(){
  if(!_editando) return;

  // Coletar valores atuais do form
  const campos = [
    'data_embarque','hbl','mbl','etd','eta','booking_numero',
    'data_chegada','data_presenca',
    'data_registro_di','numero_di',
    'canal','data_parametrizacao','data_liberacao',
    'nf_entrada_numero','nf_saida_numero',
    'data_agendamento','data_carregamento',
    'data_devolucao_vazio','demurrage_vencimento','free_time',
  ];

  const snapshot = {..._editando};
  campos.forEach(campo=>{
    const el = document.getElementById('f_'+campo);
    if(!el) return;
    const val = el.value?.trim()||null;
    snapshot[campo] = val||null;
  });
  // demurrage_valor usa máscara monetária — não pode ser lido como texto puro
  const valorDemurAtual = valorMoeda('f_demurrage_valor');
  if(valorDemurAtual!=null) snapshot.demurrage_valor = valorDemurAtual;

  const novaFase = calcularFase(snapshot);

  // Atualizar badge no header do modal
  const badge = document.getElementById('modal-fase-badge');
  if(badge){
    const fase = FASES.find(f=>f.id===novaFase)||FASES[0];
    badge.innerHTML = `<span class="fase-badge fase-${novaFase}">${fase.icon} ${fase.label}</span>`;
  }

  // Atualizar _editando.fase para que ao salvar já venha correto
  _editando._fasePrevista = novaFase;

  // Recalcular e redesenhar o bloco "Cálculo do Demurrage" com os valores
  // atuais do formulário — antes este bloco só era montado uma vez, ao abrir
  // o modal, e ficava com dados desatualizados ao editar Data Devolução etc.
  const demurWrap = document.getElementById('demur-info-wrap');
  if(demurWrap) demurWrap.innerHTML = renderDemurInfo(snapshot);

  // Atualizar a timeline
  const faseIdx = FASES.findIndex(f=>f.id===novaFase);
  document.querySelectorAll('.tl-dot').forEach((dot, i)=>{
    dot.className = 'tl-dot';
    if(i < faseIdx) dot.classList.add('done'), dot.textContent='✓';
    else if(i===faseIdx) dot.classList.add('active'), dot.textContent=FASES[i].icon;
    else dot.textContent=FASES[i].icon;
  });
  document.querySelectorAll('.tl-line').forEach((line, i)=>{
    line.className = 'tl-line';
    if(i < faseIdx) line.classList.add('done');
  });
}

function trocarAba(id){
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  const tab = document.getElementById('tab-'+id);
  const pane = document.getElementById('pane-'+id);
  if(tab)  tab.classList.add('active');
  if(pane) pane.classList.add('active');
}

// ════════════════════════════════════════════════════════════════
// PAGAMENTO
// ════════════════════════════════════════════════════════════════
function renderPagamentoCampos(){
  const tipo = document.getElementById('f_pi_pagamento')?.value;
  const p = _editando || {};
  const el = document.getElementById('pagamento-campos');
  if(!el) return;
  if(!tipo){ el.innerHTML=''; return; }

  let html = '<div class="form-grid" style="margin-top:12px;">';
  if(tipo==='VISTA'){
    html+=`<div class="form-group"><label class="form-label">Data Pagamento</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_entrada" value="${esc(p.pi_data_entrada)}"></div>`;
  } else if(tipo==='PRAZO'){
    html+=`<div class="form-group"><label class="form-label">Prazo (dias)</label>
      <input class="form-input" type="number" id="f_pi_prazo_dias" value="${p.pi_prazo_dias||''}"></div>
      <div class="form-group"><label class="form-label">Data Pagamento</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_saldo" value="${esc(p.pi_data_saldo)}"></div>`;
  } else if(tipo==='ENTRADA_SALDO'){
    html+=`<div class="form-group"><label class="form-label">% Entrada</label>
      <input class="form-input" type="number" id="f_pi_entrada_pct" value="${p.pi_entrada_pct||30}" min="1" max="99" oninput="renderPagamentoInfoLive()"></div>
      <div class="form-group"><label class="form-label">Data Entrada</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_entrada" value="${esc(p.pi_data_entrada)}"></div>
      <div class="form-group"><label class="form-label">Data Saldo</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_saldo" value="${esc(p.pi_data_saldo)}"></div>
      <div class="form-group"><label class="form-label">Câmbio Entrada (R$)</label>
      <input class="form-input" type="number" step="0.0001" id="f_pi_cambio_entrada" value="${p.pi_cambio_entrada||''}" placeholder="${_cambio.USD.toFixed(4)}" oninput="renderPagamentoInfoLive()"></div>
      <div class="form-group"><label class="form-label">Câmbio Saldo (R$)</label>
      <input class="form-input" type="number" step="0.0001" id="f_pi_cambio_saldo" value="${p.pi_cambio_saldo||''}" placeholder="${_cambio.USD.toFixed(4)}" oninput="renderPagamentoInfoLive()"></div>`;
  }
  html+='</div>';
  el.innerHTML=html;
}

// Recalcula e redesenha o resumo de pagamento (pagamento-box) quando o usuário
// edita % de entrada ou os câmbios, sem precisar salvar/reabrir o modal.
function renderPagamentoInfoLive(){
  if(!_editando) return;
  const snapshot = {..._editando};
  const pct = document.getElementById('f_pi_entrada_pct')?.value;
  if(pct!=null && pct!=='') snapshot.pi_entrada_pct = pct;
  const ce = parseFloat(document.getElementById('f_pi_cambio_entrada')?.value) || null;
  const cs = parseFloat(document.getElementById('f_pi_cambio_saldo')?.value) || null;
  if(ce!=null) snapshot.pi_cambio_entrada = ce;
  if(cs!=null) snapshot.pi_cambio_saldo = cs;
  const box = document.querySelector('#pane-financeiro .pagamento-box');
  const novoHtml = renderPagamentoInfo(snapshot);
  if(box && box.parentElement) box.outerHTML = novoHtml || box.outerHTML;
}

function renderPagamentoInfo(p){
  if(!p.pi_pagamento||!p.pi_valor_usd) return '';
  const val = parseFloat(p.pi_valor_usd)||0;
  const brl = val * _cambio.USD;
  let rows = '';
  if(p.pi_pagamento==='VISTA'){
    rows=`<div class="pagamento-row"><span>Pagamento à vista</span><span>USD ${val.toFixed(2)}</span></div>
    <div class="pagamento-row"><span>Estimativa BRL</span><span>R$ ${brl.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>`;
  } else if(p.pi_pagamento==='PRAZO'){
    rows=`<div class="pagamento-row"><span>Pagamento a prazo (${p.pi_prazo_dias||0}d)</span><span>USD ${val.toFixed(2)}</span></div>`;
  } else if(p.pi_pagamento==='ENTRADA_SALDO'){
    const pct = parseFloat(p.pi_entrada_pct||30)/100;
    const ent = val*pct; const sld = val*(1-pct);
    const cambioEnt = parseFloat(p.pi_cambio_entrada) || _cambio.USD;
    const cambioSld = parseFloat(p.pi_cambio_saldo)   || _cambio.USD;
    const entBRL = ent*cambioEnt; const sldBRL = sld*cambioSld;
    rows=`<div class="pagamento-row"><span>Entrada (${p.pi_entrada_pct||30}%) · câmbio ${cambioEnt.toLocaleString('pt-BR',{minimumFractionDigits:4})}</span><span>USD ${ent.toFixed(2)} · R$ ${entBRL.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
    <div class="pagamento-row"><span>Saldo (${100-(p.pi_entrada_pct||30)}%) · câmbio ${cambioSld.toLocaleString('pt-BR',{minimumFractionDigits:4})}</span><span>USD ${sld.toFixed(2)} · R$ ${sldBRL.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
    <div class="pagamento-row"><span>Total</span><span>USD ${val.toFixed(2)} · R$ ${(entBRL+sldBRL).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>`;
  }
  return `<div class="pagamento-box" style="margin-top:12px;">${rows}</div>`;
}

// ════════════════════════════════════════════════════════════════
// COLETAR E SALVAR
// ════════════════════════════════════════════════════════════════
function marcarPendenciaRevisada(){
  const el = document.getElementById('f_pendencia_revisao');
  if(el) el.value = '';
  const banner = document.getElementById('alerta-pendencia');
  if(banner) banner.style.display = 'none';
  coletarESalvar();
  showToast('✓ Pendência marcada como revisada', 'ok');
}

