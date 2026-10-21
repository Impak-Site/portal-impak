// controle-dash-carregamento.js
//
// Dashboard de Carregamentos — visão consolidada de todo processo que já
// chegou no porto (tem Data de Chegada ou Presença de Carga) e ainda não
// tem Agendamento de retirada confirmado (sai da lista quando o
// Agendamento é preenchido, a menos que tenha sido cancelado). Mostra, por processo:
// transportadora, agendamento, data de carregamento, horário de retirada,
// presença de carga, dias parado no porto e status do agendamento
// (inclusive motivo se foi cancelado). Também resume dois indicadores que
// alimentam os alertas automáticos criados em server.js ao salvar um
// processo (POST /api/controle/v2/processo): quantos processos estão sem
// Transportadora na semana corrente e quantos estão sem Data de
// Carregamento apesar de já terem Presença de Carga.
//
// Parte do controle_v2.html, carregado via <script src> — não é ES module.
// Depende de: _processos, esc(), parseDataLocal (controle-core.js).

function toggleDashCarregamento(){
  const el = document.getElementById('dash-carregamento');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  ELEMENTOS_TOPO_DASHBOARD.forEach(id => { const alvo = document.getElementById(id); if(alvo) alvo.style.display = visivel ? '' : 'none'; });
  const toolbarCarreg = document.querySelector('.toolbar');
  if(toolbarCarreg) toolbarCarreg.style.display = visivel ? '' : 'none';
  if(!visivel) renderDashCarregamento();
  document.getElementById('menu-carregamento')?.classList.toggle('active', !visivel);

  var _optDC = document.querySelector('#filtro-data-campo option[value="data_carregamento"]');
  if (_optDC) {
    var _nowVisible = !visivel;
    _optDC.style.display = _nowVisible ? 'none' : '';
    _optDC.disabled = !!_nowVisible;
    if (_nowVisible && document.getElementById('filtro-data-campo') && document.getElementById('filtro-data-campo').value === 'data_carregamento') {
      document.getElementById('filtro-data-campo').value = 'data_chegada';
    }
  }
}

