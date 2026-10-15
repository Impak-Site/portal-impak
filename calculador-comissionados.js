// Comissionados no Calculador (Passo 3b) — carregado no calculador.html.
//
// Lista vem de Cadastros → Listas (categoria "comissionado"), via /api/listas.
// Quem não tem acesso a resultado/financeiro/cadastros recebe a lista vazia;
// nesse caso o seletor some e o Calculador continua com o % manual de sempre.
//
// IMPORTANTE: comissão é dado INTERNO. Nada daqui pode ir para saídas do
// cliente (proposta / "p/ Cliente"). Nomes e percentuais ficam só no banco.

// Cálculo puro (sem DOM) — testado em testes_calculador_comissionados.js.
// itens: [{codigo, dados:{percentual, base}}]
// bases: { faturamento, nf, fob, lucro }   (lucro = antes das comissões de representante)
function calcularComissionadosCalc(itens, bases) {
  bases = bases || {};
  const linhas = (itens || []).map(c => {
    const d = (c && c.dados) || {};
    const pct = parseFloat(String(d.percentual == null ? '' : d.percentual).replace(',', '.')) || 0;
    const base = d.base || 'FATURAMENTO_TOTAL';
    let valorBase;
    if (base === 'NOTA_FISCAL') valorBase = bases.nf || 0;
    else if (base === 'FOB_DOLAR') valorBase = bases.fob || 0;
    else if (base === 'LUCRO_BRUTO') valorBase = Math.max(0, bases.lucro || 0);
    else valorBase = bases.faturamento || 0;
    return { codigo: c.codigo, base, pct, valorBase, valor: valorBase * pct / 100 };
  });
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  return { linhas, total };
}

