// newsletter-servidor.js — "Radar IMPAK", a newsletter semanal (19/10/2026).
//
// Pedido Ayslan: o próprio portal cria o conteúdo e manda para o revisor
// (Narcélio) conferir; depois ele só encaminha aos clientes. Duas edições:
//   segunda 6h → "pneus"  (importações, matéria-prima, passeio e caminhão)
//   quarta 6h  → "cambio" (dólar da semana, agenda, projeções, tendência)
//
// Como funciona:
//   1. A IA (API da Anthropic, ferramenta de busca na web) pesquisa a semana
//      e devolve o conteúdo em JSON (textos + fontes numeradas).
//   2. Este módulo monta o HTML do e-mail (mesmo layout aprovado: tabelas,
//      estilos inline, 600px, logo) — a IA não escreve HTML.
//   3. Os links das fontes são conferidos (abre cada um); link que não abre
//      vira nota para o revisor.
//   4. server.js envia pelo enviarEmail (Resend) ao revisor, com cópia no
//      suporte@ (regra dos e-mails internos).
//
// Regras do revisor que entram no pedido à IA (feedback do Narcélio,
// 18/10/2026): quando as fábricas anunciam reajuste por causa da
// matéria-prima, isso aparece com destaque; não dizer que o custo está
// aliviando se o mercado está repassando alta.
//
// Credencial: só ANTHROPIC_API_KEY (variável de ambiente do Railway).
'use strict';

const MODELO = 'claude-sonnet-5-5';
const MODELO_RESERVA = 'claude-sonnet-4-6';

