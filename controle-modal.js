// controle-modal.js
//
// Painel lateral do processo: abrir/fechar, render das abas (timeline, alertas, conteÃÂÃÂºdo), histÃÂÃÂ³rico, arquivos GED, parametrizaÃÂÃÂ§ÃÂÃÂ£o, troca de aba, pagamento (PI).
//
// Parte do controle_v2.html, extraÃÂÃÂ­do do <script> ÃÂÃÂºnico original pra
// facilitar manutenÃÂÃÂ§ÃÂÃÂ£o. Carregado via <script src> junto com os outros
// mÃÂÃÂ³dulos (ver controle_v2.html) ÃÂ¢ÃÂÃÂ nÃÂÃÂ£o ÃÂÃÂ© um ES module, entÃÂÃÂ£o todo
// estado (let/const de topo) e funÃÂÃÂ§ÃÂÃÂµes aqui continuam visÃÂÃÂ­veis pros
// outros arquivos, exatamente como estavam quando tudo era um sÃÂÃÂ³
// <script>. controle-core.js precisa carregar ANTES dos demais (ÃÂÃÂ©
// quem declara o estado global: _processos, _user, FASES etc.).
//
// Whitelist de armadores (ocean carriers) conhecidos, para alertar quando o campo Armador
// vier preenchido com o nome do emissor de um House B/L (agente de carga/NVOCC) em vez do
// armador real. Não bloqueia o salvamento, é só um aviso visual (ver #407/#408).
const ARMADORES_CONHECIDOS = ['MSC','CMA CGM','CMA-CGM','COSCO','MAERSK','HAPAG-LLOYD','HAPAG LLOYD','ONE','OCEAN NETWORK EXPRESS','EVERGREEN','YANG MING','PIL','PACIFIC INTERNATIONAL LINES','ZIM','HMM','WAN HAI','OOCL','APL','ANL','SITC','KMTC','TS LINES','IRIS LINES'];
function armadorReconhecido(valor){
  if(!valor || !valor.trim()) return true; // campo vazio não gera aviso
  const v = valor.toUpperCase();
  return ARMADORES_CONHECIDOS.some(a => v.includes(a));
}
function verificarArmadorConhecido(el){
  const warn = document.getElementById('f_armador_warn');
  if(!warn) return;
  warn.style.display = armadorReconhecido(el.value) ? 'none' : 'inline';
}

function abrirNovo(){
  // _camposIA rastreia, NESTA sessÃÂÃÂ£o de ediÃÂÃÂ§ÃÂÃÂ£o, quais campos foram preenchidos
  // pela ÃÂÃÂºltima leitura de IA (nÃÂÃÂ£o pelo usuÃÂÃÂ¡rio digitando) ÃÂ¢ÃÂÃÂ usado por
  // extrairComIA() pra saber se pode corrigir um campo jÃÂÃÂ¡ preenchido quando
  // um documento novo (ex: o certo, depois de um errado) trouxer outro valor.
  // NÃÂÃÂ£o ÃÂÃÂ© salvo no banco (propositalmente prefixado com _, igual _fasePrevista
  // e _savedAt jÃÂÃÂ¡ removidos antes do save) ÃÂ¢ÃÂÃÂ reseta a cada vez que o processo
  // ÃÂÃÂ© reaberto, o que cobre o caso real relatado (corrigir dentro da mesma
  // sessÃÂÃÂ£o de ediÃÂÃÂ§ÃÂÃÂ£o, logo apÃÂÃÂ³s perceber o documento errado).
  _editando = { fase:'PI', free_time:21, _camposIA: {} };
  _editandoOriginal = {};
  renderModal();
}

async function abrirProcesso(id){
  const proc = _processos.find(p=>p.id===id);
  if(!proc) return;
  await garantirProcessoCompleto(proc);
  _editando = {...proc, _camposIA: {}};
    _parcelas = []; // task #340b: força recarregar parcelas do processo certo ao trocar de processo
  _editandoOriginal = {...proc};
  renderModal();
  // URL por processo (task #59) ÃÂ¢ÃÂÃÂ deep link/bookmark + botÃÂÃÂ£o voltar do navegador
  const novaUrl = _baseUrlPath.replace(/\/$/,'') + '/' + encodeURIComponent(proc.referencia);
  if(location.pathname !== novaUrl) history.pushState({processoId:proc.id}, '', novaUrl);
}

function copiarReferencia(){
  const ref = _editando && _editando.referencia;
  if(!ref) return;
  navigator.clipboard.writeText(ref).then(function(){
    showToast('Referência copiada: ' + ref, 'ok');
  }, function(){
    showToast('Não foi possível copiar — copie manualmente: ' + ref, 'err');
  });
}

function fecharModal(){
  _editando = null;
  _painelDirty = false;
  document.getElementById('modal-bg').classList.remove('open');
  // Volta a URL pra tela de baixo (/controle ou /financeiro) sem recarregar a pÃÂÃÂ¡gina.
  if(location.pathname !== _baseUrlPath) history.pushState(null, '', _baseUrlPath);
}

