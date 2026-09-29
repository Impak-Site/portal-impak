// lib/ged-duplicados.js — acha cópias repetidas no GED (29/09/2026).
// Duplicado = mesmo processo + mesmo nome de arquivo + mesmo tamanho em bytes.
// Mantém SEMPRE a cópia mais antiga (a original); as demais vão pra remoção.
'use strict';
function arquivosDuplicados(arquivos) {
  const grupos = {};
  (arquivos || []).forEach(a => {
    if (!a || !a.nome || a.tamanho == null) return;
    const k = (a.processo_id || '') + '|' + a.nome + '|' + a.tamanho;
    (grupos[k] = grupos[k] || []).push(a);
  });
  const remover = [];
  Object.values(grupos).forEach(l => {
    if (l.length < 2) return;
    l.sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')) || String(x.id).localeCompare(String(y.id)));
    remover.push(...l.slice(1));
  });
  return remover;
}
module.exports = { arquivosDuplicados };