const ROXO = '#200056', AZUL = '#2a7bd0', TEXTO = '#2d2840', SUAVE = '#5d5873';
const FONTE = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ── hora de Brasília (o servidor roda em UTC) ─────────────────────────
function agoraSP(d) {
  const x = d ? new Date(d) : new Date();
  const br = new Date(x.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const iso = br.getFullYear() + '-' + String(br.getMonth() + 1).padStart(2, '0') + '-' + String(br.getDate()).padStart(2, '0');
  return { diaSemana: br.getDay(), hora: br.getHours(), minuto: br.getMinutes(), dataISO: iso, data: br };
}
function dataExtenso(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  const dia = DIAS[dt.getUTCDay()];
  return dia.charAt(0).toUpperCase() + dia.slice(1) + ', ' + d + ' de ' + MESES[m - 1] + ' de ' + a;
}
function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

// Qual edição sai agora? segunda → pneus, quarta → câmbio, a partir das 6h.
function edicaoDoMomento(d, horaMin) {
  const t = agoraSP(d);
  const h = horaMin == null ? 6 : horaMin;
  if (t.hora < h) return null;
  if (t.diaSemana === 1) return 'pneus';
  if (t.diaSemana === 3) return 'cambio';
  return null;
}

// Follow-up semanal de processos (Emanuelly, 19/10/2026): sai na segunda,
// logo depois da importação da planilha do despachante; se ninguém importar
// até a hora-limite, sai assim mesmo (com aviso). → 'importacao' | 'limite' | null
function decidirFollowUp(sp, gatilho, opts) {
  const o = opts || {};
  if (sp.diaSemana !== 1) return null;
  if (o.desde && sp.dataISO < o.desde) return null;
  if (gatilho === 'importacao') return 'importacao';
  if (sp.hora >= (o.horaLimite == null ? 14 : o.horaLimite)) return 'limite';
  return null;
}

// ── texto seguro + citações [n] → número sobrescrito com link ─────────
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function urlSegura(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#'; }
function comCitacoes(texto, fontes) {
  return esc(texto).replace(/\s*\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, nums) => {
    const links = nums.split(',').map(n => parseInt(n, 10)).filter(n => fontes[n - 1]).map(n =>
      `<a href="${esc(urlSegura(fontes[n - 1].url))}" style="color:${AZUL};text-decoration:none;font-weight:600;">${n}</a>`);
    return links.length ? `<sup style="font-size:10px;line-height:0;">${links.join(',')}</sup>` : '';
  });
}

// ── blocos do layout (mesmo desenho do e-mail aprovado em 19/10) ──────
function p(html, mb) {
  return `<p style="margin:0 0 ${mb == null ? 14 : mb}px 0;font-family:${FONTE};font-size:15px;line-height:1.65;color:${TEXTO};">${html}</p>`;
}
function titulo(t) {
  return `<div style="height:3px;width:32px;background:${AZUL};font-size:0;line-height:0;margin:26px 0 10px 0;">&nbsp;</div>`
    + `<h2 style="margin:0 0 10px 0;font-family:${FONTE};font-size:18px;line-height:1.35;color:${ROXO};font-weight:700;">${esc(t)}</h2>`;
}
function kpis(itens) {
  const cels = [];
  itens.slice(0, 3).forEach((k, i) => {
    if (i) cels.push('<td width="10" style="font-size:0;line-height:0;">&nbsp;</td>');
    cels.push(`<td valign="top" width="33%" style="background:#f6f4fb;border-radius:10px;padding:14px 14px 12px 14px;">`
      + `<div style="font-family:${FONTE};font-size:24px;line-height:1.15;font-weight:700;color:${ROXO};">${esc(k.valor)}</div>`
      + `<div style="font-family:${FONTE};font-size:12px;line-height:1.4;color:${SUAVE};margin-top:4px;">${esc(k.rotulo)}</div></td>`);
  });
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + cels.join('') + '</tr></table>';
}
function pontos(itens, fontes) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + itens.map((it, i) =>
    '<tr>'
    + `<td valign="top" width="34" style="padding:2px 0 14px 0;"><div style="width:24px;height:24px;border-radius:12px;background:${ROXO};color:#ffffff;font-family:${FONTE};font-size:13px;font-weight:700;line-height:24px;text-align:center;">${i + 1}</div></td>`
    + `<td valign="top" style="padding:0 0 14px 0;font-family:${FONTE};font-size:15px;line-height:1.65;color:${TEXTO};"><strong style="color:#1b1035;">${esc(it.lead)}</strong> ${comCitacoes(it.texto, fontes)}</td>`
    + '</tr>').join('') + '</table>';
}
function caixa(rotulo, html, cor) {
  const c = cor || { fundo: '#eef5fc', borda: AZUL, titulo: '#1a5fa8', texto: '#24314a' };
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 6px 0;"><tr>'
    + `<td style="background:${c.fundo};border-left:4px solid ${c.borda};border-radius:8px;padding:14px 18px;">`
    + `<div style="font-family:${FONTE};font-size:13px;font-weight:700;color:${c.titulo};margin:0 0 4px 0;">${esc(rotulo)}</div>`
    + `<div style="font-family:${FONTE};font-size:15px;line-height:1.6;color:${c.texto};">${html}</div>`
    + '</td></tr></table>';
}
function agenda(itens, fontes) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px 0;">' + itens.map((it, i) => {
    const borda = i ? 'border-top:1px solid #eeebf4;' : '';
    return '<tr>'
      + `<td valign="top" width="96" style="${borda}padding:10px 10px 10px 0;font-family:${FONTE};font-size:14px;font-weight:700;color:${ROXO};white-space:nowrap;">${esc(it.quando)}</td>`
      + `<td valign="top" style="${borda}padding:10px 0;font-family:${FONTE};font-size:15px;line-height:1.6;color:${TEXTO};">${comCitacoes(it.texto, fontes)}</td>`
      + '</tr>';
  }).join('') + '</table>';
}
function listaFontes(fontes) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + fontes.map((f, i) =>
    '<tr>'
    + `<td valign="top" width="22" style="padding:0 0 7px 0;font-family:${FONTE};font-size:12px;line-height:1.5;color:${SUAVE};">${i + 1}.</td>`
    + `<td valign="top" style="padding:0 0 7px 0;font-family:${FONTE};font-size:12px;line-height:1.5;color:${SUAVE};">${esc(f.veiculo)}. <a href="${esc(urlSegura(f.url))}" style="color:#1a5fb4;text-decoration:underline;">${esc(f.titulo)}</a>. ${esc(f.data || '')}.</td>`
    + '</tr>').join('') + '</table>';
}

const EDICOES = {
  pneus: { edicao: 'Radar IMPAK · Pneus', chapeu: 'Mercado de pneus · edição de segunda', assinatura: 'Boa semana,',
    rodape: 'Conteúdo informativo, preparado a partir das fontes citadas acima. Os números podem ser revisados pelas próprias fontes.' },
  cambio: { edicao: 'Radar IMPAK · Câmbio', chapeu: 'Câmbio · edição de quarta', assinatura: 'Um abraço,',
    rodape: 'Conteúdo informativo, preparado a partir das fontes citadas acima. Não constitui recomendação de investimento ou de operação de câmbio.' },
};

