// lib/carregamento-core.js
//
// Carregamento — e-mail "qual será a transportadora?" (20/10/2026, pedido
// Ayslan). Um e-mail por cliente com os processos que estão chegando (ou já
// chegaram) e ainda não têm transportadora, com o que a transportadora
// precisa saber: referência, peças por container, peso bruto, porto de
// chegada e quantidade de containers (+ a data de chegada, pro cliente saber
// quando).
//
// Fase de teste: o servidor manda estes e-mails para a equipe (José e
// Emanuelly) conferirem. Quando o cadastro tiver "quem recebe o quê" por
// pessoa do cliente, o mesmo e-mail vai direto para o responsável.
//
// Peso e quantidade vêm, nesta ordem, do que foi digitado no processo e do
// que a leitura dos documentos (Conferência) guardou em
// conferencia_json.dadosDocs — BL/CE são os oficiais para o peso; PL/CI para
// as peças embarcadas (a PI é só o pedido e pode ser diferente do embarcado).
//
// Sem banco e sem rede: recebe os processos já lidos (testado em
// testes_carregamento.js).
'use strict';

const tem = v => v !== null && v !== undefined && String(v).trim() !== '';
function jsonVal(v, padrao) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string' || !v.trim()) return padrao;
  try { return JSON.parse(v); } catch (e) { return padrao; }
}
const jsonArr = v => { const x = jsonVal(v, []); return Array.isArray(x) ? x : []; };
const chave = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const iso = d => { const s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
function somaDias(s, n) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Número escrito em documento: "10.532,380 KGS", "10,504.08 KGS", "1,308 PCS",
// "11846.4" → número (ou null). Com os dois separadores, o último é o decimal;
// com um só, 3 dígitos depois dele = milhar (peso de container é em milhares).
function numeroDoc(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const m = String(v == null ? '' : v).match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0].replace(/[.,]+$/, '');
  const ultPonto = s.lastIndexOf('.'), ultVirg = s.lastIndexOf(',');
  if (ultPonto >= 0 && ultVirg >= 0) {
    s = ultVirg > ultPonto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (ultPonto >= 0 || ultVirg >= 0) {
    const partes = s.split(ultVirg >= 0 ? ',' : '.');
    s = (partes.length > 2 || partes[partes.length - 1].length === 3) ? partes.join('') : partes.join('.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// Documentos que a Conferência leu: [{ tipo:'BL'|'CE'|'PL'|'CI'|'PI'..., dados:{...} }].
function documentos(p) {
  const conf = jsonVal(p && p.conferencia_json, null);
  const dd = conf && conf.dadosDocs;
  const lista = Array.isArray(dd) ? dd : (dd && typeof dd === 'object' ? Object.values(dd) : []);
  return lista.filter(d => d && d.dados && typeof d.dados === 'object').map(d => ({ tipo: String(d.tipo || '').toUpperCase(), dados: d.dados }));
}
function doPrimeiro(docs, tipos, campo, conv) {
  for (const t of tipos) {
    for (const d of docs) {
      if (d.tipo !== t) continue;
      const v = conv(d.dados[campo]);
      if (v != null && v > 0) return { valor: v, fonte: t };
    }
  }
  return null;
}
const ORDEM_PESO = ['BL', 'CE', 'PL', 'CI', 'BL_DRAFT'];
const ORDEM_PECAS = ['PL', 'CI', 'BL', 'CE', 'BL_DRAFT'];

function pesoBruto(p) {
  const digitado = numeroDoc(p && p.peso_bruto);
  if (digitado && digitado > 0) return { kg: digitado, fonte: 'processo' };
  const r = doPrimeiro(documentos(p), ORDEM_PESO, 'peso_bruto', numeroDoc);
  return r ? { kg: r.valor, fonte: r.fonte } : { kg: null, fonte: null };
}
function pecasTotal(p) {
  const r = doPrimeiro(documentos(p), ORDEM_PECAS, 'quantidade', v => { const n = numeroDoc(v); return n == null ? null : Math.round(n); });
  if (r) return { qtd: r.valor, fonte: r.fonte };
  const soma = jsonArr(p && p.produtos_json).reduce((s, x) => s + (parseFloat(x && x.quantidade) || 0), 0);
  return soma > 0 ? { qtd: Math.round(soma), fonte: 'produtos' } : { qtd: null, fonte: null };
}
function containersDe(p) {
  const lista = jsonArr(p && p.containers_json).filter(c => c && tem(c.numero))
    .map(c => ({ numero: String(c.numero).trim(), tipo: String(c.tipo || ''), pecas: numeroDoc(c.pecas != null ? c.pecas : c.quantidade) }));
  if (lista.length) return lista;
  return String((p && p.container) || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).map(n => ({ numero: n, tipo: '', pecas: null }));
}
function qtdContainers(p) {
  const cs = containersDe(p);
  if (cs.length) return cs.length;
  const n = parseInt((p && (p.qtd_containers || p.qtd_containers_prevista)) || 0, 10);
  return n > 0 ? n : null;
}
// Peças por container: a de cada container quando a leitura trouxe; com 1
// container é o total; com vários sem a divisão, fica em aberto (está no PL).
function pecasPorContainer(p) {
  const cs = containersDe(p), total = pecasTotal(p).qtd, n = qtdContainers(p);
  if (cs.length && cs.every(c => c.pecas > 0)) return cs.map(c => ({ numero: c.numero, pecas: Math.round(c.pecas) }));
  if ((n || 1) === 1) return [{ numero: cs[0] ? cs[0].numero : '', pecas: total }];
  return cs.map(c => ({ numero: c.numero, pecas: c.pecas > 0 ? Math.round(c.pecas) : null }));
}

// Entra no pedido quem não tem transportadora, não carregou e está chegando:
// já chegou (Data de Chegada/Presença) ou ETA até hoje + N dias.
// Transportadora escolhida no cadastro (id) ou carregamento já agendado (e não
// cancelado) = a transportadora já é conhecida, não pergunta de novo.
const simNao = v => /^(true|sim|1)$/i.test(String(v == null ? '' : v).trim());
function precisaTransportadora(p, hoje, dias) {
  if (!p || p.cancelado || p.fechado || p.fase === 'FINALIZADO') return false;
  if (tem(p.transportadora) || tem(p.transportadora_id) || tem(p.data_carregamento) || tem(p.data_devolucao_vazio)) return false;
  if (tem(p.data_agendamento) && !simNao(p.agendamento_cancelado)) return false;
  if (tem(p.data_chegada) || tem(p.data_presenca)) return true;
  const eta = iso(p.eta), h = iso(hoje);
  if (!eta || !h) return false;
  return eta <= somaDias(h, dias == null ? 15 : dias);
}

const ehImpak = nome => /^IMPAK\b/.test(chave(nome));
// Quem decide a transportadora: o cliente do processo. Importação própria
// (cliente = IMPAK) com venda para UM cliente → esse cliente; com várias
// vendas ou sem venda, fica com a equipe (decisão interna).
function clienteDoPedido(p) {
  const nome = tem(p.cliente) ? String(p.cliente).trim() : '';
  if (nome && !ehImpak(nome)) return { cliente: nome, clienteId: p.cliente_id || null, proprio: false };
  const vendas = jsonArr(p.vendas_json).filter(v => v && tem(v.cliente) && !ehImpak(v.cliente));
  const distintos = [...new Map(vendas.map(v => [v.cliente_id || chave(v.cliente), v])).values()];
  if (distintos.length === 1) return { cliente: String(distintos[0].cliente).trim(), clienteId: distintos[0].cliente_id || null, proprio: false };
  return { cliente: 'IMPAK — importação própria', clienteId: null, proprio: true, clientesVenda: distintos.map(v => String(v.cliente).trim()) };
}
function agruparPorCliente(processos) {
  const grupos = new Map();
  (processos || []).forEach(p => {
    const c = clienteDoPedido(p);
    const k = c.proprio ? 'impak' : (c.clienteId ? 'id:' + c.clienteId : 'nome:' + chave(c.cliente));
    if (!grupos.has(k)) grupos.set(k, { cliente: c.cliente, clienteId: c.clienteId, proprio: c.proprio, processos: [] });
    grupos.get(k).processos.push(Object.assign({}, p, { _clientesVenda: c.clientesVenda || [] }));
  });
  const ordem = (x, y) => String(iso(x.data_chegada || x.data_presenca) || iso(x.eta) || '9999').localeCompare(String(iso(y.data_chegada || y.data_presenca) || iso(y.eta) || '9999')) || String(x.referencia || '').localeCompare(String(y.referencia || ''));
  return [...grupos.values()].map(g => Object.assign(g, { processos: g.processos.sort(ordem) }))
    .sort((a, b) => (a.proprio - b.proprio) || a.cliente.localeCompare(b.cliente, 'pt-BR'));
}

const fmtInt = n => n == null ? '' : Math.round(n).toLocaleString('pt-BR');
const fmtKg = n => n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
const fmtData = s => { const i = iso(s); return i ? i.slice(8, 10) + '/' + i.slice(5, 7) + '/' + i.slice(0, 4) : ''; };

function linhaProcesso(p, opts) {
  opts = opts || {};
  const cs = containersDe(p), total = pecasTotal(p).qtd, n = qtdContainers(p), peso = pesoBruto(p).kg;
  const chegou = tem(p.data_chegada) || tem(p.data_presenca);
  return {
    referencia: String(p.referencia || ''),
    containers: cs.map(c => c.numero),
    qtdContainers: n,
    pecasPorContainer: pecasPorContainer(p),
    pecasTotal: total,
    pesoBrutoKg: peso,
    porto: typeof opts.nomePorto === 'function' ? opts.nomePorto(p.porto_destino) : String(p.porto_destino || ''),
    chegada: chegou ? { tipo: 'chegou', data: iso(p.data_chegada || p.data_presenca) } : { tipo: 'previsao', data: iso(p.eta) },
    clientesVenda: p._clientesVenda || [],
    faltando: [peso == null && 'peso bruto', total == null && 'quantidade de peças', !n && 'quantidade de containers', !tem(p.porto_destino) && 'porto de chegada'].filter(Boolean),
  };
}

function textoPecas(l) {
  const ppc = l.pecasPorContainer;
  if (ppc.length === 1 && ppc[0].pecas != null) return fmtInt(ppc[0].pecas);
  if (ppc.length > 1 && ppc.every(x => x.pecas != null)) return ppc.map(x => `${esc(x.numero)}: ${fmtInt(x.pecas)}`).join('<br>');
  if (l.pecasTotal != null) return `${fmtInt(l.pecasTotal)} no total<br><span style="color:#6b7280;font-size:11px;">divisão por container no PL</span>`;
  return '<span style="color:#b45309;">a confirmar</span>';
}

// HTML do e-mail de UM cliente. opts: { nomePorto(codigo), teste, paraQuemHtml }.
function htmlEmailCliente(grupo, opts) {
  opts = opts || {};
  const linhas = grupo.processos.map(p => linhaProcesso(p, opts));
  const td = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;';
  const corpoTabela = linhas.map(l => `
      <tr>
        <td style="${td}font-family:monospace;font-weight:600;white-space:nowrap;">${esc(l.referencia)}${l.clientesVenda.length ? `<br><span style="font-family:sans-serif;font-weight:400;color:#6b7280;font-size:11px;">vendas: ${esc(l.clientesVenda.join(', '))}</span>` : ''}</td>
        <td style="${td}font-family:monospace;">${l.containers.length ? l.containers.map(esc).join('<br>') : '<span style="color:#b45309;font-family:sans-serif;">a confirmar</span>'}</td>
        <td style="${td}text-align:right;">${textoPecas(l)}</td>
        <td style="${td}text-align:right;white-space:nowrap;">${l.pesoBrutoKg != null ? fmtKg(l.pesoBrutoKg) : '<span style="color:#b45309;">a confirmar</span>'}</td>
        <td style="${td}">${esc(l.porto) || '<span style="color:#b45309;">a confirmar</span>'}</td>
        <td style="${td}text-align:center;">${l.qtdContainers || '<span style="color:#b45309;">?</span>'}</td>
        <td style="${td}white-space:nowrap;">${l.chegada.data ? (l.chegada.tipo === 'chegou' ? 'Chegou em ' : 'Previsão ') + fmtData(l.chegada.data) : '<span style="color:#b45309;">a confirmar</span>'}</td>
      </tr>`).join('');
  const faltas = linhas.filter(l => l.faltando.length);
  const quadroTeste = opts.teste ? `
      <div style="background:#f3f4f6;border:1px dashed #9ca3af;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#374151;">
        <strong>TESTE — este e-mail ainda não foi para o cliente.</strong> Confira os dados.${opts.paraQuemHtml ? '<br>' + opts.paraQuemHtml : ''}
        ${faltas.length ? `<br><span style="color:#b45309;">Dados faltando: ${faltas.map(l => `${esc(l.referencia)} (${esc(l.faltando.join(', '))})`).join('; ')}.</span>` : ''}
      </div>` : '';
  const intro = grupo.proprio
    ? `<p style="font-size:14px;color:#111;">Processos de <strong>importação própria</strong> chegando sem transportadora definida — decisão interna da IMPAK.</p>`
    : `<p style="font-size:14px;color:#111;">Prezados,</p>
       <p style="font-size:14px;color:#111;">Os processos abaixo estão chegando ao porto. Para organizarmos a retirada assim que a carga for liberada, por favor nos informem <strong>qual transportadora fará o transporte de cada processo</strong> (nome e, se possível, o contato).</p>`;
  return `
    <div style="font-family:sans-serif;max-width:820px;margin:0 auto;">${quadroTeste}
      <h2 style="color:#1a7fd4;margin:0 0 6px;font-size:18px;">IMPAK — Transportadora para retirada · ${esc(grupo.cliente)}</h2>
      ${intro}
      <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:sans-serif;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px 10px;text-align:left;">Referência</th>
            <th style="padding:8px 10px;text-align:left;">Container</th>
            <th style="padding:8px 10px;text-align:right;">Peças por container</th>
            <th style="padding:8px 10px;text-align:right;">Peso bruto</th>
            <th style="padding:8px 10px;text-align:left;">Porto de chegada</th>
            <th style="padding:8px 10px;text-align:center;">Qtd. containers</th>
            <th style="padding:8px 10px;text-align:left;">Chegada</th>
          </tr>
        </thead>
        <tbody>${corpoTabela}</tbody>
      </table>
      <p style="font-size:12px;color:#6b7280;margin-top:14px;">As datas de chegada são previsões do armador e podem mudar. Peso e quantidade conforme os documentos de embarque (BL / Packing List).</p>
      <p style="font-size:13px;color:#111;">Obrigado,<br>Equipe IMPAK — Logística</p>
    </div>`;
}

function assuntoEmail(grupo, opts) {
  const n = grupo.processos.length;
  return `${opts && opts.teste ? '[TESTE] ' : ''}IMPAK — Transportadora para ${n} processo${n === 1 ? '' : 's'} · ${grupo.cliente}`;
}

module.exports = {
  numeroDoc, documentos, pesoBruto, pecasTotal, containersDe, qtdContainers, pecasPorContainer,
  precisaTransportadora, clienteDoPedido, agruparPorCliente, linhaProcesso, htmlEmailCliente, assuntoEmail,
};
