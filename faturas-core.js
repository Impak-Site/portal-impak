// faturas-core.js — Faturas (contas a pagar / a receber), 14/10/2026.
//
// Uma fatura é um documento de uma empresa (fatura do armador, nota do
// despachante, DARF, boleto ao cliente...) que agrupa uma ou mais taxas de
// um ou mais processos. Nasce da aba Custos Reais ("Gerar faturas": as
// linhas com "Pagamos para" viram contas a PAGAR; as "cobradas à parte"
// com "Receber de" viram contas a RECEBER) e vive na tela /faturas, onde o
// Financeiro marca como paga, informa a data e acompanha vencimentos.
//
// Regras de negócio puras (sem DOM, sem banco) — usadas no navegador
// (controle-modal.js / controle-faturas.js) e no servidor (validação) e
// cobertas por testes_faturas.js.
//
// UMD: navegador (<script src="/faturas-core.js">) e Node.
(function () {
  const STATUS = ['aberta', 'paga', 'cancelada'];
  const TIPOS = ['pagar', 'receber'];
  const MOEDAS = ['BRL', 'USD', 'EUR'];

  const iso = d => {
    if (!d) return null;
    const s = String(d).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const limpa = s => (s == null ? '' : String(s)).trim();
  const chave = s => limpa(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  // Agrupa as linhas da aba Custos Reais em faturas candidatas.
  // linha = { taxa, label, lado:'pagar'|'receber', empresa, empresa_id,
  //           documento, valor, moeda, processo_id, referencia, pago_em }
  // Mesma empresa + mesmo documento + mesma moeda + mesmo lado = uma fatura.
  // Linha sem empresa não vira fatura (não dá pra saber pra quem pagar).
  // Linha sem documento agrupa com as outras sem documento da mesma empresa.
  function agruparLinhasEmFaturas(linhas) {
    const grupos = new Map();
    const semEmpresa = [];
    (linhas || []).forEach(l => {
      if (!l) return;
      const valor = num(l.valor);
      if (!(valor > 0)) return;
      const empresa = limpa(l.empresa);
      if (!empresa) { semEmpresa.push(l); return; }
      const lado = l.lado === 'receber' ? 'receber' : 'pagar';
      const moeda = MOEDAS.includes(l.moeda) ? l.moeda : 'BRL';
      const doc = limpa(l.documento);
      const k = [lado, chave(empresa), chave(doc), moeda].join('|');
      if (!grupos.has(k)) grupos.set(k, { tipo: lado, empresa_nome: empresa, empresa_id: l.empresa_id || null, documento: doc || null, moeda, valor: 0, itens: [], vencimento: null, pago_em: null });
      const g = grupos.get(k);
      g.itens.push({ processo_id: l.processo_id || null, referencia: l.referencia || null, taxa: l.taxa, label: l.label || l.taxa, valor, moeda });
      g.valor = Math.round((g.valor + valor) * 100) / 100;
      if (!g.empresa_id && l.empresa_id) g.empresa_id = l.empresa_id;
      // já tem data de pagamento lançada na taxa → fatura nasce paga
      if (l.pago_em && iso(l.pago_em)) g.pago_em = g.pago_em || iso(l.pago_em);
      if (l.vencimento && iso(l.vencimento)) g.vencimento = g.vencimento || iso(l.vencimento);
    });
    return { faturas: [...grupos.values()], semEmpresa };
  }

  // Valida/normaliza o corpo de uma fatura vinda da tela. Devolve
  // { ok, erro, fatura }.
  function validarFatura(b) {
    b = b || {};
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
    if (!tipo) return { ok: false, erro: 'Tipo inválido (pagar/receber).' };
    const empresa_nome = limpa(b.empresa_nome);
    if (!empresa_nome) return { ok: false, erro: 'Informe a empresa (pra quem pagar / de quem receber).' };
    const moeda = MOEDAS.includes(b.moeda) ? b.moeda : 'BRL';
    const itens = Array.isArray(b.itens) ? b.itens.map(it => ({
      processo_id: it && it.processo_id ? String(it.processo_id).slice(0, 80) : null,
      referencia: it && it.referencia ? String(it.referencia).slice(0, 80) : null,
      taxa: it && it.taxa ? String(it.taxa).slice(0, 60) : null,
      label: it && it.label ? String(it.label).slice(0, 120) : null,
      valor: num(it && it.valor), moeda,
    })).filter(it => it.valor > 0 || it.taxa) : [];
    const somaItens = Math.round(itens.reduce((s, it) => s + it.valor, 0) * 100) / 100;
    const valor = b.valor != null && b.valor !== '' ? num(b.valor) : somaItens;
    if (!(valor > 0)) return { ok: false, erro: 'Valor da fatura deve ser maior que zero.' };
    const vencimento = iso(b.vencimento);
    const pago_em = iso(b.pago_em);
    let status = STATUS.includes(b.status) ? b.status : 'aberta';
    if (pago_em && status === 'aberta') status = 'paga';
    const fatura = {
      tipo, empresa_nome, empresa_id: b.empresa_id ? String(b.empresa_id).slice(0, 80) : null,
      documento: limpa(b.documento).slice(0, 120) || null, moeda, valor,
      valor_pago: status === 'paga' ? (b.valor_pago != null && b.valor_pago !== '' ? num(b.valor_pago) : valor) : null,
      emissao: iso(b.emissao), vencimento, pago_em, status,
      obs: limpa(b.obs).slice(0, 1000) || null, itens,
    };
    return { ok: true, fatura };
  }

  // Situação pra tela: vencida / vence hoje / a vencer / paga / cancelada.
  function situacao(f, hoje) {
    if (!f) return 'aberta';
    if (f.status === 'cancelada') return 'cancelada';
    if (f.status === 'paga') return 'paga';
    const v = iso(f.vencimento);
    if (!v) return 'sem_vencimento';
    if (v < hoje) return 'vencida';
    if (v === hoje) return 'hoje';
    const d = Math.round((new Date(v + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
    return d <= 7 ? 'semana' : 'a_vencer';
  }

  // Totais pros cards da tela (em R$ usando o câmbio informado pra USD/EUR).
  function resumoFaturas(lista, hoje, cambio) {
    cambio = cambio || {};
    const brl = f => f.moeda === 'BRL' ? num(f.valor) : num(f.valor) * (parseFloat(cambio[f.moeda]) || 0);
    const r = { pagar_aberto: 0, pagar_vencido: 0, receber_aberto: 0, receber_vencido: 0, pago_mes: 0, recebido_mes: 0, qtd_aberta: 0, qtd_vencida: 0 };
    const mes = (hoje || '').slice(0, 7);
    (lista || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const s = situacao(f, hoje);
      if (f.status === 'paga') {
        if ((iso(f.pago_em) || '').slice(0, 7) === mes) { if (f.tipo === 'pagar') r.pago_mes += brl(f); else r.recebido_mes += brl(f); }
        return;
      }
      r.qtd_aberta++;
      if (f.tipo === 'pagar') r.pagar_aberto += brl(f); else r.receber_aberto += brl(f);
      if (s === 'vencida') { r.qtd_vencida++; if (f.tipo === 'pagar') r.pagar_vencido += brl(f); else r.receber_vencido += brl(f); }
    });
    Object.keys(r).forEach(k => { r[k] = Math.round(r[k] * 100) / 100; });
    return r;
  }

  const FaturasCore = { STATUS, TIPOS, MOEDAS, agruparLinhasEmFaturas, validarFatura, situacao, resumoFaturas };
  if (typeof module !== 'undefined' && module.exports) module.exports = FaturasCore;
  if (typeof window !== 'undefined') window.FaturasCore = FaturasCore;
})();