// ── Pedir a transportadora aos clientes (20/10/2026, pedido Ayslan) ──
// Prévia dos e-mails (um por cliente, montados no servidor — ver
// lib/carregamento-core.js) e envio do TESTE para a equipe (José e
// Emanuelly). Nada vai para o cliente nesta fase.
async function abrirPedidoTransportadora(){
  document.getElementById('pedido-transp-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'pedido-transp-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto;';
  ov.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:900px;width:100%;padding:18px 20px;box-shadow:0 10px 40px rgba(0,0,0,.25);">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <h3 style="margin:0;font-size:16px;">📧 Pedir transportadora aos clientes — prévia</h3>
      <button class="btn btn-sm btn-outline" onclick="document.getElementById('pedido-transp-overlay').remove()">Fechar</button>
    </div>
    <div id="pedido-transp-corpo" style="margin-top:12px;font-size:13px;color:var(--muted);">Montando os e-mails…</div>
  </div>`;
  ov.addEventListener('click', e => { if(e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  const corpo = document.getElementById('pedido-transp-corpo');
  try{
    const r = await fetch('/api/carregamento/pedir-transportadora/previa');
    const d = await r.json().catch(() => ({}));
    if(!r.ok || !d.ok) throw new Error(d.erro || ('Falha (' + r.status + ')'));
    if(!d.emails.length){ corpo.innerHTML = `Nenhum processo chegando nos próximos ${d.dias} dias sem transportadora. 👍`; return; }
    corpo.innerHTML = `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;color:#1e3a8a;margin-bottom:12px;">
        <strong>${d.emails.length} e-mail(s)</strong> (um por cliente) com <strong>${d.total} processo(s)</strong> chegando em até ${d.dias} dias ou já chegados, sem transportadora.
        No teste, cada e-mail vai só para <strong>${d.para.map(esc).join(' e ')}</strong> (cópia ${esc(d.copia)}) — <strong>nada vai para o cliente</strong>.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px;">
        <button class="btn btn-sm btn-primary" id="btn-pedido-transp-enviar" onclick="enviarPedidoTransportadoraTeste()">Enviar o teste para a equipe</button>
      </div>
      <div id="pedido-transp-lista"></div>`;
    const lista = document.getElementById('pedido-transp-lista');
    d.emails.forEach(m => {
      const bloco = document.createElement('details');
      bloco.style.cssText = 'border:1px solid var(--border);border-radius:8px;margin-bottom:8px;padding:8px 10px;';
      bloco.innerHTML = `<summary style="cursor:pointer;font-weight:600;color:var(--text);">${esc(m.cliente)} — ${m.qtd} processo(s) <span style="font-weight:400;color:var(--muted);">· ${esc(m.assunto)}</span></summary>`;
      const fr = document.createElement('iframe');
      fr.setAttribute('sandbox', '');
      fr.style.cssText = 'width:100%;height:420px;border:0;margin-top:8px;background:#fff;';
      fr.srcdoc = m.html;
      bloco.appendChild(fr);
      lista.appendChild(bloco);
    });
    if(lista.firstChild) lista.firstChild.open = true;
  }catch(e){
    corpo.innerHTML = `<span style="color:var(--err);">Erro: ${esc(e.message)}</span>`;
  }
}
// clientes: só esses (ex.: reenviar os que falharam). O resultado fica num
// quadro na própria prévia (o toast some), com ✓/✗ por cliente.
async function enviarPedidoTransportadoraTeste(clientes){
  const btn = document.getElementById('btn-pedido-transp-enviar');
  if(btn){ btn.disabled = true; btn.textContent = 'Enviando… (um a cada segundo)'; }
  try{
    const r = await fetch('/api/carregamento/pedir-transportadora/enviar-teste', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(clientes && clientes.length ? { clientes } : {}) });
    const d = await r.json().catch(() => ({}));
    if(!r.ok && !d.enviados) throw new Error(d.erro || ('Falha (' + r.status + ')'));
    const falhas = d.falhas || [];
    showToast(`✓ ${d.enviados} de ${d.total} e-mail(s) de teste enviados para ${d.para.join(' e ')}` + (falhas.length ? ` · ${falhas.length} falha(s)` : ''), falhas.length ? 'warn' : 'ok', 8000);
    mostrarResultadoPedidoTransportadora(d);
    if(btn) btn.textContent = falhas.length ? 'Enviado com falhas' : 'Teste enviado';
  }catch(e){
    showToast('Erro: ' + e.message, 'err');
    if(btn){ btn.disabled = false; btn.textContent = 'Enviar o teste para a equipe'; }
  }
}
function mostrarResultadoPedidoTransportadora(d){
  const corpo = document.getElementById('pedido-transp-corpo');
  if(!corpo) return;
  let box = document.getElementById('pedido-transp-resultado');
  if(!box){ box = document.createElement('div'); box.id = 'pedido-transp-resultado'; corpo.insertBefore(box, corpo.firstChild); }
  const falhas = (d.falhas || []).map(f => f.cliente);
  const ok = !falhas.length;
  box.style.cssText = `border-radius:8px;padding:10px 12px;margin-bottom:12px;border:1px solid ${ok ? '#bbf7d0' : '#fde68a'};background:${ok ? '#f0fdf4' : '#fffbeb'};color:${ok ? '#166534' : '#92400e'};`;
  box.innerHTML = `<strong>${d.enviados} de ${d.total} e-mail(s) enviados</strong> para ${(d.para || []).map(esc).join(' e ')}.`
    + `<ul style="margin:6px 0 0 18px;padding:0;">${(d.resultados || []).map(x => `<li>${x.ok ? '✓' : '✗'} ${esc(x.cliente)}${x.ok ? '' : ` — <span style="color:#b91c1c;">${esc(x.erro || 'falhou')}</span>`}</li>`).join('')}</ul>`
    + (falhas.length ? `<div style="margin-top:8px;"><button class="btn btn-sm btn-outline" id="btn-pedido-transp-reenviar">Reenviar só os ${falhas.length} que falharam</button></div>` : '');
  const re = document.getElementById('btn-pedido-transp-reenviar');
  if(re) re.onclick = () => { re.disabled = true; enviarPedidoTransportadoraTeste(falhas); };
}

function renderDashCarregamento(){
  const el = document.getElementById('dash-carregamento-content');
  if(!el) return;

  const hoje = new Date(); hoje.setHours(0,0,0,0);

  function diasEntre(dataStr){
    if(!dataStr) return null;
    const d = parseDataLocal(dataStr);
    if(!d) return null;
    return Math.floor((hoje - d) / 86400000);
  }

  // Data de vencimento da armazenagem pra exibir na tabela (pedido
  // Emanuelly 15/09/2026: "acrescentar nesse painel a data que vence a
  // armazenagem... sempre dar preferência para o campo 'Armazenagem Vence'").
  // Mesma lógica do "📌 Vencimento" mostrado em renderArmazenInfo()
  // (controle-core.js): usa o campo digitado manualmente (armazenagem_vencimento)
  // quando preenchido; senão calcula ao vivo a partir de Presença de Carga +
  // dias grátis do porto de destino (PORTO_ARMAZENAGEM_FREE_DIAS).
  function vencimentoArmazenagem(p){
    if(p.armazenagem_vencimento) return parseDataLocal(p.armazenagem_vencimento);
    const freeDias = PORTO_ARMAZENAGEM_FREE_DIAS[p.porto_destino];
    if(!p.data_presenca || !freeDias) return null;
    const presenca = parseDataLocal(p.data_presenca);
    if(!presenca) return null;
    presenca.setDate(presenca.getDate() + freeDias - 1);
    return presenca;
  }

  function card(label, val, sub, cor){
    return `<div style="background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
    <div style="font-size:20px;font-weight:800;color:${cor};font-family:'Inter',sans-serif;white-space:nowrap;">${val}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>
    </div>`;
  }

  let lista = _processos.filter(p => (p.data_chegada || p.data_presenca) && (!p.data_carregamento || p.agendamento_cancelado));

  // Respeita o mesmo filtro de data (campo + de/até) usado na tabela
  // principal (Esta semana/Este mês/intervalo custom), pra dar consistência
  // entre as telas em vez do dashboard sempre mostrar tudo.
  const dtDe = document.getElementById('filtro-data-de')?.value;
  const dtAte = document.getElementById('filtro-data-ate')?.value;
  const dtCampo = document.getElementById('filtro-data-campo')?.value || 'eta';
  if(dtDe || dtAte){
    lista = lista.filter(p => {
      const val = p[dtCampo];
      if(!val) return false;
      if(dtDe && val < dtDe) return false;
      if(dtAte && val > dtAte) return false;
      return true;
    });
  }

  lista.sort((a,b) => {
    const da = diasEntre(a.data_presenca || a.data_chegada) ?? -9999;
    const db = diasEntre(b.data_presenca || b.data_chegada) ?? -9999;
    return db - da;
  });

  const semTransportadora = lista.filter(p => !p.transportadora);
  const semDataCarregamento = lista.filter(p => p.data_presenca && !p.data_carregamento);
  const cancelados = lista.filter(p => p.agendamento_cancelado);

  const kpis = [
    card('Aguardando Carregamento', lista.length, 'processos no porto', 'var(--ac)'),
    card('Sem Transportadora', semTransportadora.length, 'de todos os processos no porto', 'var(--err)'),
    card('Sem Data de Carregamento', semDataCarregamento.length, 'já com presença de carga registrada', 'var(--err)'),
    card('Agendamentos Cancelados', cancelados.length, 'com retirada cancelada no porto', '#b45309'),
  ];

  const linhas = lista.map(p => {
    const dias = diasEntre(p.data_presenca || p.data_chegada);
    const diasTxt = dias == null ? '—' : (dias + ' dia' + (dias===1?'':'s'));
    const diasCor = dias!=null && dias >= 5 ? 'var(--err)' : (dias!=null && dias >= 2 ? '#b45309' : 'var(--muted)');
    const fmtData = d => d ? parseDataLocal(d).toLocaleDateString('pt-BR') : '—';
    const statusAgendamento = p.agendamento_cancelado
      ? `<span style="color:var(--err);font-weight:600;">Cancelado</span>${p.motivo_cancelamento ? ' — ' + esc(p.motivo_cancelamento) : ''}`
      : (p.data_agendamento ? fmtData(p.data_agendamento) : `<span style="color:var(--err);">Sem agendamento</span>`);
    const vencArm = vencimentoArmazenagem(p);
    const diasArm = vencArm ? Math.floor((hoje - vencArm) / 86400000) : null;
    const vencArmCor = diasArm===null ? 'var(--muted)' : diasArm > 0 ? 'var(--err)' : diasArm >= -2 ? '#b45309' : 'var(--text)';
    const vencArmTxt = vencArm ? vencArm.toLocaleDateString('pt-BR') : '—';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px 8px;font-weight:600;cursor:pointer;color:var(--ac);" onclick="abrirProcesso('${p.id}')">${esc(p.referencia)}</td>
      <td style="padding:6px 8px;">${esc(p.cliente || p.fornecedor || '—')}</td>
      <td style="padding:6px 8px;">${p.transportadora ? esc(p.transportadora) : '<span style="color:var(--err);">Sem transportadora</span>'}</td>
      <td style="padding:6px 8px;">${statusAgendamento}</td>
      <td style="padding:6px 8px;">${p.data_carregamento ? fmtData(p.data_carregamento) : '<span style="color:var(--err);">Pendente</span>'}</td>
      <td style="padding:6px 8px;">${p.horario_retirada || '—'}</td>
      <td style="padding:6px 8px;">${fmtData(p.data_presenca)}</td>
      <td style="padding:6px 8px;color:${vencArmCor};font-weight:${diasArm!==null && diasArm>0 ? '600':'400'};">${vencArmTxt}</td>
      <td style="padding:6px 8px;text-align:right;color:${diasCor};font-weight:600;">${diasTxt}</td>
    </tr>`;
  }).join('');

  const tabela = lista.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
        <th style="padding:6px 8px;">Referência</th>
        <th style="padding:6px 8px;">Cliente/Fornecedor</th>
        <th style="padding:6px 8px;">Transportadora</th>
        <th style="padding:6px 8px;">Agendamento</th>
        <th style="padding:6px 8px;">Data Carregamento</th>
        <th style="padding:6px 8px;">Horário Retirada</th>
        <th style="padding:6px 8px;">Presença de Carga</th>
        <th style="padding:6px 8px;">Vencimento Armazenagem</th>
        <th style="padding:6px 8px;text-align:right;">Dias no Porto</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>` : `<div style="font-size:12px;color:var(--muted);">Nenhum processo aguardando carregamento no momento.</div>`;

  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
      <button class="btn btn-sm btn-outline" onclick="abrirPedidoTransportadora()" title="Monta um e-mail por cliente com os processos chegando sem transportadora (referência, peças por container, peso bruto, porto e containers). Em teste: vai só para José e Emanuelly.">📧 Pedir transportadora aos clientes (teste)</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px;">${kpis.join('')}</div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;overflow-x:auto;">${tabela}</div>
  `;
}