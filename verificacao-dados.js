// verificacao-dados.js — Verificação diária dos dados (22/10/2026).
//
// Pedido do Ayslan: quando o sistema ganha um campo ou uma regra nova, os
// processos que já existiam não podem ficar para trás. Duas partes:
//
// 1. Correções automáticas (correcoesAutomaticas): regras que hoje só rodam
//    quando alguém abre e salva o processo. O job diário do servidor aplica
//    a mesma regra em todos os processos abertos, com linha no Histórico.
//    Só entra aqui o que é seguro fazer sem ninguém olhar:
//      - Cliente pela NF de venda (clienteDaVendaDoProcesso, controle-core.js)
//      - Nº da DUIMP nas parcelas com câmbio fechado (duimp-parcelas.js)
//    Processo fechado ou cancelado nunca é alterado.
//
// 2. Dados para conferir (pendenciasDados): o que precisa de uma pessoa.
//    Viram tarefas na Agenda (códigos D01–D05, responsáveis e prioridade em
//    Cadastros → Listas → "Agenda — Atividades"), sem prazo, e somem
//    sozinhas quando o dado é corrigido. "Não se aplica" tira a tarefa.
//
// UMD: navegador (<script src="/verificacao-dados.js">) e Node (servidor e testes).
(function () {
  const tem = v => v !== null && v !== undefined && String(v).trim() !== '';
  const norm = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  // mesmo formato de duimp-parcelas.js: 26BR0001234567-8 (sem pontuação: 2 dígitos + BR + 11 dígitos)
  const ehDuimp = v => /^\d{2}BR\d{11}$/i.test(String(v || '').replace(/[^0-9A-Za-z]/g, ''));
  const ehAcomp = p => p && p.finalidade === 'ACOMPANHAMENTO';

  // Algum valor > 0 no item dos Custos Reais (número, {valor, moeda} ou
  // detalhado por container).
  function temValor(x) {
    if (x == null) return false;
    if (typeof x === 'number' || typeof x === 'string') return num(x) > 0;
    if (typeof x === 'object') return Object.keys(x).some(k => k !== 'moeda' && temValor(x[k]));
    return false;
  }
  function realJson(p) {
    let r = p && p.real_json;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } }
    return r && typeof r === 'object' ? r : {};
  }
  const fmtUsd = v => 'US$ ' + num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── 2. dados para conferir ───────────────────────────────────────────
  // Cada regra: codigo (atividade da Agenda), aplica(p) → detalhe (texto) ou null.
  const PENDENCIAS = [
    { codigo: 'D01', nome: 'HBL igual ao MBL',
      aplica: p => (tem(p.hbl) && norm(p.hbl) === norm(p.mbl)) ? `HBL e MBL estão iguais (${p.hbl}) — um dos dois está errado; conferir no BL e no CE` : null },
    { codigo: 'D02', nome: 'CE Master igual ao CE House',
      aplica: p => (tem(p.ce_master) && norm(p.ce_master) === norm(p.ce_house)) ? `CE Master e CE House estão iguais (${p.ce_master}) — conferir no extrato do CE Mercante` : null },
    { codigo: 'D03', nome: 'Taxa ou total da DI/DUIMP vazio',
      aplica: p => (ehDuimp(p.numero_di) && (!tem(p.di_taxa_cambio) || !tem(p.di_valor_aduaneiro)))
        ? `DUIMP ${p.numero_di} sem ${!tem(p.di_taxa_cambio) ? 'a taxa do dólar' : ''}${!tem(p.di_taxa_cambio) && !tem(p.di_valor_aduaneiro) ? ' e sem ' : ''}${!tem(p.di_valor_aduaneiro) ? 'o total em R$' : ''} — ler a DUIMP em Documentos → Extração com IA` : null },
    { codigo: 'D04', nome: 'Finalizado sem custo da mercadoria',
      aplica: p => (p.fase === 'FINALIZADO' && !ehAcomp(p) && !temValor(realJson(p).fob))
        ? 'Custos Reais sem o custo da mercadoria (câmbio das parcelas ou NF de entrada) — o resultado do processo sai errado' : null },
    { codigo: 'D05', nome: 'CI e PI muito diferentes',
      aplica: p => {
        const pi = num(p.pi_valor_usd), ci = num(p.ci_valor_usd);
        if (!(pi > 0 && ci > 0)) return null;
        const dif = (ci - pi) / pi;
        return Math.abs(dif) > 0.05 ? `Valor da CI ${fmtUsd(ci)} × PI ${fmtUsd(pi)} (${dif > 0 ? '+' : ''}${Math.round(dif * 100)}%) — conferir se a CI foi lida inteira (todas as linhas) ou se o embarque foi parcial` : null;
      } },
  ];
  function pendenciasDados(p) {
    if (!p || p.cancelado) return [];
    const out = [];
    PENDENCIAS.forEach(r => {
      let det = null;
      try { det = r.aplica(p); } catch (e) { det = null; }
      if (det) out.push({ codigo: r.codigo, nome: r.nome, detalhe: det });
    });
    return out;
  }

  // ── 1. correções automáticas ─────────────────────────────────────────
  // motor = { clienteDaVendaDoProcesso } (controle-core.js no navegador ou
  // no sandbox do servidor); DuimpParcelas = duimp-parcelas.js.
  // Devolve [{ regra, titulo, patch:{campo: valor}, log:[{campo, valor_antes, valor_depois}] }].
  function correcoesAutomaticas(p, motor, DuimpParcelas) {
    if (!p || p.cancelado || p.fechado) return [];
    const out = [];
    try {
      const cv = motor && typeof motor.clienteDaVendaDoProcesso === 'function' ? motor.clienteDaVendaDoProcesso(p) : null;
      if (cv && tem(cv.nome) && norm(cv.nome) !== norm(p.cliente)) {
        out.push({ regra: 'cliente_pela_nf', titulo: 'Cliente pela NF de venda',
          patch: { cliente: cv.nome },
          log: [{ campo: 'cliente', valor_antes: p.cliente || '', valor_depois: cv.nome }] });
      }
    } catch (e) { /* regra com erro não impede as outras */ }
    try {
      const r = DuimpParcelas && typeof DuimpParcelas.completar === 'function' ? DuimpParcelas.completar(p) : null;
      if (r && r.campo === 'pi_parcelas_json' && Array.isArray(r.parcelas)) {
        const quais = (r.preenchidas || []).map(x => x.label || ('parcela ' + (x.idx + 1))).join(', ');
        out.push({ regra: 'duimp_parcelas', titulo: 'Nº DUIMP nas parcelas',
          patch: { pi_parcelas_json: JSON.stringify(r.parcelas) },
          log: [{ campo: 'pi_parcelas_json', valor_antes: 'parcela(s) ' + quais + ' sem Nº DUIMP', valor_depois: 'Nº DUIMP ' + r.numero + ' em ' + quais }] });
      } else if (r && r.campo === 'pi_duimp_numero' && tem(r.numero) && !tem(p.pi_duimp_numero)) {
        out.push({ regra: 'duimp_parcelas', titulo: 'Nº DUIMP no pagamento único',
          patch: { pi_duimp_numero: r.numero },
          log: [{ campo: 'pi_duimp_numero', valor_antes: '', valor_depois: r.numero }] });
      }
    } catch (e) { /* idem */ }
    return out;
  }

  // Resumo pro e-mail / tela: conta por regra e lista os processos.
  function resumir(processos, motor, DuimpParcelas) {
    const correcoes = [], pendencias = {};
    (processos || []).forEach(p => {
      if (!p || p.cancelado) return;
      correcoesAutomaticas(p, motor, DuimpParcelas).forEach(c => correcoes.push({ id: p.id, referencia: p.referencia, regra: c.regra, titulo: c.titulo, log: c.log }));
      pendenciasDados(p).forEach(x => { (pendencias[x.codigo] = pendencias[x.codigo] || { codigo: x.codigo, nome: x.nome, processos: [] }).processos.push({ id: p.id, referencia: p.referencia, detalhe: x.detalhe }); });
    });
    return { correcoes, pendencias: Object.values(pendencias).sort((a, b) => a.codigo.localeCompare(b.codigo)) };
  }

  const VerificacaoDados = { PENDENCIAS, pendenciasDados, correcoesAutomaticas, resumir };
  if (typeof module !== 'undefined' && module.exports) module.exports = VerificacaoDados;
  if (typeof window !== 'undefined') window.VerificacaoDados = VerificacaoDados;
})();
