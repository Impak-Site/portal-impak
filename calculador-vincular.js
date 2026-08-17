function _escVinc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Vincular cotação a processo existente (item d) — carregado no calculador.html
(function () {
  let _processosAbertosCache = null;

  function montarModal() {
    if (document.getElementById('mbg-vincular')) return;
    const div = document.createElement('div');
    div.className = 'mbg';
    div.id = 'mbg-vincular';
    div.innerHTML = `
      <div class="modal-cot">
        <div class="modal-cot-h">
          <h3>Vincular Cotação a Processo Existente</h3>
          <button class="modal-cot-close" onclick="fecharVincularProcesso()">✕</button>
        </div>
        <div class="modal-cot-b">
          <div style="font-size:12px;color:var(--dim);margin-bottom:14px;">Em vez de criar um processo novo ao aprovar, vincule esta cotação a um processo que já existe no Controle (ex: o processo começou direto no Controle, sem passar pelo Calculador). Os valores estimados (e os custos cotados, se ainda não houver Custos Reais lançados) são gravados no processo escolhido.</div>
          <div class="form-group"><label class="form-label">Cotação</label>
            <select class="form-input" id="vincular-cotacao-select"></select>
          </div>
          <div class="form-group" style="position:relative;"><label class="form-label">Processo (busque pela referência)</label>
            <input class="form-input" id="vincular-processo-busca" placeholder="Digite a referência..." autocomplete="off" oninput="buscarProcessoVincular(this.value)">
            <div id="vincular-processo-dropdown" style="display:none;position:absolute;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;width:100%;"></div>
            <input type="hidden" id="vincular-processo-id">
          </div>
          <button class="btn-calc" style="margin-top:14px;" onclick="confirmarVincularProcesso()">Vincular</button>
        </div>
      </div>`;
    document.body.appendChild(div);
  }

  window.abrirVincularProcesso = async function () {
    montarModal();
    document.getElementById('mbg-vincular').classList.add('open');
    document.getElementById('vincular-processo-id').value = '';
    document.getElementById('vincular-processo-busca').value = '';
    document.getElementById('vincular-processo-dropdown').style.display = 'none';
    const sel = document.getElementById('vincular-cotacao-select');
    sel.innerHTML = '<option value="">Carregando...</option>';
    try {
      const r = await fetch('/api/calculador/cotacoes');
      const d = await r.json();
      const cots = (d.cotacoes || []).filter(c => !c.resumo || c.resumo.status !== 'aprovada');
      if (!cots.length) { sel.innerHTML = '<option value="">Nenhuma cotação disponível</option>'; }
      else {
        sel.innerHTML = cots.map(c => `<option value="${_escVinc(c.id)}">${_escVinc(c.cliente || '(sem cliente)')} — ${_escVinc(c.numero || c.id.slice(0, 8))}</option>`).join('');
      }
    } catch (e) { sel.innerHTML = '<option value="">Erro ao carregar cotações</option>'; }
    try {
      const r2 = await fetch('/api/controle/processos-abertos');
      const d2 = await r2.json();
      _processosAbertosCache = d2.processos || [];
    } catch (e) { _processosAbertosCache = []; }
  };

  window.fecharVincularProcesso = function () {
    const m = document.getElementById('mbg-vincular');
    if (m) m.classList.remove('open');
  };

  window.buscarProcessoVincular = function (q) {
    const dd = document.getElementById('vincular-processo-dropdown');
    const termo = (q || '').trim().toUpperCase();
    if (!termo || !_processosAbertosCache) { dd.style.display = 'none'; return; }
    const matches = _processosAbertosCache.filter(p =>
      (p.referencia || '').toUpperCase().includes(termo) || (p.cliente || '').toUpperCase().includes(termo)
    ).slice(0, 20);
    if (!matches.length) {
      dd.innerHTML = '<div style="padding:8px 12px;color:var(--dim);font-size:12px;">Nenhum processo encontrado</div>';
      dd.style.display = 'block';
      return;
    }
    dd.innerHTML = matches.map(p => {
      const refEsc = (p.referencia || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<div style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);" onmousedown="selecionarProcessoVincular('${_escVinc(p.id)}','${_escVinc(refEsc)}')"><strong>${_escVinc(p.referencia || '')}</strong> — ${_escVinc(p.cliente || '(sem cliente)')} · ${_escVinc(p.fase || '')}</div>`;
    }).join('');
    dd.style.display = 'block';
  };

  window.selecionarProcessoVincular = function (id, referencia) {
    document.getElementById('vincular-processo-id').value = id;
    document.getElementById('vincular-processo-busca').value = referencia;
    document.getElementById('vincular-processo-dropdown').style.display = 'none';
  };

  window.confirmarVincularProcesso = async function () {
    const cotacaoId = document.getElementById('vincular-cotacao-select').value;
    const processoId = document.getElementById('vincular-processo-id').value;
    if (!cotacaoId) { showToast('Selecione a cotação', 'err'); return; }
    if (!processoId) { showToast('Busque e selecione o processo pela referência', 'err'); return; }
    if (!confirm('Vincular esta cotação ao processo selecionado? Os valores estimados serão gravados no processo (sem sobrescrever Custos Reais já lançados).')) return;
    try {
      const r = await fetch(`/api/calculador/cotacoes/${cotacaoId}/vincular-processo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processo_id: processoId })
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro || 'Erro ao vincular');
      showToast(`✓ Cotação vinculada ao processo ${d.processo_referencia || ''}`, 'ok');
      window.fecharVincularProcesso();
    } catch (e) { showToast('Erro: ' + e.message, 'err'); }
  };

  function inserirBotao() {
    const btnRef = document.querySelector('[onclick="abrirListaCotacoes()"]');
    if (btnRef && btnRef.parentElement && !document.getElementById('btn-vincular-processo')) {
      const novoBtn = document.createElement('button');
      novoBtn.id = 'btn-vincular-processo';
      novoBtn.className = 'btn-refresh';
      novoBtn.style.flex = '1';
      novoBtn.textContent = 'Vincular a Processo';
      novoBtn.onclick = window.abrirVincularProcesso;
      btnRef.insertAdjacentElement('afterend', novoBtn);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inserirBotao);
  } else {
    inserirBotao();
  }
})();
