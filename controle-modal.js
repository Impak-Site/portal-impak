// controle-modal.js
//
// Painel lateral do processo: abrir/fechar, render das abas (timeline, alertas, conteÃÂºdo), histÃÂ³rico, arquivos GED, parametrizaÃÂ§ÃÂ£o, troca de aba, pagamento (PI).
//
// Parte do controle_v2.html, extraÃÂ­do do <script> ÃÂºnico original pra
// facilitar manutenÃÂ§ÃÂ£o. Carregado via <script src> junto com os outros
// mÃÂ³dulos (ver controle_v2.html) Ã¢ÂÂ nÃÂ£o ÃÂ© um ES module, entÃÂ£o todo
// estado (let/const de topo) e funÃÂ§ÃÂµes aqui continuam visÃÂ­veis pros
// outros arquivos, exatamente como estavam quando tudo era um sÃÂ³
// <script>. controle-core.js precisa carregar ANTES dos demais (ÃÂ©
// quem declara o estado global: _processos, _user, FASES etc.).
//
function abrirNovo(){
  // _camposIA rastreia, NESTA sessÃÂ£o de ediÃÂ§ÃÂ£o, quais campos foram preenchidos
  // pela ÃÂºltima leitura de IA (nÃÂ£o pelo usuÃÂ¡rio digitando) Ã¢ÂÂ usado por
  // extrairComIA() pra saber se pode corrigir um campo jÃÂ¡ preenchido quando
  // um documento novo (ex: o certo, depois de um errado) trouxer outro valor.
  // NÃÂ£o ÃÂ© salvo no banco (propositalmente prefixado com _, igual _fasePrevista
  // e _savedAt jÃÂ¡ removidos antes do save) Ã¢ÂÂ reseta a cada vez que o processo
  // ÃÂ© reaberto, o que cobre o caso real relatado (corrigir dentro da mesma
  // sessÃÂ£o de ediÃÂ§ÃÂ£o, logo apÃÂ³s perceber o documento errado).
  _editando = { fase:'PI', free_time:21, _camposIA: {} };
  _editandoOriginal = {};
  renderModal();
}

async function abrirProcesso(id){
  const proc = _processos.find(p=>p.id===id);
  if(!proc) return;
  _editando = {...proc, _camposIA: {}};
    _parcelas = []; // task #340b: forÃ§a recarregar parcelas do processo certo ao trocar de processo
  _editandoOriginal = {...proc};
  renderModal();
  // URL por processo (task #59) Ã¢ÂÂ deep link/bookmark + botÃÂ£o voltar do navegador
  const novaUrl = _baseUrlPath.replace(/\/$/,'') + '/' + encodeURIComponent(proc.referencia);
  if(location.pathname !== novaUrl) history.pushState({processoId:proc.id}, '', novaUrl);
}

function copiarReferencia(){
  const ref = _editando && _editando.referencia;
  if(!ref) return;
  navigator.clipboard.writeText(ref).then(function(){
    showToast('ReferÃÂªncia copiada: ' + ref, 'ok');
  }, function(){
    showToast('NÃÂ£o foi possÃÂ­vel copiar Ã¢ÂÂ copie manualmente: ' + ref, 'err');
  });
}

function fecharModal(){
  _editando = null;
  document.getElementById('modal-bg').classList.remove('open');
  // Volta a URL pra tela de baixo (/controle ou /financeiro) sem recarregar a pÃÂ¡gina.
  if(location.pathname !== _baseUrlPath) history.pushState(null, '', _baseUrlPath);
}

