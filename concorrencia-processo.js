// concorrencia-processo.js — duas pessoas editando o mesmo processo
// (revisão 17/10/2026). O painel guarda a versão (updated_at) de quando o
// processo foi aberto; se, na hora de salvar, o servidor tem uma versão mais
// nova, ele recusa com 409 e devolve o processo atual. Aqui o navegador junta
// as duas coisas: o que a outra pessoa salvou + o que este usuário mudou.
// Só pergunta quando os DOIS mudaram o MESMO campo com valores diferentes.
//
// Antes disto o save mandava sempre referência, fase e vencimentos calculados
// a partir da cópia aberta no painel — quem salvava por último desfazia a
// fase/vencimento gravados pelo outro, mesmo sem ter mexido neles.
(function () {
  'use strict';

  // Recalculados a cada save (não são "edição do usuário").
  const DERIVADOS = ['fase', 'demurrage_vencimento', 'armazenagem_vencimento', 'demurrage_pago',
    'updated_by', 'updated_at', 'created_by', 'created_at', 'log'];
  const _derivados = new Set(DERIVADOS);
  // Campos só de tela / pesados, fora da comparação.
  const IGNORAR = new Set(['ged_nomes', 'conferencia_resumo', 'conferencia_json', 'log']);

  function ordenar(x) {
    if (Array.isArray(x)) return x.map(ordenar);
    if (x && typeof x === 'object') { const o = {}; Object.keys(x).sort().forEach(k => { o[k] = ordenar(x[k]); }); return o; }
    return x;
  }
  // Valor comparável: vazio/nulo = '', JSON (texto ou objeto) em forma canônica.
  function norm(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'object') return JSON.stringify(ordenar(v));
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const s = String(v);
    const t = s.trim();
    if ((t[0] === '[' || t[0] === '{') && t.length > 1) {
      try { const j = JSON.parse(t); if (j && typeof j === 'object') return JSON.stringify(ordenar(j)); } catch (e) { /* não é JSON */ }
    }
    if (/^-?\d+(\.\d+)?$/.test(t)) return String(parseFloat(t));
    return t;
  }
  const diferente = (a, b) => norm(a) !== norm(b);

  // real_json: o servidor grava sozinho o vínculo com a fatura (_meta[taxa].
  // fatura_id / pago_em) — isso nunca conta como conflito e sempre é mantido.
  function semMetaServidor(rj) {
    let o = rj;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return rj; } }
    if (!o || typeof o !== 'object') return o;
    const c = JSON.parse(JSON.stringify(o));
    if (c._meta && typeof c._meta === 'object') {
      Object.keys(c._meta).forEach(k => {
        const m = c._meta[k];
        if (m && typeof m === 'object') { delete m.fatura_id; delete m.pago_em; if (!Object.keys(m).length) delete c._meta[k]; }
      });
      if (!Object.keys(c._meta).length) delete c._meta;
    }
    return c;
  }
  function mesclarRealJson(meu, deles) {
    let m = meu, d = deles;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { m = {}; } }
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
    const r = JSON.parse(JSON.stringify(m || {}));
    const dm = (d && d._meta) || {};
    Object.keys(dm).forEach(k => {
      const x = dm[k] || {};
      if (!x.fatura_id && !x.pago_em) return;
      r._meta = r._meta || {};
      r._meta[k] = Object.assign({}, r._meta[k] || {});
      if (x.fatura_id) r._meta[k].fatura_id = x.fatura_id;
      if (x.pago_em && !r._meta[k].pago_em) r._meta[k].pago_em = x.pago_em;
    });
    return r;
  }
  function difereCampo(k, a, b) {
    if (k === 'real_json') return diferente(semMetaServidor(a), semMetaServidor(b));
    return diferente(a, b);
  }

  // Campos que outra pessoa mudou desde que o painel abriu.
  function alteradosPorOutros(original, atual) {
    original = original || {}; atual = atual || {};
    const chaves = new Set(Object.keys(original).concat(Object.keys(atual)));
    const out = [];
    chaves.forEach(k => {
      if (k[0] === '_' || _derivados.has(k) || IGNORAR.has(k)) return;
      if (difereCampo(k, original[k], atual[k])) out.push(k);
    });
    return out.sort();
  }

  // Campos que este usuário mudou E a outra pessoa também, com valores diferentes.
  function camposEmConflito(original, atual, meu, campos) {
    original = original || {}; atual = atual || {}; meu = meu || {};
    const out = [];
    [...new Set(campos || [])].forEach(k => {
      if (_derivados.has(k) || IGNORAR.has(k) || k[0] === '_') return;
      if (difereCampo(k, original[k], atual[k]) && difereCampo(k, meu[k], atual[k])) {
        out.push({ campo: k, deles: atual[k], meu: meu[k] });
      }
    });
    return out;
  }

  // Processo atual do servidor + os campos que este usuário mudou (menos os
  // que ele preferiu deixar como a outra pessoa salvou).
  function mesclar(atual, meu, campos, manterDeles) {
    const manter = new Set(manterDeles || []);
    const r = Object.assign({}, atual || {});
    [...new Set(campos || [])].forEach(k => {
      if (_derivados.has(k) || IGNORAR.has(k) || manter.has(k)) return;
      if (!Object.prototype.hasOwnProperty.call(meu || {}, k)) return;
      r[k] = k === 'real_json' ? mesclarRealJson(meu[k], atual && atual.real_json) : meu[k];
    });
    return r;
  }

  const ConcorrenciaProcesso = { DERIVADOS, norm, diferente, alteradosPorOutros, camposEmConflito, mesclar, mesclarRealJson, semMetaServidor };
  if (typeof module !== 'undefined' && module.exports) module.exports = ConcorrenciaProcesso;
  if (typeof window !== 'undefined') window.ConcorrenciaProcesso = ConcorrenciaProcesso;
})();
