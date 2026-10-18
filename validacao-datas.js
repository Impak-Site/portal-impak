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
//
// 18/10/2026: registro da DI antes da liberação e da NF de entrada, devolução
// de cada container (aba Demurrage) e conferirDatasLidas(), que confere as
// datas lidas pela IA — ela às vezes lê a data brasileira como americana
// (RIC e NF com dia e mês trocados).
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
  // "2026-02-30" e "2026-13-05" não existem no calendário.
  function dataExiste(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(0);
    d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]); // setUTCFullYear não transforma o ano 26 em 1926
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  // A mesma data com dia e mês trocados ("2026-03-04" ↔ "2026-04-03"). null
  // quando a troca não muda nada (dia = mês) ou não existe (dia acima de 12).
  function trocarDiaMes(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m || m[2] === m[3]) return null;
    const t = m[1] + '-' + m[3] + '-' + m[2];
    return dataExiste(t) ? t : null;
  }
  function listaContainers(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && /^\s*\[/.test(v)) {
      try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    return [];
  }

  // "depois" não pode ser antes de "antes".
  // leitura 'erro': num documento lido pela IA isso não acontece — a DI é
  // registrada antes do desembaraço e a NF de importação cita a DI. Ao
  // digitar fica como aviso (há casos antigos ainda em conferência).
  const ORDEM = [
    { antes: 'etd', depois: 'eta', nivel: 'erro' },
    { antes: 'data_embarque', depois: 'data_chegada', nivel: 'erro' },
    { antes: 'data_chegada', depois: 'data_carregamento', nivel: 'erro' },
    { antes: 'data_chegada', depois: 'data_devolucao_vazio', nivel: 'erro', soContainer: true },
    { antes: 'data_carregamento', depois: 'data_devolucao_vazio', nivel: 'erro', soContainer: true },
    { antes: 'data_chegada', depois: 'data_presenca', nivel: 'aviso' },
    { antes: 'data_registro_di', depois: 'data_liberacao', nivel: 'aviso', leitura: 'erro' },
    { antes: 'data_registro_di', depois: 'nf_entrada_data', nivel: 'aviso', leitura: 'erro' },
  ];
  // Datas que registram algo que JÁ aconteceu.
  const REAIS = ['data_embarque', 'data_chegada', 'data_presenca', 'data_carregamento', 'data_devolucao_vazio'];
  // ...e as que um documento traz como fato (nunca no futuro) — leitura por IA.
  const EVENTOS_DOC = REAIS.concat(['data_registro_di', 'data_liberacao', 'nf_entrada_data', 'nf_saida_data', 'ce_data_embarque']);
  const TRANSITO_MINIMO_DIAS = 10; // Ásia → Brasil leva 25+ dias
  const TRANSITO_MAXIMO_LEITURA_DIAS = 150; // só para decidir se a data trocada faz sentido

  function validar(p, opts) {
    p = p || {}; opts = opts || {};
    const alterados = Array.isArray(opts.campos) ? new Set(opts.campos) : null;
    const toca = (...ks) => !alterados || ks.some(k => alterados.has(k));
    const hoje = iso(opts.hoje) || hojeISO();
    const anoAtual = Number(hoje.slice(0, 4));
    const anoForaDoLimite = ano => ano < 2015 || ano > anoAtual + 5;
    const semContainer = String(p.tipo_container || '').toUpperCase() === 'LCL';
    const out = [];

    Object.keys(p).forEach(k => {
      if (!ehCampoData(k) || !toca(k)) return;
      const v = p[k];
      if (v == null || v === '') return;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      if (!m) return; // formato que não é data — o banco recusa (e a mensagem é traduzida)
      if (anoForaDoLimite(Number(m[1]))) {
        out.push({ nivel: 'erro', tipo: 'ano', campos: [k], msg: `${rot(k)} com ano ${m[1]} — confira se o ano foi digitado completo.` });
      }
    });

    ORDEM.forEach(r => {
      if (r.soContainer && semContainer) return;
      if (!toca(r.antes, r.depois)) return;
      const a = iso(p[r.antes]), b = iso(p[r.depois]);
      if (!a || !b || b >= a) return;
      out.push({ nivel: r.nivel, tipo: 'ordem', leitura: r.leitura || r.nivel, campos: [r.antes, r.depois],
        msg: `${rot(r.depois)} (${br(b)}) está antes de ${rot(r.antes)} (${br(a)}).` });
    });

    if (toca('data_embarque', 'data_chegada')) {
      const a = iso(p.data_embarque), b = iso(p.data_chegada);
      if (a && b && b >= a && dias(a, b) < TRANSITO_MINIMO_DIAS) {
        out.push({ nivel: 'aviso', tipo: 'transito', campos: ['data_embarque', 'data_chegada'],
          msg: `Só ${dias(a, b)} dia(s) entre o Embarque (${br(a)}) e a Chegada (${br(b)}) — confira se a Data de Embarque não ficou igual à de chegada.` });
      }
    }

    REAIS.forEach(k => {
      if (!toca(k)) return;
      const v = iso(p[k]);
      if (v && dias(hoje, v) > 1) out.push({ nivel: 'aviso', tipo: 'futuro', campos: [k], msg: `${rot(k)} (${br(v)}) está no futuro — se ainda é previsão, use o campo de previsão.` });
    });

    // Devolução de cada container (aba Demurrage). Só com 2+ containers: com
    // um só vale o campo Devolução do Vazio do processo, conferido acima.
    if (!semContainer && toca('containers_json', 'data_chegada')) {
      const lista = listaContainers(p.containers_json);
      const chegada = iso(p.data_chegada);
      if (lista.length > 1) lista.forEach((c, i) => {
        if (!c || String(c.tipo || '').toUpperCase() === 'LCL') return;
        const d = iso(c.devolucao);
        if (!d) return;
        const nome = 'Devolução do container ' + (String(c.numero || '').trim() || String(i + 1));
        if (anoForaDoLimite(Number(d.slice(0, 4)))) {
          if (toca('containers_json')) out.push({ nivel: 'erro', tipo: 'ano', campos: ['containers_json'], msg: `${nome} com ano ${d.slice(0, 4)} — confira se o ano foi digitado completo.` });
          return;
        }
        if (chegada && d < chegada) {
          out.push({ nivel: 'erro', tipo: 'ordem', leitura: 'erro', campos: ['containers_json', 'data_chegada'],
            msg: `${nome} (${br(d)}) está antes de ${rot('data_chegada')} (${br(chegada)}).` });
        }
        if (toca('containers_json') && dias(hoje, d) > 1) {
          out.push({ nivel: 'aviso', tipo: 'futuro', campos: ['containers_json'], msg: `${nome} (${br(d)}) está no futuro — confira a data.` });
        }
      });
    }

    return out;
  }

  // ── Datas lidas de um documento pela IA ──
  // Cada data lida é conferida com as do processo. Se ela é impossível
  // (antes da chegada ou da DI, no futuro, data que não existe...) e a versão
  // com dia e mês trocados fecha por completo, vale a trocada; se nenhuma das
  // duas fecha, a data não é usada. Data só improvável (trânsito curto) não
  // é trocada — fica como veio e o aviso aparece ao salvar. As datas do mesmo
  // documento são conferidas juntas (a DI traz registro, desembaraço e
  // chegada) e, quando não dá para saber qual delas está errada, nenhuma das
  // envolvidas é usada.
  //   lidas     { campo: 'AAAA-MM-DD' } — as datas deste documento
  //   processo  valores atuais (as outras datas, tipo_container, containers_json)
  //   retorna   { datas: {campo: valor a usar}, trocadas: [{campo, lida, usada, motivo, aviso}],
  //               descartadas: [{campo, lida, motivo, tipo, aviso}], avisos: [texto] }
  //   tipo da descartada: 'futuro' | 'ordem' | 'ano' | 'inexistente' | 'ambigua'
  function problemasLeitura(estado, campos, hoje) {
    const lista = validar(estado, { campos: campos, hoje: hoje }).filter(x => x.tipo !== 'futuro');
    campos.forEach(k => {
      const v = iso(estado[k]);
      if (v && EVENTOS_DOC.indexOf(k) >= 0 && dias(hoje, v) > 1) {
        lista.push({ nivel: 'aviso', tipo: 'futuro', campos: [k], msg: `${rot(k)} (${br(v)}) está no futuro.` });
      }
    });
    [['data_embarque', 'data_chegada'], ['etd', 'eta']].forEach(par => {
      if (campos.indexOf(par[0]) < 0 && campos.indexOf(par[1]) < 0) return;
      const a = iso(estado[par[0]]), b = iso(estado[par[1]]);
      if (!a || !b || b < a) return;
      const n = dias(a, b);
      if (n > TRANSITO_MAXIMO_LEITURA_DIAS || (par[0] === 'etd' && n < TRANSITO_MINIMO_DIAS)) {
        lista.push({ nivel: 'aviso', tipo: 'transito', campos: par.slice(), msg: `${n} dia(s) entre ${rot(par[0])} (${br(a)}) e ${rot(par[1])} (${br(b)}).` });
      }
    });
    lista.forEach(x => { x.duro = x.nivel === 'erro' || x.leitura === 'erro' || x.tipo === 'futuro'; });
    return lista;
  }

  const MAX_DATAS_JUNTAS = 8; // 3^8 combinações; um documento traz bem menos datas
  const NAO_USAR = { valor: null, troca: false };

  function conferirDatasLidas(lidas, processo, opts) {
    opts = opts || {};
    const hoje = iso(opts.hoje) || hojeISO();
    const base = Object.assign({}, processo || {});
    const res = { datas: {}, trocadas: [], descartadas: [], avisos: [] };
    const campos = [], lida = {}, opcoes = {};
    Object.keys(lidas || {}).forEach(k => {
      const bruto = lidas[k];
      if (bruto == null || bruto === '') return;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(bruto).trim());
      if (!m) { res.datas[k] = bruto; return; } // não é AAAA-MM-DD: segue como veio
      const v = m[0], t = trocarDiaMes(v);
      lida[k] = v;
      opcoes[k] = [].concat(dataExiste(v) ? [{ valor: v, troca: false }] : [], t ? [{ valor: t, troca: true }] : [], [NAO_USAR]);
      campos.push(k);
    });
    if (!campos.length) return res;

    const estadoCom = escolha => {
      const e = Object.assign({}, base);
      campos.forEach(k => { if (escolha[k].valor != null) e[k] = escolha[k].valor; });
      return e;
    };
    // Escolha válida: nada impossível, e data trocada só se ela fecha por
    // completo. Custo: menos datas sem usar, depois menos trocas, depois
    // menos avisos (uma data só improvável não é trocada).
    function avaliar(escolha) {
      const usadas = campos.filter(k => escolha[k].valor != null);
      const probs = usadas.length ? problemasLeitura(estadoCom(escolha), usadas, hoje) : [];
      const trocadas = campos.filter(k => escolha[k].troca);
      const ok = !probs.some(x => x.duro || x.campos.some(c => trocadas.indexOf(c) >= 0));
      return { ok, probs, escolha, custo: [campos.length - usadas.length, trocadas.length, probs.length] };
    }
    const comparar = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
    let melhores = [];
    const considerar = r => {
      if (!r.ok) return;
      const c = melhores.length ? comparar(r.custo, melhores[0].custo) : -1;
      if (c < 0) melhores = [r]; else if (c === 0) melhores.push(r);
    };
    if (campos.length <= MAX_DATAS_JUNTAS) {
      (function percorrer(i, escolha) {
        if (i === campos.length) { considerar(avaliar(Object.assign({}, escolha))); return; }
        opcoes[campos[i]].forEach(o => { escolha[campos[i]] = o; percorrer(i + 1, escolha); });
      })(0, {});
    } else {
      // Muitas datas num documento só (não acontece na prática): uma por vez.
      const escolha = {};
      campos.forEach(k => { escolha[k] = NAO_USAR; });
      campos.forEach(k => {
        let melhor = null;
        opcoes[k].forEach(o => {
          const r = avaliar(Object.assign({}, escolha, { [k]: o }));
          if (r.ok && (!melhor || comparar(r.custo, melhor.custo) < 0)) melhor = r;
        });
        if (melhor) escolha[k] = melhor.escolha[k];
      });
      considerar(avaliar(escolha));
    }

    // Empate entre escolhas diferentes = não dá para saber qual data está
    // errada: as datas em que elas discordam não são usadas.
    const final = Object.assign({}, melhores[0].escolha);
    const ambiguas = campos.filter(k => melhores.some(r => r.escolha[k].valor !== final[k].valor));
    ambiguas.forEach(k => { final[k] = NAO_USAR; });
    for (let volta = 0; volta < campos.length; volta++) {
      const r = avaliar(final);
      if (r.ok) break;
      const culpadas = campos.filter(k => final[k].valor != null && r.probs.some(x => (x.duro || final[k].troca) && x.campos.indexOf(k) >= 0));
      if (!culpadas.length) break;
      culpadas.forEach(k => { final[k] = NAO_USAR; });
    }

    // O que a data LIDA (sem troca) tem de errado, com as outras como ficaram
    // (ou, se ficou ambígua, com as outras como foram lidas).
    function motivo(k, comoLidas) {
      const v = lida[k];
      if (!dataExiste(v)) return { msg: 'essa data não existe no calendário.', tipo: 'inexistente' };
      const e = estadoCom(final);
      if (comoLidas) campos.forEach(c => { if (dataExiste(lida[c])) e[c] = lida[c]; });
      e[k] = v;
      const probs = problemasLeitura(e, [k], hoje).filter(x => x.campos.indexOf(k) >= 0);
      const p = probs.filter(x => x.duro)[0] || probs[0];
      return p ? { msg: p.msg, tipo: p.tipo } : { msg: '', tipo: '' };
    }

    campos.forEach(k => {
      const o = final[k], v = lida[k];
      if (o.valor != null && !o.troca) { res.datas[k] = v; return; }
      if (o.troca) {
        const m = motivo(k, false).msg;
        const aviso = `${rot(k)} lida como ${br(v)} não fecha${m ? ': ' + m : '.'} Usei ${br(o.valor)} (dia e mês trocados) — confira no documento.`;
        res.datas[k] = o.valor;
        res.trocadas.push({ campo: k, lida: v, usada: o.valor, motivo: m, aviso });
        res.avisos.push(aviso);
        return;
      }
      const ambigua = ambiguas.indexOf(k) >= 0;
      const m = motivo(k, ambigua);
      const t = m.tipo === 'ano' ? null : trocarDiaMes(v); // trocar dia e mês não conserta o ano
      const aviso = `${rot(k)} lida como ${br(v)} não foi preenchida${m.msg ? ': ' + m.msg : '.'}` +
        (ambigua ? ' Não dá para saber qual das datas deste documento está errada.'
          : (t ? ` Com dia e mês trocados (${br(t)}) também não fecha.` : '')) +
        ' Confira no documento e digite a data certa.';
      res.descartadas.push({ campo: k, lida: v, motivo: m.msg, tipo: ambigua ? 'ambigua' : m.tipo, aviso });
      res.avisos.push(aviso);
    });
    return res;
  }

  const erros = (lista) => (lista || []).filter(x => x.nivel === 'erro');
  const avisos = (lista) => (lista || []).filter(x => x.nivel === 'aviso');
  // Mais de 1 dia à frente de hoje (horário de Brasília) — mesma folga das regras acima.
  const noFuturo = (v, hoje) => { const d = iso(v); return !!d && dias(iso(hoje) || hojeISO(), d) > 1; };

  const ValidacaoDatas = { validar, erros, avisos, ehCampoData, conferirDatasLidas, trocarDiaMes, dataExiste, noFuturo, ROTULOS, TRANSITO_MINIMO_DIAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = ValidacaoDatas;
  if (typeof window !== 'undefined') window.ValidacaoDatas = ValidacaoDatas;
})();
