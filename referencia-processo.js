// referencia-processo.js — achar o processo do Controle pela referência que
// vem de fora (planilha do despachante, planilha interna, criação em lote,
// faturas), 19/10/2026.
//
// Parte dos processos é cadastrada com o prefixo da empresa ("IMPAK-...") e
// quem preenche a planilha nem sempre escreve o prefixo (ou escreve quando o
// Controle não tem). Antes a importação só achava a referência idêntica e
// dava "não encontrada". Regra agora:
//   1. referência igual (sem diferença de maiúscula/espaço nas pontas) → ela;
//   2. senão, compara as duas SEM o prefixo → aceita só se der UM processo
//      (nunca junta dois processos diferentes em silêncio);
//   3. não achou → devolve parecidas (mesmo começo) para a pessoa saber o
//      que corrigir na planilha.
// O prefixo só conta quando vem separado do resto (IMPAK-, IMPAK , IMPAK_):
// uma referência que apenas começa com essas letras não é cortada.
//
// UMD: navegador (<script src="/referencia-processo.js">, window.ReferenciaProcesso)
// e Node (require). Testes em testes_revisao.js.
(function () {
  'use strict';

  const PREFIXOS = ['IMPAK'];
  const RE_PREFIXO = new RegExp('^(?:' + PREFIXOS.join('|') + ')[\\s._/-]+', 'i');

  function normalizar(ref) {
    return String(ref == null ? '' : ref).trim().replace(/\s+/g, ' ').toUpperCase();
  }

  function semPrefixo(ref) {
    const n = normalizar(ref);
    const s = n.replace(RE_PREFIXO, '');
    return s || n;
  }

  function adicionar(mapa, chave, item) {
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(item);
  }

  function criarIndice(processos, campo) {
    const c = campo || 'referencia';
    const exato = new Map();
    const base = new Map();
    (processos || []).forEach(p => {
      const ref = p && p[c];
      if (!normalizar(ref)) return;
      adicionar(exato, normalizar(ref), p);
      adicionar(base, semPrefixo(ref), p);
    });
    return { exato, base, campo: c };
  }

  // Referências parecidas (o Controle tem a da planilha + algo depois de um
  // separador, ex.: planilha "ABC123" e Controle "IMPAK-ABC123-CLIENTE").
  function sugerir(indice, ref, max) {
    const lim = max || 3;
    const b = semPrefixo(ref);
    if (b.length < 4) return [];
    const out = [];
    indice.base.forEach((procs, chave) => {
      if (chave.length > b.length && chave.startsWith(b) && /[\s._/-]/.test(chave.charAt(b.length))) {
        procs.forEach(p => out.push(p[indice.campo]));
      }
    });
    return out.sort().slice(0, lim);
  }

  // → { processo, como: 'exato' | 'sem_prefixo' | 'ambiguo' | null, candidatos?, sugestoes? }
  function encontrar(indice, ref) {
    const n = normalizar(ref);
    if (!n) return { processo: null, como: null };
    const iguais = indice.exato.get(n);
    if (iguais && iguais.length === 1) return { processo: iguais[0], como: 'exato' };
    if (iguais && iguais.length > 1) return { processo: null, como: 'ambiguo', candidatos: iguais.map(p => p[indice.campo]) };
    const parecidos = indice.base.get(semPrefixo(ref));
    if (parecidos && parecidos.length === 1) return { processo: parecidos[0], como: 'sem_prefixo' };
    if (parecidos && parecidos.length > 1) return { processo: null, como: 'ambiguo', candidatos: parecidos.map(p => p[indice.campo]) };
    return { processo: null, como: null, sugestoes: sugerir(indice, ref) };
  }

  // Criação em lote: o que já existe no Controle (igual, ou com/sem o
  // prefixo) não é criado de novo, e a mesma referência não entra duas vezes
  // no mesmo lote.
  function separarNovos(existentes, entrada, campo) {
    const c = campo || 'referencia';
    const indice = criarIndice(existentes, c);
    const vistos = new Set();
    const novos = [], jaExistem = [], equivalentes = [], repetidos = [];
    (entrada || []).forEach(p => {
      const ref = p && p[c];
      if (!normalizar(ref)) return;
      const r = encontrar(indice, ref);
      if (r.processo || r.como === 'ambiguo') {
        jaExistem.push(p);
        if (r.como === 'sem_prefixo') equivalentes.push({ referencia: String(ref).trim(), existente: r.processo[c] });
        return;
      }
      const b = semPrefixo(ref);
      if (vistos.has(b)) { repetidos.push(String(ref).trim()); return; }
      vistos.add(b);
      novos.push(p);
    });
    return { novos, jaExistem, equivalentes, repetidos };
  }

  const ReferenciaProcesso = { PREFIXOS, normalizar, semPrefixo, criarIndice, encontrar, sugerir, separarNovos };
  if (typeof module !== 'undefined' && module.exports) module.exports = ReferenciaProcesso;
  if (typeof window !== 'undefined') window.ReferenciaProcesso = ReferenciaProcesso;
})();
