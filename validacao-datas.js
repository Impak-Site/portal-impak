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
// 18/10/2026 (2ª parte): avisos de data real longe da previsão, carregamento
// antes da liberação, NF de entrada depois do carregamento, prontidão depois
// do embarque e viagem longa demais; lerDataTexto() (a data como está impressa
// no documento), separarDatasImpossiveis() (importações) e o modo de
// auditoria (e-mail semanal).
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
    // A carga sai do porto depois do desembaraço, levando a NF de entrada; e
    // fica pronta na fábrica antes de embarcar. Aviso: pode haver exceção.
    { antes: 'data_liberacao', depois: 'data_carregamento', nivel: 'aviso' },
    { antes: 'nf_entrada_data', depois: 'data_carregamento', nivel: 'aviso' },
    { antes: 'data_prontidao', depois: 'data_embarque', nivel: 'aviso' },
  ];
  // Datas que registram algo que JÁ aconteceu.
  const REAIS = ['data_embarque', 'data_chegada', 'data_presenca', 'data_carregamento', 'data_devolucao_vazio'];
  // ...e as que um documento traz como fato (nunca no futuro) — leitura por IA e auditoria.
  const EVENTOS_DOC = REAIS.concat(['data_registro_di', 'data_liberacao', 'nf_entrada_data', 'nf_saida_data', 'ce_data_embarque']);
  const TRANSITO_MINIMO_DIAS = 10; // Ásia → Brasil leva 25+ dias
  const TRANSITO_MAXIMO_DIAS = 90; // mais que isso é raro (só com baldeação muito atrasada)
  // Data real mais longe que isso da previsão (ETD/ETA): costuma ser dia e mês
  // trocados que ainda "cabem" na sequência.
  const DISTANCIA_PREVISAO_DIAS = 30;
  // Real x previsão: [previsão, real, nome curto da previsão]
  const PREVISOES = [['etd', 'data_embarque', 'ETD'], ['eta', 'data_chegada', 'ETA']];

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
      } else if (a && b && dias(a, b) > TRANSITO_MAXIMO_DIAS) {
        out.push({ nivel: 'aviso', tipo: 'transito', campos: ['data_embarque', 'data_chegada'],
          msg: `${dias(a, b)} dias entre o Embarque (${br(a)}) e a Chegada (${br(b)}) — viagem longa demais, confira as duas datas.` });
      }
    }

    PREVISOES.forEach(([prev, real, nome]) => {
      if (!toca(prev, real)) return;
      const a = iso(p[prev]), b = iso(p[real]);
      if (!a || !b) return;
      const n = dias(a, b);
      if (Math.abs(n) > DISTANCIA_PREVISAO_DIAS) {
        out.push({ nivel: 'aviso', tipo: 'previsao', campos: [prev, real],
          msg: `${rot(real)} (${br(b)}) está ${Math.abs(n)} dias ${n > 0 ? 'depois' : 'antes'} do ${nome} (${br(a)}) — confira se dia e mês não foram trocados.` });
      }
    });

    // Auditoria (opts.eventosNoFuturo): também DI, liberação, NFs e embarque
    // do CE Mercante — nenhuma delas pode estar no futuro.
    (opts.eventosNoFuturo ? EVENTOS_DOC : REAIS).forEach(k => {
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

    // NFs da aba Vendas (vendas_json). Caso real (auditoria dos FECHADOS,
    // 19/10/2026): UD26-069, NF 8635 emitida em 11/08/2026 gravada como
    // 08/11/2026 — a data no futuro fez a armazenagem RF tirar R$ 15 mil do
    // lucro. NF com número já foi emitida: não pode estar no futuro nem antes
    // da NF de entrada. Venda sem número (planejada) pode ter data futura.
    if (toca('vendas_json', 'nf_entrada_data')) {
      let vendas = p.vendas_json;
      if (typeof vendas === 'string') { try { vendas = JSON.parse(vendas || '[]'); } catch (e) { vendas = []; } }
      const entrada = iso(p.nf_entrada_data);
      (Array.isArray(vendas) ? vendas : []).forEach((v, i) => {
        const d = v && iso(v.nf_saida_data);
        if (!d) return;
        const nf = String(v.nf_saida_numero || '').trim();
        const nome = 'Data da NF ' + (nf || 'da venda ' + (i + 1)) + ' (aba Vendas)';
        if (anoForaDoLimite(Number(d.slice(0, 4)))) {
          out.push({ nivel: 'erro', tipo: 'ano', campos: ['vendas_json'], msg: `${nome} com ano ${d.slice(0, 4)} — confira se o ano foi digitado completo.` });
          return;
        }
        if (!nf) return;
        const t = trocarDiaMes(d);
        const trocadaFecha = t && dias(hoje, t) <= 1 && (!entrada || t >= entrada);
        const dica = trocadaFecha ? ` Com dia e mês trocados ficaria ${br(t)} — confira.` : '';
        if (dias(hoje, d) > 1) {
          out.push({ nivel: 'aviso', tipo: 'futuro', campos: ['vendas_json'], msg: `${nome} (${br(d)}) está no futuro — NF emitida não pode ter data futura.${dica}` });
        } else if (entrada && d < entrada) {
          out.push({ nivel: 'aviso', tipo: 'ordem', campos: ['vendas_json', 'nf_entrada_data'], msg: `${nome} (${br(d)}) está antes da ${rot('nf_entrada_data')} (${br(entrada)}).${dica}` });
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
  //   opts      { hoje, semTroca: [campos] } — semTroca: datas confirmadas pelo
  //             texto impresso no documento (lerDataTexto sem ambiguidade); essas
  //             nunca são trocadas, só usadas ou não
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
    // Embarque x chegada já tem limite de viagem em validar(); na leitura vale
    // o mesmo para a previsão (ETD x ETA).
    if (campos.indexOf('etd') >= 0 || campos.indexOf('eta') >= 0) {
      const a = iso(estado.etd), b = iso(estado.eta);
      const n = a && b && b >= a ? dias(a, b) : null;
      if (n != null && (n > TRANSITO_MAXIMO_DIAS || n < TRANSITO_MINIMO_DIAS)) {
        lista.push({ nivel: 'aviso', tipo: 'transito', campos: ['etd', 'eta'], msg: `${n} dia(s) entre ${rot('etd')} (${br(a)}) e ${rot('eta')} (${br(b)}).` });
      }
    }
    lista.forEach(x => { x.duro = x.nivel === 'erro' || x.leitura === 'erro' || x.tipo === 'futuro'; });
    return lista;
  }

  const MAX_DATAS_JUNTAS = 8; // 3^8 combinações; um documento traz bem menos datas
  const NAO_USAR = { valor: null, troca: false };

  function conferirDatasLidas(lidas, processo, opts) {
    opts = opts || {};
    const hoje = iso(opts.hoje) || hojeISO();
    const base = Object.assign({}, processo || {});
    const semTroca = new Set(Array.isArray(opts.semTroca) ? opts.semTroca : []);
    const res = { datas: {}, trocadas: [], descartadas: [], avisos: [] };
    const campos = [], lida = {}, opcoes = {};
    Object.keys(lidas || {}).forEach(k => {
      const bruto = lidas[k];
      if (bruto == null || bruto === '') return;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(bruto).trim());
      if (!m) { res.datas[k] = bruto; return; } // não é AAAA-MM-DD: segue como veio
      const v = m[0], t = semTroca.has(k) ? null : trocarDiaMes(v);
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
      // trocar dia e mês não conserta o ano; data confirmada pelo texto não é trocada
      const t = (m.tipo === 'ano' || semTroca.has(k)) ? null : trocarDiaMes(v);
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

  // ── A data como está impressa no documento ──
  // A IA copia o texto da data ("08/09/2026 10:54", "2026/05/30", "SEP. 05,
  // 2026") e o sistema converte sozinho. Ano na frente e mês por extenso não
  // têm ambiguidade; dia/mês numérico só tem quando os dois são até 12 — aí
  // vale opts.diaPrimeiro (documento brasileiro = dia/mês/ano). Sem saber o
  // padrão do documento, a data ambígua volta com data null.
  //   retorna { data: 'AAAA-MM-DD' | null, ambigua: true|false } ou null (texto sem data)
  const MESES = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7,
    ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
  function lerDataTexto(texto, opts) {
    opts = opts || {};
    const s = String(texto == null ? '' : texto).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!s) return null;
    const ano4 = a => (a.length === 2 ? 2000 + Number(a) : Number(a));
    const montar = (a, m, d) => {
      const t = String(a).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      return dataExiste(t) ? t : null;
    };
    const mes = nome => MESES[String(nome).slice(0, 3)] || null;
    let m;
    // ano na frente: 2026-05-30, 2026/05/30, 2026.5.30, 2026年5月30日
    m = /(?:^|\D)(\d{4})[\-/.](\d{1,2})[\-/.](\d{1,2})(?!\d)/.exec(s) || /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s);
    if (m) return { data: montar(m[1], Number(m[2]), Number(m[3])), ambigua: false };
    // numérico: 08/09/2026, 8.9.26, 08-09-2026 (antes do mês por extenso, para
    // "gate out 28/05/2026" não virar outubro)
    m = /(?:^|\D)(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{4}|\d{2})(?!\d)/.exec(s);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]), ano = ano4(m[3]);
      if (a > 12 && b <= 12) return { data: montar(ano, b, a), ambigua: false }; // só pode ser dia/mês
      if (b > 12 && a <= 12) return { data: montar(ano, a, b), ambigua: false }; // só pode ser mês/dia
      if (a === b) return { data: montar(ano, a, b), ambigua: false };
      if (opts.diaPrimeiro === true) return { data: montar(ano, b, a), ambigua: true };
      if (opts.diaPrimeiro === false) return { data: montar(ano, a, b), ambigua: true };
      return { data: null, ambigua: true };
    }
    // mês por extenso: "05 sep 2026", "05-SEP-26", "5 de setembro de 2026"
    for (m of s.matchAll(/(\d{1,2})[\s.\-/]*(?:de\s+)?([a-z]{3,})\.?[\s.\-/,]*(?:de\s+)?(\d{4}|\d{2})(?!\d)/g)) {
      if (mes(m[2])) return { data: montar(ano4(m[3]), mes(m[2]), Number(m[1])), ambigua: false };
    }
    // "sep 05, 2026", "SEP.05,2026", "September 5th 2026"
    for (m of s.matchAll(/([a-z]{3,})\.?[\s.\-/]*(\d{1,2})(?:st|nd|rd|th)?[\s.,\-/]+(\d{4}|\d{2})(?!\d)/g)) {
      if (mes(m[1])) return { data: montar(ano4(m[3]), mes(m[1]), Number(m[2])), ambigua: false };
    }
    return null;
  }

  // ── Datas que chegam por importação ──
  // Planilha do despachante, planilha interna, criação em lote e o Conexos
  // gravam direto no banco. A data impossível (as mesmas regras de 'erro' do
  // save do painel) não é gravada: sai do patch e vai para o relatório da
  // importação. Aviso não trava — só é devolvido para constar no relatório.
  //   atual   processo como está no banco (datas, tipo_container, containers_json)
  //   patch   { campo: valor } que a importação quer gravar
  //   retorna { patch, recusadas: [{campo, valor, motivo}], avisos: [texto] }
  function separarDatasImpossiveis(atual, patch, opts) {
    opts = opts || {};
    const p = Object.assign({}, patch || {});
    const recusadas = [];
    for (let volta = 0; volta < 10; volta++) {
      const errs = erros(validar(Object.assign({}, atual || {}, p), { campos: Object.keys(p), hoje: opts.hoje }));
      const culpados = [...new Set([].concat(...errs.map(e => e.campos)).filter(c => Object.prototype.hasOwnProperty.call(p, c)))];
      if (!culpados.length) break;
      culpados.forEach(c => {
        recusadas.push({ campo: c, valor: p[c], motivo: errs.filter(e => e.campos.indexOf(c) >= 0).map(e => e.msg).join(' ') });
        delete p[c];
      });
    }
    const restantes = Object.keys(p);
    const avs = restantes.length ? avisos(validar(Object.assign({}, atual || {}, p), { campos: restantes, hoje: opts.hoje })).map(a => a.msg) : [];
    return { patch: p, recusadas, avisos: avs };
  }

  // ── Auditoria (e-mail semanal) ──
  // Todas as regras em todas as datas do processo, inclusive DI, liberação e
  // NFs no futuro. Devolve só os processos com algum problema.
  //   retorna [{ processo, problemas: [{nivel, tipo, campos, msg}] }]
  function auditarProcessos(lista, opts) {
    opts = opts || {};
    const out = [];
    (lista || []).forEach(p => {
      if (!p || p.cancelado) return;
      const problemas = validar(p, { hoje: opts.hoje, eventosNoFuturo: true });
      if (problemas.length) out.push({ processo: p, problemas });
    });
    return out;
  }

  const ValidacaoDatas = { validar, erros, avisos, ehCampoData, conferirDatasLidas, trocarDiaMes, dataExiste, noFuturo,
    lerDataTexto, separarDatasImpossiveis, auditarProcessos, ROTULOS, TRANSITO_MINIMO_DIAS, TRANSITO_MAXIMO_DIAS, DISTANCIA_PREVISAO_DIAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = ValidacaoDatas;
  if (typeof window !== 'undefined') window.ValidacaoDatas = ValidacaoDatas;
})();
