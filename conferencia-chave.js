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
  function ehPendenciaConferencia(c) {
    return !!c && (c.status === 'DIVERGENCIA' || c.status === 'AUSENTE' || (c.status === 'ALERTA' && !!c.campo));
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
  const api = { chaveDivergencia, ehPendenciaConferencia, aceiteDe, migrarAceites, contarConferencia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConferenciaChave = api;
})(typeof window !== 'undefined' ? window : this);
