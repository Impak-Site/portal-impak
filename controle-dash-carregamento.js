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
  if(!visivel) renderDashCarregamento();
  document.getElementById('menu-carregamento')?.classList.toggle('active', !visivel);
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

  function card(label, val, sub, cor){
    return `<div style="background:#fff;border:1px solid var(--border);border-left:3px solid ${cor};border-radius:10px;padding:14px 16px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${label}</div>
    <div style="font-size:20px;font-weight:800;color:${cor};font-family:'DM Sans',sans-serif;white-space:nowrap;">${val}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>
    </div>`;
  }

  let lista = _processos.filter(p => (p.data_chegada || p.data_presenca) && (!p.data_agendamento || p.agendamento_cancelado));

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
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px 8px;font-weight:600;cursor:pointer;color:var(--ac);" onclick="abrirProcesso('${p.id}')">${esc(p.referencia)}</td>
      <td style="padding:6px 8px;">${esc(p.cliente || p.fornecedor || '—')}</td>
      <td style="padding:6px 8px;">${p.transportadora ? esc(p.transportadora) : '<span style="color:var(--err);">Sem transportadora</span>'}</td>
      <td style="padding:6px 8px;">${statusAgendamento}</td>
      <td style="padding:6px 8px;">${p.data_carregamento ? fmtData(p.data_carregamento) : '<span style="color:var(--err);">Pendente</span>'}</td>
      <td style="padding:6px 8px;">${p.horario_retirada || '—'}</td>
      <td style="padding:6px 8px;">${fmtData(p.data_presenca)}</td>
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
        <th style="padding:6px 8px;text-align:right;">Dias no Porto</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>` : `<div style="font-size:12px;color:var(--muted);">Nenhum processo aguardando carregamento no momento.</div>`;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px;">${kpis.join('')}</div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;overflow-x:auto;">${tabela}</div>
  `;
}