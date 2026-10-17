// validacao-datas.js — datas impossíveis num processo (revisão 17/10/2026).
// O banco aceitava qualquer combinação: chegada antes do embarque, devolução
// do vazio antes da chegada, ano "0026" digitado pela metade... A base tinha
// 13 processos com embarque = chegada, 9 com devolução antes da chegada e 12
// com carregamento antes da chegada. Mesmas regras no navegador (avisa antes
// de salvar) e no servidor (POST /api/controle/v2/processo recusa).
//
// nivel 'erro'  = impossível → não grava.
// nivel 'aviso' = muito improvável → o navegador pede confirmação.
// opts.campos   = só as regras que envolvem campos ALTERADOS neste save —
//                 processo antigo com data errada não trava a edição de
//                 outro campo qualquer, só de quem mexe naquelas datas.
(function () {
  'use strict';

  const ROTULOS = {
    etd: 'ETD (previsão de embarque)', eta: 'ETA (previsão de chegada)',
    data_embarque: 'Data de Embarque', data_chegada: 'Data de Chegada',
    data_presenca: 'Presença de Carga', data_carregamento: 'Data de Carregamento',
    data_devolucao_vazio: 'Devolução do Vazio', data_registro_di: 'Registro da DI/DUIMP',
    data_liberacao: 'Data de Liberação', data_parametrizacao: 'Parametrização',
    data_agendamento: 'Agendamento', data_prontidao: 'Prontidão na Fábrica',
    previsao_prontidao: 'Previsão de Prontidão', pi_data: 'Data da PI', ci_data: 'Data da CI',
    nf_entrada_data: 'Data da NF de Entrada', nf_saida_data: 'Data da NF de Saída',
    pi_data_entrada: 'Vencimento da Entrada', pi_data_saldo: 'Vencimento do Saldo',
    pi_venc_di: 'Vencimento DI/DUIMP', demurrage_vencimento: 'Vencimento da Demurrage',
    armazenagem_vencimento: 'Vencimento da Armazenagem', data_pagamento_lavagem: 'Pagamento da Lavagem',
    data_pagamento_demurrage: 'Pagamento da Demurrage', data_envio_termo: 'Envio do Termo',
    data_solicitacao_demurrage: 'Solicitação de Isenção', data_isencao_demurrage: 'Isenção da Demurrage',
    ce_data_embarque: 'Embarque no CE Mercante', entrada_armazem: 'Entrada no Armazém',
    pi_data_recebimento: 'Recebimento do Cliente',
  };
  const rot = k => ROTULOS[k] || k;

  // Campo que guarda data (pelo nome): data_*, *_data, eta/etd, vencimentos.
  function ehCampoData(k) {
    return /^data_|_data$|_data_|^eta$|^etd$|vencimento$|^pi_data|^pi_venc|^previsao_prontidao$|^entrada_armazem$/.test(String(k || ''));
  }
  function iso(v) { const s = String(v == null ? '' : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  function br(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; }
  function dias(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
  function hojeISO() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); } // horário de Brasília

  // "depois" não pode ser antes de "antes".
  const ORDEM = [
    { antes: 'etd', depois: 'eta', nivel: 'erro' },
    { antes: 'data_embarque', depois: 'data_chegada', nivel: 'erro' },
    { antes: 'data_chegada', depois: 'data_carregamento', nivel: 'erro' },
    { antes: 'data_chegada', depois: 'data_devolucao_vazio', nivel: 'erro', soContainer: true },
    { antes: 'data_carregamento', depois: 'data_devolucao_vazio', nivel: 'erro', soContainer: true },
    { antes: 'data_chegada', depois: 'data_presenca', nivel: 'aviso' },
  ];
  // Datas que registram algo que JÁ aconteceu.
  const REAIS = ['data_embarque', 'data_chegada', 'data_presenca', 'data_carregamento', 'data_devolucao_vazio'];
  const TRANSITO_MINIMO_DIAS = 10; // Ásia → Brasil leva 25+ dias

  function validar(p, opts) {
    p = p || {}; opts = opts || {};
    const alterados = Array.isArray(opts.campos) ? new Set(opts.campos) : null;
    const toca = (...ks) => !alterados || ks.some(k => alterados.has(k));
    const hoje = iso(opts.hoje) || hojeISO();
    const anoAtual = Number(hoje.slice(0, 4));
    const semContainer = String(p.tipo_container || '').toUpperCase() === 'LCL';
    const out = [];

    Object.keys(p).forEach(k => {
      if (!ehCampoData(k) || !toca(k)) return;
      const v = p[k];
      if (v == null || v === '') return;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      if (!m) return; // formato que não é data — o banco recusa (e a mensagem é traduzida)
      const ano = Number(m[1]);
      if (ano < 2015 || ano > anoAtual + 5) {
        out.push({ nivel: 'erro', campos: [k], msg: `${rot(k)} com ano ${m[1]} — confira se o ano foi digitado completo.` });
      }
    });

    ORDEM.forEach(r => {
      if (r.soContainer && semContainer) return;
      if (!toca(r.antes, r.depois)) return;
      const a = iso(p[r.antes]), b = iso(p[r.depois]);
      if (!a || !b || b >= a) return;
      out.push({ nivel: r.nivel, campos: [r.antes, r.depois], msg: `${rot(r.depois)} (${br(b)}) está antes de ${rot(r.antes)} (${br(a)}).` });
    });

    if (toca('data_embarque', 'data_chegada')) {
      const a = iso(p.data_embarque), b = iso(p.data_chegada);
      if (a && b && b >= a && dias(a, b) < TRANSITO_MINIMO_DIAS) {
        out.push({ nivel: 'aviso', campos: ['data_embarque', 'data_chegada'],
          msg: `Só ${dias(a, b)} dia(s) entre o Embarque (${br(a)}) e a Chegada (${br(b)}) — confira se a Data de Embarque não ficou igual à de chegada.` });
      }
    }

    REAIS.forEach(k => {
      if (!toca(k)) return;
      const v = iso(p[k]);
      if (v && dias(hoje, v) > 1) out.push({ nivel: 'aviso', campos: [k], msg: `${rot(k)} (${br(v)}) está no futuro — se ainda é previsão, use o campo de previsão.` });
    });

    return out;
  }

  const erros = (lista) => (lista || []).filter(x => x.nivel === 'erro');
  const avisos = (lista) => (lista || []).filter(x => x.nivel === 'aviso');

  const ValidacaoDatas = { validar, erros, avisos, ehCampoData, ROTULOS, TRANSITO_MINIMO_DIAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = ValidacaoDatas;
  if (typeof window !== 'undefined') window.ValidacaoDatas = ValidacaoDatas;
})();
