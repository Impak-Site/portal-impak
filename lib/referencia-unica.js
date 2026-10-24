// Referência de processo única (24/10/2026).
'use strict';

// Processo novo com referência que já existe (UD26-099, 23/10/2026).
// buscar(ref) → lista de { id, referencia, cancelado } parecidos (o servidor
// usa ilike). Ignora maiúsculas, espaços nas pontas e processos cancelados.
async function referenciaJaUsada(referencia, buscar) {
  const ref = String(referencia || '').trim();
  if (!ref) return null;
  const lista = (await buscar(ref)) || [];
  const alvo = ref.toLowerCase();
  return lista.find(x => x && !x.cancelado && String(x.referencia || '').trim().toLowerCase() === alvo) || null;
}

module.exports = { referenciaJaUsada };