// Casa o cliente com a lista "clientes" do comissionado (palavra inteira,
// sem acento) — mesma regra do Controle (comissionadoAtendeCliente).
function comissionadoAtendeClienteCalc(c, cliente) {
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const lista = String((c && c.dados && c.dados.clientes) || '').split(/[,;\/\n]+/).map(norm).filter(Boolean);
  if (!lista.length) return false; // sem lista de clientes: nunca marca sozinho
  const cli = ' ' + norm(cliente) + ' ';
  return lista.some(t => cli.includes(' ' + t + ' ')); // palavra inteira: "OST" não casa com "COSTA"
}
// Meta de lucro por cliente (lista "meta_lucro", Rev97 N33). Devolve
// { pct, codigo, nome, especifica, porProduto } — ordem de prioridade:
// cliente+produto > cliente (todos os produtos) > padrão+produto > padrão.
// produto: string ou { valor, rotulo } (ex.: { valor:'TBR', rotulo:'Caminhão (TBR)' }).
// Linha com `produtos` preenchido só vale se o produto casar (palavra inteira).
function produtoAtendeMetaCalc(x, produto) {
  const lista = String(((x || {}).dados || {}).produtos || '').split(/[,;\/\n]+/).map(s => s.trim()).filter(Boolean);
  if (!lista.length) return null; // sem filtro de produto
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const p = produto && typeof produto === 'object' ? produto : { valor: produto, rotulo: '' };
  const alvo = ' ' + norm(p.valor) + ' ' + norm(p.rotulo) + ' ';
  return lista.some(t => { const n = norm(t); return n && alvo.includes(' ' + n + ' '); });
}
function metaLucroParaCliente(lista, cliente, produto) {
  const itens = (lista || []).filter(x => x && x.ativo !== false);
  const pct = x => parseFloat(String(((x || {}).dados || {}).percentual == null ? '' : x.dados.percentual).replace(',', '.'));
  const temCli = x => !!String((x.dados || {}).clientes || '').trim();
  const doCliente = itens.filter(x => temCli(x) && comissionadoAtendeClienteCalc(x, cliente));
  const padrao = itens.filter(x => !temCli(x));
  const escolher = arr => arr.find(x => produtoAtendeMetaCalc(x, produto) === true) || arr.find(x => produtoAtendeMetaCalc(x, produto) === null);
  const m = escolher(doCliente) || escolher(padrao);
  if (!m || isNaN(pct(m))) return null;
  return { pct: pct(m), codigo: m.codigo, nome: m.nome || m.codigo, especifica: doCliente.includes(m), porProduto: produtoAtendeMetaCalc(m, produto) === true };
}
const ehSimComissaoCalc = v => v === true || /^(S|SIM|Y|YES|TRUE|1)$/i.test(String(v || '').trim());

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calcularComissionadosCalc, comissionadoAtendeClienteCalc, ehSimComissaoCalc, metaLucroParaCliente, produtoAtendeMetaCalc };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
  let _lista = null; // null = ainda não carregou
  let _metas = [];   // lista meta_lucro

  // Meta de lucro do cliente digitado (ou null). Usada pelo card de resultado.
  window.metaLucroAtualCalc = function () {
    const cliente = (document.getElementById('cliente') || {}).value || '';
    const selP = document.getElementById('produto');
    const op = selP && selP.options && selP.selectedIndex >= 0 ? selP.options[selP.selectedIndex] : null;
    return metaLucroParaCliente(_metas, cliente, { valor: selP ? selP.value : '', rotulo: op ? op.text : '' });
  };
  // Trocar o produto também reaplica a meta (o % pode mudar por produto).
  document.addEventListener('change', ev => { if (ev.target && ev.target.id === 'produto' && typeof window.aplicarMetaLucroCliente === 'function') window.aplicarMetaLucroCliente(); });
  // Ao trocar o cliente: Lucro Alvo % (cenário em %) recebe a meta do cliente,
  // como a planilha (DADOS!N33 → MODELO). Cenário 2 (R$) não mexe.
  window.aplicarMetaLucroCliente = function () {
    const m = window.metaLucroAtualCalc();
    const info = document.getElementById('meta-lucro-info');
    if (!m) { if (info) info.style.display = 'none'; return; }
    if (info) { info.style.display = ''; info.textContent = `Meta de lucro ${m.especifica ? 'do cliente' : 'padrão'}${m.porProduto ? ' para este produto' : ''} (${m.nome}): ${String(m.pct).replace('.', ',')}% — aplicada no Lucro Alvo % (pode alterar).`; }
    if (_estado.cenario === 2) return;
    const el = document.getElementById('cenario_valor');
    if (el && parseFloat(el.value) !== m.pct) { el.value = m.pct; if (typeof agendarAutosave === 'function') agendarAutosave(); recalcularSePronto(); }
  };

  const NOME_BASE = { FATURAMENTO_TOTAL: 'Faturamento total', NOTA_FISCAL: 'Nota fiscal', FOB_DOLAR: 'FOB', LUCRO_BRUTO: 'Lucro bruto' };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function sel() {
    if (!Array.isArray(_estado.comissionados)) _estado.comissionados = [];
    return _estado.comissionados;
  }

  // Usado por calcular(): devolve os itens completos dos selecionados.
  window.comissionadosSelecionadosCalc = function () {
    if (!_lista || !_lista.length) return [];
    const codigos = sel();
    return _lista.filter(c => codigos.includes(c.codigo));
  };

  function recalcularSePronto() {
    if (_estado.ultimoResultado && typeof calcular === 'function') { try { calcular({ auto: true }); } catch (e) {} }
  }

  function render() {
    const box = document.getElementById('br-comissionados-box');
    const chips = document.getElementById('br-comissionados-chips');
    if (!box || !chips) return;
    if (!_lista || !_lista.length) { box.style.display = 'none'; atualizarManual(); return; }
    box.style.display = '';
    const codigos = sel();
    chips.innerHTML = _lista.map(c => {
      const d = c.dados || {};
      const on = codigos.includes(c.codigo);
      const pct = String(d.percentual == null ? '' : d.percentual).replace('.', ',');
      return `<button type="button" class="toggle-btn${on ? ' active-sim' : ''}" style="margin:0 6px 6px 0;font-size:11px;padding:5px 9px;"
        onclick="toggleComissionadoCalc('${esc(c.codigo).replace(/\\/g, '\\\\')}')"
        title="${esc(d.observacao || '')}">${on ? '✓ ' : ''}${esc(c.nome || c.codigo)} · ${esc(pct)}% s/ ${esc(NOME_BASE[d.base] || 'Faturamento total')}</button>`;
    }).join('');
    atualizarManual();
  }

  // Com comissionado escolhido, o % manual deixa de valer (evita somar duas vezes).
  function atualizarManual() {
    const usa = sel().length > 0 && _lista && _lista.length;
    const pct = document.getElementById('br_pct');
    const nome = document.getElementById('br_nome');
    const aviso = document.getElementById('br-comissionados-aviso');
    [pct, nome].forEach(el => { if (el) { el.disabled = !!usa; el.style.opacity = usa ? '.5' : ''; } });
    if (aviso) aviso.style.display = usa ? '' : 'none';
  }

  window.toggleComissionadoCalc = function (codigo) {
    const s = sel();
    const i = s.indexOf(codigo);
    if (i >= 0) s.splice(i, 1); else s.push(codigo);
    if (s.length && _estado.toggles.br !== 'SIM') setToggle('br', 'SIM');
    render();
    if (typeof agendarAutosave === 'function') agendarAutosave();
    recalcularSePronto();
  };

  // Ao trocar o cliente: marca os "automáticos" que atendem esse cliente e
  // desmarca automáticos que eram de outro cliente. Não mexe nos escolhidos à mão.
  window.aplicarComissionadosAutoCliente = function () {
    if (!_lista || !_lista.length) return;
    const cliente = (document.getElementById('cliente') || {}).value || '';
    const s = sel();
    let mudou = false;
    _lista.forEach(c => {
      if (!ehSimComissaoCalc((c.dados || {}).automatico)) return;
      const atende = comissionadoAtendeClienteCalc(c, cliente);
      const i = s.indexOf(c.codigo);
      if (atende && i < 0) { s.push(c.codigo); mudou = true; }
      if (!atende && i >= 0) { s.splice(i, 1); mudou = true; }
    });
    if (!mudou) return;
    if (s.length && _estado.toggles.br !== 'SIM') setToggle('br', 'SIM');
    render();
    if (typeof agendarAutosave === 'function') agendarAutosave();
  };

  // Chamado por aplicarEstadoFormulario() ao abrir uma cotação salva.
  window.restaurarComissionadosCalc = function (codigos) {
    _estado.comissionados = Array.isArray(codigos) ? codigos.filter(x => typeof x === 'string').map(x => x.toUpperCase()) : [];
    render();
  };

  async function carregar() {
    try {
      const r = await fetch('/api/listas').then(x => x.json());
      _lista = ((r && r.listas && r.listas.comissionado) || []).filter(x => x && x.codigo && x.ativo !== false)
        .map(x => ({ ...x, codigo: String(x.codigo).toUpperCase() }));
      _metas = (r && r.listas && r.listas.meta_lucro) || [];
    } catch (e) { _lista = []; _metas = []; }
    render();
  }

  document.addEventListener('DOMContentLoaded', carregar);
})();