// Se o usuÃÂÃÂ¡rio editar manualmente um campo que a IA tinha preenchido antes,
// esse campo "vira dele" ÃÂ¢ÃÂÃÂ deixa de poder ser sobrescrito automaticamente por
// uma leitura de IA seguinte, protegendo a correÃÂÃÂ§ÃÂÃÂ£o manual do usuÃÂÃÂ¡rio. SÃÂÃÂ³
// reage a eventos reais do teclado/mouse: setar .value via JS (como a prÃÂÃÂ³pria
// extraÃÂÃÂ§ÃÂÃÂ£o faz) nÃÂÃÂ£o dispara 'input', entÃÂÃÂ£o isso nunca conflita com a IA.
document.addEventListener('input', function(e){
  if(!_editando || !_editando._camposIA) return;
  const id = e.target && e.target.id;
  if(!id || !id.startsWith('f_')) return;
  const campo = id.slice(2);
  if(_editando._camposIA[campo]) delete _editando._camposIA[campo];
});

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// MODAL ÃÂ¢ÃÂÃÂ RENDER
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function renderModal(){
  const p = _editando;
  const isNovo = !p.id;
  _painelDirty = false; // painel acabou de (re)carregar do zero — ver ESC em controle-core.js
  const fase = faseParaExibir(p);

  document.getElementById('modal-title').textContent = isNovo ? 'Novo Processo' : p.referencia;
  const btnCopiarRef = document.getElementById('btn-copiar-ref');
  if(btnCopiarRef) btnCopiarRef.style.display = isNovo ? 'none' : '';
  document.getElementById('modal-fase-badge').innerHTML = `<span class="fase-badge fase-${fase.id}">${fase.icon} ${fase.label}</span>`;
  document.getElementById('modal-bg').classList.add('open');


  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ABAS ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  const TABS = [
    {id:'identificacao', label:'📄 Identificação'},
    {id:'financeiro',    label:'💰 Financeiro'},
    {id:'fechamento',    label:'📐 Fechamento'},
    {id:'custosreais',   label:'💵 Custos Reais'},
    {id:'vendas',        label:'🧾 Vendas'},
    {id:'logistica',     label:'🚢 Logística'},
    {id:'demurrage',    label:'⚓ Demurrage'},
    {id:'documentos',    label:'📋 Documentos'},
    {id:'conferencia',   label:'🔍 Conferência'},
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

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ALERTAS ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  const alertas = verificarAlertas(p, false);
  const alertasHtml = alertas.map(a=>
    `<div style="padding:8px 12px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:8px;font-size:12px;color:var(--err);margin-bottom:8px;font-weight:600;">🚨 ${esc(a.titulo)}: ${esc(a.mensagem)}</div>`
  ).join('');

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ CONTEÃÂÃÂDO DAS ABAS ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  const finInfo = p.pi_pagamento ? renderPagamentoInfo(p) : '';

  // ConfirmaÃÂÃÂ§ÃÂÃÂ£o visual demurrage (calculada dinamicamente ÃÂ¢ÃÂÃÂ ver renderDemurInfo)
  let demurInfo = renderDemurInfo(p);

  // Confirmação visual armazenagem (calculada dinamicamente — ver renderArmazenInfo)
  let armazenInfo = renderArmazenInfo(p);

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ TRAVA DE PROCESSO ("Fechar Processo") ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  // Quando fechado, o conteÃÂÃÂºdo do modal fica visualmente desabilitado
  // (opacity + pointer-events:none) dentro do wrapper abaixo ÃÂ¢ÃÂÃÂ a validaÃÂÃÂ§ÃÂÃÂ£o
  // que de fato impede a ediÃÂÃÂ§ÃÂÃÂ£o ÃÂÃÂ© no servidor (ver server.js: POST /api/
  // controle/v2/processo), isto aqui ÃÂÃÂ© sÃÂÃÂ³ pra nÃÂÃÂ£o deixar o usuÃÂÃÂ¡rio tentar
  // editar um processo travado sem perceber.
  const bloqueado = !!p.fechado;
  const podeDestravar = _user && _user.role === 'gerente';
  const bannerTrava = bloqueado
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:rgba(0,0,0,.04);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text);"><strong>🔒 Processo fechado</strong>${p.fechado_em?` em ${new Date(p.fechado_em).toLocaleString('pt-BR')}`:''}${p.fechado_por?` por ${esc(p.fechado_por)}`:''} — edição travada.</div>
        ${podeDestravar ? `<button type="button" class="btn btn-outline" onclick="reabrirProcesso('${p.id}')">🔓 Reabrir para editar</button>` : `<span style="font-size:11px;color:var(--muted);">Só um gerente pode reabrir.</span>`}
      </div>`
    : '';

  // ── CANCELAMENTO ("Cancelar Processo") ──────────────────────────
  // Igual à trava de fechado, mas pra processos que não vão pra frente e
  // precisam sumir das contagens operacionais sem perder o histórico
  // (pedido da Emanuelly, 21/08/2026). Não trava edição (diferente de
  // fechado) — só marca visualmente e some das telas de acompanhamento
  // ao vivo (Dashboard TV).
  const cancelado = !!p.cancelado;
  const souGerente = _user && _user.role === 'gerente';
  const podeReverterCancelamento = souGerente;
  const bannerCancelado = cancelado
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:rgba(100,116,139,.08);border:1px solid rgba(100,116,139,.3);border-radius:10px;padding:10px 14px;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text);"><strong>🚫 Processo cancelado</strong>${p.cancelado_em?` em ${new Date(p.cancelado_em).toLocaleString('pt-BR')}`:''}${p.cancelado_por?` por ${esc(p.cancelado_por)}`:''}${p.cancelado_motivo?` — ${esc(p.cancelado_motivo)}`:''}</div>
        ${podeReverterCancelamento ? `<button type="button" class="btn btn-outline" onclick="reverterCancelamento('${p.id}')">↩️ Reverter cancelamento</button>` : `<span style="font-size:11px;color:var(--muted);">Só um gerente pode reverter.</span>`}
      </div>`
    : '';

  // ── SOLICITAÇÃO DE CANCELAMENTO (aprovação por gerente) ──────────
  // Ampliação do mesmo dia (pedido da Emanuelly, depois que a Paula — que
  // é gerente — bateu num erro tentando cancelar direto): agora quem não
  // é gerente só "solicita" o cancelamento; aqui aparece o banner com o
  // pedido, e só um gerente vê os botões de aprovar/rejeitar.
  const solicitado = !!p.cancelamento_solicitado && !cancelado;
  const bannerSolicitacaoCancelamento = solicitado
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.3);border-radius:10px;padding:10px 14px;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text);"><strong>📨 Cancelamento solicitado</strong>${p.cancelamento_solicitado_em?` em ${new Date(p.cancelamento_solicitado_em).toLocaleString('pt-BR')}`:''}${p.cancelamento_solicitado_por?` por ${esc(p.cancelamento_solicitado_por)}`:''}${p.cancelado_motivo?` — ${esc(p.cancelado_motivo)}`:''}</div>
        ${souGerente ? `<div style="display:flex;gap:8px;">
            <button type="button" class="btn" onclick="aprovarCancelamento('${p.id}')" style="background:var(--err-bg);color:var(--err);border:1px solid rgba(220,38,38,.2);">✅ Aprovar cancelamento</button>
            <button type="button" class="btn btn-outline" onclick="rejeitarCancelamento('${p.id}')">✖️ Rejeitar</button>
          </div>` : `<span style="font-size:11px;color:var(--muted);">Aguardando aprovação de um gerente.</span>`}
      </div>`
    : '';

  document.getElementById('modal-body').innerHTML = `
    ${bannerTrava}
    ${bannerCancelado}
    ${bannerSolicitacaoCancelamento}
    <div id="modal-body-lockwrap" style="${bloqueado?'opacity:.85;pointer-events:none;user-select:none;':''}">
    <!-- ABA: IDENTIFICAÇÃO -->
    <div class="tab-pane active" id="pane-identificacao">
      <div class="timeline">${timeline}</div>
      ${alertasHtml}
      <!-- IA -->
      <div id="ia-drop-zone" class="form-section" style="background:rgba(26,127,212,.04);border:1px dashed rgba(26,127,212,.15);border-radius:10px;padding:14px 16px;margin-bottom:20px;transition:border-color .15s,background .15s;" ondragover="handleDragOverIA(event)" ondragleave="handleDragLeaveIA(event)" ondrop="handleDropIA(event)">
        <div class="form-section-title" style="border:none;margin-bottom:8px;">🤖 Extração com IA</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Envie uma PI, CI ou BL para preencher os campos automaticamente</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="file" id="ia-doc-file" accept=".pdf,.png,.jpg,.jpeg" multiple style="display:none" onchange="extrairComIA(this)">
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
              <option value="ACOMPANHAMENTO" ${p.finalidade==='ACOMPANHAMENTO'?'selected':''}>Acompanhamento (só acompanhamos)</option>
            </select>
            ${p.finalidade==='ACOMPANHAMENTO' ? '<div style="font-size:11px;color:#0369a1;margin-top:4px;line-height:1.35;">👁 Só acompanhamos: sem câmbio, NF ou DUIMP. Fica fora do Financeiro, Câmbio, Cliente/Medida, Reciclagem, DRE, Averbação e dos totais da TV (só aparece na lista Em Águas); sem alerta de demurrage.</div>' : ''}</div>
          <div class="form-group" style="position:relative"><label class="form-label">Fornecedor (Exportador)</label>
            <input class="form-input" id="f_fornecedor" value="${esc(p.fornecedor)}" placeholder="Ex: EUDEMON" autocomplete="off"
              oninput="autocompletarContato(this,'FORNECEDOR,EXPORTADOR','fornecedor-dropdown')">
            <div id="fornecedor-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group"><label class="form-label">Marca (Brand)</label>
            <input class="form-input" id="f_brand" value="${esc(p.brand)}" placeholder="Ex: Maxam — deixe em branco se marca = fornecedor">
          </div>
          <div class="form-group"><label class="form-label">ID no Conexos</label>
            <input class="form-input" id="f_conexos_id" value="${esc(p.conexos_id)}" placeholder="Nº/código deste processo no Conexos" title="Identificador do mesmo processo no Conexos Cloud — usado pela integração (em preparação) pra casar os dois sistemas">
            ${p.conexos_ultima_sync ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">Última sincronização: ${esc(new Date(p.conexos_ultima_sync).toLocaleString('pt-BR'))}</div>` : ''}
          </div>
          <div class="form-group"><label class="form-label" id="label-qtd-containers">Qtd. Containers (previsto)</label>
            <input class="form-input" type="number" min="0" step="1" id="f_qtd_containers_prevista" value="${p.qtd_containers_prevista ?? ''}" placeholder="Ex: 3 — preencha assim que souber, mesmo antes do booking">
            <div id="hint-qtd-containers" style="font-size:11px;color:var(--warn);margin-top:4px;"></div>
          </div>
          <div class="form-group" style="position:relative"><label class="form-label">Cliente</label>
            <input class="form-input" id="f_cliente" value="${esc(p.cliente)}" autocomplete="off"
              oninput="autocompletarContato(this,'CLIENTE','cliente-dropdown',function(){sugerirAcompanhamentoPorCliente();})" onchange="sugerirAcompanhamentoPorCliente()" placeholder="Digite razão social, CNPJ ou cidade...">
            <div id="cliente-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group" style="position:relative"><label class="form-label">Consignatário</label>
<input class="form-input" id="f_consignatario" value="${esc(p.consignatario)}" placeholder="Consignee do BL/DI — pode ser diferente do Cliente" autocomplete="off"
oninput="autocompletarContato(this,'CLIENTE,FORNECEDOR','consignatario-dropdown')">
<div id="consignatario-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
</div>
<div class="form-group" style="position:relative"><label class="form-label">Notify</label>
<input class="form-input" id="f_notify" value="${esc(p.notify)}" placeholder="Notify Party do BL/DI" autocomplete="off"
oninput="autocompletarContato(this,'CLIENTE,FORNECEDOR','notify-dropdown')">
<div id="notify-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
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
        <div style="display:flex;gap:10px;">
          ${p.id?`<button class="btn" onclick="excluirProcesso('${p.id}')" style="background:var(--err-bg);color:var(--err);border:1px solid rgba(220,38,38,.2);">🗑 Excluir</button>`:''}
          ${p.id && !cancelado && !solicitado?`<button class="btn btn-outline" onclick="cancelarProcesso('${p.id}')" title="${souGerente?'Mantém no histórico, mas sai das contagens operacionais':'Envia para aprovação de um gerente'}" style="color:#64748b;border-color:rgba(100,116,139,.4);">🚫 ${souGerente?'Cancelar Processo':'Solicitar Cancelamento'}</button>`:''}
          ${p.id && !bloqueado?`<button class="btn btn-outline" onclick="fecharProcesso('${p.id}')" title="Trava NF, Custos Reais e o resultado — só gerente pode reabrir depois">🔒 Fechar Processo</button>`:''}
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="coletarESalvar({fecharAoSalvar:false})">💾 Salvar</button>
        </div>
      </div>
    </div>

    <!-- ABA: FINANCEIRO -->
    <div class="tab-pane" id="pane-financeiro">
      ${datalistBancosCambioHtml()}
      <div class="form-section">
        <div class="form-section-title">💰 Proforma Invoice (PI)</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Nº PI</label>
            <input class="form-input" id="f_pi_numero" value="${esc(p.pi_numero)}"></div>
          <div class="form-group"><label class="form-label">Data PI</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" oninput="atualizarDataPagamentoPrazo()" id="f_pi_data" value="${esc(p.pi_data)}"></div>
          <div class="form-group"><label class="form-label">Valor USD</label>
            <div class="moeda-wrap"><span class="moeda-prefix">USD</span><input class="form-input" type="text" inputmode="decimal" id="f_pi_valor_usd" value="${exibirMoeda(p.pi_valor_usd)}" placeholder="0,00" oninput="formatarMoedaInput(this);renderPagamentoInfoLive()" onchange="calcularParcelaResidualAuto();renderParcelas();renderPagamentoInfoLive()"></div></div>
          <div class="form-group"><label class="form-label">Câmbio na PI (R$)</label>
            <input class="form-input" type="number" id="f_pi_cambio" value="${p.pi_cambio||''}" placeholder="${_cambio.USD.toFixed(2)}" step="0.0001">
          </div>
          <div class="form-group"><label class="form-label">Câmbio Fechado (R$)</label>
            <input class="form-input" type="number" id="f_pi_cambio_fechado" value="${p.pi_cambio_fechado||''}" placeholder="preenchido ao confirmar o câmbio" step="0.0001"
              title="Taxa que realmente foi paga (vem do comprovante de câmbio, pra Pagamento Único/Prazo). Fica separado de 'Câmbio na PI' de propósito — aquele é a previsão, este é o fechado, pra dar pra comparar os dois no Dashboard Financeiro.">
          </div>
          <div class="form-group"><label class="form-label">Banco/Corretora do Câmbio</label>
            <input class="form-input" list="lista-bancos-cambio" id="f_pi_cambio_banco" value="${esc(p.pi_cambio_banco)}" placeholder="Ex: Itaú, Santander..."
              title="Onde o câmbio foi fechado (pedido Ayslan 09/09/2026: concentração de risco por contraparte). Só faz sentido depois que o câmbio já foi fechado.">
          </div>
          <div class="form-group" id="grp-pi-cambio-custo" style="${p.pi_pagamento==='PARCELADO'?'display:none':''}"><label class="form-label">Custo da Operação (R$)</label>
            <div class="moeda-wrap"><span class="moeda-prefix">R$</span><input class="form-input" type="text" inputmode="decimal" id="f_pi_cambio_custo" value="${exibirMoeda(p.pi_cambio_custo)}" placeholder="0,00" oninput="formatarMoedaInput(this)"
              title="Custo da OPERAÇÃO de câmbio em si (IOF, spread do banco, tarifas) — separado da taxa. Só aparece pra Único/Entrada+Saldo; em Parcelado o custo já é por parcela, mais abaixo."></div>
          </div>
          <div class="form-group" id="grp-pi-cambio-bacen" style="${p.pi_pagamento==='PARCELADO'?'display:none':''}"><label class="form-label">Código BACEN</label>
            <input class="form-input" id="f_pi_cambio_codigo_bacen" value="${esc(p.pi_cambio_codigo_bacen)}" placeholder="Nº do contrato de câmbio"
              title="Nº do contrato de câmbio / referência do banco junto ao Banco Central. Existe também por parcela em Parcelado — aqui é o equivalente pra Único/Entrada+Saldo/Prazo, senão a extração por IA não tinha onde gravar esse dado (relato da Paula, 22/09/2026: comprovante lido mas Código BACEN sumia).">
          </div>
          <!-- DI/DUIMP pra pagamento único (À Vista / 100% a Prazo / Entrada+Saldo) —
               pedido Emanuelly 01/10/2026: antes só existia dentro de cada parcela
               (Parcelado), então em "100% a Prazo" não tinha onde pôr a chave da
               DUIMP (IMPAK-OID2605A). Colunas pi_venc_di/pi_duimp_numero/
               pi_duimp_protocolo (migration 0041). Em Parcelado some, igual ao BACEN. -->
          <div class="form-group" id="grp-pi-duimp-venc" style="${p.pi_pagamento==='PARCELADO'?'display:none':''}"><label class="form-label">Venc. DI/DUIMP</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_venc_di" value="${esc(p.pi_venc_di)}" title="Prazo p/ comprovar DI/DUIMP ao banco (padrão: 180 dias da data do câmbio/pagamento)" style="flex:1;">
              <button type="button" title="Calcular 180 dias a partir da Data Pagamento" onclick="calcularVencDIPagamentoUnico()" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--ac);cursor:pointer;font-size:13px;padding:0;height:36px;width:32px;flex:none;">↻</button>
            </div>
          </div>
          <div class="form-group" id="grp-pi-duimp-numero" style="${p.pi_pagamento==='PARCELADO'?'display:none':''}"><label class="form-label">Nº DUIMP</label>
            <input class="form-input" id="f_pi_duimp_numero" value="${esc(p.pi_duimp_numero)}" placeholder="Nº DUIMP"
              title="Número da DUIMP deste processo (em Parcelado fica dentro de cada parcela)"></div>
          <div class="form-group" id="grp-pi-duimp-protocolo" style="${p.pi_pagamento==='PARCELADO'?'display:none':''}"><label class="form-label">Protocolo / Chave de Acesso</label>
            <input class="form-input" id="f_pi_duimp_protocolo" value="${esc(p.pi_duimp_protocolo)}" placeholder="Protocolo / Chave de Acesso"
              title="Chave de acesso / protocolo da DUIMP que o banco pede pra vincular ao contrato de câmbio"></div>
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
            <select class="form-input" id="f_pi_pagamento" onchange="renderPagamentoCampos();atualizarVencimentoSaldoPorETA()" onwheel="this.blur()">
              <option value="">—</option>
              <option value="VISTA"        ${p.pi_pagamento==='VISTA'?'selected':''}>100% à Vista</option>
              <option value="PRAZO"        ${p.pi_pagamento==='PRAZO'?'selected':''}>100% a Prazo</option>
              <option value="PARCELADO"    ${p.pi_pagamento==='PARCELADO'?'selected':''}>Parcelado</option>
              <!-- "Entrada + Saldo" foi substituída por "Parcelado" (suporta quantos
                   câmbios forem necessários, não só 2). Pedido do Ayslan (20/09/2026):
                   esse option ainda aparecia em processos que não o usam (ex: UD26-221,
                   "100% a Prazo") porque tentava esconder via CSS (display:none), que
                   o seletor nativo do SO não respeita de forma confiável. Agora o
                   <option> nem entra no HTML quando o processo não usa ENTRADA_SALDO
                   -- só é montado (e fica selecionável) pra não quebrar processos
                   antigos que já têm esse valor salvo. -->
              ${p.pi_pagamento==='ENTRADA_SALDO'?'<option disabled>──────────</option><option value="ENTRADA_SALDO" selected>Entrada + Saldo (legado)</option>':''}
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
        <button class="btn btn-primary" onclick="coletarESalvar({fecharAoSalvar:false})">💾 Salvar</button>
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
        <!-- pointer-events:auto explicito nos 3 elementos abaixo -- quando o
        processo esta fechado, #modal-body-lockwrap trava TODO o conteudo
        com pointer-events:none (pra impedir edicao), o que sem isso tambem
        bloqueava clicar em "Ver / Exportar DRE" e no modal do DRE que abre
        dentro do dre-overlay. Pedido do Ayslan (08/09/2026): "eu nao
        consigo clicar para ver o DRE" quando fechado, "preciso exportar o
        DRE mesmo depois de fechado" -- so ver/exportar o DRE, sem editar
        nada, entao fica de fora da trava. -->
        <div style="margin-top:14px;pointer-events:auto;">
          <button type="button" class="btn btn-outline" style="pointer-events:auto;" onclick="abrirDRE()">📊 Ver / Exportar DRE</button>
        </div>
        <div id="dre-overlay" style="pointer-events:auto;"></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar({fecharAoSalvar:false})">💾 Salvar</button>
      </div>
    </div>

    <!-- ABA: CUSTOS REAIS -->
    <div class="tab-pane" id="pane-custosreais">
      <div class="form-section">
        <div class="form-section-title">💵 Custos Reais — apuração de lucro item a item</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Lance aqui o que realmente foi pago em cada item (FOB, frete, seguro, impostos, comissões e taxas operacionais). Quando o processo veio de uma cotação aprovada, cada campo já nasce preenchido com o valor cotado — ajuste só o que saiu diferente. Assim que tiver pelo menos um item aqui, o Lucro Real na aba Fechamento passa a usar esse detalhamento em vez do cálculo simples por NF.
        </div>
        <!-- Importar direto da planilha de Fechamento (mesmo template BASE
        SP/SC usado antes de existir esta tela) — lê a aba "Fechamento" e
        preenche os campos "Pago" abaixo + as datas de Embarque/Chegada/
        Registro DI (aba Documentos), sem precisar digitar tudo de novo.
        Reaproveita POST /api/controle/importar-fechamento (server-side,
        planilha-import.js) — o usuário sempre revisa/ajusta antes de salvar. -->
        <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <input type="file" id="import-fechamento-input" accept=".xlsm,.xlsx" style="display:none" onchange="importarFechamentoProcesso(this)">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('import-fechamento-input').click()">📥 Importar planilha de Fechamento</button>
          ${!p.real_json ? `
          <button type="button" class="btn btn-outline" onclick="vincularProcessoAoCalculador('${p.id}')" title="Cria uma cotação no Calculador já pré-preenchida com os dados deste processo, pra registrar a estimativa/fechamento">🧮 Vincular ao Calculador</button>
          ` : ''}
        </div>
        ${renderCustosReaisTab(p)}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarCustosReaisTab()">💾 Salvar Custos Reais</button>
      </div>
    </div>

    <!-- ABA: VENDAS (multi-cliente / rateio de custo) -->
    <div class="tab-pane" id="pane-vendas">
      <div class="form-section">
        <div class="form-section-title">🧾 Vendas — um processo, vários clientes</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Use esta aba quando este processo (Direto, Encomenda ou Conta e Ordem) foi vendido pra mais de um cliente — ex.: meio contêiner pra um, meio pra outro. Cada venda tem seu próprio cliente e NF Saída. Os custos lançados na aba Custos Reais são rateados automaticamente entre as vendas, proporcional à quantidade que cada uma levou; custos que só existiram por causa de um cliente específico (ex.: um frete extra) podem ser lançados direto naquela venda, sem entrar no rateio. Se este processo tem um único cliente/NF Saída, não precisa usar esta aba.
        </div>
        <div id="vendas-list"></div>
        <button type="button" onclick="adicionarVenda()" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:6px 14px;font-size:12px;color:var(--ac);cursor:pointer;font-weight:600;margin-top:4px;">+ Adicionar Venda</button>
        <input type="hidden" id="f_vendas_json">
        <div id="vendas-resumo"></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar({fecharAoSalvar:false})">💾 Salvar</button>
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
          <div class="form-group" style="position:relative"><label class="form-label">Armador <span id="f_armador_warn" style="display:${armadorReconhecido(p.armador)?'none':'inline'};color:#f39c12;font-weight:600;font-size:11px;" title="Armador não reconhecido — confira se não é o emissor do House B/L (agente de carga); o armador real (ocean carrier) deve vir do Master B/L">⚠ verificar</span></label>
            <input class="form-input" id="f_armador" value="${esc(p.armador)}" placeholder="Ex: PIL, COSCO, MSC" autocomplete="off"
              oninput="autocompletarContato(this,'ARMADOR','armador-dropdown');verificarArmadorConhecido(this)">
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
            <input class="form-input" type="text" inputmode="decimal" id="f_valor_frete" value="${exibirMoeda(p.valor_frete)}" placeholder="0,00" oninput="formatarMoedaInput(this);sincronizarFreteCustosReais()"></div>
          <div class="form-group"><label class="form-label">Moeda do Frete</label>
            <select class="form-input" id="f_moeda_frete" onchange="sincronizarFreteCustosReais()">
              <option value="USD" ${(!p.moeda_frete||p.moeda_frete==='USD')?'selected':''}>USD (US$)</option>
              <option value="BRL" ${p.moeda_frete==='BRL'?'selected':''}>BRL (R$)</option>
              <option value="EUR" ${p.moeda_frete==='EUR'?'selected':''}>EUR (€)</option>
            </select></div>
          <div class="form-group"><label class="form-label">Porto Origem</label>
            <div style="position:relative">
            <select class="form-input" id="f_porto_origem" onchange="togglePortoOutro('origem')" style="display:${(p.porto_origem && !PORTOS_ORIGEM.includes((p.porto_origem||'').toUpperCase()))?'none':''}">${gerarOptionsPortoOrigem(p.porto_origem)}</select>
            <input class="form-input" id="f_porto_origem_outro" value="${esc(PORTOS_ORIGEM.includes((p.porto_origem||'').toUpperCase())?'':p.porto_origem)}"
              placeholder="Digite o porto de origem" style="display:${(p.porto_origem && !PORTOS_ORIGEM.includes((p.porto_origem||'').toUpperCase()))?'block':'none'};padding-right:74px;">
            <button type="button" id="f_porto_origem_voltar" onclick="voltarPortoLista('origem')" title="Voltar à lista de portos"
              style="display:${(p.porto_origem && !PORTOS_ORIGEM.includes((p.porto_origem||'').toUpperCase()))?'inline-block':'none'};position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:#fff;cursor:pointer;color:var(--muted);">↺ lista</button>
            </div></div>
          <div class="form-group"><label class="form-label">Porto Destino</label>
            <select class="form-input" id="f_porto_destino">${gerarOptionsPortoDestino(p.porto_destino)}</select></div>
          <div class="form-group"><label class="form-label">Previsão de Embarque (ETD)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_etd" value="${esc(p.etd)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">ETA (Previsão de Chegada)</label>
            <input class="form-input highlight" type="date" onpaste="colarData(event,this)" id="f_eta" value="${esc(p.eta)}" onchange="atualizarVencimentoSaldoPorETA()">
          </div>
          <div class="form-group"><label class="form-label">Data de Embarque (Efetiva)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_embarque" value="${esc(p.data_embarque)}"
              onchange="moverDataFuturaParaPrevisao('f_data_embarque','f_etd','Previsão de Embarque (ETD)');atualizarFaseEmTempoReal();atualizarDataPagamentoPrazo()"></div>
          <div class="form-group"><label class="form-label">Free Time (dias)</label>
            <input class="form-input" type="number" id="f_free_time" value="${p.free_time||''}" placeholder="Preencher após emissão do BL"></div>
          <div class="form-group"><label class="form-label">Semana de Booking</label>
            <input class="form-input" type="number" id="f_semana_booking" value="${p.semana_booking||''}" placeholder="Ex: 40" min="1" max="53"
              title="Semana do booking (calendário) — permite agrupar/filtrar a tabela de processos por semana de embarque, igual à antiga planilha de Programação Semanal."></div>
          <div class="form-group"><label class="form-label">Cliente pediu outro agente de carga?</label>
            <label style="display:flex;align-items:center;gap:8px;height:38px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="f_tag_outro_agente" ${etiquetasManuaisTem(p,'OUTRO_AGENTE_CARGA')?'checked':''} onchange="toggleEtiquetaManual('OUTRO_AGENTE_CARGA', this.checked)">
              Sim, cliente solicitou outro agente
            </label>
            <input type="hidden" id="f_etiquetas_manuais_json" value="${esc(p.etiquetas_manuais_json || '[]')}"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">📋 Aprovações Pré-Embarque</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Aprovação HBL</label>
            <select class="form-input" id="f_aprovacao_hbl" onchange="atualizarFaseEmTempoReal()">
              <option value="" ${!p.aprovacao_hbl?'selected':''}>Selecione...</option>
              <option value="Sim" ${p.aprovacao_hbl==='Sim'?'selected':''}>Sim</option>
              <option value="Não" ${p.aprovacao_hbl==='Não'?'selected':''}>Não</option>
            </select></div>
          <div class="form-group"><label class="form-label">Docs enviados à despachante (Amanda)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_docs_enviados_despachante" value="${esc(p.docs_enviados_despachante)}"
              title="Assim que Aprovação HBL = Sim, envie HBL/CI pra Amanda/Find Comex solicitar a LI — marque a data aqui pra não esquecer. Some o alerta/etiqueta automaticamente quando preenchido."></div>
          <div class="form-group"><label class="form-label">Solicitação LI</label>
            <select class="form-input" id="f_solicitacao_li" onchange="atualizarFaseEmTempoReal()">
              <option value="" ${!p.solicitacao_li?'selected':''}>Selecione...</option>
              <option value="Sim" ${p.solicitacao_li==='Sim'?'selected':''}>Sim</option>
              <option value="Não" ${p.solicitacao_li==='Não'?'selected':''}>Não</option>
            </select></div>
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
          <div class="form-group"><label class="form-label">Horário Retirada</label>
            <input class="form-input" type="time" id="f_horario_retirada" value="${esc(p.horario_retirada)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Agendamento Cancelado?</label>
            <select class="form-input" id="f_agendamento_cancelado" onchange="toggleMotivoCancelamento()">
              <option value="false" ${!p.agendamento_cancelado?'selected':''}>Não</option>
              <option value="true"  ${p.agendamento_cancelado?'selected':''}>Sim</option>
            </select></div>
        </div>
        <div id="wrap_motivo_cancelamento" style="display:${p.agendamento_cancelado?'block':'none'};margin-top:10px;">
          <div class="form-group"><label class="form-label">Motivo do Cancelamento</label>
            <textarea class="form-input" id="f_motivo_cancelamento" rows="2" style="resize:vertical;">${esc(p.motivo_cancelamento)}</textarea></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">⚓ Chegada & Armazenagem</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Data Chegada</label>
            <input class="form-input highlight" type="date" onpaste="colarData(event,this)" id="f_data_chegada" value="${esc(p.data_chegada)}"
              onchange="moverDataFuturaParaPrevisao('f_data_chegada','f_eta','ETA (Previsão de Chegada)');atualizarFaseEmTempoReal();atualizarVencimentoSaldoPorETA()"></div>
          <div class="form-group"><label class="form-label">Presença de Carga</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_presenca" value="${esc(p.data_presenca)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Armazenagem Vence</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_armazenagem_vencimento" value="${esc(p.armazenagem_vencimento)}" style="color:var(--warn);font-weight:600;" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group" style="position:relative"><label class="form-label">Armazém</label>
            <input class="form-input" id="f_armazem" value="${esc(p.armazem)}" placeholder="Onde a carga está armazenada (útil p/ LCL — não é container cheio)" autocomplete="off"
              oninput="autocompletarValorLocal(this,'armazem','armazem-dropdown')">
            <div id="armazem-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
        </div>
        <div id="armazen-info-wrap">${armazenInfo}</div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar({fecharAoSalvar:false})">💾 Salvar</button>
      </div>
    </div>

    <!-- ABA: DEMURRAGE -->
    <div class="tab-pane" id="pane-demurrage">
      <div class="form-section">
        <div class="form-section-title">⚓ Demurrage</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Demurrage Vence</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_demurrage_vencimento" value="${esc(p.demurrage_vencimento)}" style="color:var(--err);font-weight:600;" onchange="atualizarFaseEmTempoReal()"></div>
        </div>
        <div id="demurrage-campos-single">
          <div class="form-grid">
            <div class="form-group"><label class="form-label">Valor Demurrage (R$)</label>
              <input class="form-input" type="text" inputmode="decimal" id="f_demurrage_valor" value="${exibirMoeda(p.demurrage_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this);atualizarFaseEmTempoReal()"></div>
            <div class="form-group"><label class="form-label">Data Devolução</label>
              <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_devolucao_vazio" value="${esc(p.data_devolucao_vazio)}" onchange="atualizarFaseEmTempoReal()"></div>
            <div class="form-group"><label class="form-label">Status RIC</label>
              <select class="form-input" id="f_ric_status">
                <option value="" ${!p.ric_status?'selected':''}>—</option>
                <option value="Isento" ${p.ric_status==='Isento'?'selected':''}>Isento</option>
                <option value="Parcial Isento" ${p.ric_status==='Parcial Isento'?'selected':''}>Parcial Isento</option>
                <option value="Termo" ${p.ric_status==='Termo'?'selected':''}>Termo</option>
              </select></div>
            <div class="form-group" style="position:relative"><label class="form-label">Depot</label>
              <input class="form-input" id="f_depot" value="${esc(p.depot)}" placeholder="Depot de devolução" autocomplete="off"
                oninput="autocompletarValorLocal(this,'depot','depot-dropdown')">
              <div id="depot-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
            </div>
            <div class="form-group"><label class="form-label">Data Solicitação</label>
              <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_solicitacao_demurrage" value="${esc(p.data_solicitacao_demurrage)}"></div>
            <div class="form-group"><label class="form-label">Data Isenção</label>
              <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_isencao_demurrage" value="${esc(p.data_isencao_demurrage)}"></div>
            <div class="form-group"><label class="form-label">Data de Envio do Termo</label>
              <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_envio_termo" value="${esc(p.data_envio_termo)}"></div>
            <div class="form-group"><label class="form-label">Data Pagamento Lavagem</label>
              <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_pagamento_lavagem" value="${esc(p.data_pagamento_lavagem)}"></div>
            <div class="form-group"><label class="form-label">Data de Pagamento da Demurrage</label>
              <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_pagamento_demurrage" value="${esc(p.data_pagamento_demurrage)}" onchange="atualizarFaseEmTempoReal()"></div>
          </div>
        </div>
        <!-- Preenchido via JS (renderDemurrageContainers, controle-campos.js) quando o
             processo tem 2+ containers -- cada um com sua propria devolucao/RIC/depot,
             em vez do bloco unico acima. Pedido da Emanuelly (10/09/2026). -->
        <div id="demurrage-campos-multi" style="display:none;margin-top:4px;"></div>
        <div id="demur-info-wrap">${demurInfo}</div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar({fecharAoSalvar:false})">💾 Salvar</button>
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
        <div class="form-section-title">📋 DI/DUIMP e Parametrização</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Data de Registro da DI/DUIMP</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_registro_di" value="${esc(p.data_registro_di)}" onchange="aplicarRegraParametrizacaoVerde();atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Número da DI/DUIMP</label>
            <input class="form-input" id="f_numero_di" value="${esc(p.numero_di)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Peso Total da DI/DUIMP (kg)</label>
            <input class="form-input" id="f_di_peso_liquido" inputmode="decimal" value="${p.di_peso_liquido!=null&&p.di_peso_liquido!==''?esc(String(p.di_peso_liquido).replace('.',',')):''}" placeholder="ex: 15780,76 — usado na Reciclagem (70%)"></div>
          <div class="form-group"><label class="form-label">NCM(s) da DI/DUIMP</label>
            <input class="form-input" id="f_di_ncms" value="${esc(p.di_ncms||'')}" placeholder="ex: 4011.20.90"></div>
          <div class="form-group"><label class="form-label">Canal</label>
            <select class="form-input" id="f_canal" onchange="aplicarRegraParametrizacaoVerde();atualizarFaseEmTempoReal()">
              <option value="">—</option>
              <option value="VERDE"   ${p.canal==='VERDE'?'selected':''}>🟢 Verde</option>
              <option value="AMARELO" ${p.canal==='AMARELO'?'selected':''}>🟡 Amarelo</option>
              <option value="VERMELHO"${p.canal==='VERMELHO'?'selected':''}>🔴 Vermelho</option>
            </select></div>
          <div class="form-group"><label class="form-label">Data de Parametrização da DI/DUIMP</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_parametrizacao" value="${esc(p.data_parametrizacao)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Data Liberação</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_liberacao" value="${esc(p.data_liberacao)}" onchange="atualizarFaseEmTempoReal()" placeholder="Data do desembaraço (CI)"></div>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-top:6px;">Canal Verde preenche a Data de Parametrização da DI/DUIMP automaticamente com a Data de Registro da DI/DUIMP (sem conferência separada). Data Liberação é a Data do Desembaraço informada no Comprovante de Importação.</div>
      </div>
      <div class="form-section">
        <div class="form-section-title">🧾 Faturamento</div>
        ${(() => {
          // Ambiguidade NF SaÃÂÃÂ­da legada ÃÂÃÂ aba Vendas: quando o processo jÃÂÃÂ¡
          // tem vendas cadastradas (multi-cliente), calcularFechamento()
          // ignora nf_saida_numero/data/valor por completo e usa a soma das
          // NFs de cada venda ÃÂ¢ÃÂÃÂ sem este aviso, alguÃÂÃÂ©m podia preencher os
          // dois lugares achando que os dois contam, ou nÃÂÃÂ£o entender por que
          // editar este campo aqui nÃÂÃÂ£o muda o Lucro Real na aba Fechamento.
          let vendas = [];
          try{ vendas = p.vendas_json ? JSON.parse(p.vendas_json) : []; }catch(e){ vendas = []; }
          if(!Array.isArray(vendas)) vendas = [];
          if(!vendas.length) return '';
          return `<div style="background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.35);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--text);">
            ⚠ Este processo foi vendido a <strong>${vendas.length} cliente${vendas.length===1?'':'s'}</strong> diferentes (ver aba 🧾 Vendas) — os campos de <strong>NF Saída</strong> abaixo NÃO são usados no cálculo de Fechamento nesse caso; cada venda tem sua própria NF Saída, lançada na aba Vendas.
          </div>`;
        })()}
        ${(() => {
          let vendas2 = [];
          try{ vendas2 = p.vendas_json ? JSON.parse(p.vendas_json) : []; }catch(e){ vendas2 = []; }
          if(!Array.isArray(vendas2)) vendas2 = [];
          if(vendas2.length) return '';
          // Drag-and-drop igual à Extração com IA da aba Documentos (task #405) --
          // pedido Ayslan 17/09/2026: "Tem como arrastar e soltar o arquivo aqui
          // na parte de NF tb?". handleDragOverIA_NF/handleDragLeaveIA_NF/
          // handleDropIA_NF (controle-import-ia.js) reaproveitam
          // importarNFSaidaProcessoArquivo(file) -- mesma função que o
          // <input type=file> onchange já chama.
          return `<div id="ia-nf-saida-drop-zone" style="background:rgba(26,127,212,.04);border:1px dashed rgba(26,127,212,.15);border-radius:10px;padding:12px 14px;margin-bottom:14px;transition:border-color .15s,background .15s;" ondragover="handleDragOverIA_NF(event)" ondragleave="handleDragLeaveIA_NF(event)" ondrop="handleDropIA_NF(event)">
            <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;">Extrair NF (Entrada ou Saida) com IA</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Envie o XML da NFe ou o PDF/foto do DANFE (ou arraste o arquivo aqui) — o sistema identifica se e Entrada ou Saida e preenche os campos certos automaticamente</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <input type="file" id="ia-nf-saida-file" accept=".pdf,.png,.jpg,.jpeg,.xml" style="display:none" onchange="importarNFSaidaProcesso(this)">
              <button class="btn btn-outline" onclick="document.getElementById('ia-nf-saida-file').click()">Selecionar NF (Entrada ou Saida)</button>
              <span id="ia-nf-saida-status" style="font-size:12px;color:var(--muted);"></span>
            </div>
          </div>`;
        })()}
        <div class="form-grid">
          <div class="form-group"><label class="form-label">NF Entrada Nº</label>
            <input class="form-input" id="f_nf_entrada_numero" value="${esc(p.nf_entrada_numero)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">NF Entrada Data</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_nf_entrada_data" value="${esc(p.nf_entrada_data)}"></div>
          <div class="form-group"><label class="form-label">NF Entrada Valor (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_nf_entrada_valor" value="${exibirMoeda(p.nf_entrada_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">NF Saída Nº${p.vendas_json&&JSON.parse(p.vendas_json||'[]').length?' <span style="color:#f39c12;font-weight:400;">(não usado — ver aba Vendas)</span>':''}</label>
            <input class="form-input" id="f_nf_saida_numero" value="${esc(p.nf_saida_numero)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">NF Saída Data</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_nf_saida_data" value="${esc(p.nf_saida_data)}"></div>
          <div class="form-group"><label class="form-label">NF Saída Valor (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_nf_saida_valor" value="${exibirMoeda(p.nf_saida_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">CFOP NF Saída</label>
            <input class="form-input" id="f_nf_saida_cfop" value="${esc(p.nf_saida_cfop)}" placeholder="ex: 5405, 5905..."></div>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-top:6px;">CFOP 5905 (ou NF de Saída ainda não emitida) = container importado sem venda efetiva ainda — usado no Dashboard Narcélio pra calcular estoque parado no armazém.</div>
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
        <button class="btn btn-primary" onclick="coletarESalvar({fecharAoSalvar:false})">💾 Salvar</button>
      </div>
    </div>

    <!-- ABA: CONFERÊNCIA -->
    <div class="tab-pane" id="pane-conferencia">
      <div id="pane-conferencia-conteudo"></div>
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
  // Inicializar multi-produtos (com retrocompatibilidade do campo "produto" legado em texto ÃÂÃÂºnico)
  try{
    if(p.produtos_json) _produtos = JSON.parse(p.produtos_json);
    else if(p.produto) _produtos = [{descricao:p.produto||'', quantidade:''}];
    else _produtos = [{descricao:'', quantidade:''}];
  }catch(e){ _produtos = [{descricao:'', quantidade:''}]; }
  renderMultiProdutos();
  // Inicializar vendas multi-cliente (aba Vendas) ÃÂ¢ÃÂÃÂ vazio ([]) pra qualquer
  // processo que nunca usou essa aba, exatamente como _produtos/_containers acima.
  try{
    _vendas = p.vendas_json ? JSON.parse(p.vendas_json) : [];
    if(!Array.isArray(_vendas)) _vendas = [];
  }catch(e){ _vendas = []; }
  renderVendas();
  if(!isNovo){ carregarArquivosGed(p.id); carregarHistorico(p.id); }
  else document.getElementById('ged-lista-arquivos').innerHTML = '<div style="font-size:11px;color:var(--dim);">Salve o processo antes de enviar arquivos.</div>';
  if(typeof renderConferencia === 'function') renderConferencia(p);
  if(typeof atualizarBadgeConferencia === 'function') atualizarBadgeConferencia(p);
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// CUSTOS REAIS ÃÂ¢ÃÂÃÂ apuraÃÂÃÂ§ÃÂÃÂ£o de lucro por processo, item a item
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Config/cÃÂÃÂ¡lculo (CUSTOS_REAIS_CONFIG, calcularCustoCotadoItem,
// calcularCustoRealTotal) vivem em controle-core.js ÃÂ¢ÃÂÃÂ aqui sÃÂÃÂ³ o HTML da aba
// e a coleta/salvamento dos campos, seguindo o mesmo padrÃÂÃÂ£o de "aba com
// botÃÂÃÂ£o de salvar prÃÂÃÂ³prio" que a aba Fechamento jÃÂÃÂ¡ usa (ela sÃÂÃÂ³ lÃÂÃÂª, nÃÂÃÂ£o tem
// campo editÃÂÃÂ¡vel; esta aba tem campos, entÃÂÃÂ£o precisa de coletar+salvar).
// Uma cÃÂÃÂ©lula "valor + moeda" (input number + select BRL/USD/EUR lado a
// lado) ÃÂ¢ÃÂÃÂ usada tanto pro Pago quanto pro Cobrado, tanto na linha principal
// quanto em cada sub-linha de container, sempre com o mesmo par de ids
// (valorId/moedaId) montado pelo chamador.
// ══════════════════════════════════════════════════════════════════════
// CUSTOS REAIS — aba redesenhada (30/09/2026, pedido Ayslan: "pensa a
// melhor forma de ver e preencher isso")
//
// Como a tela funciona agora:
//   - Cards no topo: Receita (NF saída) / Custo real / Lucro real (com o
//     cotado ao lado) / Conferidos N de M. Tudo recalculado a cada tecla.
//   - UMA coluna de valor por item ("Real (pago)"), com máscara 1.234,56 e
//     a moeda dentro do campo. Os valores são arredondados a 2 casas tanto
//     na exibição quanto ao salvar (antes vazava 174387,9905459328).
//   - Coluna "Cotado · origem": o cotado do Calculador com a diferença
//     (Δ) em R$ e %, e de onde o valor pode ser puxado (parcelas pagas do
//     Financeiro, Valor do Frete da Logística) — um clique preenche.
//   - "Cobrado do cliente" fica recolhido. Sem nada gravado = repasse igual
//     ao pago (ver cobradoEfetivo em controle-core.js). Só abre quando é
//     diferente (markup, ou o cotado que a aprovação da cotação gravou em
//     _cobrado) — mostra "cobrado X · margem ±Y" e um link pra editar.
//   - Só aparecem as linhas que têm valor (real ou cotado), as 10 básicas
//     (CUSTOS_REAIS_SEMPRE_VISIVEIS) e as que o usuário adicionar pelo
//     "+ adicionar item" de cada grupo. Caiu de ~55 linhas pra ~12-15.
//   - Bolinha de status por linha: verde = conferido por alguém (digitou,
//     puxou de outra aba, importou da planilha ou clicou na bolinha); azul
//     = tem valor mas é só o cotado pré-preenchido, ninguém conferiu;
//     vazia = sem valor. Guardado em real_json._conf = {id:{por,em,origem}}.
//   - Enter pula pro próximo campo de valor (igual Excel).
//
// Formato salvo em real_json NÃO mudou (número | {valor,moeda} |
// {porContainer}), só ganhou a chave _conf — DRE, Fechamento, Resultado e
// Análises continuam lendo exatamente o que liam.
// ══════════════════════════════════════════════════════════════════════

// Estado da aba pro processo aberto (reinicia quando troca de processo).
let _crExtras = new Set();   // itens adicionados pelo "+ adicionar item" nesta sessão
let _crConf = {};            // real_json._conf em edição
let _crProcId = null;

function crFmt(v){ return (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function crSimbolo(m){ return m === 'USD' ? 'US$' : m === 'EUR' ? '€' : 'R$'; }
function crData(iso){ if(!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR'); }
function crQuem(){ return (_user && (_user.displayName || _user.nome || _user.usuario)) || ''; }

// Célula "moeda + valor" (select da moeda dentro do campo, à esquerda, e o
// valor com máscara). Usada no Pago, no Cobrado e nas sub-linhas por
// container. `extraOnInput` é o gancho da linha principal pra marcar a
// linha como conferida quando alguém digita.
function celulaValorMoedaHtml(valorId, moedaId, valor, moeda, placeholder, readonly, cotado, extraOnInput){
  const exib = (valor === '' || valor == null) ? '' : exibirMoeda(valor);
  const roStyle = readonly ? 'background:var(--bg);color:var(--muted);' : '';
  const onInput = `formatarMoedaInput(this);${extraOnInput || 'atualizarTotalCustosReais()'}`;
  return `<div class="moeda-wrap cr-wrap">
    <select class="cr-moeda" id="${moedaId}" ${readonly?'disabled':''} onchange="atualizarTotalCustosReais()" title="Moeda deste valor">${MOEDAS_REAIS.map(m=>`<option value="${m.code}" ${m.code===moeda?'selected':''}>${m.simbolo}</option>`).join('')}</select>
    <input class="form-input cr-valor" type="text" inputmode="decimal" id="${valorId}" value="${exib}" placeholder="${placeholder||'0,00'}"${readonly?' readonly':''} style="width:100%;${roStyle}" oninput="${onInput}" onkeydown="crEnter(event,this)"${(cotado!==undefined&&cotado!==null)?` data-cotado="${exibirMoeda(cotado)}"`:''}>
  </div>`;
}

// Extrai { valor, moeda } pra pré-preencher a célula única (não-detalhada) a
// partir do que está salvo em real_json — aceita os 3 formatos possíveis
// (ver normalizarValorRealItem em controle-core.js); quando salvo em modo
// "por container", devolve null (tratado à parte).
function valorMoedaInicial(raw, item){
  if(raw == null || raw === '') return { valor:'', moeda:item.unidade };
  if(typeof raw === 'object'){
    if(raw.porContainer) return null;
    if(raw.valor != null && raw.valor !== '') return { valor: raw.valor, moeda: raw.moeda || item.unidade };
    return { valor:'', moeda:item.unidade };
  }
  // legado: número puro na moeda antiga do item (ver unidadeLegado)
  return { valor: raw, moeda: item.unidadeLegado || item.unidade };
}

function igualarCobradoPago(itemId, idx){ var suf = (idx === undefined || idx === null) ? '' : ('__c' + idx); var val = document.getElementById('f_cr_' + itemId + suf); var moeda = document.getElementById('f_cr_moeda_' + itemId + suf); var valCobrado = document.getElementById('f_cr_cobrado_' + itemId + suf); var moedaCobrado = document.getElementById('f_cr_cobrado_moeda_' + itemId + suf); if (val && valCobrado) valCobrado.value = val.value; if (moeda && moedaCobrado) moedaCobrado.value = moeda.value; if (typeof atualizarTotalCustosReais === 'function') atualizarTotalCustosReais(); }
// ── DRE (Demonstrativo de Resultado) — modal com o mesmo layout da
// planilha "IA - <referencia>" usada internamente antes do Controle
// existir, montado a partir de montarDRE() (controle-core.js), que so
// reorganiza os MESMOS lancamentos ja feitos na aba Custos Reais
// (real_json) — abre pelo botao na aba Fechamento; exportar pra Excel
// fica dentro do proprio modal (exportarDREExcel, controle-export.js).
function abrirDRE(){
  const dre = montarDRE(_editando);
  const overlay = document.getElementById('dre-overlay');
  if(overlay) overlay.innerHTML = renderDREModalHtml(dre);
}
function fecharDRE(){
  const overlay = document.getElementById('dre-overlay');
  if(overlay) overlay.innerHTML = '';
}
function renderDREModalHtml(dre){
  const r2 = v => `R$ ${(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const linhaSimples = (label,valor) => `
    <tr><td style="padding:5px 8px;">${esc(label)}</td><td colspan="3" style="padding:5px 8px;text-align:right;">${r2(valor)}</td></tr>`;
  const linhaGrupo = itens => itens.map(i=>linhaSimples('   '+i.label, i.valor)).join('');
  const linhaDif = i => `
    <tr><td style="padding:5px 8px;">   ${esc(i.label)}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--muted);">${r2(i.valorNfe)}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--muted);">${r2(i.creditoEntrada)}</td>
        <td style="padding:5px 8px;text-align:right;">${r2(i.diferenca)}</td></tr>`;

  const linhaJuros = dre.jurosCobrado
    ? linhaSimples('Juros', dre.jurosCobrado.valor)
    : '';
  const linhaTotalReceita = dre.jurosCobrado
    ? `<tr><td style="padding:5px 8px;font-weight:700;border-top:1px solid var(--border);">TOTAL</td><td colspan="3" style="padding:5px 8px;text-align:right;font-weight:700;border-top:1px solid var(--border);">${r2(dre.totalReceita)}</td></tr>`
    : '';
  const rotuloLucro1 = dre.notasBoss ? 'LUCRO BRUTO do PROCESSO - IMPAK' : 'LUCRO BRUTO do PROCESSO';
  const linhaBoss = dre.notasBoss
    ? `
        <tr><td colspan="4" style="padding:10px 8px 4px;"></td></tr>
        ${linhaSimples('Nfe BOSS', dre.notasBoss.valorBoss)}
        ${linhaSimples('Custos', dre.notasBoss.irRetido+dre.notasBoss.iss+dre.notasBoss.pis+dre.notasBoss.cofins+dre.notasBoss.irpj+dre.notasBoss.csll)}
        <tr><td style="padding:2px 8px 5px 24px;color:var(--muted);font-size:11px;">Impostos (IR+ISS+PIS+COFINS+IRPJ+CSLL)</td></tr>
        <tr><td style="padding:5px 8px;font-weight:600;">Total a Receber (somado ao Lucro Real)</td><td colspan="3" style="padding:5px 8px;text-align:right;font-weight:600;">${r2(dre.notasBoss.totalReceber)}</td></tr>
        <tr><td style="padding:8px;font-weight:700;color:var(--ok);border-top:2px solid var(--border);">LUCRO BRUTO do PROCESSO</td>
            <td colspan="3" style="padding:8px;text-align:right;font-weight:700;color:var(--ok);border-top:2px solid var(--border);">${r2(dre.lucroBruto)} ${dre.pctLucro!=null?'('+(dre.pctLucro*100).toFixed(1)+'%)':''}</td></tr>`
    : '';

  return `
  <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this) fecharDRE()">
    <div style="background:var(--bg,#fff);border-radius:12px;max-width:760px;width:92%;max-height:calc(var(--vhz,1vh)*88);overflow:auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;">📊 DRE — Processo ${esc(dre.referencia)}</h3>
        <button class="btn btn-outline" onclick="fecharDRE()">✕</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="padding:5px 8px;font-weight:600;">Nota fiscal de Saída${dre.nfSaidaNumero?' — Nfe '+esc(dre.nfSaidaNumero):''}</td>
            <td colspan="3" style="padding:5px 8px;text-align:right;font-weight:600;">${r2(dre.nfSaidaValor)}</td></tr>
        ${linhaJuros}
        ${linhaTotalReceita}
        <tr><td colspan="4" style="padding:10px 8px 4px;font-weight:700;border-top:1px solid var(--border);">CUSTOS</td></tr>
        ${linhaSimples('FOB', dre.fob)}
        <tr><td style="padding:5px 8px;">Adiantamento Porto (Liberação)</td><td colspan="3" style="padding:5px 8px;text-align:right;">${r2(dre.totalAdiantamento)}</td></tr>
        ${linhaGrupo(dreLinhasVisiveis(dre.adiantamentoItens))}
        <tr><td style="padding:5px 8px;">Agente Frete</td><td colspan="3" style="padding:5px 8px;text-align:right;">${r2(dre.totalAgenteFrete)}</td></tr>
        ${linhaGrupo(dreLinhasVisiveis(dre.agenteFreteItens))}
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
      </table>
      ${(typeof renderFechamentoTimeline==='function' && _editando) ? `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;margin-top:16px;">${renderFechamentoTimeline(_editando)}</div>` : ''}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button class="btn btn-outline" onclick="fecharDRE()">Fechar</button>
        <button class="btn btn-primary" onclick="exportarDREPDF(montarDRE(_editando), _editando)">📄 Exportar PDF</button>
        <button class="btn btn-primary" onclick="exportarDREExcel(montarDRE(_editando), _editando)">⬇️ Exportar Excel</button>
      </div>
    </div>
  </div>`;
}

// Pedido do Ayslan (18/09/2026): "quando o valor do frete for preenchido
// na aba logistica no campo Valor do Frete preencher automaticamente igual
// na aba custos reais no campo: frete internacional - cobrado (nao
// preencher campo pago)". Sempre espelha o Cobrado no Valor do Frete
// (inclusive sobrescrevendo um valor já salvo — bug Emanuelly 18/09/2026:
// mudou o Frete de 1.850 pra 2.000 e o Cobrado ficou parado). No redesenho
// (30/09/2026) o Cobrado fica recolhido: aqui ele sai do modo "espelho do
// pago" e passa a ter o valor da Logística, mostrado como "cobrado US$ X ·
// margem" na linha do frete.
function sincronizarFreteCustosReais(){
  const valorEl = document.getElementById('f_valor_frete');
  const moedaEl = document.getElementById('f_moeda_frete');
  const cobradoEl = document.getElementById('f_cr_cobrado_frete');
  const cobradoMoedaEl = document.getElementById('f_cr_cobrado_moeda_frete');
  if(!valorEl || !cobradoEl) return;
  if(cobradoEl.readOnly) return;
  const valor = parseValorMoeda(valorEl.value);
  if(!valor) return;
  const wrap = document.getElementById('cr_cobrado_wrap_frete');
  if(wrap) wrap.dataset.espelho = '0';
  cobradoEl.value = exibirMoeda(valor);
  if(cobradoMoedaEl && moedaEl) cobradoMoedaEl.value = moedaEl.value;
  if(typeof atualizarTotalCustosReais === 'function') atualizarTotalCustosReais();
}

function renderCustosReaisTab(p){
  const reais = (p.real_json && typeof p.real_json === 'object') ? p.real_json : {};
  if(_crProcId !== p.id){ _crExtras = new Set(); _crProcId = p.id; }
  _crConf = (reais._conf && typeof reais._conf === 'object') ? JSON.parse(JSON.stringify(reais._conf)) : {};
  const cotado = (p.estimativa_json && p.estimativa_json.custos_cotados_json) || null;
  const cambioDefault = p.real_cambio ?? (cotado && cotado.cambio) ?? p.pi_cambio ?? _cambio.USD;
  const cambioEurDefault = (reais._cambio_eur != null && reais._cambio_eur !== '') ? reais._cambio_eur : _cambio.EUR;
  const containers = containersDoProcesso(p);
  const estado = custosReaisEstado(p, [..._crExtras]);
  const porId = {}; estado.itens.forEach(i => { porId[i.id] = i; });

  const gruposHtml = CUSTOS_REAIS_CONFIG.map(g => {
    const visiveis = g.itens.filter(it => porId[it.id] && porId[it.id].visivel);
    const ocultos = g.itens.filter(it => !porId[it.id] || !porId[it.id].visivel);
    const linhas = visiveis.map(item => crLinhaHtml(item, porId[item.id], reais, containers, p)).join('');
    const addSel = ocultos.length
      ? `<select class="form-input cr-add" onchange="crAdicionarItem(this)" title="Mostra um item deste grupo que ainda não tem valor">
          <option value="">+ adicionar item…</option>
          ${ocultos.map(it => `<option value="${it.id}">${esc(it.label)}</option>`).join('')}
        </select>`
      : '';
    return `<div class="cr-grupo">
      <div class="cr-grupo-head"><span class="cr-grupo-titulo">${g.grupo}</span><span class="cr-grupo-total" id="cr_grupo_total_${g.slug}"></span></div>
      ${visiveis.length ? `<table class="cr-tabela">
        <colgroup><col style="width:22px"><col style="width:25%"><col style="width:200px"><col><col style="width:27%"></colgroup>
        <thead><tr><th></th><th>Item</th><th>Real (pago)</th><th>Cotado · origem</th><th>Cobrado do cliente</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>` : `<div class="cr-muted" style="padding:4px 0;">Nenhum item lançado neste grupo.</div>`}
      ${addSel ? `<div style="margin-top:8px;">${addSel}</div>` : ''}
    </div>`;
  }).join('');

  return `<div id="custos-reais-wrap">
    <div id="cr_cards" class="cr-cards"></div>
    <div id="cr_aviso"></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
      <div class="form-group" style="max-width:150px;margin:0;">
        <label class="form-label">Câmbio USD</label>
        <input class="form-input" type="number" step="0.0001" id="f_cr_cambio" value="${cambioDefault||''}" placeholder="${_cambio.USD.toFixed(4)}" oninput="atualizarTotalCustosReais()" title="Usado pra converter valores lançados em US$ pra R$">
      </div>
      <div class="form-group" style="max-width:150px;margin:0;">
        <label class="form-label">Câmbio EUR</label>
        <input class="form-input" type="number" step="0.0001" id="f_cr_cambio_eur" value="${cambioEurDefault||''}" placeholder="${_cambio.EUR.toFixed(4)}" oninput="atualizarTotalCustosReais()">
      </div>
      <div class="cr-muted" style="padding-bottom:8px;line-height:1.7;">
        <span class="cr-dot ok" style="cursor:default;vertical-align:middle;"></span> conferido &nbsp;
        <span class="cr-dot cotado" style="cursor:default;vertical-align:middle;"></span> só o cotado, ninguém conferiu &nbsp;
        <span class="cr-dot" style="cursor:default;vertical-align:middle;"></span> sem valor
        <br>Clique na bolinha pra marcar como conferido · Enter pula pro próximo campo · "Cobrado" só precisa ser mexido quando o cliente paga diferente do custo.
      </div>
    </div>
    ${gruposHtml}
    ${renderNotasBossBlock(p)}
    ${renderJurosCobradoBlock(p)}
    <div id="custos-reais-total" style="margin-top:6px;"></div>
  </div>`;
}

// Uma linha da tabela de um grupo (+ a sub-linha de containers quando a
// taxa é porContainer e o processo tem mais de um container).
// Pacote (Adiantamento Porto / Agente Frete) com valor real lançado = os
// itens daquele grupo já estão dentro dele. Nessas linhas a aba NÃO pode
// pré-preencher o cotado nem deixar "marcar restantes" confirmar o valor,
// senão o mesmo dinheiro entra duas vezes (auditoria 30/09/2026: foi assim
// que 9 processos ficaram com pacote + item a item).
function crPacoteAtivoDoItem(itemId, reais){
  if(typeof CUSTOS_REAIS_PACOTES === 'undefined' || !reais) return null;
  for(const k of Object.keys(CUSTOS_REAIS_PACOTES)){
    const pk = CUSTOS_REAIS_PACOTES[k];
    if(pk.itens.includes(itemId) && custoRealTemValor(reais[pk.id])) return pk;
  }
  return null;
}
function crLinhaHtml(item, st, reais, containers, p){
  const rawPago = reais[item.id], rawCobrado = reais[item.id + '_cobrado'];
  const podeDetalhar = !!item.porContainer && containers.length > 1;
  const breakdownAtivo = podeDetalhar && ((rawPago && rawPago.porContainer) || (rawCobrado && rawCobrado.porContainer));
  const iniPago = valorMoedaInicial(rawPago, item) || { valor:'', moeda:item.unidade };
  const iniCobrado = valorMoedaInicial(rawCobrado, item) || { valor:'', moeda:item.unidade };
  const pacoteAtivo = crPacoteAtivoDoItem(item.id, reais);
  // Sem nada salvo, pré-preenche com o cotado (fica azul = "só cotado" até
  // alguém conferir). Só no modo valor único e só quando o grupo não está
  // lançado como pacote. O valor pré-preenchido NÃO é gravado ao salvar
  // (ver aindaDefault em coletarCustosReaisDoForm) — só vira real quando
  // alguém digita, usa o cotado ou marca como conferido.
  const prefill = !breakdownAtivo && iniPago.valor === '' && st.valorCotado != null && !pacoteAtivo;
  if(prefill){ iniPago.valor = st.valorCotado; iniPago.moeda = 'BRL'; }
  const temCobradoExplicito = custoRealTemValor(rawCobrado);
  let pagoExib = iniPago.valor, pagoMoeda = iniPago.moeda, cobradoExib = iniCobrado.valor, cobradoMoeda = iniCobrado.moeda;
  if(breakdownAtivo){
    const nP = normalizarValorRealItem(rawPago, item, p), nC = normalizarValorRealItem(rawCobrado, item, p);
    pagoExib = nP ? nP.totalBrl.toFixed(2) : ''; cobradoExib = nC ? nC.totalBrl.toFixed(2) : '';
    pagoMoeda = 'BRL'; cobradoMoeda = 'BRL';
  }
  const aberto = breakdownAtivo;                    // input do Cobrado visível de cara só no modo detalhado
  const espelho = !temCobradoExplicito && !breakdownAtivo; // sem cobrado gravado = repasse igual ao pago
  const temValor = custoRealTemValor(rawPago) || prefill;
  const dotClass = (temValor && st.conferido) ? 'ok' : (temValor ? 'cotado' : '');

  const notas = [];
  if(item.temCredito) notas.push('crédito tributário — fora do custo');
  if(item.excluirDosTotais) notas.push('fora dos totais');
  if(item.pacote) notas.push(item.pacote === 'adiantamento'
    ? 'total da nota do despachante — OU isto, OU II/IPI/PIS/COFINS/ICMS/Siscomex/AFRMM/armazenagem item a item'
    : 'total da fatura do agente — OU isto, OU Frete Internacional + taxas do agente item a item');
  if(pacoteAtivo) notas.push('já está dentro do pacote ' + pacoteAtivo.nome.replace(/ \(.*\)$/, '') + ' — deixe vazio');
  const detalharLink = podeDetalhar
    ? `<a href="javascript:void(0)" onclick="toggleCrContainerBreakdown('${item.id}')" class="cr-link">📦 <span id="cr_toggle_label_${item.id}">${breakdownAtivo ? 'Ver total único' : `Detalhar por container (${containers.length})`}</span></a>`
    : '';

  const pagoCell = item.apenasPago
    ? `<div class="moeda-wrap cr-wrap"><span class="moeda-prefix" style="left:14px;">R$</span><input class="form-input cr-valor" type="text" inputmode="decimal" id="f_cr_${item.id}" value="${pagoExib===''?'':exibirMoeda(pagoExib)}" data-cotado="${st.valorCotado!=null?exibirMoeda(st.valorCotado):''}" placeholder="0,00" oninput="formatarMoedaInput(this);crAoDigitar('${item.id}')" onkeydown="crEnter(event,this)" style="width:100%;padding-left:40px;"></div>`
    : celulaValorMoedaHtml('f_cr_'+item.id, 'f_cr_moeda_'+item.id, pagoExib, pagoMoeda, '0,00', breakdownAtivo, st.valorCotado, `crAoDigitar('${item.id}')`);

  const cobradoCell = item.apenasPago
    ? `<span class="cr-muted">custo direto (não é cobrado do cliente)</span>`
    : `<div id="cr_cobrado_wrap_${item.id}" data-aberto="${aberto?1:0}" data-espelho="${espelho?1:0}">
        <div class="cr-cobrado-fechado" style="display:${aberto?'none':'block'};"><span id="cr_cobrado_resumo_${item.id}" class="cr-info"></span></div>
        <div class="cr-cobrado-aberto" style="display:${aberto?'flex':'none'};align-items:center;gap:6px;">
          <div style="flex:1;min-width:0;">${celulaValorMoedaHtml('f_cr_cobrado_'+item.id, 'f_cr_cobrado_moeda_'+item.id, cobradoExib, cobradoMoeda, '0,00', breakdownAtivo)}</div>
          ${breakdownAtivo ? '' : `<a href="javascript:void(0)" class="cr-link" onclick="crFecharCobrado('${item.id}')" title="Volta a cobrar do cliente exatamente o valor pago">= pago</a>`}
        </div>
        <div id="cr_margem_${item.id}" class="cr-margem"></div>
      </div>`;

  const containersLinhasHtml = podeDetalhar ? containers.map((nome, idx) => {
    const savedPago = (rawPago && rawPago.porContainer && rawPago.porContainer[nome]) || null;
    const savedCobrado = (rawCobrado && rawCobrado.porContainer && rawCobrado.porContainer[nome]) || null;
    return `<tr>
      <td style="padding:4px 10px 4px 0;font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;white-space:nowrap;width:160px;">${esc(nome)}</td>
      <td style="padding:4px 6px;width:200px;">${celulaValorMoedaHtml('f_cr_'+item.id+'__c'+idx, 'f_cr_moeda_'+item.id+'__c'+idx, savedPago?savedPago.valor:'', savedPago?savedPago.moeda:item.unidade, 'pago', false)}</td>
      <td style="padding:4px 6px;width:200px;">${celulaValorMoedaHtml('f_cr_cobrado_'+item.id+'__c'+idx, 'f_cr_cobrado_moeda_'+item.id+'__c'+idx, savedCobrado?savedCobrado.valor:'', savedCobrado?savedCobrado.moeda:item.unidade, 'cobrado', false)}</td>
      <td style="padding:4px 0 4px 4px;"><button type="button" title="Cobrado = Pago neste container" onclick="igualarCobradoPago('${item.id}', ${idx})" style="width:22px;height:26px;border:1px solid var(--border);background:var(--bg2);border-radius:6px;cursor:pointer;font-size:12px;color:var(--ac);">=</button></td>
    </tr>`;
  }).join('') : '';

  return `<tr id="cr_row_${item.id}" data-prefill="${prefill ? 1 : 0}">
    <td><span id="cr_dot_${item.id}" class="cr-dot ${dotClass}" onclick="crToggleConferido('${item.id}')"></span></td>
    <td><div class="cr-label">${item.label}</div>${notas.length ? `<div class="cr-muted">${notas.join(' · ')}</div>` : ''}${detalharLink ? `<div>${detalharLink}</div>` : ''}</td>
    <td>${pagoCell}</td>
    <td><div id="cr_info_${item.id}" class="cr-info"></div></td>
    <td>${cobradoCell}</td>
  </tr>
  ${podeDetalhar ? `<tr id="cr_containers_row_${item.id}" style="display:${breakdownAtivo?'table-row':'none'};background:var(--bg);">
    <td colspan="5" style="padding:2px 0 10px 24px;">
      <div class="cr-muted" style="margin-bottom:4px;">Por container (pago · cobrado):</div>
      <table style="width:100%;border-collapse:collapse;"><tbody>${containersLinhasHtml}</tbody></table>
    </td>
  </tr>` : ''}`;
}

// Bloco "Notas Fiscais BOSS" (sub-livro da aba Fechamento, linhas 46-56 da
// planilha) - separado dos grupos de CUSTOS_REAIS_CONFIG porque nao e um
// custo do processo, e uma SEGUNDA nota de venda (alem da NF Saida
// principal) que paga seu proprio conjunto de impostos e cujo liquido
// (Total a Receber) se soma ao Lucro Real. Unico input manual: o valor
// total das notas Boss (real_json.notas_boss_valor) - o resto (IR/ISS/PIS/
// COFINS/IRPJ/CSLL/IBS/CBS) e 100% automatico (ver calcularNotasBoss em
// controle-core.js, percentuais fixos, sem tabela de UF envolvida).
function renderNotasBossBlock(p){
  const reais = p.real_json || {};
  const valorSalvo = (reais.notas_boss_valor != null && reais.notas_boss_valor !== '') ? reais.notas_boss_valor : '';
  const nb = calcularNotasBoss(p);
  const r2 = v => 'R$ ' + crFmt(v);
  return `<div class="cr-grupo">
    <div class="cr-grupo-head"><span class="cr-grupo-titulo">Notas Fiscais BOSS (opcional)</span></div>
    <div class="cr-muted" style="margin-bottom:10px;">Quando o processo também fatura por uma nota separada da NF Saída principal, lance aqui o valor total dela — os impostos (IR retido, ISS, PIS, COFINS, IRPJ, CSLL, IBS, CBS) são calculados automaticamente e o líquido entra somado ao Lucro Real.</div>
    <div class="form-group" style="max-width:220px;margin-bottom:8px;">
      <label class="form-label">Valor das Notas Boss</label>
      <div class="moeda-wrap"><span class="moeda-prefix">R$</span><input class="form-input" type="text" inputmode="decimal" id="f_cr_notas_boss" value="${valorSalvo===''?'':exibirMoeda(valorSalvo)}" placeholder="0,00" oninput="formatarMoedaInput(this);atualizarTotalCustosReais()"></div>
    </div>
    <div id="notas-boss-detalhe" style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:2px;">${nb ? `
      <span>IR Retido (1,5%): ${r2(nb.irRetido)} · ISS (2,5%): ${r2(nb.iss)} · PIS (0,65%): ${r2(nb.pis)} · COFINS (3%): ${r2(nb.cofins)}</span>
      <span>IRPJ: ${r2(nb.irpj)} · CSLL (9%): ${r2(nb.csll)} · IBS (0,1%): ${r2(nb.ibs)} · CBS (0,9%): ${r2(nb.cbs)}</span>
      <span style="color:var(--text);font-weight:600;">Total a Receber (soma ao Lucro Real): ${r2(nb.totalReceber)}</span>` : ''}</div>
  </div>`;
}

// Bloco "Juros Cobrado do Cliente" (G13 da aba Fechamento da planilha,
// somado a NF Saída pra formar a receita total do processo — pedido Jean/
// Emanuelly 03/09/2026, processo KS260507SMBZIMP). Diferente da Nota Boss
// (que é uma segunda nota, com seu próprio conjunto de impostos calculado
// automaticamente), o juro é só um valor de receita — os custos
// operacionais dele (PIS 0,65% + COFINS 4%) o próprio usuário soma junto
// com a diferença NFe×D.I. normal nos campos "Diferença PIS/COFINS".
function renderJurosCobradoBlock(p){
  const reais = p.real_json || {};
  const valorSalvo = (reais.juros_valor != null && reais.juros_valor !== '') ? reais.juros_valor : '';
  return `<div class="cr-grupo">
    <div class="cr-grupo-head"><span class="cr-grupo-titulo">Juros Cobrado do Cliente (opcional)</span></div>
    <div class="cr-muted" style="margin-bottom:10px;">Quando o processo cobra juro à parte (parcelamento/financiamento), lance aqui o valor — soma direto à receita (junto com a NF Saída) pro Lucro Real. Os custos operacionais desse juro (PIS 0,65% + COFINS 4%, tipicamente) devem ser somados manualmente nos campos "Diferença PIS/COFINS", igual a planilha já faz.</div>
    <div class="form-group" style="max-width:220px;margin:0;">
      <label class="form-label">Valor do Juro Cobrado</label>
      <div class="moeda-wrap"><span class="moeda-prefix">R$</span><input class="form-input" type="text" inputmode="decimal" id="f_cr_juros" value="${valorSalvo===''?'':exibirMoeda(valorSalvo)}" placeholder="0,00" oninput="formatarMoedaInput(this);atualizarTotalCustosReais()"></div>
    </div>
  </div>`;
}

// ── ações da aba ──────────────────────────────────────────────────────
function crValorCampo(id){
  const el = document.getElementById(id);
  if(!el) return null;
  const n = parseValorMoeda(el.value);
  return (n === '' || n == null || isNaN(n)) ? null : round2(n);
}
function crMarcar(id, origem){
  _crConf[id] = { por: crQuem(), em: new Date().toISOString(), origem: origem || 'digitado' };
}
// Digitou no campo Real: passa a "conferido" (apagou tudo: volta a vazio).
function crAoDigitar(id){
  const tr = document.getElementById('cr_row_' + id);
  if(tr) tr.dataset.prefill = '0';
  if(crValorCampo('f_cr_' + id) == null) delete _crConf[id]; else crMarcar(id, 'digitado');
  atualizarTotalCustosReais();
}
function crToggleConferido(id){
  if(crValorCampo('f_cr_' + id) == null){ if(typeof showToast === 'function') showToast('Lance um valor antes de marcar como conferido.', 'warn'); return; }
  if(_crConf[id]) delete _crConf[id]; else crMarcar(id, 'conferido');
  atualizarTotalCustosReais();
}
// "Marcar restantes": só o que tem valor REAL lançado (digitado ou salvo).
// Linha ainda só com o cotado pré-preenchido não entra — quem quiser aceitar
// o cotado usa "usar cotado" linha a linha. Item coberto por pacote ativo
// também fica de fora (já está dentro do pacote).
function crConferirTodos(){
  const reais = coletarCustosReaisDoForm();
  custosReaisItensFlat().forEach(item => {
    if(crValorCampo('f_cr_' + item.id) == null) return;
    const tr = document.getElementById('cr_row_' + item.id);
    if(tr && tr.dataset.prefill === '1') return;
    if(crPacoteAtivoDoItem(item.id, reais)) return;
    if(!_crConf[item.id]) crMarcar(item.id, 'conferido');
  });
  atualizarTotalCustosReais();
}
function crUsarCotado(id){
  const el = document.getElementById('f_cr_' + id);
  if(!el || el.readOnly || !el.dataset.cotado) return;
  const tr = document.getElementById('cr_row_' + id);
  if(tr) tr.dataset.prefill = '0';
  el.value = el.dataset.cotado;
  const sel = document.getElementById('f_cr_moeda_' + id);
  if(sel) sel.value = 'BRL';
  crMarcar(id, 'cotado');
  atualizarTotalCustosReais();
}
// Puxa o valor de outra aba (parcelas pagas do Financeiro → Custo da
// mercadoria; Valor do Frete da Logística → Cobrado do frete).
function crUsarFonte(id){
  if(!_editando) return;
  const fontes = fontesCustosReais(_editando);
  const f = fontes[id];
  if(!f) return;
  if(f.lado === 'cobrado'){
    crAbrirCobrado(id, true);
    const el = document.getElementById('f_cr_cobrado_' + id), sel = document.getElementById('f_cr_cobrado_moeda_' + id);
    if(el){ el.value = exibirMoeda(f.valor); }
    if(sel) sel.value = f.moeda;
  } else {
    const el = document.getElementById('f_cr_' + id), sel = document.getElementById('f_cr_moeda_' + id);
    if(!el || el.readOnly) return;
    el.value = exibirMoeda(f.valor);
    if(sel) sel.value = f.moeda;
    crMarcar(id, f.origem);
  }
  atualizarTotalCustosReais();
}
// Abre o campo Cobrado de uma linha. Vindo do modo espelho, começa igual
// ao pago (o usuário só ajusta a diferença).
function crAbrirCobrado(id, silencioso){
  const wrap = document.getElementById('cr_cobrado_wrap_' + id);
  if(!wrap) return;
  const foiEspelho = wrap.dataset.espelho === '1';
  wrap.dataset.aberto = '1'; wrap.dataset.espelho = '0';
  const fechado = wrap.querySelector('.cr-cobrado-fechado'), abertoEl = wrap.querySelector('.cr-cobrado-aberto');
  if(fechado) fechado.style.display = 'none';
  if(abertoEl) abertoEl.style.display = 'flex';
  const inp = document.getElementById('f_cr_cobrado_' + id), sel = document.getElementById('f_cr_cobrado_moeda_' + id);
  if(foiEspelho && inp && !inp.value){
    const pago = document.getElementById('f_cr_' + id), pagoMoeda = document.getElementById('f_cr_moeda_' + id);
    if(pago) inp.value = pago.value;
    if(sel && pagoMoeda) sel.value = pagoMoeda.value;
  }
  atualizarTotalCustosReais();
  if(!silencioso && inp){ inp.focus(); inp.select(); }
}
// Volta a linha pro modo espelho (cobrado = pago): o _cobrado explícito
// deixa de ser gravado no próximo salvar.
function crFecharCobrado(id){
  const wrap = document.getElementById('cr_cobrado_wrap_' + id);
  if(!wrap) return;
  wrap.dataset.aberto = '0'; wrap.dataset.espelho = '1';
  const fechado = wrap.querySelector('.cr-cobrado-fechado'), abertoEl = wrap.querySelector('.cr-cobrado-aberto');
  if(fechado) fechado.style.display = 'block';
  if(abertoEl) abertoEl.style.display = 'none';
  const inp = document.getElementById('f_cr_cobrado_' + id);
  if(inp) inp.value = '';
  atualizarTotalCustosReais();
}
function crAdicionarItem(sel){
  const id = sel && sel.value;
  if(!id) return;
  _crExtras.add(id);
  crRerender();
  setTimeout(() => { const el = document.getElementById('f_cr_' + id); if(el){ el.focus(); el.scrollIntoView({ block:'center', behavior:'smooth' }); } }, 0);
}
// Redesenha a aba inteira preservando o que já foi digitado (coleta o
// formulário num snapshot e renderiza a partir dele).
function crRerender(){
  if(!_editando) return;
  const wrap = document.getElementById('custos-reais-wrap');
  if(!wrap) return;
  const snapshot = { ..._editando, real_json: coletarCustosReaisDoForm(), real_cambio: coletarCambioCustosReaisDoForm() };
  const tmp = document.createElement('div');
  tmp.innerHTML = renderCustosReaisTab(snapshot);
  wrap.replaceWith(tmp.firstElementChild);
  atualizarTotalCustosReais();
}
// Enter = próximo campo de valor (igual Excel). Tab continua normal.
function crEnter(ev, el){
  if(!ev || ev.key !== 'Enter') return;
  ev.preventDefault();
  const wrap = document.getElementById('custos-reais-wrap');
  if(!wrap) return;
  const campos = [...wrap.querySelectorAll('input.cr-valor')].filter(i => !i.readOnly && i.offsetParent !== null);
  const idx = campos.indexOf(el);
  const prox = campos[idx + 1];
  if(prox){ prox.focus(); prox.select(); } else el.blur();
}
// Valores vindos da planilha de Fechamento (controle-import-ia.js):
// garante que as linhas existam (mesmo as que estavam escondidas), preenche
// o que ainda não foi conferido e marca como conferido pela planilha.
function crAplicarImportado(realJson, moedas){
  const ids = Object.keys(realJson || {}).filter(id => custosReaisItensFlat().some(it => it.id === id));
  ids.forEach(id => _crExtras.add(id));
  crRerender();
  let n = 0;
  ids.forEach(id => {
    const el = document.getElementById('f_cr_' + id);
    if(!el || el.readOnly) return;
    if(el.value && _crConf[id] && _crConf[id].origem !== 'planilha') return; // alguém já conferiu à mão: não sobrescreve
    el.value = exibirMoeda(realJson[id]);
    const sel = document.getElementById('f_cr_moeda_' + id);
    if(sel && moedas && moedas[id]) sel.value = moedas[id];
    crMarcar(id, 'planilha');
    el.style.borderColor = 'var(--ok)'; el.style.background = 'rgba(22,163,74,.04)';
    setTimeout(() => { el.style.borderColor = ''; el.style.background = ''; }, 3000);
    n++;
  });
  atualizarTotalCustosReais();
  return n;
}

// Alterna uma taxa entre "valor único pro processo" e "detalhado container a
// container" — ativa/desativa a sub-linha de containers e trava (readonly) a
// linha principal, que passa a mostrar só o total somado em R$.
function toggleCrContainerBreakdown(itemId){
  const row = document.getElementById('cr_containers_row_'+itemId);
  const label = document.getElementById('cr_toggle_label_'+itemId);
  if(!row) return;
  const ativar = row.style.display === 'none';
  row.style.display = ativar ? 'table-row' : 'none';
  if(label) label.textContent = ativar ? 'Ver total único' : 'Detalhar por container';
  ['f_cr_'+itemId, 'f_cr_cobrado_'+itemId].forEach(id => {
    const el = document.getElementById(id);
    if(el){ el.readOnly = ativar; el.style.background = ativar ? 'var(--bg)' : ''; el.style.color = ativar ? 'var(--muted)' : ''; }
  });
  ['f_cr_moeda_'+itemId, 'f_cr_cobrado_moeda_'+itemId].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.disabled = ativar;
  });
  const wrap = document.getElementById('cr_cobrado_wrap_'+itemId);
  if(wrap){
    // detalhado: o cobrado é lido das sub-linhas, então o campo principal
    // fica aberto (como resumo somado) e sai do modo espelho
    if(ativar){ wrap.dataset.aberto = '1'; wrap.dataset.espelho = '0'; }
    const fechado = wrap.querySelector('.cr-cobrado-fechado'), abertoEl = wrap.querySelector('.cr-cobrado-aberto');
    if(fechado) fechado.style.display = wrap.dataset.aberto === '1' ? 'none' : 'block';
    if(abertoEl) abertoEl.style.display = wrap.dataset.aberto === '1' ? 'flex' : 'none';
  }
  atualizarTotalCustosReais();
}

// Lê os valores atualmente digitados nos campos f_cr_* (sem depender de
// _editando estar sincronizado ainda) — usado tanto pra atualizar o total ao
// vivo quanto pra montar o que vai salvo em real_json/real_cambio. O câmbio
// vem separado (real_cambio é coluna própria, não fica dentro do real_json)
// pra bater com a migration 0004_add_custos_reais_processo.sql.
//
// Tudo que é valor passa por round2: o que o usuário vê (2 casas) é o que
// fica gravado. Linhas sem campo na tela (escondidas por não ter valor) não
// têm nada a gravar — toda linha com valor salvo é sempre renderizada
// (ver custosReaisEstado em controle-core.js).
function coletarCustosReaisDoForm(soConfirmados){
  const obj = {};
  // Linha pré-preenchida com o cotado (data-prefill="1" no <tr>) e ainda com
  // o valor do cotado, sem ninguém ter conferido: NÃO é custo real — fica de
  // fora do real_json. Antes (30/09/2026) qualquer Salvar gravava todos os
  // cotados como se fossem reais, inclusive por cima dos pacotes.
  const aindaDefault = (el) => {
    const tr = el && el.closest ? el.closest('tr') : null;
    if(!tr || tr.dataset.prefill !== '1') return false;
    const id = tr.id.replace('cr_row_', '');
    if(_crConf && _crConf[id]) return false;
    return !!(el.dataset && el.dataset.cotado !== undefined && el.value === el.dataset.cotado);
  };
  const eurEl = document.getElementById('f_cr_cambio_eur');
  if(eurEl && eurEl.value !== '') obj._cambio_eur = parseFloat(eurEl.value);
  const boss = crValorCampo('f_cr_notas_boss');
  if(boss != null) obj.notas_boss_valor = boss;
  const juros = crValorCampo('f_cr_juros');
  if(juros != null) obj.juros_valor = juros;
  const containers = containersDoProcesso(_editando || {});
  custosReaisItensFlat().forEach(item => {
    const containersRow = document.getElementById('cr_containers_row_'+item.id);
    const emBreakdown = !!(containersRow && containersRow.style.display !== 'none');
    const lados = [{ sufixo:'', prefV:'f_cr_', prefM:'f_cr_moeda_' }];
    if(!item.apenasPago){
      const wrapC = document.getElementById('cr_cobrado_wrap_'+item.id);
      const espelho = wrapC ? wrapC.dataset.espelho === '1' : true;
      if(emBreakdown || !espelho) lados.push({ sufixo:'_cobrado', prefV:'f_cr_cobrado_', prefM:'f_cr_cobrado_moeda_' });
    }
    lados.forEach(({sufixo, prefV, prefM}) => {
      if(emBreakdown){
        const porContainer = {};
        containers.forEach((nome, idx) => {
          const el = document.getElementById(prefV+item.id+'__c'+idx);
          const v = el ? crValorCampo(prefV+item.id+'__c'+idx) : null;
          if(el && v != null && !aindaDefault(el)){
            const moedaEl = document.getElementById(prefM+item.id+'__c'+idx);
            porContainer[nome] = { valor: v, moeda: moedaEl ? moedaEl.value : item.unidade };
          }
        });
        if(Object.keys(porContainer).length) obj[item.id+sufixo] = { porContainer };
        return;
      }
      const el = document.getElementById(prefV+item.id);
      if(!el) return;
      const v = crValorCampo(prefV+item.id);
      if(v == null || aindaDefault(el)) return;
      const moedaEl = document.getElementById(prefM+item.id);
      obj[item.id+sufixo] = { valor: v, moeda: moedaEl ? moedaEl.value : item.unidade };
    });
  });
  const conf = {};
  Object.keys(_crConf || {}).forEach(id => { if(obj[id] != null) conf[id] = _crConf[id]; });
  if(Object.keys(conf).length) obj._conf = conf;
  return obj;
}

function coletarCambioCustosReaisDoForm(){
  const el = document.getElementById('f_cr_cambio');
  return (el && el.value !== '') ? parseFloat(el.value) : null;
}

// Recalcula tudo que é derivado (cards, Δ vs cotado, origem, cobrado/margem,
// totais por grupo, Notas Boss) conforme o usuário digita — sem salvar.
function atualizarTotalCustosReais(){
  if(!_editando) return;
  const wrap = document.getElementById('custos-reais-wrap');
  if(!wrap) return;
  const cambio = coletarCambioCustosReaisDoForm();
  const obj = coletarCustosReaisDoForm();
  const snapshot = { ..._editando, real_json: obj, real_cambio: cambio };
  if(typeof _vendas !== 'undefined' && Array.isArray(_vendas) && _vendas.length) snapshot.vendas_json = JSON.stringify(_vendas);
  const estado = custosReaisEstado(snapshot, [..._crExtras]);
  const porId = {}; estado.itens.forEach(i => { porId[i.id] = i; });
  const r2 = v => 'R$ ' + crFmt(v);

  custosReaisItensFlat().forEach(item => {
    const st = porId[item.id];
    if(!st || !document.getElementById('cr_row_'+item.id)) return;
    const normPago = normalizarValorRealItem(obj[item.id], item, snapshot);
    const rawCobradoExp = obj[item.id+'_cobrado'];
    const normCobradoExp = normalizarValorRealItem(rawCobradoExp, item, snapshot);

    // modo detalhado por container: a linha principal vira resumo somado
    const containersRow = document.getElementById('cr_containers_row_'+item.id);
    if(containersRow && containersRow.style.display !== 'none'){
      const pagoInput = document.getElementById('f_cr_'+item.id);
      const cobradoInput = document.getElementById('f_cr_cobrado_'+item.id);
      if(pagoInput) pagoInput.value = normPago ? exibirMoeda(normPago.totalBrl) : '';
      if(cobradoInput) cobradoInput.value = normCobradoExp ? exibirMoeda(normCobradoExp.totalBrl) : '';
    }

    // bolinha de status
    const temValor = !!normPago;
    const conferido = temValor && !!_crConf[item.id];
    const dot = document.getElementById('cr_dot_'+item.id);
    if(dot){
      dot.className = 'cr-dot ' + (conferido ? 'ok' : temValor ? 'cotado' : '');
      dot.title = conferido ? `Conferido por ${_crConf[item.id].por || '?'} em ${crData(_crConf[item.id].em)} — clique pra desmarcar`
        : temValor ? 'Tem valor, mas ninguém conferiu — clique pra marcar como conferido' : 'Sem valor';
    }

    // coluna "Cotado · origem"
    const info = document.getElementById('cr_info_'+item.id);
    if(info){
      const partes = [];
      if(st.valorCotado != null){
        let txt = `cotado ${r2(st.valorCotado)}`;
        if(normPago){
          const d = normPago.totalBrl - st.valorCotado;
          if(Math.abs(d) >= 0.01){
            const pct = st.valorCotado ? (d / st.valorCotado * 100) : null;
            txt += ` <span style="color:${d > 0 ? 'var(--err)' : 'var(--ok)'};font-weight:600;" title="Real − cotado">${d > 0 ? '+' : '−'}${crFmt(Math.abs(d))}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%)` : ''}</span>`;
            if(!(containersRow && containersRow.style.display !== 'none')) txt += ` <a class="cr-link" onclick="crUsarCotado('${item.id}')">usar cotado</a>`;
          } else txt += ' <span class="cr-muted">= real</span>';
        }
        partes.push(txt);
      }
      if(st.fonte && st.fonte.lado === 'pago'){
        const atual = normPago ? normPago.totalBrl : null;
        const difere = atual == null || Math.abs(atual - st.fonte.valor) >= 0.01;
        partes.push(difere
          ? `<a class="cr-link" onclick="crUsarFonte('${item.id}')" title="${esc(st.fonte.descricao)}">puxar ${r2(st.fonte.valor)} do ${esc(st.fonte.origem)}</a>${st.fonte.pendentes ? ` <span class="cr-muted" title="Parcelas ainda sem câmbio fechado não entram na soma">(+${st.fonte.pendentes} parcela${st.fonte.pendentes===1?'':'s'} em aberto)</span>` : ''}`
          : `<span class="cr-muted" title="${esc(st.fonte.descricao)}">= ${esc(st.fonte.origem)}</span>`);
      }
      if(conferido){
        const c = _crConf[item.id];
        const origem = c.origem && !['digitado','conferido'].includes(c.origem) ? ` · ${esc(c.origem)}` : '';
        partes.push(`<span class="cr-muted">✓ ${esc(c.por || '')} ${crData(c.em)}${origem}</span>`);
      }
      info.innerHTML = partes.join('<span class="cr-sep">·</span>') || '<span class="cr-muted">—</span>';
    }

    // Cobrado do cliente (recolhido ou aberto) + margem
    const wrapC = document.getElementById('cr_cobrado_wrap_'+item.id);
    if(wrapC){
      const aberto = wrapC.dataset.aberto === '1';
      const espelho = wrapC.dataset.espelho === '1';
      const resumo = document.getElementById('cr_cobrado_resumo_'+item.id);
      const margemEl = document.getElementById('cr_margem_'+item.id);
      let margemHtml = '';
      if(!espelho && normPago && normCobradoExp){
        const m = normCobradoExp.totalBrl - normPago.totalBrl;
        margemHtml = Math.abs(m) >= 0.01
          ? `<span style="color:${m >= 0 ? 'var(--ok)' : 'var(--err)'};font-weight:600;">margem ${m >= 0 ? '+' : '−'}${crFmt(Math.abs(m))}</span>`
          : '<span class="cr-muted">margem 0,00</span>';
      }
      const fonteCobrado = (st.fonte && st.fonte.lado === 'cobrado') ? st.fonte : null;
      const fonteDifere = fonteCobrado && (!normCobradoExp || espelho || Math.abs((parseFloat(rawCobradoExp && rawCobradoExp.valor) || 0) - fonteCobrado.valor) >= 0.01 || (rawCobradoExp && rawCobradoExp.moeda && rawCobradoExp.moeda !== fonteCobrado.moeda));
      const fonteHtml = fonteCobrado
        ? (fonteDifere ? `<a class="cr-link" onclick="crUsarFonte('${item.id}')" title="${esc(fonteCobrado.descricao)}">puxar ${crSimbolo(fonteCobrado.moeda)} ${crFmt(fonteCobrado.valor)} da ${esc(fonteCobrado.origem)}</a>` : `<span class="cr-muted">= ${esc(fonteCobrado.origem)}</span>`)
        : '';
      if(resumo && !aberto){
        if(espelho){
          resumo.innerHTML = [`<span class="cr-muted">= pago</span>`, `<a class="cr-link" onclick="crAbrirCobrado('${item.id}')">cobrar diferente</a>`, fonteHtml].filter(Boolean).join('<span class="cr-sep">·</span>');
        } else {
          const valorTxt = rawCobradoExp && rawCobradoExp.porContainer
            ? (normCobradoExp ? `cobrado ${r2(normCobradoExp.totalBrl)}` : '')
            : (normCobradoExp ? `cobrado ${crSimbolo(rawCobradoExp.moeda || 'BRL')} ${crFmt(rawCobradoExp.valor)}` : '<span class="cr-muted">cobrado: vazio</span>');
          resumo.innerHTML = [valorTxt, margemHtml, `<a class="cr-link" onclick="crAbrirCobrado('${item.id}')">editar</a>`, fonteHtml].filter(Boolean).join('<span class="cr-sep">·</span>');
        }
      }
      if(margemEl) margemEl.innerHTML = aberto ? [margemHtml, fonteHtml].filter(Boolean).join('<span class="cr-sep">·</span>') : '';
    }
  });

  // Totais por grupo
  (calcularTotalizadorPorGrupo(snapshot) || []).forEach(totG => {
    const el = document.getElementById('cr_grupo_total_'+totG.slug);
    if(!el) return;
    if(!totG.temPago && !totG.temCobrado){ el.innerHTML = ''; return; }
    if(totG.apenasPago){ el.innerHTML = `custo real <strong style="color:var(--text);">${r2(totG.totalPago)}</strong>`; return; }
    const partes = [`pago <strong style="color:var(--text);">${r2(totG.totalPago)}</strong>`];
    if(totG.margem != null && Math.abs(totG.margem) >= 0.01){
      partes.push(`cobrado <strong style="color:var(--text);">${r2(totG.totalCobrado)}</strong>`);
      partes.push(`<span style="color:${totG.margem >= 0 ? 'var(--ok)' : 'var(--err)'};font-weight:600;">margem ${totG.margem >= 0 ? '+' : '−'}${crFmt(Math.abs(totG.margem))}</span>`);
    }
    el.innerHTML = partes.join(' · ');
  });

  // Notas Fiscais BOSS ao vivo
  const notasBoss = calcularNotasBoss(snapshot);
  const detalheBoss = document.getElementById('notas-boss-detalhe');
  if(detalheBoss){
    detalheBoss.innerHTML = notasBoss ? `
      <span>IR Retido (1,5%): ${r2(notasBoss.irRetido)} · ISS (2,5%): ${r2(notasBoss.iss)} · PIS (0,65%): ${r2(notasBoss.pis)} · COFINS (3%): ${r2(notasBoss.cofins)}</span>
      <span>IRPJ: ${r2(notasBoss.irpj)} · CSLL (9%): ${r2(notasBoss.csll)} · IBS (0,1%): ${r2(notasBoss.ibs)} · CBS (0,9%): ${r2(notasBoss.cbs)}</span>
      <span style="color:var(--text);font-weight:600;">Total a Receber (soma ao Lucro Real): ${r2(notasBoss.totalReceber)}</span>` : '';
  }

  crRenderCards(snapshot, estado);

  // Pacote + itens detalhados ao mesmo tempo = dinheiro contado em dobro.
  const avisoEl = document.getElementById('cr_aviso');
  if(avisoEl){
    const dup = custosReaisDuplicidadePacote(snapshot);
    avisoEl.innerHTML = dup.map(d => `<div class="cr-aviso">⚠ <strong>${esc(d.nome)}</strong> lançado como pacote (${r2(d.pacote)}) e também item a item (${d.itens.map(i => esc(i.label)).join(', ')} = ${r2(d.totalItens)}). O Custo real está contando esse dinheiro duas vezes — zere o pacote ou os itens.</div>`).join('');
  }

  // Rodapé: a mesma conta do Fechamento, pra quem rolou até o fim ver o
  // resultado sem voltar ao topo.
  const rodape = document.getElementById('custos-reais-total');
  if(rodape){
    const f = calcularFechamento(snapshot);
    rodape.innerHTML = f.custoRealTotal != null
      ? `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span style="color:var(--muted);">Custo real total: <strong style="color:var(--text);">${r2(f.custoRealTotal)}</strong></span>
          ${f.lucroReal != null ? `<span style="color:var(--muted);">Lucro real: <strong style="color:${f.lucroReal >= 0 ? 'var(--ok)' : 'var(--err)'};">${r2(f.lucroReal)}</strong>${f.pctLucroReal != null ? ` (${(f.pctLucroReal*100).toFixed(1).replace('.', ',')}%)` : ''}</span>` : `<span class="cr-muted">Informe a NF de saída na aba Documentos pra ver o lucro real.</span>`}
        </div>`
      : '';
  }
}

// Cards do topo: Receita / Custo real / Lucro real (vs cotado) / Conferidos.
// Usa calcularFechamento (controle-core.js) — a MESMA conta da aba
// Fechamento e do Dashboard Resultado, pra nunca mostrar dois lucros
// diferentes pro mesmo processo.
function crRenderCards(snapshot, estado){
  const el = document.getElementById('cr_cards');
  if(!el) return;
  const f = calcularFechamento(snapshot);
  const r2 = v => (v == null || isNaN(v)) ? '—' : 'R$ ' + crFmt(v);
  const receitaLabel = f.vendasResumo ? 'Receita (vendas)' : 'Receita (NF saída)';
  const extrasReceita = [f.jurosCobrado ? '+ juros' : '', f.notasBoss ? '+ notas Boss' : ''].filter(Boolean).join(' ');
  const lucroCor = f.lucroReal == null ? 'var(--muted)' : f.lucroReal >= 0 ? 'var(--ok)' : 'var(--err)';
  const pct = f.pctLucroReal != null ? ` <span style="font-size:12px;font-weight:600;">(${(f.pctLucroReal*100).toFixed(1).replace('.', ',')}%)</span>` : '';
  let estTxt = 'sem cotação vinculada';
  if(f.lucroEstimado != null){
    estTxt = `cotado ${r2(f.lucroEstimado)}`;
    if(f.deltaValor != null) estTxt += ` · <span style="color:${f.deltaValor >= 0 ? 'var(--ok)' : 'var(--err)'};">${f.deltaValor >= 0 ? '+' : '−'}${crFmt(Math.abs(f.deltaValor))}</span>`;
  }
  const faltam = estado.total - estado.conferidos;
  el.innerHTML = `
    <div class="cr-card"><div class="cr-card-l">${receitaLabel}</div><div class="cr-card-v">${r2(f.nfSaida)}</div><div class="cr-card-s">${f.nfSaida ? (extrasReceita || '&nbsp;') : 'informe a NF de saída na aba Documentos'}</div></div>
    <div class="cr-card"><div class="cr-card-l">Custo real</div><div class="cr-card-v">${r2(f.custoRealTotal)}</div><div class="cr-card-s">${f.custosReais ? `${f.custosReais.count} ${f.custosReais.count === 1 ? 'item' : 'itens'} no custo` : 'nenhum item lançado'}</div></div>
    <div class="cr-card"><div class="cr-card-l">Lucro real</div><div class="cr-card-v" style="color:${lucroCor};">${r2(f.lucroReal)}${pct}</div><div class="cr-card-s">${estTxt}</div></div>
    <div class="cr-card"><div class="cr-card-l">Conferidos</div><div class="cr-card-v">${estado.conferidos} <span style="font-size:12px;color:var(--muted);font-weight:500;">de ${estado.total}</span></div><div class="cr-card-s">${faltam > 0 ? `<a class="cr-link" onclick="crConferirTodos()">marcar ${faltam === 1 ? 'o restante' : `os ${faltam} restantes`} como conferido${faltam === 1 ? '' : 's'}</a>` : (estado.total ? 'tudo conferido ✓' : '&nbsp;')}</div></div>`;
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// HISTÃÂÃÂRICO ÃÂ¢ÃÂÃÂ AUDITORIA DE ALTERAÃÂÃÂÃÂÃÂES
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Marcador usado no campo "campo" de uma entrada de log pra indicar que ela
// nÃÂÃÂ£o ÃÂÃÂ© uma alteraÃÂÃÂ§ÃÂÃÂ£o normal de campo, e sim o registro de "a IA leu este
// documento e preencheu estes campos" (ver extrairComIA() e o render abaixo).
// Etiquetas manuais (pedido Ayslan 17/09/2026, substituindo as cores da
// planilha da Paula) — hoje só existe uma: "cliente pediu outro agente de
// carga" (a "amarelo grifado" da planilha antiga). Guardadas como array de
// ids em etiquetas_manuais_json (ex: ["OUTRO_AGENTE_CARGA"]) num input
// hidden, no mesmo padrão de containers_json/produtos_json.
function etiquetasManuaisTem(p, id){
  try{ return (JSON.parse(p.etiquetas_manuais_json||'[]')||[]).includes(id); }catch(e){ return false; }
}
function toggleEtiquetaManual(id, marcado){
  const el = document.getElementById('f_etiquetas_manuais_json');
  if(!el) return;
  let lista = [];
  try{ lista = JSON.parse(el.value||'[]')||[]; }catch(e){ lista = []; }
  if(marcado){ if(!lista.includes(id)) lista.push(id); }
  else { lista = lista.filter(x=>x!==id); }
  el.value = JSON.stringify(lista);
}
const LOG_CAMPO_LEITURA_IA = '📄_leitura_ia';
const LABELS_CAMPOS_IA = {
  referencia:'Referência', finalidade:'Finalidade', fornecedor:'Fornecedor/Exportador', brand:'Marca', conexos_id:'ID no Conexos',
  qtd_containers_prevista:'Qtd. Containers (previsto)', cliente:'Cliente', produto:'Produto', obs:'Observações',
  itens:'Itens/Produtos', pi_numero:'Nº PI', pi_data:'Data PI', pi_valor_usd:'Valor PI (USD)',
  pi_incoterm:'Incoterm', pi_pagamento:'Forma de pagamento', pi_pago:'PI paga',
  pi_entrada_pct:'% Entrada', pi_prazo_dias:'Prazo (dias)', pi_data_entrada:'Data Entrada', pi_data_saldo:'Data Saldo',
  pi_valor_recebido_cliente:'Valor Recebido do Cliente (R$)', pi_data_recebimento:'Data Recebimento',
  previsao_prontidao:'Previsão de prontidão', data_prontidao:'Data de prontidão',
  booking_numero:'Nº Booking', armador:'Armador', agente:'Agente de carga', navio:'Navio', viagem:'Viagem',
  valor_frete:'Valor do frete', moeda_frete:'Moeda do frete', porto_origem:'Porto de origem', porto_destino:'Porto de destino',
  etd:'ETD', eta:'ETA', free_time:'Free time', data_embarque:'Data de embarque', hbl:'HBL', mbl:'MBL',
  consignatario:'Consignatário', notify:'Notify', container:'Container', tipo_container:'Tipo de container',
  aprovacao_hbl:'Aprovação HBL', solicitacao_li:'Solicitação LI', docs_enviados_despachante:'Docs enviados à despachante',
  semana_booking:'Semana de Booking', etiquetas_manuais_json:'Etiquetas manuais',
  peso_bruto:'Peso bruto', volumes:'Volumes', data_chegada:'Data de chegada', data_presenca:'Data de presença de carga',
  demurrage_vencimento:'Vencimento Demurrage', armazenagem_vencimento:'Vencimento Armazenagem',
  data_registro_di:'Data de Registro da DI/DUIMP', di_peso_liquido:'Peso Total da DI/DUIMP', di_ncms:'NCM(s) da DI/DUIMP', numero_di:'Nº DI/DUIMP', canal:'Canal',
  data_parametrizacao:'Data de Parametrização da DI/DUIMP', data_liberacao:'Data liberação',
  ci_numero:'Nº CI', ci_data:'Data CI', ci_valor_usd:'Valor CI (USD)',
  ce_master:'CE Master', ce_house:'CE House', ce_data_embarque:'Data embarque (CE)', pendencia_revisao:'Pendência/Revisão',
  data_agendamento:'Data de agendamento', data_carregamento:'Data de carregamento',
  transportadora:'Transportadora', placa:'Placa', horario_retirada:'Horário de retirada',
  agendamento_cancelado:'Agendamento cancelado', motivo_cancelamento:'Motivo do cancelamento',
  nf_entrada_numero:'Nº NF entrada', nf_entrada_data:'Data NF entrada', nf_entrada_valor:'Valor NF entrada',
  nf_saida_numero:'Nº NF saída', nf_saida_data:'Data NF saída', nf_saida_valor:'Valor NF saída', nf_saida_cfop:'CFOP NF saída',
  data_devolucao_vazio:'Data devolução vazio', demurrage_valor:'Valor Demurrage', armazem:'Armazém',
  ric_status:'Status RIC', depot:'Depot',
  data_solicitacao_demurrage:'Data solicitação Demurrage', data_isencao_demurrage:'Data isenção Demurrage',
  data_envio_termo:'Data envio do termo', data_pagamento_lavagem:'Data pagamento lavagem', data_pagamento_demurrage:'Data pagamento Demurrage',
  despachante:'Despachante', pi_cambio:'Câmbio PI', pi_cambio_fechado:'Câmbio fechado',
  pi_cambio_entrada:'Câmbio Entrada', pi_cambio_saldo:'Câmbio Saldo', pi_cambio_banco:'Banco do câmbio', pi_cambio_custo:'Custo do câmbio', pi_cambio_codigo_bacen:'Código BACEN', pi_venc_di:'Venc. DI/DUIMP', pi_duimp_numero:'Nº DUIMP', pi_duimp_protocolo:'Chave de acesso DUIMP',
  containers_json:'Containers', produtos_json:'Produtos', vendas_json:'Vendas', pi_parcelas_json:'Parcelas de pagamento',
  duimp_numero:'Nº DUIMP',
};
// Campos cujo valor bruto e um blob JSON (lista de containers/produtos/
// vendas/parcelas) — no Historico nao faz sentido despejar o JSON inteiro
// na tela, so avisar que aquele bloco foi atualizado.
const CAMPOS_JSON_HISTORICO = new Set(['containers_json','produtos_json','vendas_json','pi_parcelas_json','etiquetas_manuais_json']);
async function carregarHistorico(processoId){
  const lista = document.getElementById('historico-lista');
  if(!lista) return;
  lista.innerHTML = '<div style="font-size:11px;color:var(--dim);">Carregando histórico...</div>';
  try{
    const r = await fetch('/api/controle/v2/processo/'+processoId+'/log');
    const d = await r.json();
  if(!_editando || _editando.id !== processoId) return;
    if(!d.ok || !d.log.length){
      lista.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Nenhuma alteração registrada ainda</div></div>';
      return;
    }
    lista.innerHTML = '<div class="log-list">' + d.log.map(l=>{
      const isLeituraIA = l.campo === LOG_CAMPO_LEITURA_IA;
      const isCampoJson = CAMPOS_JSON_HISTORICO.has(l.campo);
      const labelCampo = LABELS_CAMPOS_IA[l.campo] || l.campo || '';
      const texto = isLeituraIA
        ? ` leu o documento <strong>${esc(l.valor_antes||'?')}</strong> com IA e preencheu: ${esc(l.valor_depois||'—')}`
        : isCampoJson
        ? ` atualizou <strong>${esc(labelCampo)}</strong>`
        : ` alterou <strong>${esc(labelCampo)}</strong>: ${esc(String(l.valor_antes||'—'))} → ${esc(String(l.valor_depois||'—'))}`;
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// GED ÃÂ¢ÃÂÃÂ UPLOAD E GESTÃÂÃÂO DE ARQUIVOS DO PROCESSO
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
async function carregarArquivosGed(processoId){
  const lista = document.getElementById('ged-lista-arquivos');
  if(!lista) return;
  lista.innerHTML = '<div style="font-size:11px;color:var(--dim);">Carregando...</div>';
  try{
    const r = await fetch('/api/controle/v2/arquivos/'+processoId);
    const d = await r.json();
  if(!_editando || _editando.id !== processoId) return;
    if(!d.ok || !d.arquivos.length){
      lista.innerHTML = '<div style="font-size:11px;color:var(--dim);">Nenhum arquivo enviado ainda.</div>';
      return;
    }
    // Cópias repetidas (mesmo nome + tamanho) — botão "Remover duplicados"
    // pro gerente (pedido Ayslan 29/09/2026). Mantém sempre a mais antiga.
    const _vistos = {}; let _dups = 0;
    d.arquivos.forEach(a => { const k = a.nome+'|'+a.tamanho; if(_vistos[k]) _dups++; else _vistos[k] = 1; });
    const _souGerente = _user && _user.role === 'gerente';
    const bannerDup = _dups ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e;margin-bottom:4px;">
        <span style="flex:1;">⚠ ${_dups} cópia(s) repetida(s) neste processo (mesmo arquivo anexado mais de uma vez).</span>
        ${_souGerente ? `<button type="button" onclick="removerDuplicadosGed('${processoId}')" style="font-size:11px;font-weight:700;padding:5px 10px;border:1px solid #d97706;border-radius:6px;background:#fff;color:#92400e;cursor:pointer;">🧹 Remover duplicados</button>
        <button type="button" onclick="removerDuplicadosGed('todos','${processoId}')" style="font-size:11px;padding:5px 10px;border:1px solid #fde68a;border-radius:6px;background:transparent;color:#92400e;cursor:pointer;">Limpar todos os processos</button>` : `<span style="font-size:11px;">Peça a um gerente para remover.</span>`}
      </div>` : '';
    lista.innerHTML = bannerDup + d.arquivos.map(a=>{
      const icon = a.nome.toLowerCase().endsWith('.pdf') ? '📄' : '🖼️';
      const urlOk = /^https?:\/\//i.test(a.url||''); const hrefSafe = urlOk ? a.url : '#';
      const tamanho = a.tamanho ? (a.tamanho/1024).toFixed(0)+' KB' : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;">
        <span>${icon}</span>
        <a href="${esc(hrefSafe)}" target="_blank" rel="noopener noreferrer" style="flex:1;color:var(--ac);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.nome)}</a>
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
      else if(d.duplicado) showToast(file.name+' já estava anexado — não duplicado','info');
    }catch(e){
      showToast('Erro ao enviar '+file.name,'err');
    }
  }
  carregarArquivosGed(p.id);
}

async function removerDuplicadosGed(alvo, processoAtual){
  const todos = alvo === 'todos';
  const msg = todos
    ? 'Remover as cópias repetidas de TODOS os processos?\n\nFica sempre a cópia mais antiga de cada arquivo (mesmo nome e tamanho); as outras são apagadas de vez.'
    : 'Remover as cópias repetidas deste processo?\n\nFica a cópia mais antiga de cada arquivo; as outras são apagadas de vez.';
  if(!confirm(msg)) return;
  try{
    showToast('Removendo duplicados...','info');
    const r = await fetch('/api/controle/v2/arquivos/'+encodeURIComponent(alvo)+'/remover-duplicados', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.ok) throw new Error(d.erro || ('HTTP '+r.status));
    showToast(`✓ ${d.removidos} cópia(s) removida(s)` + (todos ? ` em ${d.processos} processo(s)` : ''),'ok');
  }catch(e){ showToast('Não foi possível remover: '+e.message,'err'); }
  carregarArquivosGed(processoAtual || alvo);
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// ATUALIZAÃÂÃÂÃÂÃÂO AUTOMÃÂÃÂTICA DE FASE EM TEMPO REAL
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ

// Quando o canal sai VERDE, nÃÂÃÂ£o hÃÂÃÂ¡ etapa de conferÃÂÃÂªncia separada ÃÂ¢ÃÂÃÂ a
// parametrizaÃÂÃÂ§ÃÂÃÂ£o ocorre na mesma data do registro da DI. SÃÂÃÂ³ preenche
// automaticamente se o campo ainda estiver vazio, para nÃÂÃÂ£o sobrescrever
// uma data de parametrizaÃÂÃÂ§ÃÂÃÂ£o jÃÂÃÂ¡ informada manualmente (ex: Amarelo/Vermelho
// que depois virou Verde apÃÂÃÂ³s reanÃÂÃÂ¡lise, mas jÃÂÃÂ¡ tinha data prÃÂÃÂ³pria).
function aplicarRegraParametrizacaoVerde(){
  const canalEl = document.getElementById('f_canal');
  const paramEl = document.getElementById('f_data_parametrizacao');
  const regEl   = document.getElementById('f_data_registro_di');
  if(!canalEl || !paramEl || !regEl) return;
  if(canalEl.value === 'VERDE' && !paramEl.value && regEl.value){
    paramEl.value = regEl.value;
  }
}

// Datas "efetivas" (Data de Embarque, Data Chegada, Data ProntidÃÂÃÂ£o Real)
// registram algo que JÃÂÃÂ ACONTECEU. Se alguÃÂÃÂ©m digitar ali uma data no
// FUTURO ÃÂ¢ÃÂÃÂ muito comum: o booking chega com uma previsÃÂÃÂ£o e a pessoa
// preenche direto no campo "de verdade" por hÃÂÃÂ¡bito, sem notar que existe um
// campo de previsÃÂÃÂ£o separado ÃÂ¢ÃÂÃÂ isso quase sempre ÃÂÃÂ© engano. Em vez de sÃÂÃÂ³
// avisar (como este arquivo fazia antes, sÃÂÃÂ³ pra Data Chegada), move o valor
// automaticamente pro campo de previsÃÂÃÂ£o correspondente (ETD/ETA/PrevisÃÂÃÂ£o
// ProntidÃÂÃÂ£o) e limpa o campo efetivo, porque por definiÃÂÃÂ§ÃÂÃÂ£o ele nÃÂÃÂ£o pode ter
// uma data que ainda nÃÂÃÂ£o aconteceu. Isso evita o processo aparecer como "jÃÂÃÂ¡
// embarcado" ou "jÃÂÃÂ¡ chegou" antes da hora sÃÂÃÂ³ por causa do campo errado ÃÂ¢ÃÂÃÂ
// consistente com a 2ÃÂÃÂª camada de proteÃÂÃÂ§ÃÂÃÂ£o que jÃÂÃÂ¡ existe em calcularFase().
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
    'data_devolucao_vazio','demurrage_vencimento','armazenagem_vencimento','free_time',
    'data_pagamento_demurrage',
  ];

  const snapshot = {..._editando};
  campos.forEach(campo=>{
    const el = document.getElementById('f_'+campo);
    if(!el) return;
    const val = el.value?.trim()||null;
    snapshot[campo] = val||null;
  });
  // demurrage_valor usa mÃÂÃÂ¡scara monetÃÂÃÂ¡ria ÃÂ¢ÃÂÃÂ nÃÂÃÂ£o pode ser lido como texto puro
  const valorDemurAtual = valorMoeda('f_demurrage_valor');
  if(valorDemurAtual!=null) snapshot.demurrage_valor = valorDemurAtual;

  const novaFase = calcularFase(snapshot);

  // Atualizar badge no header do modal
  const badge = document.getElementById('modal-fase-badge');
  if(badge){
    const fase = faseParaExibir({...snapshot, fase:novaFase});
    badge.innerHTML = `<span class="fase-badge fase-${fase.id}">${fase.icon} ${fase.label}</span>`;
  }

  // Atualizar _editando.fase para que ao salvar jÃÂÃÂ¡ venha correto
  _editando._fasePrevista = novaFase;

  // Recalcular e redesenhar o bloco "CÃÂÃÂ¡lculo do Demurrage" com os valores
  // atuais do formulÃÂÃÂ¡rio ÃÂ¢ÃÂÃÂ antes este bloco sÃÂÃÂ³ era montado uma vez, ao abrir
  // o modal, e ficava com dados desatualizados ao editar Data DevoluÃÂÃÂ§ÃÂÃÂ£o etc.
  const demurWrap = document.getElementById('demur-info-wrap');
  if(demurWrap) demurWrap.innerHTML = renderDemurInfo(snapshot);

  const armazenWrap = document.getElementById('armazen-info-wrap');
  if(armazenWrap) armazenWrap.innerHTML = renderArmazenInfo(snapshot);

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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// PAGAMENTO
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function renderPagamentoCampos(){
  const tipo = document.getElementById('f_pi_pagamento')?.value;
  const p = _editando || {};
  const el = document.getElementById('pagamento-campos');
  // Campos que só valem pra pagamento único (em Parcelado existem por parcela):
  // custo da operação, código BACEN e DI/DUIMP (venc/nº/chave — 01/10/2026).
  ['grp-pi-cambio-custo','grp-pi-cambio-bacen','grp-pi-duimp-venc','grp-pi-duimp-numero','grp-pi-duimp-protocolo'].forEach(id=>{
    const g = document.getElementById(id);
    if(g) g.style.display = (tipo==='PARCELADO') ? 'none' : '';
  });
  if(!el) return;
  if(!tipo){ el.innerHTML=''; return; }

  let html = '<div class="form-grid" style="margin-top:12px;">';
  // Valor Recebido do Cliente + Data Recebimento -- pedido do Ayslan
  // (21/09/2026): "quando a forma de pagamento for diferente do parcelado,
  // precisa ter o valor recebido do cliente e a data também". Mesmo par de
  // campos que já existe por parcela em PARCELADO (task #226), só que aqui
  // em nível de processo (colunas pi_valor_recebido_cliente/
  // pi_data_recebimento, migration 0035) -- VISTA e PRAZO têm um único
  // recebimento do cliente, não vários como no parcelado.
  const camposRecebimento = `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-top:14px;background:var(--bg);grid-column:1/-1;display:grid;gap:14px;grid-template-columns:1fr 1fr;">
      <div><label class="form-label">Valor Recebido do Cliente (R$)</label><div class="moeda-wrap"><span class="moeda-prefix">R$</span><input class="form-input" type="text" inputmode="decimal" id="f_pi_valor_recebido_cliente" placeholder="0,00" value="${p.pi_valor_recebido_cliente!=null&&p.pi_valor_recebido_cliente!==''?exibirMoeda(p.pi_valor_recebido_cliente):''}" oninput="formatarMoedaInput(this)"></div></div>
      <div><label class="form-label">Data Recebimento</label><input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_recebimento" value="${esc(p.pi_data_recebimento)}" title="Data em que o cliente pagou o câmbio pra IMPAK"></div>
    </div>`;
  if(tipo==='VISTA'){
    html+=`<div class="form-group"><label class="form-label">Data Pagamento</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_entrada" value="${esc(p.pi_data_entrada)}"></div>`
      + camposRecebimento;
  } else if(tipo==='PRAZO'){
    html+=`<div class="form-group"><label class="form-label">Prazo (dias)</label>
      <input class="form-input" type="number" id="f_pi_prazo_dias" value="${p.pi_prazo_dias||''}" oninput="atualizarDataPagamentoPrazo()"></div>
      <div class="form-group"><label class="form-label">Data Pagamento</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_saldo" value="${esc(p.pi_data_saldo)}"></div>`
      + camposRecebimento;
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
  } else if(tipo==='PARCELADO'){
    // Recarrega _parcelas a partir do processo sempre que o form entra em
    // modo Parcelado (troca de tipo de pagamento ou abertura do modal) ÃÂ¢ÃÂÃÂ
    // mesmo padrÃÂÃÂ£o de _vendas/_containers: estado vive numa variÃÂÃÂ¡vel global
    // porque as linhas sÃÂÃÂ£o adicionadas/removidas dinamicamente (sem isso nÃÂÃÂ£o
    // dÃÂÃÂ¡ pra ter "quantas parcelas forem necessÃÂÃÂ¡rias" com um botÃÂÃÂ£o +).
    if(!Array.isArray(_parcelas) || !_parcelas.length){
        try{ _parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ _parcelas = []; }
    if(!Array.isArray(_parcelas) || !_parcelas.length) _parcelas = [{...parcelaVazia(), label:'Inicial'}, {...parcelaVazia(), label:'Final'}];
      }
    html+=`<div class="form-group full">
      <label class="form-label">Parcelas (quantos câmbios forem necessários — ex.: confirmação do pedido, embarque, chegada)</label>
      <div id="parcelas-list"></div>
      <button type="button" onclick="adicionarParcela()" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--ac);cursor:pointer;font-weight:600;margin-top:4px;">+ Adicionar Parcela</button>
      <button type="button" onclick="limparParcelas()" title="Apaga todas as parcelas (depois é só Salvar)" style="background:none;border:1px dashed #fecaca;border-radius:6px;padding:5px 12px;font-size:11px;color:var(--err);cursor:pointer;font-weight:600;margin-top:4px;margin-left:6px;">🗑 Limpar parcelas</button>
      <input type="hidden" id="f_pi_parcelas_json">
    </div>`;
  }
  html+='</div>';
  el.innerHTML=html;
  // #parcelas-list sÃÂÃÂ³ existe no DOM depois do innerHTML acima ÃÂ¢ÃÂÃÂ preencher aqui.
  if(tipo==='PARCELADO'){ renderParcelas(); atualizarVencimentoSaldoPorETA(); }
}

// Venc. DI/DUIMP do pagamento único = 180 dias da Data Pagamento (mesma regra
// do botão ↻ de cada parcela em Parcelado, ver calcularVencimentoDI em
// controle-campos.js). Data Pagamento = f_pi_data_saldo (100% a Prazo) ou
// f_pi_data_entrada (À Vista) — os mesmos campos que o Controle Cambial usa
// como data do câmbio nesses dois casos.
function calcularVencDIPagamentoUnico(){
  const tipo = document.getElementById('f_pi_pagamento')?.value;
  const base = (tipo==='VISTA') ? document.getElementById('f_pi_data_entrada')?.value : (document.getElementById('f_pi_data_saldo')?.value || document.getElementById('f_pi_data_entrada')?.value);
  const el = document.getElementById('f_pi_venc_di');
  if(!el) return;
  if(!base){ showToast('Preencha a Data Pagamento primeiro (o prazo é 180 dias a partir dela)', 'warn'); return; }
  el.value = calcularVencimentoDI(base);
  el.dispatchEvent(new Event('input', {bubbles:true}));
}

// Forma "100% a Prazo": provisiona a Data Pagamento automaticamente como
// Data PI + Prazo (dias), pra nÃÂÃÂ£o depender do usuÃÂÃÂ¡rio calcular/lembrar de
// preencher na mÃÂÃÂ£o ÃÂ¢ÃÂÃÂ e sem isso o pagamento nem entrava no Dashboard
// Financeiro (listarPagamentosPI usa pi_data_saldo como vencimento pro
// "Saldo a pagar"). Roda a cada ediÃÂÃÂ§ÃÂÃÂ£o da Data PI ou do Prazo; se o usuÃÂÃÂ¡rio
// mudar a Data Pagamento manualmente depois, prevalece o valor calculado na
// ÃÂÃÂºltima ediÃÂÃÂ§ÃÂÃÂ£o de Data PI/Prazo (mesmo comportamento de "provisionar", nÃÂÃÂ£o
// de travar o campo).
// Sempre que a forma de pagamento for "100% a Prazo" ou "Parcelado"
// (parcela Final), preenche o vencimento do saldo a pagar como ETA
// Previsto - 10 dias -- ver comentário detalhado acima de
// atualizarDataPagamentoPrazo(). Isso faz o câmbio futuro já aparecer no
// Controle Cambial antes mesmo de haver Data de Embarque Efetiva (que só
// existe mais pra frente no processo).
// 24/09/2026 (Paula): passou a ACOMPANHAR o ETA/Chegada -- antes só
// preenchia se estivesse vazio, e quando o navio atrasava o vencimento
// ficava no ETA antigo (processo aparecia como câmbio "atrasado"). Regra da
// planilha dela: pagamento = chegada - 10 dias. Exceções: câmbio já
// fechado/pago, e 100% a Prazo com "Prazo (dias)" (conta do embarque).
function atualizarVencimentoSaldoPorETA(){
  const chegada = document.getElementById('f_data_chegada')?.value;
  const eta = chegada || document.getElementById('f_eta')?.value;
  if(!eta) return;
  const d = parseDataLocal(eta);
  if(!d) return;
  d.setDate(d.getDate() - 10);
  const vencimento = d.toISOString().split('T')[0];
  const tipo = document.getElementById('f_pi_pagamento')?.value;
  if(tipo === 'PRAZO'){
    const destino = document.getElementById('f_pi_data_saldo');
    const prazoDias = parseInt(document.getElementById('f_pi_prazo_dias')?.value, 10);
    const pago = document.getElementById('f_pi_pago')?.value === 'true';
    if(destino && !prazoDias && !pago && destino.value !== vencimento){ destino.value = vencimento; try{ renderPagamentoInfoLive(); }catch(e){} }
  } else if(tipo === 'PARCELADO' && Array.isArray(_parcelas)){
    const idx = _parcelas.findIndex(pc => pc.label === 'Final');
    if(idx !== -1 && !_parcelas[idx].cambio_fechado && _parcelas[idx].data_vencimento !== vencimento){
      _parcelas[idx].data_vencimento = vencimento;
      renderParcelas();
      renderPagamentoInfoLive();
    }
  }
}

function atualizarDataPagamentoPrazo(){
  if(document.getElementById('f_pi_pagamento')?.value !== 'PRAZO') return;
  // Prazo SÓ conta a partir da Data de Embarque Efetiva (pedido Paula/Ayslan
  // 17/09/2026, revisando a regra #413) -- NUNCA mais cai de volta pra Data
  // PI. Calcular em cima da PI dava uma Data Pagamento "estimada" cedo
  // demais e enganosa (o pedido pode levar meses pra embarcar de verdade),
  // fazendo o processo parecer com vencimento definido quando na prática
  // ainda nem embarcou. Sem embarque, limpa o campo -- o pagamento entra
  // como "sem vencimento calculável" no Dashboard Financeiro (grupo já
  // existente pra isso), sinalizando a pendência real em vez de escondê-la
  // atrás de uma data inventada.
  const destino = document.getElementById('f_pi_data_saldo');
  if(!destino) return;
  const dataEmbarque = document.getElementById('f_data_embarque')?.value;
  const prazo = parseInt(document.getElementById('f_pi_prazo_dias')?.value, 10);
  if(!dataEmbarque || !prazo){
    destino.value = '';
    renderPagamentoInfoLive();
    return;
  }
  const d = parseDataLocal(dataEmbarque);
  if(!d) return;
  d.setDate(d.getDate() + prazo);
  destino.value = d.toISOString().split('T')[0];
  renderPagamentoInfoLive();
}

// Recalcula e redesenha o resumo de pagamento (pagamento-box) quando o usuÃÂÃÂ¡rio
// edita % de entrada ou os cÃÂÃÂ¢mbios, sem precisar salvar/reabrir o modal.
function renderPagamentoInfoLive(){
  if(!_editando) return;
  const snapshot = {..._editando};
  // BUG #340 ÃÂ¢ÃÂÃÂ snapshot herdava pi_pagamento de _editando (o valor salvo no
  // banco), nunca do <select> na tela. Resultado: trocar a Forma de
  // Pagamento (ex.: ENTRADA_SALDO salvo ÃÂ¢ÃÂÃÂ escolher PARCELADO) e digitar
  // qualquer cÃÂÃÂ¢mbio disparava este redraw usando o tipo ANTIGO, entÃÂÃÂ£o o
  // resumo (pagamento-box) mostrava "Entrada + Saldo (legado)" de novo ÃÂ¢ÃÂÃÂ o
  // usuÃÂÃÂ¡rio via isso como "o formulÃÂÃÂ¡rio reverteu sozinho", mesmo com o
  // <select> e as parcelas continuando corretos por trÃÂÃÂ¡s. _editando.pi_pagamento
  // sÃÂÃÂ³ ÃÂÃÂ© atualizado de fato no Salvar (coletarESalvar), entÃÂÃÂ£o tem que ler o
  // tipo atual direto do DOM aqui tambÃÂÃÂ©m, nÃÂÃÂ£o sÃÂÃÂ³ pra decidir se anexa
  // pi_parcelas_json (como jÃÂÃÂ¡ fazia abaixo).
  const tipoAtual = document.getElementById('f_pi_pagamento')?.value;
  if(tipoAtual) snapshot.pi_pagamento = tipoAtual;
  const prazo = document.getElementById('f_pi_prazo_dias')?.value;
  if(prazo!=null && prazo!=='') snapshot.pi_prazo_dias = prazo;
  const pct = document.getElementById('f_pi_entrada_pct')?.value;
  if(pct!=null && pct!=='') snapshot.pi_entrada_pct = pct;
  const ce = parseFloat(document.getElementById('f_pi_cambio_entrada')?.value) || null;
  const cs = parseFloat(document.getElementById('f_pi_cambio_saldo')?.value) || null;
  if(ce!=null) snapshot.pi_cambio_entrada = ce;
  if(cs!=null) snapshot.pi_cambio_saldo = cs;
  // Parcelado: usa o array em memÃÂÃÂ³ria (ainda nÃÂÃÂ£o salvo) pra refletir ao vivo
  // toda linha adicionada/editada/removida, igual ao resto do resumo.
  if(tipoAtual==='PARCELADO') snapshot.pi_parcelas_json = JSON.stringify(_parcelas);
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
    rows=`<div class="pagamento-row"><span>Pagamento à vista</span><span>USD ${val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
    <div class="pagamento-row"><span>Estimativa BRL</span><span>R$ ${brl.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
  } else if(p.pi_pagamento==='PRAZO'){
    rows=`<div class="pagamento-row"><span>Pagamento a prazo (${p.pi_prazo_dias||0}d)</span><span>USD ${val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
  } else if(p.pi_pagamento==='ENTRADA_SALDO'){
    const pct = parseFloat(p.pi_entrada_pct||30)/100;
    const ent = val*pct; const sld = val*(1-pct);
    const cambioEnt = parseFloat(p.pi_cambio_entrada) || _cambio.USD;
    const cambioSld = parseFloat(p.pi_cambio_saldo)   || _cambio.USD;
    const entBRL = ent*cambioEnt; const sldBRL = sld*cambioSld;
    rows=`<div class="pagamento-row"><span>Entrada (${p.pi_entrada_pct||30}%) · câmbio ${cambioEnt.toLocaleString('pt-BR',{minimumFractionDigits:4})}</span><span>USD ${ent.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} · R$ ${entBRL.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
    <div class="pagamento-row"><span>Saldo (${100-(p.pi_entrada_pct||30)}%) · câmbio ${cambioSld.toLocaleString('pt-BR',{minimumFractionDigits:4})}</span><span>USD ${sld.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} · R$ ${sldBRL.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
    <div class="pagamento-row"><span>Total</span><span>USD ${val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} · R$ ${(entBRL+sldBRL).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
  } else if(p.pi_pagamento==='PARCELADO'){
    let parcelas = [];
    try{ parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ parcelas = []; }
    let totalUsd = 0, totalBrl = 0;
    parcelas.forEach((pc,i)=>{
      const v = parseFloat(pc.valor_usd)||0;
      const c = parseFloat(pc.cambio_fechado) || _cambio.USD;
      const brlPc = v*c;
      totalUsd += v; totalBrl += brlPc;
      const venc = pc.data_vencimento ? ' · ' + parseDataLocal(pc.data_vencimento).toLocaleDateString('pt-BR') : '';
      rows += `<div class="pagamento-row"><span>${esc(pc.label)||('Parcela '+(i+1))} · câmbio ${c.toLocaleString('pt-BR',{minimumFractionDigits:4})}${venc}</span><span>USD ${v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} · R$ ${brlPc.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
    });
    rows += `<div class="pagamento-row"><span>Total (${parcelas.length} parcela${parcelas.length===1?'':'s'})</span><span>USD ${totalUsd.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} · R$ ${totalBrl.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
    // Como cada parcela usa valor fixo em USD (nÃÂÃÂ£o %), nÃÂÃÂ£o hÃÂÃÂ¡ garantia
    // automÃÂÃÂ¡tica de que a soma bate com o Valor USD da PI ÃÂ¢ÃÂÃÂ sinalizar em vez
    // de deixar passar batido (percentual, ao contrÃÂÃÂ¡rio, sempre soma 100%).
    if(val && Math.abs(totalUsd-val) > 0.01){
      rows += `<div class="pagamento-row" style="color:#b45309;"><span>⚠ Parcelas somam USD ${totalUsd.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}, mas o Valor USD da PI é USD ${val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span><span></span></div>`;
    }
  }
  return `<div class="pagamento-box" style="margin-top:12px;">${rows}</div>`;
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// COLETAR E SALVAR
// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function marcarPendenciaRevisada(){
  const el = document.getElementById('f_pendencia_revisao');
  if(el) el.value = '';
  const banner = document.getElementById('alerta-pendencia');
  if(banner) banner.style.display = 'none';
  coletarESalvar();
  showToast('✓ Pendência marcada como revisada', 'ok');
}


// BotÃÂÃÂ£o "Vincular ao Calculador" (item e) ÃÂ¢ÃÂÃÂ abre o Calculador em uma nova
// aba, jÃÂÃÂ¡ preenchendo o wizard com os dados deste processo, pra gerar uma
// cotaÃÂÃÂ§ÃÂÃÂ£o (estimativa) de um processo que comeÃÂÃÂ§ou direto no Controle.
function vincularProcessoAoCalculador(processoId){
  window.open(`/calculador?processo_id=${processoId}`, '_blank');
}


function toggleMotivoCancelamento(){
  const sel = document.getElementById('f_agendamento_cancelado');
  const wrap = document.getElementById('wrap_motivo_cancelamento');
  if(sel && wrap) wrap.style.display = sel.value === 'true' ? 'block' : 'none';
}
