// conferencia-chave.js — identificação estável das divergências da
// Conferência documental (usado no navegador E no servidor).
//
// Por que existe (06/10/2026): o aceite de uma divergência era gravado pela
// POSIÇÃO dela na lista ("grupo 2, item 3"). Ao rodar uma conferência nova
// (ex.: chegou o BL original), a IA devolve a lista em outra ordem, mas os
// aceites antigos eram copiados pelas mesmas posições — uma divergência nova
// podia aparecer como "aceita" sem ninguém ter aceitado, e uma já aceita
// voltava como pendente. Agora a chave é o CONTEÚDO da divergência: campo,
// documentos comparados e os valores de cada um. Um aceite só se repete se a
// divergência for exatamente a mesma; se um valor mudar, precisa aceitar de
// novo.
//
// Compatibilidade: análises gravadas antes desta mudança (sem chaveVersao 2)
// continuam lendo os aceites antigos pela posição — era o que a tela mostrava
// pra elas. Ao rodar uma conferência nova por cima, os aceites antigos são
// convertidos pela análise em que foram feitos (migrarAceites).
(function (root) {
  function normalizar(v) {
    return String(v == null ? '' : v)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function chaveDivergencia(c) {
    c = c || {};
    return 'k' + hash([c.campo, c.doc1_label, c.doc1_valor, c.doc2_label, c.doc2_valor].map(normalizar).join('|'));
  }
  // ── Regras dispensadas (19/10/2026, pedido Emanuelly) ──────────────
  // 1) NCM no BL: o BL sempre traz só a posição de 4 dígitos (ex.: 4011).
  //    "NCM incompleto no BL" não é pendência. Continua pendência se a
  //    posição de 4 dígitos do BL for diferente da CI/PI (ex.: 4012 x 4011).
  // 2) Porto de destino: muda entre PI, CI, PL e BL na maioria das vezes —
  //    porto diferente entre documentos não é pendência. Só é pendência se
  //    algum documento trouxer porto de destino FORA de Santa Catarina.
  const PORTOS_SC = ['ITAJAI', 'NAVEGANTES', 'PORTONAVE', 'ITAPOA', 'IMBITUBA', 'SAO FRANCISCO DO SUL',
    'BRITJ', 'BRNVT', 'BRIOA', 'BRIBB', 'BRSFS'];
  function maiusculo(v) { return normalizar(v).toUpperCase(); }
  function ehPortoSC(v) {
    const t = maiusculo(v).replace(/[^A-Z0-9 ]/g, ' ');
    return PORTOS_SC.some(p => (' ' + t + ' ').includes(' ' + p + ' ') || t.replace(/\s/g, '').includes(p.replace(/\s/g, '')));
  }
  function textoDa(c) { return maiusculo([c.campo, c.doc1_label, c.doc2_label, c.observacao].join(' ')); }
  function ehCampoPortoDestino(c) {
    const campo = maiusculo(c.campo);
    if (!/PORT/.test(campo)) return false;
    if (/ORIGEM|ORIGIN|EMBARQUE|LOADING|FOB|SAIDA/.test(campo)) return false;
    return /DESTIN|DESCARGA|DISCHARGE|DELIVERY|DESEMBARQUE|CHEGADA/.test(campo) || campo.trim() === 'PORTO';
  }
  function regraDispensada(c) {
    if (!c) return null;
    // NCM com 4 dígitos no BL
    if (/\bNCM\b/.test(maiusculo(c.campo))) {
      const temBL = /\b(BL|HBL|MBL|BILL|DRAFT)\b/.test(textoDa(c));
      // primeiro código com 4+ dígitos do texto ("4011 (4 digitos)" → 4011; "4011.20.90" → 40112090)
      const dig = v => { const m = String(v == null ? '' : v).replace(/(\d)[.\-\s](?=\d)/g, '$1').match(/\d{4,}/); return m ? m[0] : ''; };
      const vals = [c.doc1_valor, c.doc2_valor].map(dig).filter(Boolean);
      if (temBL && vals.length && vals.some(v => v.length < 8)) {
        const posicoes = new Set(vals.map(v => v.slice(0, 4)));
        if (posicoes.size === 1) return 'NCM com 4 dígitos no BL é o padrão';
      }
    }
    // Porto de destino diferente entre documentos, todos em SC
    if (ehCampoPortoDestino(c)) {
      const vals = [c.doc1_valor, c.doc2_valor].map(v => String(v == null ? '' : v).trim()).filter(Boolean);
      if (vals.length && vals.every(ehPortoSC)) return 'Porto de destino em SC (pode mudar entre os documentos)';
    }
    return null;
  }
  function ehPendenciaConferencia(c) {
    return !!c && (c.status === 'DIVERGENCIA' || c.status === 'AUSENTE' || (c.status === 'ALERTA' && !!c.campo)) && !regraDispensada(c);
  }
  function ehAnaliseNova(analise) { return !!analise && analise.chaveVersao >= 2; }
  // Aceite gravado pra esta divergência (ou null).
  function aceiteDe(analise, c, gi, ci) {
    const m = (analise && analise.divResolvedMap) || {};
    return m[chaveDivergencia(c)] || (!ehAnaliseNova(analise) ? (m[gi + '-' + ci] || null) : null);
  }
  // Aceites que passam pra uma conferência nova: só por conteúdo.
  function migrarAceites(analiseAnterior) {
    const m = (analiseAnterior && analiseAnterior.divResolvedMap) || {};
    const out = {};
    Object.keys(m).forEach(k => { if (!/^\d+-\d+$/.test(k)) out[k] = m[k]; });
    if (analiseAnterior && !ehAnaliseNova(analiseAnterior)) {
      (analiseAnterior.grupos || []).forEach((g, gi) => (g.campos || []).forEach((c, ci) => {
        const v = m[gi + '-' + ci];
        const k = chaveDivergencia(c);
        if (v && ehPendenciaConferencia(c) && !out[k]) out[k] = v;
      }));
    }
    return out;
  }
  // Contagem usada no badge, na fila e nos e-mails.
  function contarConferencia(analise) {
    let pendentes = 0, bloqueantes = 0, aceitas = 0;
    ((analise && analise.grupos) || []).forEach((g, gi) => (g.campos || []).forEach((c, ci) => {
      if (!ehPendenciaConferencia(c)) return;
      if (aceiteDe(analise, c, gi, ci)) aceitas++;
      else { pendentes++; if (c.severidade === 'BLOQUEANTE') bloqueantes++; }
    }));
    return { pendentes, bloqueantes, aceitas };
  }
  // Texto das regras novas para o prompt da IA (usado na aba Conferência e,
  // no servidor, para a tela antiga processos.html, que não é editada).
  const REGRAS_NCM_PORTO_PROMPT = 'REGRA NCM NO BL (atualizada): o BL traz o NCM so com a posicao de 4 digitos (ex: 4011) — isso e o PADRAO, NAO gerar divergencia nem alerta de "NCM incompleto" no BL; so gerar DIVERGENCIA de NCM se os 4 primeiros digitos do BL forem diferentes dos da CI/PI. '
    + 'REGRA PORTO DE DESTINO (atualizada): o porto de destino/descarga MUDA com frequencia entre PI, CI, PL e BL (ex: PI NAVEGANTES e CI/BL ITAPOA) — isso e NORMAL: NAO comparar o porto de destino entre documentos e NAO gerar divergencia por portos diferentes. A unica exigencia: o porto de destino/descarga de cada documento deve ser um porto de Santa Catarina (ITAJAI, NAVEGANTES/PORTONAVE, ITAPOA, IMBITUBA ou SAO FRANCISCO DO SUL). Se algum documento trouxer porto de destino FORA de Santa Catarina = DIVERGENCIA BLOQUEANTE com campo="Porto de destino fora de SC", doc1_label=<documento> e doc1_valor=<porto encontrado>. ';
  const api = { chaveDivergencia, ehPendenciaConferencia, regraDispensada, ehPortoSC, aceiteDe, migrarAceites, contarConferencia, REGRAS_NCM_PORTO_PROMPT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConferenciaChave = api;
})(typeof window !== 'undefined' ? window : this);