// Monta o e-mail a partir do JSON da IA. notas (opcional) = avisos só para
// o revisor, numa caixa amarela no topo ("apague antes de encaminhar").
function montarHtml(tipo, conteudo, opts) {
  const cfg = EDICOES[tipo];
  if (!cfg) throw new Error('edição desconhecida: ' + tipo);
  const o = opts || {};
  const c = conteudo || {};
  const fontes = Array.isArray(c.fontes) ? c.fontes : [];
  const partes = [];
  const notas = [].concat(c.notas_revisao || [], o.notas || []).filter(Boolean);
  if (notas.length) {
    partes.push(caixa('Só para revisão — apague esta caixa antes de encaminhar',
      notas.map(n => '• ' + esc(n)).join('<br>'),
      { fundo: '#fff7e0', borda: '#d99a00', titulo: '#8a5a00', texto: '#4a3a10' }));
    partes.push('<div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>');
  }
  if (Array.isArray(c.kpis) && c.kpis.length) {
    partes.push(kpis(c.kpis));
    partes.push('<div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>');
  }
  partes.push(p('Bom dia,'));
  (c.abertura || []).forEach(t => partes.push(p(comCitacoes(t, fontes))));
  (c.secoes || []).forEach(s => {
    if (s.titulo) partes.push(titulo(s.titulo));
    (s.paragrafos || []).forEach(t => partes.push(p(comCitacoes(t, fontes))));
    if (Array.isArray(s.agenda) && s.agenda.length) partes.push(agenda(s.agenda, fontes));
    if (Array.isArray(s.pontos) && s.pontos.length) partes.push(pontos(s.pontos, fontes));
    if (s.caixa && s.caixa.texto) partes.push(caixa(s.caixa.rotulo || 'Nossa leitura', comCitacoes(s.caixa.texto, fontes)));
  });
  partes.push('<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>');
  if (c.fecho) partes.push(p(comCitacoes(c.fecho, fontes)));
  partes.push(p(esc(cfg.assinatura) + '<br><strong style="color:#1b1035;">Equipe IMPAK</strong>', 4));

  const logo = o.logoUrl || '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.assunto)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f0f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f0f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e4e0ee;border-radius:12px;overflow:hidden;">
<tr><td style="padding:22px 32px 18px 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle">${logo ? `<img src="${esc(logo)}" width="150" alt="IMPAK Comercial Importadora" style="display:block;width:150px;height:auto;border:0;">` : `<strong style="font-family:${FONTE};font-size:20px;color:${ROXO};">IMPAK</strong>`}</td>
    <td valign="middle" align="right" style="font-family:${FONTE};font-size:12px;line-height:1.5;color:${SUAVE};">
      <div style="font-weight:700;color:${ROXO};">${esc(cfg.edicao)}</div>
      <div>${esc(o.dataExtenso || '')}</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:0;font-size:0;line-height:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="75%" height="4" style="background:${ROXO};font-size:0;line-height:0;">&nbsp;</td>
    <td width="25%" height="4" style="background:${AZUL};font-size:0;line-height:0;">&nbsp;</td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 6px 32px;">
  <div style="font-family:${FONTE};font-size:12px;letter-spacing:0.3px;color:${AZUL};font-weight:700;margin:0 0 8px 0;">${esc(cfg.chapeu)}</div>
  <h1 style="margin:0 0 10px 0;font-family:${FONTE};font-size:26px;line-height:1.25;color:#1b1035;font-weight:700;">${esc(c.h1)}</h1>
  <p style="margin:0 0 8px 0;font-family:${FONTE};font-size:15px;line-height:1.55;color:#4f4a63;">${esc(c.linha_fina)}</p>
  <div style="font-family:${FONTE};font-size:12px;color:#8a85a0;margin:0 0 18px 0;">Leitura de ${esc(o.minutos || 3)} minutos</div>
</td></tr>
<tr><td style="padding:0 32px 14px 32px;">
${partes.join('')}
</td></tr>
<tr><td style="padding:6px 32px 22px 32px;">
  <div style="border-top:1px solid #eeebf4;padding-top:16px;">
    <div style="font-family:${FONTE};font-size:13px;font-weight:700;color:#4f4a63;margin:0 0 8px 0;">Fontes</div>
    ${listaFontes(fontes)}
  </div>
</td></tr>
<tr><td style="background:#faf9fc;border-top:1px solid #eeebf4;padding:16px 32px 18px 32px;font-family:${FONTE};font-size:11.5px;line-height:1.55;color:#8a85a0;text-align:center;">
  <strong style="color:#6b6680;">IMPAK Comercial Importadora</strong><br>
  ${esc(cfg.rodape)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Palavras do corpo (sem fontes) → minutos de leitura (220 palavras/min).
function minutosLeitura(conteudo) {
  const c = conteudo || {};
  const textos = [].concat(c.abertura || [], c.fecho || []);
  (c.secoes || []).forEach(s => {
    textos.push(...(s.paragrafos || []));
    (s.pontos || []).forEach(x => textos.push(x.lead, x.texto));
    (s.agenda || []).forEach(x => textos.push(x.texto));
    if (s.caixa) textos.push(s.caixa.texto);
  });
  const n = textos.join(' ').replace(/\[\d+(?:,\s*\d+)*\]/g, '').split(/\s+/).filter(w => /\w/.test(w)).length;
  return Math.max(2, Math.round(n / 220));
}

// Confere o JSON que veio da IA. Devolve lista de problemas (vazia = ok).
function validarConteudo(c) {
  const erros = [];
  if (!c || typeof c !== 'object') return ['resposta sem JSON'];
  ['assunto', 'h1', 'linha_fina'].forEach(k => { if (!c[k] || typeof c[k] !== 'string') erros.push('faltou ' + k); });
  if (!Array.isArray(c.secoes) || c.secoes.length < 2) erros.push('menos de 2 seções');
  if (!Array.isArray(c.fontes) || c.fontes.length < 3) erros.push('menos de 3 fontes');
  (c.fontes || []).forEach((f, i) => { if (!f || !/^https?:\/\//i.test(f.url || '')) erros.push(`fonte ${i + 1} sem link`); });
  // citação apontando para fonte que não existe
  const txt = JSON.stringify([c.abertura, c.secoes, c.fecho]);
  const nFontes = (c.fontes || []).length;
  (txt.match(/\[(\d+(?:\s*,\s*\d+)*)\]/g) || []).forEach(m => m.replace(/[[\]\s]/g, '').split(',').forEach(n => {
    if (+n < 1 || +n > nFontes) erros.push('citação [' + n + '] sem fonte');
  }));
  if (!/\[\d/.test(txt)) erros.push('texto sem nenhuma citação de fonte');
  return [...new Set(erros)];
}

// Tira o JSON do texto final da IA (entre <json>...</json> ou o 1º objeto).
function extrairJson(texto) {
  const s = String(texto || '');
  const m = s.match(/<json>([\s\S]*?)<\/json>/i);
  let bruto = m ? m[1] : null;
  if (!bruto) {
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i >= 0 && j > i) bruto = s.slice(i, j + 1);
  }
  if (!bruto) return null;
  bruto = bruto.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(bruto); } catch (e) { /* tenta sem quebras de linha soltas */ }
  // Com a busca na web, a resposta vem picada em vários blocos (um por
  // citação) e pode trazer quebra de linha crua dentro de um texto — o que
  // invalida o JSON. Troca caracteres de controle por espaço e tenta de novo.
  try { return JSON.parse(bruto.replace(/[\u0000-\u001F]+/g, ' ')); } catch (e) { return null; }
}

// ── pedido à IA ───────────────────────────────────────────────────────
const FORMATO = `Responda SOMENTE com um JSON entre <json> e </json>, neste formato:
{
  "assunto": "assunto do e-mail (curto, sem 'Radar IMPAK')",
  "preheader": "uma frase de prévia (até 120 caracteres)",
  "h1": "título principal (pode ser igual ao assunto)",
  "linha_fina": "1 ou 2 frases resumindo a edição",
  "kpis": [{"valor": "34,2 mi", "rotulo": "o que o número significa"}, ... exatamente 3],
  "abertura": ["1 parágrafo curto de abertura (sem 'Bom dia', isso já vai no e-mail)"],
  "secoes": [
    {"titulo": "...", "paragrafos": ["... [1]", "..."], "pontos": [{"lead": "frase forte.", "texto": "explicação [2]"}], "agenda": [{"quando": "Sex, 23/10", "texto": "..."}], "caixa": {"rotulo": "Nossa leitura", "texto": "..."}}
  ],
  "fecho": "1 frase de fechamento (convite a responder o e-mail / próxima edição)",
  "fontes": [{"veiculo": "AutoData", "titulo": "título da matéria", "data": "28/09/2026", "url": "https://..."}],
  "notas_revisao": ["pontos que o revisor precisa confirmar (dado sem fonte pública, número divergente entre fontes etc.)"]
}
Use só os campos que fizerem sentido em cada seção ("pontos", "agenda" e "caixa" são opcionais).
Citações: marque no texto com [n] (n = posição na lista "fontes", começando em 1), logo depois do dado. Todo número precisa de citação.`;

const REGRAS = `Regras de redação (obrigatórias):
- Português do Brasil, tom humano e profissional, como um gestor experiente escrevendo para clientes do setor. Não pode parecer texto de IA: nada de clichês ("cenário desafiador", "nesse contexto", "vale ressaltar"), nada de exagero, frases diretas.
- Leitura de 2 a 4 minutos (550 a 850 palavras no total).
- Só use números que você encontrou na busca, de fonte confiável e recente, e cite a fonte. Nunca invente número, data ou declaração. Se um dado importante não tiver fonte pública confiável, não afirme: coloque em "notas_revisao" para o revisor confirmar.
- Fontes: links diretos para a matéria (não para a página inicial do site), com a data da publicação. De 5 a 10 fontes.
- A IMPAK é uma importadora de pneus (Ásia → Brasil, Joinville/SC). Os leitores são clientes: distribuidores, revendas, transportadoras.`;

function pedido(tipo, hojeISO) {
  if (tipo === 'pneus') {
    return `Hoje é ${dataExtenso(hojeISO)} (${hojeISO}). Monte a edição de SEGUNDA do Radar IMPAK sobre o mercado brasileiro de pneus, com as notícias mais recentes (últimos 7 a 15 dias; dados oficiais mais recentes disponíveis).

Seções, nesta ordem:
1. Importações de pneus (ANIP, ComexStat/Secex, AutoData...): números mais recentes, variação, participação dos importados na reposição.
2. Matéria-prima: borracha natural (Osaka/OSE e Xangai/SHFE), borracha sintética/butadieno, petróleo (Brent), negro de fumo, aço — e os reajustes de preço anunciados pelas fábricas de pneus. REGRA DO REVISOR: quando as fábricas estiverem anunciando aumento de preço por causa da matéria-prima, isso aparece com destaque; nunca diga que o custo está aliviando se o mercado está repassando alta. Queda pontual de uma cotação é tratada como pontual dentro do cenário. Feche com uma caixa "Nossa leitura" prática para quem compra.
3. "Pneu de passeio: 3 pontos para acompanhar" (use "pontos", exatamente 3).
4. "Pneu de caminhão: 3 pontos para acompanhar" (use "pontos", exatamente 3) — antidumping, Camex/imposto de importação, vendas de caminhões (Anfavea/Fenabrave), reposição.
O fecho avisa que na quarta-feira o assunto é câmbio.

${REGRAS}

${FORMATO}`;
  }
  return `Hoje é ${dataExtenso(hojeISO)} (${hojeISO}). Monte a edição de QUARTA do Radar IMPAK sobre câmbio (dólar x real), útil para quem importa e tem câmbio a fechar.

Seções, nesta ordem:
1. Como o dólar se comportou na semana passada e nesta semana até ontem: fechamentos (R$ com 4 casas quando a fonte der), variação na semana, o que moveu (cenário doméstico, fiscal, eleições se houver, exterior, Fed, commodities).
2. "O que está no radar": agenda dos próximos dias até cerca de 2 semanas (Copom, Fed, IPCA/IPCA-15, payroll, Focus, eventos políticos) — use "agenda" com datas no formato "Qua, 21/10".
3. "Para onde vai o dólar": projeções (Boletim Focus mais recente, bancos e casas de análise) e a tendência de curto prazo, com caixa "Nossa leitura" prática para quem tem câmbio a fechar (sem recomendar operação ou investimento).
Os 3 kpis: último fechamento do dólar, variação na semana, projeção do Focus para o fim do ano.
O fecho avisa que na segunda-feira volta o mercado de pneus.

${REGRAS}

${FORMATO}`;
}

async function chamarAnthropic(body, apiKey, fetchImpl) {
  const f = fetchImpl || fetch;
  const RETRY = [429, 500, 502, 503, 529];
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 420000);
    try {
      const resp = await f('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      clearTimeout(to);
      if (RETRY.includes(resp.status) && tentativa < 3) { await new Promise(r => setTimeout(r, 3000 * tentativa)); continue; }
      const data = await resp.json();
      if (data.error && body.model !== MODELO_RESERVA && /model/i.test(data.error.message || '')) {
        body = Object.assign({}, body, { model: MODELO_RESERVA }); tentativa--; continue;
      }
      if (data.error) throw new Error(data.error.message || 'erro da API');
      return data;
    } catch (e) {
      clearTimeout(to);
      if (e.name === 'AbortError' && tentativa < 3) continue;
      throw e;
    }
  }
  throw new Error('API da Anthropic indisponível');
}

// Pesquisa + redação. Devolve { conteudo, usoBuscas }.
async function gerarConteudo(tipo, hojeISO, opts) {
  const o = opts || {};
  const apiKey = (o.apiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');
  const mensagens = [{ role: 'user', content: pedido(tipo, hojeISO) }];
  let ultima = null, buscas = 0;
  // A busca na web roda do lado da Anthropic; respostas longas podem vir em
  // partes (stop_reason "pause_turn") — continua até 4 vezes.
  for (let rodada = 0; rodada < 5; rodada++) {
    const data = await chamarAnthropic({
      model: MODELO, max_tokens: 16000, messages: mensagens,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 15, user_location: { type: 'approximate', country: 'BR', timezone: 'America/Sao_Paulo' } }],
    }, apiKey, o.fetchImpl);
    ultima = data;
    buscas += (data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
    if (data.stop_reason !== 'pause_turn') break;
    mensagens.push({ role: 'assistant', content: data.content });
  }
  // Os blocos de texto são pedaços contínuos da mesma resposta (a busca
  // corta o texto a cada citação) — juntar SEM separador.
  const texto = (ultima && ultima.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const conteudo = extrairJson(texto);
  return { conteudo, buscas, textoBruto: texto, stopReason: ultima && ultima.stop_reason };
}

// Abre cada link das fontes (GET, 10 s). Link que não abre vira nota.
async function conferirFontes(fontes, fetchImpl) {
  const f = fetchImpl || fetch;
  const ruins = [];
  await Promise.all((fontes || []).map(async (fo, i) => {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await f(fo.url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Radar IMPAK; conferência de fonte)' } });
      // 401/403/429: muitos sites bloqueiam robôs mas o link existe — não acusa.
      if (r.status >= 400 && ![401, 403, 429].includes(r.status)) ruins.push({ n: i + 1, url: fo.url, motivo: 'HTTP ' + r.status });
    } catch (e) {
      ruins.push({ n: i + 1, url: fo.url, motivo: e.name === 'AbortError' ? 'não respondeu em 10 s' : 'não abriu' });
    } finally { clearTimeout(to); }
  }));
  return ruins.sort((a, b) => a.n - b.n);
}

// Tudo junto: gera, confere e monta. Não envia (quem envia é o server.js).
// → { assunto, html, conteudo, avisos }
async function prepararEdicao(tipo, opts) {
  const o = opts || {};
  const hoje = o.hojeISO || agoraSP().dataISO;
  let r = await gerarConteudo(tipo, hoje, o);
  let problemas = validarConteudo(r.conteudo);
  if (problemas.length) {
    // uma segunda tentativa antes de desistir
    r = await gerarConteudo(tipo, hoje, o);
    problemas = validarConteudo(r.conteudo);
  }
  if (problemas.length) {
    const detalhe = r.stopReason ? ` [fim: ${r.stopReason}; início da resposta: ${String(r.textoBruto || '').replace(/\s+/g, ' ').slice(0, 160)}]` : '';
    const e = new Error('conteúdo inválido: ' + problemas.join('; ') + detalhe);
    e.problemas = problemas; e.textoBruto = r.textoBruto;
    throw e;
  }
  const c = r.conteudo;
  const ruins = o.pularConferencia ? [] : await conferirFontes(c.fontes, o.fetchImpl);
  const notas = ruins.map(x => `Fonte ${x.n} não abriu na conferência automática (${x.motivo}): ${x.url}`);
  const html = montarHtml(tipo, c, { logoUrl: o.logoUrl, dataExtenso: dataExtenso(hoje), minutos: minutosLeitura(c), notas });
  const nomeEd = tipo === 'pneus' ? 'Pneus' : 'Câmbio';
  const assunto = `Para revisão: Radar IMPAK · ${nomeEd} (${ddmm(hoje)}) — ${c.assunto}`;
  return { assunto, html, conteudo: c, avisos: notas.concat(c.notas_revisao || []), buscas: r.buscas };
}

module.exports = {
  agoraSP, dataExtenso, edicaoDoMomento, decidirFollowUp, comCitacoes, montarHtml, minutosLeitura,
  validarConteudo, extrairJson, pedido, gerarConteudo, conferirFontes, prepararEdicao, EDICOES,
};