// Se o usuÃÂ¡rio editar manualmente um campo que a IA tinha preenchido antes,
// esse campo "vira dele" Ã¢ÂÂ deixa de poder ser sobrescrito automaticamente por
// uma leitura de IA seguinte, protegendo a correÃÂ§ÃÂ£o manual do usuÃÂ¡rio. SÃÂ³
// reage a eventos reais do teclado/mouse: setar .value via JS (como a prÃÂ³pria
// extraÃÂ§ÃÂ£o faz) nÃÂ£o dispara 'input', entÃÂ£o isso nunca conflita com a IA.
document.addEventListener('input', function(e){
  if(!_editando || !_editando._camposIA) return;
  const id = e.target && e.target.id;
  if(!id || !id.startsWith('f_')) return;
  const campo = id.slice(2);
  if(_editando._camposIA[campo]) delete _editando._camposIA[campo];
});

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// MODAL Ã¢ÂÂ RENDER
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function renderModal(){
  const p = _editando;
  const isNovo = !p.id;
  const fase = FASES.find(f=>f.id===p.fase)||FASES[0];

  document.getElementById('modal-title').textContent = isNovo ? 'Novo Processo' : p.referencia;
  const btnCopiarRef = document.getElementById('btn-copiar-ref');
  if(btnCopiarRef) btnCopiarRef.style.display = isNovo ? 'none' : '';
  document.getElementById('modal-fase-badge').innerHTML = `<span class="fase-badge fase-${p.fase}">${fase.icon} ${fase.label}</span>`;
  document.getElementById('modal-bg').classList.add('open');


  // Ã¢ÂÂÃ¢ÂÂ ABAS Ã¢ÂÂÃ¢ÂÂ
  const TABS = [
    {id:'identificacao', label:'Ã°ÂÂÂ IdentificaÃÂ§ÃÂ£o'},
    {id:'financeiro',    label:'Ã°ÂÂÂ° Financeiro'},
    {id:'fechamento',    label:'Ã°ÂÂÂ Fechamento'},
    {id:'custosreais',   label:'Ã°ÂÂÂµ Custos Reais'},
    {id:'vendas',        label:'Ã°ÂÂ§Â¾ Vendas'},
    {id:'logistica',     label:'Ã°ÂÂÂ¢ LogÃÂ­stica'},
    {id:'documentos',    label:'Ã°ÂÂÂ Documentos'},
    {id:'historico',     label:'Ã°ÂÂÂ HistÃÂ³rico'},
  ];
  const temAlerta = verificarAlertas(p, false).length > 0;
  const tabsHtml = TABS.map(t =>
    `<div class="modal-tab ${t.id==='identificacao'?'active':''}" onclick="trocarAba('${t.id}')" id="tab-${t.id}">
      ${t.label}${t.id==='identificacao'&&temAlerta?'<span class="tab-alert"></span>':''}
    </div>`
  ).join('');
  document.getElementById('modal-tabs').innerHTML = tabsHtml;

  // Ã¢ÂÂÃ¢ÂÂ TIMELINE com datas Ã¢ÂÂÃ¢ÂÂ
  const faseIdx = FASES.findIndex(f=>f.id===p.fase);
  // Mapa fase Ã¢ÂÂ data do processo
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
        <div class="tl-dot ${cls}">${done?'Ã¢ÂÂ':f.icon}</div>
        <div class="tl-label">${f.label}</div>
        ${dataStr}
      </div>`;
  }).join('');

  // Ã¢ÂÂÃ¢ÂÂ ALERTAS Ã¢ÂÂÃ¢ÂÂ
  const alertas = verificarAlertas(p, false);
  const alertasHtml = alertas.map(a=>
    `<div style="padding:8px 12px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:8px;font-size:12px;color:var(--err);margin-bottom:8px;font-weight:600;">Ã°ÂÂÂ¨ ${a.titulo}: ${a.mensagem}</div>`
  ).join('');

  // Ã¢ÂÂÃ¢ÂÂ CONTEÃÂDO DAS ABAS Ã¢ÂÂÃ¢ÂÂ
  const finInfo = p.pi_pagamento ? renderPagamentoInfo(p) : '';

  // ConfirmaÃÂ§ÃÂ£o visual demurrage (calculada dinamicamente Ã¢ÂÂ ver renderDemurInfo)
  let demurInfo = renderDemurInfo(p);

  // Ã¢ÂÂÃ¢ÂÂ TRAVA DE PROCESSO ("Fechar Processo") Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  // Quando fechado, o conteÃÂºdo do modal fica visualmente desabilitado
  // (opacity + pointer-events:none) dentro do wrapper abaixo Ã¢ÂÂ a validaÃÂ§ÃÂ£o
  // que de fato impede a ediÃÂ§ÃÂ£o ÃÂ© no servidor (ver server.js: POST /api/
  // controle/v2/processo), isto aqui ÃÂ© sÃÂ³ pra nÃÂ£o deixar o usuÃÂ¡rio tentar
  // editar um processo travado sem perceber.
  const bloqueado = !!p.fechado;
  const podeDestravar = _user && _user.role === 'gerente';
  const bannerTrava = bloqueado
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:rgba(0,0,0,.04);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text);"><strong>Ã°ÂÂÂ Processo fechado</strong>${p.fechado_em?` em ${new Date(p.fechado_em).toLocaleString('pt-BR')}`:''}${p.fechado_por?` por ${esc(p.fechado_por)}`:''} Ã¢ÂÂ ediÃÂ§ÃÂ£o travada.</div>
        ${podeDestravar ? `<button type="button" class="btn btn-outline" onclick="reabrirProcesso('${p.id}')">Ã°ÂÂÂ Reabrir para editar</button>` : `<span style="font-size:11px;color:var(--muted);">SÃÂ³ um gerente pode reabrir.</span>`}
      </div>`
    : '';

  document.getElementById('modal-body').innerHTML = `
    ${bannerTrava}
    <div id="modal-body-lockwrap" style="${bloqueado?'opacity:.55;pointer-events:none;user-select:none;':''}">
    <!-- ABA: IDENTIFICAÃÂÃÂO -->
    <div class="tab-pane active" id="pane-identificacao">
      <div class="timeline">${timeline}</div>
      ${alertasHtml}
      <!-- IA -->
      <div class="form-section" style="background:rgba(26,127,212,.04);border:1px solid rgba(26,127,212,.15);border-radius:10px;padding:14px 16px;margin-bottom:20px;">
        <div class="form-section-title" style="border:none;margin-bottom:8px;">Ã°ÂÂ¤Â ExtraÃÂ§ÃÂ£o com IA</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Envie uma PI, CI ou BL para preencher os campos automaticamente</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="file" id="ia-doc-file" accept=".pdf,.png,.jpg,.jpeg" style="display:none" onchange="extrairComIA(this)">
          <button class="btn btn-outline" onclick="document.getElementById('ia-doc-file').click()">Ã°ÂÂÂ Selecionar documento</button>
          <span id="ia-status" style="font-size:12px;color:var(--muted);"></span>
        </div>
      </div>
      <!-- Alerta de pendÃÂªncia de revisÃÂ£o (vem da importaÃÂ§ÃÂ£o de planilha) -->
      <div id="alerta-pendencia" style="display:${p.pendencia_revisao ? 'block' : 'none'};background:rgba(243,156,18,.1);border:1px solid rgba(243,156,18,.4);border-left:4px solid #f39c12;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
        <div style="font-weight:700;color:#f39c12;font-size:13px;margin-bottom:6px;">Ã¢ÂÂ  PendÃÂªncia de revisÃÂ£o (da importaÃÂ§ÃÂ£o de planilha)</div>
        <div id="texto-pendencia" style="font-size:12px;color:var(--text);white-space:pre-line;line-height:1.6;">${esc(p.pendencia_revisao)}</div>
        <input type="hidden" id="f_pendencia_revisao" value="${esc(p.pendencia_revisao)}">
        <button type="button" class="btn btn-outline" style="margin-top:10px;font-size:12px;" onclick="marcarPendenciaRevisada()">Ã¢ÂÂ Marcar como revisado</button>
      </div>
      <!-- IdentificaÃÂ§ÃÂ£o -->
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ IdentificaÃÂ§ÃÂ£o</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">ReferÃÂªncia *</label>
            <input class="form-input" id="f_referencia" value="${esc(p.referencia)}" placeholder="Ex: UD25-340"></div>
          <div class="form-group"><label class="form-label">Finalidade</label>
            <select class="form-input" id="f_finalidade">
              <option value="">Ã¢ÂÂ selecionar Ã¢ÂÂ</option>
              <option value="IMPORTACAO_DIRETA" ${p.finalidade==='IMPORTACAO_DIRETA'?'selected':''}>ImportaÃÂ§ÃÂ£o PrÃÂ³pria (Direto)</option>
              <option value="ENCOMENDA" ${p.finalidade==='ENCOMENDA'?'selected':''}>Encomenda</option>
              <option value="CONTA_E_ORDEM" ${p.finalidade==='CONTA_E_ORDEM'?'selected':''}>Conta e Ordem</option>
            </select></div>
          <div class="form-group" style="position:relative"><label class="form-label">Fornecedor (Exportador)</label>
            <input class="form-input" id="f_fornecedor" value="${esc(p.fornecedor)}" placeholder="Ex: EUDEMON" autocomplete="off"
              oninput="autocompletarContato(this,'FORNECEDOR,EXPORTADOR','fornecedor-dropdown')">
            <div id="fornecedor-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group"><label class="form-label">Marca (Brand)</label>
            <input class="form-input" id="f_brand" value="${esc(p.brand)}" placeholder="Ex: Maxam Ã¢ÂÂ deixe em branco se marca = fornecedor">
          </div>
          <div class="form-group" style="position:relative"><label class="form-label">Cliente</label>
            <input class="form-input" id="f_cliente" value="${esc(p.cliente)}" autocomplete="off"
              oninput="autocompletarContato(this,'CLIENTE','cliente-dropdown')" placeholder="Digite razÃÂ£o social, CNPJ ou cidade...">
            <div id="cliente-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
          </div>
          <div class="form-group" style="position:relative"><label class="form-label">ConsignatÃÂ¡rio</label>
<input class="form-input" id="f_consignatario" value="${esc(p.consignatario)}" placeholder="Consignee do BL/DI Ã¢ÂÂ pode ser diferente do Cliente" autocomplete="off"
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
          <div class="form-group full"><label class="form-label">ObservaÃÂ§ÃÂµes</label>
            <input class="form-input" id="f_obs" value="${esc(p.obs)}"></div>
        </div>
      </div>
      <!-- AÃÂ§ÃÂµes -->
      <div style="display:flex;gap:10px;justify-content:space-between;padding-top:16px;border-top:1px solid var(--border);">
        <div style="display:flex;gap:10px;">
          ${p.id?`<button class="btn" onclick="excluirProcesso('${p.id}')" style="background:var(--err-bg);color:var(--err);border:1px solid rgba(220,38,38,.2);">Ã°ÂÂÂ Excluir</button>`:''}
          ${p.id && !bloqueado?`<button class="btn btn-outline" onclick="fecharProcesso('${p.id}')" title="Trava NF, Custos Reais e o resultado Ã¢ÂÂ sÃÂ³ gerente pode reabrir depois">Ã°ÂÂÂ Fechar Processo</button>`:''}
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="coletarESalvar()">Ã°ÂÂÂ¾ Salvar</button>
        </div>
      </div>
    </div>

    <!-- ABA: FINANCEIRO -->
    <div class="tab-pane" id="pane-financeiro">
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ° Proforma Invoice (PI)</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">NÃÂº PI</label>
            <input class="form-input" id="f_pi_numero" value="${esc(p.pi_numero)}"></div>
          <div class="form-group"><label class="form-label">Data PI</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" oninput="atualizarDataPagamentoPrazo()" id="f_pi_data" value="${esc(p.pi_data)}"></div>
          <div class="form-group"><label class="form-label">Valor USD</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_pi_valor_usd" value="${exibirMoeda(p.pi_valor_usd)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">CÃÂ¢mbio na PI (R$)</label>
            <input class="form-input" type="number" id="f_pi_cambio" value="${p.pi_cambio||''}" placeholder="${_cambio.USD.toFixed(2)}" step="0.0001">
          </div>
          <div class="form-group"><label class="form-label">CÃÂ¢mbio Fechado (R$)</label>
            <input class="form-input" type="number" id="f_pi_cambio_fechado" value="${p.pi_cambio_fechado||''}" placeholder="preenchido ao confirmar o cÃÂ¢mbio" step="0.0001"
              title="Taxa que realmente foi paga (vem do comprovante de cÃÂ¢mbio, pra Pagamento ÃÂnico/Prazo). Fica separado de 'CÃÂ¢mbio na PI' de propÃÂ³sito Ã¢ÂÂ aquele ÃÂ© a previsÃÂ£o, este ÃÂ© o fechado, pra dar pra comparar os dois no Dashboard Financeiro.">
          </div>
          <div class="form-group"><label class="form-label">Incoterm</label>
            <select class="form-input" id="f_pi_incoterm">
              <option value="">Ã¢ÂÂ</option>
              <option value="EXW" ${p.pi_incoterm==='EXW'?'selected':''}>EXW</option>
              <option value="FCA" ${p.pi_incoterm==='FCA'?'selected':''}>FCA</option>
              <option value="FOB" ${p.pi_incoterm==='FOB'?'selected':''}>FOB</option>
              <option value="CFR" ${p.pi_incoterm==='CFR'?'selected':''}>CFR</option>
              <option value="CIF" ${p.pi_incoterm==='CIF'?'selected':''}>CIF</option>
              <option value="CPT" ${p.pi_incoterm==='CPT'?'selected':''}>CPT</option>
            </select></div>
          <div class="form-group"><label class="form-label">Forma de Pagamento</label>
            <select class="form-input" id="f_pi_pagamento" onchange="renderPagamentoCampos()" onwheel="this.blur()">
              <option value="">Ã¢ÂÂ</option>
              <option value="VISTA"        ${p.pi_pagamento==='VISTA'?'selected':''}>100% ÃÂ  Vista</option>
              <option value="PRAZO"        ${p.pi_pagamento==='PRAZO'?'selected':''}>100% a Prazo</option>
              <option value="PARCELADO"    ${p.pi_pagamento==='PARCELADO'?'selected':''}>Parcelado</option>
              <!-- "Entrada + Saldo" foi substituÃÂ­da por "Parcelado" (suporta quantos
                   cÃÂ¢mbios forem necessÃÂ¡rios, nÃÂ£o sÃÂ³ 2) Ã¢ÂÂ este option some do
                   dropdown pra processos novos, mas continua aqui (sÃÂ³ oculto via
                   CSS) e SELECIONÃÂVEL/exibido quando o processo jÃÂ¡ usa esse valor,
                   pra nÃÂ£o quebrar/perder a forma de pagamento de processos antigos
                   ao simplesmente abrir e salvar o cadastro de novo. -->
              <option disabled${p.pi_pagamento!=='ENTRADA_SALDO'?' style="display:none"':''}>Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ</option>
<option value="ENTRADA_SALDO"${p.pi_pagamento==='ENTRADA_SALDO'?'selected':''}${p.pi_pagamento!=='ENTRADA_SALDO'?' style="display:none"':''}>Entrada + Saldo (legado)</option>
            </select></div>
          <div class="form-group"><label class="form-label">PI Paga?</label>
            <select class="form-input" id="f_pi_pago">
              <option value="false" ${!p.pi_pago?'selected':''}>NÃÂ£o</option>
              <option value="true"  ${p.pi_pago?'selected':''}>Sim Ã¢ÂÂ</option>
            </select></div>
        </div>
        <div id="pagamento-campos"></div>
        ${finInfo}
      </div>
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂµ Commercial Invoice (CI)</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">NÃÂº CI</label>
            <input class="form-input" id="f_ci_numero" value="${esc(p.ci_numero)}"></div>
          <div class="form-group"><label class="form-label">Data CI</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_ci_data" value="${esc(p.ci_data)}"></div>
          <div class="form-group"><label class="form-label">Valor CI (USD)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_ci_valor_usd" value="${exibirMoeda(p.ci_valor_usd)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">Ã°ÂÂÂ¾ Salvar</button>
      </div>
    </div>

    <!-- ABA: FECHAMENTO -->
    <div class="tab-pane" id="pane-fechamento">
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ Fechamento Ã¢ÂÂ Estimado ÃÂ Real</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Compara o que foi cotado no Calculador (na hora de aprovar a cotaÃÂ§ÃÂ£o) com o resultado real do processo, calculado a partir da NF Entrada e NF SaÃÂ­da lanÃÂ§adas na aba Documentos.
        </div>
        ${renderFechamentoInfo(p)}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">Ã°ÂÂÂ¾ Salvar</button>
      </div>
    </div>

    <!-- ABA: CUSTOS REAIS -->
    <div class="tab-pane" id="pane-custosreais">
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂµ Custos Reais Ã¢ÂÂ apuraÃÂ§ÃÂ£o de lucro item a item</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Lance aqui o que realmente foi pago em cada item (FOB, frete, seguro, impostos, comissÃÂµes e taxas operacionais). Quando o processo veio de uma cotaÃÂ§ÃÂ£o aprovada, cada campo jÃÂ¡ nasce preenchido com o valor cotado Ã¢ÂÂ ajuste sÃÂ³ o que saiu diferente. Assim que tiver pelo menos um item aqui, o Lucro Real na aba Fechamento passa a usar esse detalhamento em vez do cÃÂ¡lculo simples por NF.
        </div>
        <!-- Importar direto da planilha de Fechamento (mesmo template BASE
        SP/SC usado antes de existir esta tela) Ã¢ÂÂ lÃÂª a aba "Fechamento" e
        preenche os campos "Pago" abaixo + as datas de Embarque/Chegada/
        Registro DI (aba Documentos), sem precisar digitar tudo de novo.
        Reaproveita POST /api/controle/importar-fechamento (server-side,
        planilha-import.js) Ã¢ÂÂ o usuÃÂ¡rio sempre revisa/ajusta antes de salvar. -->
        <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <input type="file" id="import-fechamento-input" accept=".xlsm,.xlsx" style="display:none" onchange="importarFechamentoProcesso(this)">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('import-fechamento-input').click()">Ã°ÂÂÂ¥ Importar planilha de Fechamento</button>
          ${!p.custos_reais_json ? `
          <button type="button" class="btn btn-outline" onclick="vincularProcessoAoCalculador('${p.id}')" title="Cria uma cotaÃÂ§ÃÂ£o no Calculador jÃÂ¡ prÃÂ©-preenchida com os dados deste processo, pra registrar a estimativa/fechamento">Ã°ÂÂ§Â® Vincular ao Calculador</button>
          ` : ''}
        </div>
        ${renderCustosReaisTab(p)}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarCustosReaisTab()">Ã°ÂÂÂ¾ Salvar Custos Reais</button>
      </div>
    </div>

    <!-- ABA: VENDAS (multi-cliente / rateio de custo) -->
    <div class="tab-pane" id="pane-vendas">
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂ§Â¾ Vendas Ã¢ÂÂ um processo, vÃÂ¡rios clientes</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Use esta aba quando este processo (Direto, Encomenda ou Conta e Ordem) foi vendido pra mais de um cliente Ã¢ÂÂ ex.: meio contÃÂªiner pra um, meio pra outro. Cada venda tem seu prÃÂ³prio cliente e NF SaÃÂ­da. Os custos lanÃÂ§ados na aba Custos Reais sÃÂ£o rateados automaticamente entre as vendas, proporcional ÃÂ  quantidade que cada uma levou; custos que sÃÂ³ existiram por causa de um cliente especÃÂ­fico (ex.: um frete extra) podem ser lanÃÂ§ados direto naquela venda, sem entrar no rateio. Se este processo tem um ÃÂºnico cliente/NF SaÃÂ­da, nÃÂ£o precisa usar esta aba.
        </div>
        <div id="vendas-list"></div>
        <button type="button" onclick="adicionarVenda()" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:6px 14px;font-size:12px;color:var(--ac);cursor:pointer;font-weight:600;margin-top:4px;">+ Adicionar Venda</button>
        <input type="hidden" id="f_vendas_json">
        <div id="vendas-resumo"></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">Ã°ÂÂÂ¾ Salvar</button>
      </div>
    </div>

    <!-- ABA: LOGÃÂSTICA -->
    <div class="tab-pane" id="pane-logistica">
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ­ ProntidÃÂ£o</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">PrevisÃÂ£o ProntidÃÂ£o</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_previsao_prontidao" value="${esc(p.previsao_prontidao)}"></div>
          <div class="form-group"><label class="form-label">Data ProntidÃÂ£o Real</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_prontidao" value="${esc(p.data_prontidao)}"
              onchange="moverDataFuturaParaPrevisao('f_data_prontidao','f_previsao_prontidao','PrevisÃÂ£o ProntidÃÂ£o')"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ¦ Booking & Embarque</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">NÃÂº Booking</label>
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
              <option value="EUR" ${p.moeda_frete==='EUR'?'selected':''}>EUR (Ã¢ÂÂ¬)</option>
            </select></div>
          <div class="form-group"><label class="form-label">Porto Origem</label>
            <select class="form-input" id="f_porto_origem" onchange="togglePortoOutro('origem')">${gerarOptionsPortoOrigem(p.porto_origem)}</select>
            <input class="form-input" id="f_porto_origem_outro" value="${esc(PORTOS_ORIGEM.includes((p.porto_origem||'').toUpperCase())?'':p.porto_origem)}"
              placeholder="Digite o porto de origem" style="display:${(p.porto_origem && !PORTOS_ORIGEM.includes(p.porto_origem.toUpperCase()))?'block':'none'};margin-top:6px;"></div>
          <div class="form-group"><label class="form-label">Porto Destino</label>
            <select class="form-input" id="f_porto_destino">${gerarOptionsPortoDestino(p.porto_destino)}</select></div>
          <div class="form-group"><label class="form-label">PrevisÃÂ£o de Embarque (ETD)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_etd" value="${esc(p.etd)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">ETA (PrevisÃÂ£o de Chegada)</label>
            <input class="form-input highlight" type="date" onpaste="colarData(event,this)" id="f_eta" value="${esc(p.eta)}">
          </div>
          <div class="form-group"><label class="form-label">Data de Embarque (Efetiva)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_embarque" value="${esc(p.data_embarque)}"
              onchange="moverDataFuturaParaPrevisao('f_data_embarque','f_etd','PrevisÃÂ£o de Embarque (ETD)');atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Free Time (dias)</label>
            <input class="form-input" type="number" id="f_free_time" value="${p.free_time||''}" placeholder="Preencher apÃÂ³s emissÃÂ£o do BL"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ Carregamento</div>
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
          <div class="form-group"><label class="form-label">HorÃÂ¡rio Retirada</label>
            <input class="form-input" type="time" id="f_horario_retirada" value="${esc(p.horario_retirada)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Agendamento Cancelado?</label>
            <select class="form-input" id="f_agendamento_cancelado" onchange="toggleMotivoCancelamento()">
              <option value="false" ${!p.agendamento_cancelado?'selected':''}>NÃÂ£o</option>
              <option value="true"  ${p.agendamento_cancelado?'selected':''}>Sim</option>
            </select></div>
        </div>
        <div id="wrap_motivo_cancelamento" style="display:${p.agendamento_cancelado?'block':'none'};margin-top:10px;">
          <div class="form-group"><label class="form-label">Motivo do Cancelamento</label>
            <textarea class="form-input" id="f_motivo_cancelamento" rows="2" style="resize:vertical;">${esc(p.motivo_cancelamento)}</textarea></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Ã¢ÂÂ Chegada & Demurrage</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Data Chegada</label>
            <input class="form-input highlight" type="date" onpaste="colarData(event,this)" id="f_data_chegada" value="${esc(p.data_chegada)}"
              onchange="moverDataFuturaParaPrevisao('f_data_chegada','f_eta','ETA (PrevisÃÂ£o de Chegada)');atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">PresenÃÂ§a de Carga</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_presenca" value="${esc(p.data_presenca)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Demurrage Vence</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_demurrage_vencimento" value="${esc(p.demurrage_vencimento)}" style="color:var(--err);font-weight:600;" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Data DevoluÃÂ§ÃÂ£o</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_devolucao_vazio" value="${esc(p.data_devolucao_vazio)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Valor Demurrage (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_demurrage_valor" value="${exibirMoeda(p.demurrage_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this);atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Demurrage Pago?</label>
            <select class="form-input" id="f_demurrage_pago">
              <option value="false" ${!p.demurrage_pago?'selected':''}>NÃÂ£o</option>
              <option value="true"  ${p.demurrage_pago?'selected':''}>Sim Ã¢ÂÂ</option>
            </select></div>
        </div>
        <div id="demur-info-wrap">${demurInfo}</div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">Ã°ÂÂÂ¾ Salvar</button>
      </div>
    </div>

    <!-- ABA: DOCUMENTOS -->
    <div class="tab-pane" id="pane-documentos">
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ¢ NÃÂºmeros de ReferÃÂªncia</div>
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
        <div class="form-section-title">Ã¢ÂÂ CE Mercante</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">CE Master</label>
            <input class="form-input" id="f_ce_master" value="${esc(p.ce_master)}"></div>
          <div class="form-group"><label class="form-label">CE House</label>
            <input class="form-input" id="f_ce_house" value="${esc(p.ce_house)}"></div>
          <div class="form-group"><label class="form-label">Data Embarque (CE)</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_ce_data_embarque" value="${esc(p.ce_data_embarque)}"></div>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-top:6px;">Ao subir o CE Mercante na extraÃÂ§ÃÂ£o por IA, os campos Navio e Armador (aba Booking &amp; Embarque) sÃÂ£o atualizados automaticamente Ã¢ÂÂ em caso de transbordo no exterior, o navio de conexÃÂ£o/ÃÂºltimo navio.</div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ DI e ParametrizaÃÂ§ÃÂ£o</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Data Registro DI</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_registro_di" value="${esc(p.data_registro_di)}" onchange="aplicarRegraParametrizacaoVerde();atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">NÃÂºmero DI</label>
            <input class="form-input" id="f_numero_di" value="${esc(p.numero_di)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Canal</label>
            <select class="form-input" id="f_canal" onchange="aplicarRegraParametrizacaoVerde();atualizarFaseEmTempoReal()">
              <option value="">Ã¢ÂÂ</option>
              <option value="VERDE"   ${p.canal==='VERDE'?'selected':''}>Ã°ÂÂÂ¢ Verde</option>
              <option value="AMARELO" ${p.canal==='AMARELO'?'selected':''}>Ã°ÂÂÂ¡ Amarelo</option>
              <option value="VERMELHO"${p.canal==='VERMELHO'?'selected':''}>Ã°ÂÂÂ´ Vermelho</option>
            </select></div>
          <div class="form-group"><label class="form-label">Data ParametrizaÃÂ§ÃÂ£o</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_parametrizacao" value="${esc(p.data_parametrizacao)}" onchange="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Data LiberaÃÂ§ÃÂ£o</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_data_liberacao" value="${esc(p.data_liberacao)}" onchange="atualizarFaseEmTempoReal()" placeholder="Data do desembaraÃÂ§o (CI)"></div>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-top:6px;">Canal Verde preenche a Data ParametrizaÃÂ§ÃÂ£o automaticamente com a Data de Registro da DI (sem conferÃÂªncia separada). Data LiberaÃÂ§ÃÂ£o ÃÂ© a Data do DesembaraÃÂ§o informada no Comprovante de ImportaÃÂ§ÃÂ£o.</div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂ§Â¾ Faturamento</div>
        ${(() => {
          // Ambiguidade NF SaÃÂ­da legada ÃÂ aba Vendas: quando o processo jÃÂ¡
          // tem vendas cadastradas (multi-cliente), calcularFechamento()
          // ignora nf_saida_numero/data/valor por completo e usa a soma das
          // NFs de cada venda Ã¢ÂÂ sem este aviso, alguÃÂ©m podia preencher os
          // dois lugares achando que os dois contam, ou nÃÂ£o entender por que
          // editar este campo aqui nÃÂ£o muda o Lucro Real na aba Fechamento.
          let vendas = [];
          try{ vendas = p.vendas_json ? JSON.parse(p.vendas_json) : []; }catch(e){ vendas = []; }
          if(!Array.isArray(vendas)) vendas = [];
          if(!vendas.length) return '';
          return `<div style="background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.35);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--text);">
            Ã¢ÂÂ  Este processo foi vendido a <strong>${vendas.length} cliente${vendas.length===1?'':'s'}</strong> diferentes (ver aba Ã°ÂÂ§Â¾ Vendas) Ã¢ÂÂ os campos de <strong>NF SaÃÂ­da</strong> abaixo NÃÂO sÃÂ£o usados no cÃÂ¡lculo de Fechamento nesse caso; cada venda tem sua prÃÂ³pria NF SaÃÂ­da, lanÃÂ§ada na aba Vendas.
          </div>`;
        })()}
        ${(() => {
          let vendas2 = [];
          try{ vendas2 = p.vendas_json ? JSON.parse(p.vendas_json) : []; }catch(e){ vendas2 = []; }
          if(!Array.isArray(vendas2)) vendas2 = [];
          if(vendas2.length) return '';
          return `<div style="background:rgba(26,127,212,.04);border:1px solid rgba(26,127,212,.15);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;">Extrair NF (Entrada ou Saida) com IA</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Envie o XML da NFe ou o PDF/foto do DANFE Ã¢ÂÂ o sistema identifica se e Entrada ou Saida e preenche os campos certos automaticamente</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <input type="file" id="ia-nf-saida-file" accept=".pdf,.png,.jpg,.jpeg,.xml" style="display:none" onchange="importarNFSaidaProcesso(this)">
              <button class="btn btn-outline" onclick="document.getElementById('ia-nf-saida-file').click()">Selecionar NF (Entrada ou Saida)</button>
              <span id="ia-nf-saida-status" style="font-size:12px;color:var(--muted);"></span>
            </div>
          </div>`;
        })()}
        <div class="form-grid">
          <div class="form-group"><label class="form-label">NF Entrada NÃÂº</label>
            <input class="form-input" id="f_nf_entrada_numero" value="${esc(p.nf_entrada_numero)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">NF Entrada Data</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_nf_entrada_data" value="${esc(p.nf_entrada_data)}"></div>
          <div class="form-group"><label class="form-label">NF Entrada Valor (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_nf_entrada_valor" value="${exibirMoeda(p.nf_entrada_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">NF SaÃÂ­da NÃÂº${p.vendas_json&&JSON.parse(p.vendas_json||'[]').length?' <span style="color:#f39c12;font-weight:400;">(nÃÂ£o usado Ã¢ÂÂ ver aba Vendas)</span>':''}</label>
            <input class="form-input" id="f_nf_saida_numero" value="${esc(p.nf_saida_numero)}" oninput="atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">NF SaÃÂ­da Data</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_nf_saida_data" value="${esc(p.nf_saida_data)}"></div>
          <div class="form-group"><label class="form-label">NF SaÃÂ­da Valor (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" id="f_nf_saida_valor" value="${exibirMoeda(p.nf_saida_valor)}" placeholder="0,00" oninput="formatarMoedaInput(this)"></div>
          <div class="form-group"><label class="form-label">CFOP NF SaÃÂ­da</label>
            <input class="form-input" id="f_nf_saida_cfop" value="${esc(p.nf_saida_cfop)}" placeholder="ex: 5405, 5905..."></div>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-top:6px;">CFOP 5905 (ou NF de SaÃÂ­da ainda nÃÂ£o emitida) = container importado sem venda efetiva ainda Ã¢ÂÂ usado no Dashboard NarcÃÂ©lio pra calcular estoque parado no armazÃÂ©m.</div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Ã°ÂÂÂ Arquivos do Processo (GED)</div>
        <div id="ged-upload-area" style="border:2px dashed var(--border);border-radius:8px;padding:20px;text-align:center;cursor:pointer;margin-bottom:12px;" onclick="document.getElementById('ged-file-input').click()">
          <input type="file" id="ged-file-input" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none" onchange="uploadArquivosGed(this.files)">
          <div style="color:var(--muted);font-size:13px;">Ã°ÂÂÂ¤ Clique para enviar PDF, JPEG ou PNG</div>
          <div style="color:var(--dim);font-size:11px;margin-top:4px;">MÃÂºltiplos arquivos permitidos</div>
        </div>
        <div id="ged-lista-arquivos" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-outline" onclick="fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="coletarESalvar()">Ã°ÂÂÂ¾ Salvar</button>
      </div>
    </div>

    <!-- ABA: HISTÃÂRICO -->
    <div class="tab-pane" id="pane-historico">
      <div id="historico-lista">
        ${isNovo
          ? '<div class="empty"><div class="empty-icon">Ã°ÂÂÂ</div><div class="empty-text">Salve o processo para comeÃÂ§ar a registrar alteraÃÂ§ÃÂµes.</div></div>'
          : '<div style="font-size:11px;color:var(--dim);">Carregando histÃÂ³rico...</div>'
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
  // Inicializar multi-produtos (com retrocompatibilidade do campo "produto" legado em texto ÃÂºnico)
  try{
    if(p.produtos_json) _produtos = JSON.parse(p.produtos_json);
    else if(p.produto) _produtos = [{descricao:p.produto||'', quantidade:''}];
    else _produtos = [{descricao:'', quantidade:''}];
  }catch(e){ _produtos = [{descricao:'', quantidade:''}]; }
  renderMultiProdutos();
  // Inicializar vendas multi-cliente (aba Vendas) Ã¢ÂÂ vazio ([]) pra qualquer
  // processo que nunca usou essa aba, exatamente como _produtos/_containers acima.
  try{
    _vendas = p.vendas_json ? JSON.parse(p.vendas_json) : [];
    if(!Array.isArray(_vendas)) _vendas = [];
  }catch(e){ _vendas = []; }
  renderVendas();
  if(!isNovo){ carregarArquivosGed(p.id); carregarHistorico(p.id); }
  else document.getElementById('ged-lista-arquivos').innerHTML = '<div style="font-size:11px;color:var(--dim);">Salve o processo antes de enviar arquivos.</div>';
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// CUSTOS REAIS Ã¢ÂÂ apuraÃÂ§ÃÂ£o de lucro por processo, item a item
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Config/cÃÂ¡lculo (CUSTOS_REAIS_CONFIG, calcularCustoCotadoItem,
// calcularCustoRealTotal) vivem em controle-core.js Ã¢ÂÂ aqui sÃÂ³ o HTML da aba
// e a coleta/salvamento dos campos, seguindo o mesmo padrÃÂ£o de "aba com
// botÃÂ£o de salvar prÃÂ³prio" que a aba Fechamento jÃÂ¡ usa (ela sÃÂ³ lÃÂª, nÃÂ£o tem
// campo editÃÂ¡vel; esta aba tem campos, entÃÂ£o precisa de coletar+salvar).
// Uma cÃÂ©lula "valor + moeda" (input number + select BRL/USD/EUR lado a
// lado) Ã¢ÂÂ usada tanto pro Pago quanto pro Cobrado, tanto na linha principal
// quanto em cada sub-linha de container, sempre com o mesmo par de ids
// (valorId/moedaId) montado pelo chamador.
function celulaValorMoedaHtml(valorId, moedaId, valor, moeda, placeholder, readonly){
  const dis = readonly ? 'readonly style="width:100%;background:var(--bg);color:var(--muted);"' : 'style="width:100%;"';
  return `<div style="display:flex;gap:4px;">
    <input class="form-input" type="number" step="0.01" id="${valorId}" value="${valor}" placeholder="${placeholder}" ${dis} oninput="atualizarTotalCustosReais()">
    <select class="form-input" id="${moedaId}" ${readonly?'disabled':''} onchange="atualizarTotalCustosReais()" style="width:62px;flex-shrink:0;padding-left:4px;padding-right:4px;">
      ${MOEDAS_REAIS.map(m=>`<option value="${m.code}" ${m.code===moeda?'selected':''}>${m.code}</option>`).join('')}
    </select>
  </div>`;
}

// Extrai { valor, moeda } pra prÃÂ©-preencher a cÃÂ©lula ÃÂºnica (nÃÂ£o-detalhada) a
// partir do que estÃÂ¡ salvo em real_json Ã¢ÂÂ aceita os 3 formatos possÃÂ­veis
// (ver normalizarValorRealItem em controle-core.js); quando salvo em modo
// "por container", devolve null (tratado ÃÂ  parte).
function valorMoedaInicial(raw, item){
  if(raw == null || raw === '') return { valor:'', moeda:item.unidade };
  if(typeof raw === 'object'){
    if(raw.porContainer) return null;
    if(raw.valor != null && raw.valor !== '') return { valor: raw.valor, moeda: raw.moeda || item.unidade };
    return { valor:'', moeda:item.unidade };
  }
  return { valor: raw, moeda: item.unidade };
}

function igualarCobradoPago(itemId, idx){ var suf = (idx === undefined || idx === null) ? '' : ('__c' + idx); var val = document.getElementById('f_cr_' + itemId + suf); var moeda = document.getElementById('f_cr_moeda_' + itemId + suf); var valCobrado = document.getElementById('f_cr_cobrado_' + itemId + suf); var moedaCobrado = document.getElementById('f_cr_cobrado_moeda_' + itemId + suf); if (val && valCobrado) valCobrado.value = val.value; if (moeda && moedaCobrado) moedaCobrado.value = moeda.value; if (typeof atualizarTotalCustosReais === 'function') atualizarTotalCustosReais(); } function renderCustosReaisTab(p){
  const reais = p.real_json || {};
  const cotado = (p.estimativa_json && p.estimativa_json.custos_cotados_json) || null;
  const cambioDefault = p.real_cambio ?? (cotado && cotado.cambio) ?? p.pi_cambio ?? _cambio.USD;
  const cambioEurDefault = (reais._cambio_eur != null && reais._cambio_eur !== '') ? reais._cambio_eur : _cambio.EUR;
  const containers = containersDoProcesso(p);

  // Tabela em largura total (em vez do form-grid de 2-3 colunas) Ã¢ÂÂ com dois
  // campos por item (Pago/Cobrado) + hint do cotado, a versÃÂ£o em grid
  // espremia demais e cortava o campo "Cobrado" na tela. Uma linha por item,
  // ocupando toda a largura do painel, dÃÂ¡ espaÃÂ§o de sobra pros 2 campos +
  // a margem, e ainda fica mais fÃÂ¡cil de escanear vÃÂ¡rias taxas em sequÃÂªncia
  // (mesma lÃÂ³gica da tabela Pagamento ÃÂ Recebimento do Conexos).
  //
  // Cada lado (Pago/Cobrado) tem sua PRÃÂPRIA moeda (BRL/USD/EUR) Ã¢ÂÂ igual ao
  // Conexos, que deixa pagar num moeda e receber em outra. E taxas marcadas
  // como porContainer podem ser detalhadas container a container quando o
  // processo tem mais de um (link "Ã°ÂÂÂ¦ Detalhar por container").
  const gruposHtml = CUSTOS_REAIS_CONFIG.map(g => {
    const linhasHtml = g.itens.map(item => {
      const valorCotado = calcularCustoCotadoItem(item, cotado);
      const rawPago = reais[item.id];

      // Imposto (apenasPago) nÃÂ£o tem compra ÃÂ venda Ã¢ÂÂ ÃÂ© sÃÂ³ um valor a pagar
      // pro governo, sempre em R$, sem Cobrado/Margem nem seletor de moeda.
      if(item.apenasPago){
        const valorInicialImposto = (rawPago != null && rawPago !== '')
          ? (typeof rawPago === 'object' ? rawPago.valor : rawPago)
          : (valorCotado != null ? valorCotado.toFixed(2) : '');
        const hintCotadoImposto = valorCotado != null
          ? `<div style="font-size:10px;color:var(--dim);margin-top:2px;">Cotado: R$ ${valorCotado.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>`
          : '';
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 10px 8px 0;font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;">${item.label}${hintCotadoImposto}</td>
          <td colspan="2" style="padding:8px 6px;">
            <div style="display:flex;align-items:center;gap:6px;max-width:220px;">
              <span style="font-size:12px;color:var(--muted);flex-shrink:0;">R$</span>
              <input class="form-input" type="number" step="0.01" id="f_cr_${item.id}" value="${valorInicialImposto}" placeholder="Valor a pagar" oninput="atualizarTotalCustosReais()" style="width:100%;">
            </div>
          </td>
          <td style="padding:8px 0 8px 10px;width:16%;font-size:11px;color:var(--dim);font-style:italic;">custo direto</td>
        </tr>`;
      }

      const rawCobrado = reais[item.id+'_cobrado'];
      const podeDetalhar = !!item.porContainer && containers.length > 1;
      const breakdownAtivo = podeDetalhar && ((rawPago && rawPago.porContainer) || (rawCobrado && rawCobrado.porContainer));

      const iniPago = valorMoedaInicial(rawPago, item) || { valor:'', moeda:item.unidade };
      const iniCobrado = valorMoedaInicial(rawCobrado, item) || { valor:'', moeda:item.unidade };
      // Sem nada salvo ainda (nem detalhado, nem valor ÃÂºnico), prÃÂ©-preenche
      // com o cotado Ã¢ÂÂ sÃÂ³ faz sentido no modo valor ÃÂºnico.
      if(!breakdownAtivo && iniPago.valor === '' && valorCotado != null) iniPago.valor = valorCotado.toFixed(2);

      const simboloUnidade = item.unidade === 'USD' ? 'US$' : 'R$';
      const hintCotado = valorCotado != null
        ? `<div style="font-size:10px;color:var(--dim);margin-top:2px;">Cotado: ${simboloUnidade} ${valorCotado.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>`
        : '';
      const detalharLink = podeDetalhar
        ? `<div style="margin-top:3px;"><a href="javascript:void(0)" onclick="toggleCrContainerBreakdown('${item.id}')" style="font-size:10px;color:var(--ac);text-decoration:none;">Ã°ÂÂÂ¦ <span id="cr_toggle_label_${item.id}">${breakdownAtivo ? 'Ver total ÃÂºnico' : `Detalhar por container (${containers.length})`}</span></a></div>`
        : '';

      // Se jÃÂ¡ estÃÂ¡ em modo detalhado, o valor mostrado na linha principal ÃÂ©
      // sÃÂ³ um resumo somado em R$ (read-only) Ã¢ÂÂ a ediÃÂ§ÃÂ£o de verdade acontece
      // nas sub-linhas por container, logo abaixo.
      let pagoValorExibido = iniPago.valor, pagoMoedaExibida = iniPago.moeda;
      let cobradoValorExibido = iniCobrado.valor, cobradoMoedaExibida = iniCobrado.moeda;
      if(breakdownAtivo){
        const normP = normalizarValorRealItem(rawPago, item, p);
        const normC = normalizarValorRealItem(rawCobrado, item, p);
        pagoValorExibido = normP ? normP.totalBrl.toFixed(2) : '';
        cobradoValorExibido = normC ? normC.totalBrl.toFixed(2) : '';
        pagoMoedaExibida = 'BRL'; cobradoMoedaExibida = 'BRL';
      }

      const containersLinhasHtml = podeDetalhar ? containers.map((nome, idx) => {
        const savedPago = (rawPago && rawPago.porContainer && rawPago.porContainer[nome]) || null;
        const savedCobrado = (rawCobrado && rawCobrado.porContainer && rawCobrado.porContainer[nome]) || null;
        return `<tr>
          <td style="padding:4px 10px 4px 0;font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;white-space:nowrap;">${esc(nome)}</td>
          <td style="padding:4px 6px;">${celulaValorMoedaHtml('f_cr_'+item.id+'__c'+idx, 'f_cr_moeda_'+item.id+'__c'+idx, savedPago?savedPago.valor:'', savedPago?savedPago.moeda:item.unidade, 'Pago', false)}</td>
          <td style="padding:4px 6px;">${celulaValorMoedaHtml('f_cr_cobrado_'+item.id+'__c'+idx, 'f_cr_cobrado_moeda_'+item.id+'__c'+idx, savedCobrado?savedCobrado.valor:'', savedCobrado?savedCobrado.moeda:item.unidade, 'Cobrado', false)}</td><td style="padding:4px 0 4px 4px;"><button type="button" title="Usar o mesmo valor do Pago" onclick="igualarCobradoPago('${item.id}', ${idx})" style="width:22px;height:26px;border:1px solid var(--border);background:var(--bg2);border-radius:6px;cursor:pointer;font-size:12px;color:var(--ac);">=</button></td>
        </tr>`;
      }).join('') : '';

      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px 10px 8px 0;font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;">${item.label}${hintCotado}${detalharLink}</td>
        <td style="padding:8px 6px;width:24%;">${celulaValorMoedaHtml('f_cr_'+item.id, 'f_cr_moeda_'+item.id, pagoValorExibido, pagoMoedaExibida, 'Pago', breakdownAtivo)}</td>
        <td style="padding:8px 6px;width:24%;"><div style="display:flex;align-items:center;gap:4px;">${!breakdownAtivo ? `<button type="button" title="Usar o mesmo valor do Pago" onclick="igualarCobradoPago('${item.id}')" style="flex-shrink:0;width:22px;height:28px;border:1px solid var(--border);background:var(--bg2);border-radius:6px;cursor:pointer;font-size:12px;color:var(--ac);">=</button>` : ''}<div style="flex:1;">${celulaValorMoedaHtml('f_cr_cobrado_'+item.id, 'f_cr_cobrado_moeda_'+item.id, cobradoValorExibido, cobradoMoedaExibida, 'Cobrado', breakdownAtivo)}</div></div></td>
        <td style="padding:8px 0 8px 10px;width:16%;font-size:11px;" id="cr_margem_${item.id}"></td>
      </tr>
      ${podeDetalhar ? `<tr id="cr_containers_row_${item.id}" style="display:${breakdownAtivo?'table-row':'none'};background:var(--bg);">
        <td colspan="4" style="padding:2px 0 10px 14px;">
          <table style="width:100%;border-collapse:collapse;">
            <tbody>${containersLinhasHtml}</tbody>
          </table>
        </td>
      </tr>` : ''}`;
    }).join('');
    return `<div style="margin-bottom:22px;">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">${g.grupo}</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:0 10px 6px 0;font-size:10px;color:var(--dim);text-transform:uppercase;">Taxa</th>
            <th style="text-align:left;padding:0 6px 6px;font-size:10px;color:var(--dim);text-transform:uppercase;">Pago</th>
            <th style="text-align:left;padding:0 6px 6px;font-size:10px;color:var(--dim);text-transform:uppercase;">Cobrado</th>
            <th style="text-align:left;padding:0 0 6px 10px;font-size:10px;color:var(--dim);text-transform:uppercase;">Margem</th>
          </tr>
        </thead>
        <tbody>${linhasHtml}</tbody>
      </table>
    </div>`;
  }).join('');

  return `<div style="font-size:11px;color:var(--dim);margin-bottom:16px;"><strong>Pago</strong> = o que saiu do bolso (custo). <strong>Cobrado</strong> = o que foi repassado ao cliente (receita), cada um com sua prÃÂ³pria moeda. Taxas por container podem ser detalhadas container a container.</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="form-group" style="max-width:200px;">
        <label class="form-label">CÃÂ¢mbio USD</label>
        <input class="form-input" type="number" step="0.0001" id="f_cr_cambio" value="${cambioDefault||''}" placeholder="${_cambio.USD.toFixed(4)}" oninput="atualizarTotalCustosReais()">
      </div>
      <div class="form-group" style="max-width:200px;">
        <label class="form-label">CÃÂ¢mbio EUR</label>
        <input class="form-input" type="number" step="0.0001" id="f_cr_cambio_eur" value="${cambioEurDefault||''}" placeholder="${_cambio.EUR.toFixed(4)}" oninput="atualizarTotalCustosReais()">
      </div>
    </div>
    ${gruposHtml}
    <div id="custos-reais-total" style="margin-top:6px;"></div>`;
}

// Alterna uma taxa entre "valor ÃÂºnico pro processo" e "detalhado container a
// container" Ã¢ÂÂ ativa/desativa a sub-linha de containers e trava (readonly) a
// linha principal, que passa a mostrar sÃÂ³ o total somado em R$.
function toggleCrContainerBreakdown(itemId){
  const row = document.getElementById('cr_containers_row_'+itemId);
  const label = document.getElementById('cr_toggle_label_'+itemId);
  if(!row) return;
  const ativar = row.style.display === 'none';
  row.style.display = ativar ? 'table-row' : 'none';
  if(label) label.textContent = ativar ? 'Ver total ÃÂºnico' : `Detalhar por container`;
  ['f_cr_'+itemId, 'f_cr_cobrado_'+itemId].forEach(id => {
    const el = document.getElementById(id);
    if(el){ el.readOnly = ativar; el.style.background = ativar ? 'var(--bg)' : ''; el.style.color = ativar ? 'var(--muted)' : ''; }
  });
  ['f_cr_moeda_'+itemId, 'f_cr_cobrado_moeda_'+itemId].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.disabled = ativar;
  });
  atualizarTotalCustosReais();
}

// LÃÂª os valores atualmente digitados nos campos f_cr_* (sem depender de
// _editando estar sincronizado ainda) Ã¢ÂÂ usado tanto pra atualizar o total ao
// vivo quanto pra montar o que vai salvo em real_json/real_cambio. O cÃÂ¢mbio
// vem separado (real_cambio ÃÂ© coluna prÃÂ³pria, nÃÂ£o fica dentro do real_json)
// pra bater com a migration 0004_add_custos_reais_processo.sql, que jÃÂ¡
// criou as duas colunas assim.
function coletarCustosReaisDoForm(){
  const obj = {};
  const eurEl = document.getElementById('f_cr_cambio_eur');
  if(eurEl && eurEl.value !== '') obj._cambio_eur = parseFloat(eurEl.value);
  const containers = containersDoProcesso(_editando || {});
  custosReaisItensFlat().forEach(item => {
    // "Cobrado do Cliente" fica na MESMA real_json, com sufixo _cobrado Ã¢ÂÂ
    // nÃÂ£o precisa de coluna nova (ver calcularReceitaRealTotal em
    // controle-core.js, que lÃÂª exatamente essa convenÃÂ§ÃÂ£o). Cada lado (Pago/
    // Cobrado) ÃÂ© coletado com o mesmo par de prefixos, valor+moeda; quando a
    // taxa estÃÂ¡ em modo "detalhado por container" (sub-linha visÃÂ­vel), lÃÂª os
    // campos por container em vez do campo ÃÂºnico da linha principal.
    [
      { sufixo:'',         prefV:'f_cr_',          prefM:'f_cr_moeda_' },
      { sufixo:'_cobrado', prefV:'f_cr_cobrado_',  prefM:'f_cr_cobrado_moeda_' },
    ].forEach(({sufixo, prefV, prefM}) => {
      const containersRow = document.getElementById('cr_containers_row_'+item.id);
      const emBreakdown = containersRow && containersRow.style.display !== 'none';
      if(emBreakdown){
        const porContainer = {};
        containers.forEach((nome, idx) => {
          const el = document.getElementById(prefV+item.id+'__c'+idx);
          const moedaEl = document.getElementById(prefM+item.id+'__c'+idx);
          if(el && el.value !== ''){
            porContainer[nome] = { valor: parseFloat(el.value), moeda: moedaEl ? moedaEl.value : item.unidade };
          }
        });
        if(Object.keys(porContainer).length) obj[item.id+sufixo] = { porContainer };
        return;
      }
      const el = document.getElementById(prefV+item.id);
      const moedaEl = document.getElementById(prefM+item.id);
      if(el && el.value !== ''){
        obj[item.id+sufixo] = { valor: parseFloat(el.value), moeda: moedaEl ? moedaEl.value : item.unidade };
      }
    });
  });
  return obj;
}

function coletarCambioCustosReaisDoForm(){
  const el = document.getElementById('f_cr_cambio');
  return (el && el.value !== '') ? parseFloat(el.value) : null;
}

// Recalcula e redesenha o resumo (Custo Total Real / Lucro Real) conforme o
// usuÃÂ¡rio digita, sem precisar salvar Ã¢ÂÂ mesmo padrÃÂ£o do renderPagamentoInfoLive().
function atualizarTotalCustosReais(){
  if(!_editando) return;
  const wrap = document.getElementById('custos-reais-total');
  if(!wrap) return;
  const cambio = coletarCambioCustosReaisDoForm();
  const r2 = v => 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

  const obj = coletarCustosReaisDoForm();
  const snapshot = { ..._editando, real_json: obj, real_cambio: cambio };

  // Margem por LINHA (pago ÃÂ cobrado), atualizada a cada tecla Ã¢ÂÂ igual ao
  // Conexos mostra Pagamento ÃÂ Recebimento lado a lado por taxa. Sempre em
  // R$: Pago e Cobrado podem estar em moedas diferentes entre si (ex.: paga
  // o representante em BRL, recebe do importador em USD), entÃÂ£o R$ ÃÂ© a
  // ÃÂºnica unidade em que dÃÂ¡ pra comparar os dois lados direto.
  custosReaisItensFlat().forEach(item => {
    const badge = document.getElementById('cr_margem_'+item.id);
    const normPago = normalizarValorRealItem(obj[item.id], item, snapshot);
    const normCobrado = normalizarValorRealItem(obj[item.id+'_cobrado'], item, snapshot);
    // Quando a taxa estÃÂ¡ em modo "detalhado por container", a linha
    // principal fica sÃÂ³ como resumo somado em R$ (readonly) Ã¢ÂÂ atualiza o
    // valor mostrado a cada tecla digitada nas sub-linhas.
    const containersRow = document.getElementById('cr_containers_row_'+item.id);
    if(containersRow && containersRow.style.display !== 'none'){
      const pagoInput = document.getElementById('f_cr_'+item.id);
      const cobradoInput = document.getElementById('f_cr_cobrado_'+item.id);
      if(pagoInput) pagoInput.value = normPago ? normPago.totalBrl.toFixed(2) : '';
      if(cobradoInput) cobradoInput.value = normCobrado ? normCobrado.totalBrl.toFixed(2) : '';
    }
    if(!badge) return;
    if(!normPago || !normCobrado){ badge.innerHTML = ''; return; }
    const margem = normCobrado.totalBrl - normPago.totalBrl;
    badge.innerHTML = `<span style="color:${margem>=0?'var(--ok)':'var(--err)'};font-weight:600;">${margem>=0?'Ã¢ÂÂ²':'Ã¢ÂÂ¼'} margem: R$ ${margem.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
  });

  const custosReais = calcularCustoRealTotal(snapshot);
  if(!custosReais){ wrap.innerHTML = ''; return; }
  const receitaReais = calcularReceitaRealTotal(snapshot);
  const nfSaida = parseFloat(snapshot.nf_saida_valor);
  const temNf = !isNaN(nfSaida) && nfSaida > 0;
  const lucro = temNf ? (nfSaida - custosReais.total) : null;
  const linhaMargemTaxas = receitaReais
    ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Cobrado do Cliente nas Taxas (${receitaReais.count} ${receitaReais.count===1?'item':'itens'})</span><strong>${r2(receitaReais.total)}</strong></div>
       <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Margem das Taxas (Cobrado Ã¢ÂÂ Pago)</span><strong style="color:${(receitaReais.total-custosReais.total)>=0?'var(--ok)':'var(--err)'}">${r2(receitaReais.total-custosReais.total)}</strong></div>`
    : '';
  wrap.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:12px;display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Custo Total Real (${custosReais.count} ${custosReais.count===1?'item':'itens'} lanÃÂ§ados)</span><strong>${r2(custosReais.total)}</strong></div>
    ${linhaMargemTaxas}
    ${temNf
      ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);">Lucro Real (NF SaÃÂ­da Ã¢ÂÂ Custo Real Total)</span><strong style="color:${lucro>=0?'var(--ok)':'var(--err)'}">${r2(lucro)}</strong></div>`
      : `<div style="color:var(--dim);">Preencha a NF SaÃÂ­da na aba Documentos pra ver o lucro real aqui.</div>`}
  </div>`;
}

// Salva sÃÂ³ os custos reais Ã¢ÂÂ segue o mesmo mecanismo de patchFields das
// outras abas (salvarProcesso em controle-core.js), entÃÂ£o nÃÂ£o sobrescreve
// nenhum outro campo alterado por outra pessoa nesse meio tempo.
async function salvarCustosReaisTab(){
  if(!_editando) return;
  _editando.real_json = coletarCustosReaisDoForm();
  _editando.real_cambio = coletarCambioCustosReaisDoForm();
  const ok = await salvarProcesso(_editando, ['real_json', 'real_cambio']);
  if(ok) atualizarTotalCustosReais();
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// HISTÃÂRICO Ã¢ÂÂ AUDITORIA DE ALTERAÃÂÃÂES
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Marcador usado no campo "campo" de uma entrada de log pra indicar que ela
// nÃÂ£o ÃÂ© uma alteraÃÂ§ÃÂ£o normal de campo, e sim o registro de "a IA leu este
// documento e preencheu estes campos" (ver extrairComIA() e o render abaixo).
const LOG_CAMPO_LEITURA_IA = 'Ã°ÂÂÂ_leitura_ia';
const LABELS_CAMPOS_IA = {
  referencia:'ReferÃÂªncia', fornecedor:'Fornecedor/Exportador', cliente:'Cliente',
  itens:'Itens/Produtos', pi_numero:'NÃÂº PI', pi_data:'Data PI', pi_valor_usd:'Valor PI (USD)',
  pi_incoterm:'Incoterm', pi_pagamento:'Forma de pagamento', etd:'ETD', eta:'ETA',
  armador:'Armador', navio:'Navio', porto_origem:'Porto de origem', porto_destino:'Porto de destino',
  hbl:'HBL', mbl:'MBL', container:'Container', lacre:'Lacre', valor_frete:'Valor do frete',
  moeda_frete:'Moeda do frete', numero_di:'NÃÂº DI', data_registro_di:'Data registro DI',
  canal:'Canal', data_liberacao:'Data liberaÃÂ§ÃÂ£o', ci_numero:'NÃÂº CI', ci_valor_usd:'Valor CI (USD)',
  ci_data:'Data CI', data_chegada:'Data de chegada', ce_master:'CE Master', ce_house:'CE House',
  ce_data_embarque:'Data embarque (CE)', nf_entrada_numero:'NÃÂº NF entrada', nf_entrada_data:'Data NF entrada',
  nf_entrada_valor:'Valor NF entrada', nf_saida_numero:'NÃÂº NF saÃÂ­da', nf_saida_data:'Data NF saÃÂ­da',
  nf_saida_valor:'Valor NF saÃÂ­da', nf_saida_cfop:'CFOP NF saÃÂ­da', data_devolucao_vazio:'Data devoluÃÂ§ÃÂ£o vazio',
};
async function carregarHistorico(processoId){
  const lista = document.getElementById('historico-lista');
  if(!lista) return;
  lista.innerHTML = '<div style="font-size:11px;color:var(--dim);">Carregando histÃÂ³rico...</div>';
  try{
    const r = await fetch('/api/controle/v2/processo/'+processoId+'/log');
    const d = await r.json();
    if(!d.ok || !d.log.length){
      lista.innerHTML = '<div class="empty"><div class="empty-icon">Ã°ÂÂÂ</div><div class="empty-text">Nenhuma alteraÃÂ§ÃÂ£o registrada ainda</div></div>';
      return;
    }
    lista.innerHTML = '<div class="log-list">' + d.log.map(l=>{
      const isLeituraIA = l.campo === LOG_CAMPO_LEITURA_IA;
      const texto = isLeituraIA
        ? ` leu o documento <strong>${esc(l.valor_antes||'?')}</strong> com IA e preencheu: ${esc(l.valor_depois||'Ã¢ÂÂ')}`
        : ` alterou <strong>${esc(l.campo||'')}</strong>: ${esc(String(l.valor_antes||'Ã¢ÂÂ'))} Ã¢ÂÂ ${esc(String(l.valor_depois||'Ã¢ÂÂ'))}`;
      return `<div class="log-item">
        <div class="log-avatar">${isLeituraIA ? 'Ã°ÂÂ¤Â' : esc((l.usuario||'?').slice(0,2).toUpperCase())}</div>
        <div class="log-content">
          <span class="log-user">${esc(l.usuario||'?')}</span>
          <span class="log-text">${texto}</span>
          <div class="log-time">${l.created_at ? new Date(l.created_at).toLocaleString('pt-BR') : ''}</div>
        </div>
      </div>`;
    }).join('') + '</div>';
  }catch(e){
    lista.innerHTML = '<div style="font-size:11px;color:var(--err);">Erro ao carregar histÃÂ³rico.</div>';
  }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// GED Ã¢ÂÂ UPLOAD E GESTÃÂO DE ARQUIVOS DO PROCESSO
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
      const icon = a.nome.toLowerCase().endsWith('.pdf') ? 'Ã°ÂÂÂ' : 'Ã°ÂÂÂ¼Ã¯Â¸Â';
      const tamanho = a.tamanho ? (a.tamanho/1024).toFixed(0)+' KB' : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;">
        <span>${icon}</span>
        <a href="${a.url}" target="_blank" style="flex:1;color:var(--ac);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.nome}</a>
        <span style="color:var(--dim);font-size:10px;">${tamanho}</span>
        <button onclick="excluirArquivoGed('${a.id}','${processoId}')" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:13px;padding:2px 6px;" title="Excluir">Ã¢ÂÂ</button>
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
      showToast(`Tipo nÃÂ£o permitido: ${file.name}`,'err');
      continue;
    }
    if(file.size > 15*1024*1024){
      showToast(`Arquivo muito grande (mÃÂ¡x 15MB): ${file.name}`,'err');
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
    if(d.ok){ showToast('Arquivo excluÃÂ­do','ok'); carregarArquivosGed(processoId); }
    else showToast('Erro ao excluir','err');
  }catch(e){ showToast('Erro ao excluir','err'); }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// ATUALIZAÃÂÃÂO AUTOMÃÂTICA DE FASE EM TEMPO REAL
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

// Quando o canal sai VERDE, nÃÂ£o hÃÂ¡ etapa de conferÃÂªncia separada Ã¢ÂÂ a
// parametrizaÃÂ§ÃÂ£o ocorre na mesma data do registro da DI. SÃÂ³ preenche
// automaticamente se o campo ainda estiver vazio, para nÃÂ£o sobrescrever
// uma data de parametrizaÃÂ§ÃÂ£o jÃÂ¡ informada manualmente (ex: Amarelo/Vermelho
// que depois virou Verde apÃÂ³s reanÃÂ¡lise, mas jÃÂ¡ tinha data prÃÂ³pria).
function aplicarRegraParametrizacaoVerde(){
  const canalEl = document.getElementById('f_canal');
  const paramEl = document.getElementById('f_data_parametrizacao');
  const regEl   = document.getElementById('f_data_registro_di');
  if(!canalEl || !paramEl || !regEl) return;
  if(canalEl.value === 'VERDE' && !paramEl.value && regEl.value){
    paramEl.value = regEl.value;
  }
}

// Datas "efetivas" (Data de Embarque, Data Chegada, Data ProntidÃÂ£o Real)
// registram algo que JÃÂ ACONTECEU. Se alguÃÂ©m digitar ali uma data no
// FUTURO Ã¢ÂÂ muito comum: o booking chega com uma previsÃÂ£o e a pessoa
// preenche direto no campo "de verdade" por hÃÂ¡bito, sem notar que existe um
// campo de previsÃÂ£o separado Ã¢ÂÂ isso quase sempre ÃÂ© engano. Em vez de sÃÂ³
// avisar (como este arquivo fazia antes, sÃÂ³ pra Data Chegada), move o valor
// automaticamente pro campo de previsÃÂ£o correspondente (ETD/ETA/PrevisÃÂ£o
// ProntidÃÂ£o) e limpa o campo efetivo, porque por definiÃÂ§ÃÂ£o ele nÃÂ£o pode ter
// uma data que ainda nÃÂ£o aconteceu. Isso evita o processo aparecer como "jÃÂ¡
// embarcado" ou "jÃÂ¡ chegou" antes da hora sÃÂ³ por causa do campo errado Ã¢ÂÂ
// consistente com a 2ÃÂª camada de proteÃÂ§ÃÂ£o que jÃÂ¡ existe em calcularFase().
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
  showToast(`Ã°ÂÂÂ Essa data ainda nÃÂ£o aconteceu (ÃÂ© futura) Ã¢ÂÂ movida para "${labelPrevisao}" automaticamente.`, 'info');
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
  // demurrage_valor usa mÃÂ¡scara monetÃÂ¡ria Ã¢ÂÂ nÃÂ£o pode ser lido como texto puro
  const valorDemurAtual = valorMoeda('f_demurrage_valor');
  if(valorDemurAtual!=null) snapshot.demurrage_valor = valorDemurAtual;

  const novaFase = calcularFase(snapshot);

  // Atualizar badge no header do modal
  const badge = document.getElementById('modal-fase-badge');
  if(badge){
    const fase = FASES.find(f=>f.id===novaFase)||FASES[0];
    badge.innerHTML = `<span class="fase-badge fase-${novaFase}">${fase.icon} ${fase.label}</span>`;
  }

  // Atualizar _editando.fase para que ao salvar jÃÂ¡ venha correto
  _editando._fasePrevista = novaFase;

  // Recalcular e redesenhar o bloco "CÃÂ¡lculo do Demurrage" com os valores
  // atuais do formulÃÂ¡rio Ã¢ÂÂ antes este bloco sÃÂ³ era montado uma vez, ao abrir
  // o modal, e ficava com dados desatualizados ao editar Data DevoluÃÂ§ÃÂ£o etc.
  const demurWrap = document.getElementById('demur-info-wrap');
  if(demurWrap) demurWrap.innerHTML = renderDemurInfo(snapshot);

  // Atualizar a timeline
  const faseIdx = FASES.findIndex(f=>f.id===novaFase);
  document.querySelectorAll('.tl-dot').forEach((dot, i)=>{
    dot.className = 'tl-dot';
    if(i < faseIdx) dot.classList.add('done'), dot.textContent='Ã¢ÂÂ';
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

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// PAGAMENTO
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
      <input class="form-input" type="number" id="f_pi_prazo_dias" value="${p.pi_prazo_dias||''}" oninput="atualizarDataPagamentoPrazo()"></div>
      <div class="form-group"><label class="form-label">Data Pagamento</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_saldo" value="${esc(p.pi_data_saldo)}"></div>`;
  } else if(tipo==='ENTRADA_SALDO'){
    html+=`<div class="form-group"><label class="form-label">% Entrada</label>
      <input class="form-input" type="number" id="f_pi_entrada_pct" value="${p.pi_entrada_pct||30}" min="1" max="99" oninput="renderPagamentoInfoLive()"></div>
      <div class="form-group"><label class="form-label">Data Entrada</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_entrada" value="${esc(p.pi_data_entrada)}"></div>
      <div class="form-group"><label class="form-label">Data Saldo</label>
      <input class="form-input" type="date" onpaste="colarData(event,this)" id="f_pi_data_saldo" value="${esc(p.pi_data_saldo)}"></div>
      <div class="form-group"><label class="form-label">CÃÂ¢mbio Entrada (R$)</label>
      <input class="form-input" type="number" step="0.0001" id="f_pi_cambio_entrada" value="${p.pi_cambio_entrada||''}" placeholder="${_cambio.USD.toFixed(4)}" oninput="renderPagamentoInfoLive()"></div>
      <div class="form-group"><label class="form-label">CÃÂ¢mbio Saldo (R$)</label>
      <input class="form-input" type="number" step="0.0001" id="f_pi_cambio_saldo" value="${p.pi_cambio_saldo||''}" placeholder="${_cambio.USD.toFixed(4)}" oninput="renderPagamentoInfoLive()"></div>`;
  } else if(tipo==='PARCELADO'){
    // Recarrega _parcelas a partir do processo sempre que o form entra em
    // modo Parcelado (troca de tipo de pagamento ou abertura do modal) Ã¢ÂÂ
    // mesmo padrÃÂ£o de _vendas/_containers: estado vive numa variÃÂ¡vel global
    // porque as linhas sÃÂ£o adicionadas/removidas dinamicamente (sem isso nÃÂ£o
    // dÃÂ¡ pra ter "quantas parcelas forem necessÃÂ¡rias" com um botÃÂ£o +).
    if(!Array.isArray(_parcelas) || !_parcelas.length){
        try{ _parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ _parcelas = []; }
    if(!Array.isArray(_parcelas) || !_parcelas.length) _parcelas = [parcelaVazia(), parcelaVazia()];
      }
    html+=`<div class="form-group full">
      <label class="form-label">Parcelas (quantos cÃÂ¢mbios forem necessÃÂ¡rios Ã¢ÂÂ ex.: confirmaÃÂ§ÃÂ£o do pedido, embarque, chegada)</label>
      <div id="parcelas-list"></div>
      <button type="button" onclick="adicionarParcela()" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--ac);cursor:pointer;font-weight:600;margin-top:4px;">+ Adicionar Parcela</button>
      <input type="hidden" id="f_pi_parcelas_json">
    </div>`;
  }
  html+='</div>';
  el.innerHTML=html;
  // #parcelas-list sÃÂ³ existe no DOM depois do innerHTML acima Ã¢ÂÂ preencher aqui.
  if(tipo==='PARCELADO') renderParcelas();
}

