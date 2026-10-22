// duimp-parcelas.js — Nº DUIMP nas parcelas de câmbio (21/10/2026).
//
// Por quê (QD-IMK-LPL-2605-1738, pergunta do Ayslan): a leitura da DUIMP pela
// IA (controle-import-ia.js) preenche o Nº DUIMP só nas parcelas que JÁ têm
// câmbio fechado naquele momento. A parcela Final teve o câmbio fechado uma
// hora depois da leitura e ficou sem o número — e a tarefa da Agenda "Informar
// Nº DUIMP nas parcelas de pagamento antecipado" (A22) não sumia.
//
// Regra: o processo tem UMA DUIMP — a que já está nas parcelas (todas as que
// têm número usam a mesma) ou, se nenhuma tiver, o Nº DI/DUIMP do processo
// quando ele é uma DUIMP (formato 26BR0002022638-2). Toda parcela com câmbio
// fechado e sem Nº DUIMP recebe esse número; a Chave de acesso vem junto
// quando as parcelas usam uma só. No pagamento único (À Vista, 100% a Prazo,
// Entrada+Saldo) o campo é o do processo (pi_duimp_numero). Nunca troca um
// número já digitado e não adivinha quando há mais de uma DUIMP no processo.
//
// Quem usa: o painel do processo (controle-campos.js) ao fechar o câmbio de
// uma parcela e ao salvar. Testes em testes_revisao.js.
//
// UMD: navegador (<script src="/duimp-parcelas.js">, window.DuimpParcelas) e
// Node (require).
(function () {
  'use strict';

  const txt = v => (v == null ? '' : String(v)).trim();
  // Para comparar números: só letras e dígitos, em maiúsculas.
  const chave = v => txt(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const RE_DUIMP = /^\d{2}BR\d{11}$/;

  // "26BR0002022638-2" (com ou sem hífen/espaços). DI antiga ("26/1234567-8") não.
  function ehNumeroDuimp(v) { return RE_DUIMP.test(chave(v)); }

  function cambioFechado(v) {
    const n = parseFloat(txt(v).replace(',', '.'));
    return isFinite(n) && n > 0;
  }

  function lerParcelas(v) {
    if (Array.isArray(v)) return v;
    if (!txt(v)) return [];
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }

  // Valores distintos (pela chave), mantendo a primeira grafia de cada um.
  function distintos(lista) {
    const vistos = new Map();
    lista.forEach(v => { const k = chave(v); if (k && !vistos.has(k)) vistos.set(k, txt(v)); });
    return [...vistos.values()];
  }

  // A DUIMP do processo Parcelado: { numero, protocolo } ou null (nenhuma ou
  // mais de uma). `parcelas` é opcional (senão lê p.pi_parcelas_json).
  function duimpDoProcesso(p, parcelas) {
    const lista = (parcelas || lerParcelas(p && p.pi_parcelas_json)).filter(pc => pc && typeof pc === 'object');
    const nums = distintos(lista.map(pc => pc.duimp_numero));
    const di = p && ehNumeroDuimp(p.numero_di) ? txt(p.numero_di) : '';
    if (nums.length > 1) return null;
    if (nums.length === 1 && di && chave(nums[0]) !== chave(di)) return null;
    const numero = nums[0] || di;
    if (!numero) return null;
    const prots = distintos(lista.map(pc => pc.duimp_protocolo));
    return { numero, protocolo: prots.length === 1 ? prots[0] : '' };
  }

  // Parcelado: preenche o Nº DUIMP (e a Chave, quando única) nas parcelas com
  // câmbio fechado que estão sem. Não muda o array recebido: devolve
  // { parcelas (cópia), preenchidas: [{ idx, label }], duimp }.
  function completarParcelas(p, parcelasEntrada) {
    const parcelas = (parcelasEntrada || lerParcelas(p && p.pi_parcelas_json))
      .map(pc => (pc && typeof pc === 'object') ? Object.assign({}, pc) : pc);
    const duimp = duimpDoProcesso(p, parcelas);
    const preenchidas = [];
    if (!duimp) return { parcelas, preenchidas, duimp: null };
    parcelas.forEach((pc, idx) => {
      if (!pc || typeof pc !== 'object') return;
      if (!cambioFechado(pc.cambio_fechado) || txt(pc.duimp_numero)) return;
      pc.duimp_numero = duimp.numero;
      if (duimp.protocolo && !txt(pc.duimp_protocolo)) pc.duimp_protocolo = duimp.protocolo;
      preenchidas.push({ idx, label: txt(pc.label) || ('Parcela ' + (idx + 1)) });
    });
    return { parcelas, preenchidas, duimp };
  }

  // Pagamento único: o Nº DUIMP que falta no processo ('' = nada a fazer).
  function duimpPagamentoUnico(p) {
    if (!p || txt(p.pi_pagamento) === 'PARCELADO') return '';
    if (txt(p.pi_duimp_numero)) return '';
    if (!(cambioFechado(p.pi_cambio_fechado) || cambioFechado(p.pi_cambio_entrada))) return '';
    return ehNumeroDuimp(p.numero_di) ? txt(p.numero_di) : '';
  }

  // Processo inteiro (dados do banco): o que falta preencher, ou null.
  //   Parcelado → { campo: 'pi_parcelas_json', parcelas, preenchidas, numero }
  //   Único     → { campo: 'pi_duimp_numero', numero }
  function completar(p) {
    if (!p || p.cancelado) return null;
    if (txt(p.pi_pagamento) === 'PARCELADO') {
      const r = completarParcelas(p);
      return r.preenchidas.length ? { campo: 'pi_parcelas_json', parcelas: r.parcelas, preenchidas: r.preenchidas, numero: r.duimp.numero } : null;
    }
    const numero = duimpPagamentoUnico(p);
    return numero ? { campo: 'pi_duimp_numero', numero } : null;
  }

  const DuimpParcelas = { ehNumeroDuimp, duimpDoProcesso, completarParcelas, duimpPagamentoUnico, completar };
  if (typeof module !== 'undefined' && module.exports) module.exports = DuimpParcelas;
  if (typeof window !== 'undefined') window.DuimpParcelas = DuimpParcelas;
})();