// Forma "100% a Prazo": provisiona a Data Pagamento automaticamente como
// Data PI + Prazo (dias), pra nÃÂ£o depender do usuÃÂ¡rio calcular/lembrar de
// preencher na mÃÂ£o Ã¢ÂÂ e sem isso o pagamento nem entrava no Dashboard
// Financeiro (listarPagamentosPI usa pi_data_saldo como vencimento pro
// "Saldo a pagar"). Roda a cada ediÃÂ§ÃÂ£o da Data PI ou do Prazo; se o usuÃÂ¡rio
// mudar a Data Pagamento manualmente depois, prevalece o valor calculado na
// ÃÂºltima ediÃÂ§ÃÂ£o de Data PI/Prazo (mesmo comportamento de "provisionar", nÃÂ£o
// de travar o campo).
function atualizarDataPagamentoPrazo(){
  if(document.getElementById('f_pi_pagamento')?.value !== 'PRAZO') return;
  const dataPI = document.getElementById('f_pi_data')?.value;
  const prazo = parseInt(document.getElementById('f_pi_prazo_dias')?.value, 10);
  const destino = document.getElementById('f_pi_data_saldo');
  if(!dataPI || !prazo || !destino) return;
  const d = parseDataLocal(dataPI);
  if(!d) return;
  d.setDate(d.getDate() + prazo);
  destino.value = d.toISOString().split('T')[0];
  renderPagamentoInfoLive();
}

// Recalcula e redesenha o resumo de pagamento (pagamento-box) quando o usuÃÂ¡rio
// edita % de entrada ou os cÃÂ¢mbios, sem precisar salvar/reabrir o modal.
function renderPagamentoInfoLive(){
  if(!_editando) return;
  const snapshot = {..._editando};
  // BUG #340 Ã¢ÂÂ snapshot herdava pi_pagamento de _editando (o valor salvo no
  // banco), nunca do <select> na tela. Resultado: trocar a Forma de
  // Pagamento (ex.: ENTRADA_SALDO salvo Ã¢ÂÂ escolher PARCELADO) e digitar
  // qualquer cÃÂ¢mbio disparava este redraw usando o tipo ANTIGO, entÃÂ£o o
  // resumo (pagamento-box) mostrava "Entrada + Saldo (legado)" de novo Ã¢ÂÂ o
  // usuÃÂ¡rio via isso como "o formulÃÂ¡rio reverteu sozinho", mesmo com o
  // <select> e as parcelas continuando corretos por trÃÂ¡s. _editando.pi_pagamento
  // sÃÂ³ ÃÂ© atualizado de fato no Salvar (coletarESalvar), entÃÂ£o tem que ler o
  // tipo atual direto do DOM aqui tambÃÂ©m, nÃÂ£o sÃÂ³ pra decidir se anexa
  // pi_parcelas_json (como jÃÂ¡ fazia abaixo).
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
  // Parcelado: usa o array em memÃÂ³ria (ainda nÃÂ£o salvo) pra refletir ao vivo
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
    rows=`<div class="pagamento-row"><span>Pagamento ÃÂ  vista</span><span>USD ${val.toFixed(2)}</span></div>
    <div class="pagamento-row"><span>Estimativa BRL</span><span>R$ ${brl.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>`;
  } else if(p.pi_pagamento==='PRAZO'){
    rows=`<div class="pagamento-row"><span>Pagamento a prazo (${p.pi_prazo_dias||0}d)</span><span>USD ${val.toFixed(2)}</span></div>`;
  } else if(p.pi_pagamento==='ENTRADA_SALDO'){
    const pct = parseFloat(p.pi_entrada_pct||30)/100;
    const ent = val*pct; const sld = val*(1-pct);
    const cambioEnt = parseFloat(p.pi_cambio_entrada) || _cambio.USD;
    const cambioSld = parseFloat(p.pi_cambio_saldo)   || _cambio.USD;
    const entBRL = ent*cambioEnt; const sldBRL = sld*cambioSld;
    rows=`<div class="pagamento-row"><span>Entrada (${p.pi_entrada_pct||30}%) ÃÂ· cÃÂ¢mbio ${cambioEnt.toLocaleString('pt-BR',{minimumFractionDigits:4})}</span><span>USD ${ent.toFixed(2)} ÃÂ· R$ ${entBRL.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
    <div class="pagamento-row"><span>Saldo (${100-(p.pi_entrada_pct||30)}%) ÃÂ· cÃÂ¢mbio ${cambioSld.toLocaleString('pt-BR',{minimumFractionDigits:4})}</span><span>USD ${sld.toFixed(2)} ÃÂ· R$ ${sldBRL.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
    <div class="pagamento-row"><span>Total</span><span>USD ${val.toFixed(2)} ÃÂ· R$ ${(entBRL+sldBRL).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>`;
  } else if(p.pi_pagamento==='PARCELADO'){
    let parcelas = [];
    try{ parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; }catch(e){ parcelas = []; }
    let totalUsd = 0, totalBrl = 0;
    parcelas.forEach((pc,i)=>{
      const v = parseFloat(pc.valor_usd)||0;
      const c = parseFloat(pc.cambio_fechado) || _cambio.USD;
      const brlPc = v*c;
      totalUsd += v; totalBrl += brlPc;
      const venc = pc.data_vencimento ? ' ÃÂ· ' + parseDataLocal(pc.data_vencimento).toLocaleDateString('pt-BR') : '';
      rows += `<div class="pagamento-row"><span>${esc(pc.label)||('Parcela '+(i+1))} ÃÂ· cÃÂ¢mbio ${c.toLocaleString('pt-BR',{minimumFractionDigits:4})}${venc}</span><span>USD ${v.toFixed(2)} ÃÂ· R$ ${brlPc.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>`;
    });
    rows += `<div class="pagamento-row"><span>Total (${parcelas.length} parcela${parcelas.length===1?'':'s'})</span><span>USD ${totalUsd.toFixed(2)} ÃÂ· R$ ${totalBrl.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>`;
    // Como cada parcela usa valor fixo em USD (nÃÂ£o %), nÃÂ£o hÃÂ¡ garantia
    // automÃÂ¡tica de que a soma bate com o Valor USD da PI Ã¢ÂÂ sinalizar em vez
    // de deixar passar batido (percentual, ao contrÃÂ¡rio, sempre soma 100%).
    if(val && Math.abs(totalUsd-val) > 0.01){
      rows += `<div class="pagamento-row" style="color:#b45309;"><span>Ã¢ÂÂ  Parcelas somam USD ${totalUsd.toFixed(2)}, mas o Valor USD da PI ÃÂ© USD ${val.toFixed(2)}</span><span></span></div>`;
    }
  }
  return `<div class="pagamento-box" style="margin-top:12px;">${rows}</div>`;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// COLETAR E SALVAR
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function marcarPendenciaRevisada(){
  const el = document.getElementById('f_pendencia_revisao');
  if(el) el.value = '';
  const banner = document.getElementById('alerta-pendencia');
  if(banner) banner.style.display = 'none';
  coletarESalvar();
  showToast('Ã¢ÂÂ PendÃÂªncia marcada como revisada', 'ok');
}


// BotÃÂ£o "Vincular ao Calculador" (item e) Ã¢ÂÂ abre o Calculador em uma nova
// aba, jÃÂ¡ preenchendo o wizard com os dados deste processo, pra gerar uma
// cotaÃÂ§ÃÂ£o (estimativa) de um processo que comeÃÂ§ou direto no Controle.
function vincularProcessoAoCalculador(processoId){
  window.open(`/calculador?processo_id=${processoId}`, '_blank');
}


function toggleMotivoCancelamento(){
  const sel = document.getElementById('f_agendamento_cancelado');
  const wrap = document.getElementById('wrap_motivo_cancelamento');
  if(sel && wrap) wrap.style.display = sel.value === 'true' ? 'block' : 'none';
}
