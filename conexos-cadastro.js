// conexos-cadastro.js — códigos do Conexos nos processos e nos produtos (23/10/2026).
//
// Pedido do Jean: ver o código do Conexos ao lado da referência do processo
// (lista do Controle e painel), ao lado de cada produto (painel e folha de
// Faturamento do Calculador) e ter um lugar para subir as planilhas que o
// Conexos exporta ("CadProcessos" e "CadProdutos") e atualizar a lista.
//
// Este arquivo tem só as regras (sem banco, sem tela):
//   • lerPlanilha(linhas): reconhece qual das duas planilhas é e devolve os itens;
//   • planoProcessos(itens, processos, RefProcesso): o que muda em cada
//     processo (ID no Conexos = "Cód. Processo", casando pela "Referência
//     Externa"); não troca nada sem mostrar antes;
//   • planoProdutos(itens, catalogo): o que entra/atualiza no Catálogo de
//     Produtos (codigo_conexos = "Produto", codigo_interno = "Cód. Externo");
//   • acharProduto(descricao, catalogo): o código do Conexos de um item do
//     processo/cotação pela descrição (medida + pattern + índice de carga…).
//
// UMD: navegador (window.ConexosCadastro) e Node (require). Testes em
// testes_conexos.js (valores fictícios).
(function () {
  'use strict';

  const txt = v => (v == null ? '' : String(v)).trim();
  const semAcento = s => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normCab = s => semAcento(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const inteiro = v => { const s = txt(v).replace(/\.0+$/, ''); return /^\d{1,9}$/.test(s) ? parseInt(s, 10) : null; };

  // ── Leitura das planilhas exportadas do Conexos ───────────────────────────
  // linhas = matriz (1ª linha com cabeçalho em algum lugar das 10 primeiras)
  function lerPlanilha(linhas) {
    linhas = Array.isArray(linhas) ? linhas : [];
    for (let h = 0; h < Math.min(10, linhas.length); h++) {
      const cab = (linhas[h] || []).map(normCab);
      const col = nome => cab.indexOf(nome);
      // CadProcessos: "Cód. Processo" + "Referência Externa"
      if (col('CODPROCESSO') >= 0 && col('REFERENCIAEXTERNA') >= 0) {
        const iCod = col('CODPROCESSO'), iRef = col('REFERENCIAEXTERNA'), iRefCli = col('REFERENCIACLIENTE'),
          iSit = col('SITUACAO'), iCli = col('DESCRICAODEENCOMENDANTEADQUIRENTE'), iAbert = col('DATAABERTURA');
        const itens = [];
        for (let i = h + 1; i < linhas.length; i++) {
          const l = linhas[i] || [];
          const codigo = inteiro(l[iCod]);
          const referencia = txt(l[iRef]) || (iRefCli >= 0 ? txt(l[iRefCli]) : '');
          if (codigo == null || !referencia) continue;
          itens.push({ codigo_conexos: codigo, referencia, referencia_cliente: iRefCli >= 0 ? txt(l[iRefCli]) : '',
            situacao: iSit >= 0 ? txt(l[iSit]) : '', cliente: iCli >= 0 ? txt(l[iCli]) : '', abertura: iAbert >= 0 ? l[iAbert] : null });
        }
        return { tipo: 'processos', itens };
      }
      // CadProdutos: "Produto" + "Descrição Produto"
      if (col('PRODUTO') >= 0 && col('DESCRICAOPRODUTO') >= 0) {
        const iCod = col('PRODUTO'), iDesc = col('DESCRICAOPRODUTO'), iExt = col('CODEXTERNO'), iExp = col('CODEXPORTADOR'),
          iNcm = col('NCM'), iSit = col('SITUACAO'), iMarca = col('MARCADOPRODUTO');
        const itens = [];
        for (let i = h + 1; i < linhas.length; i++) {
          const l = linhas[i] || [];
          const codigo = inteiro(l[iCod]);
          const descricao = txt(l[iDesc]);
          if (codigo == null || !descricao) continue;
          itens.push({ codigo_conexos: codigo, descricao, codigo_interno: iExt >= 0 ? (txt(l[iExt]) || null) : null,
            codigo_exportador: iExp >= 0 ? txt(l[iExp]) : '', ncm: iNcm >= 0 ? txt(l[iNcm]) : '',
            situacao: iSit >= 0 ? txt(l[iSit]) : '', marca: iMarca >= 0 ? txt(l[iMarca]) : '' });
        }
        return { tipo: 'produtos', itens };
      }
    }
    return { tipo: null, itens: [], erro: 'Não reconheci a planilha: use a exportação do Conexos de Processos (colunas "Cód. Processo" e "Referência Externa") ou de Produtos (colunas "Produto" e "Descrição Produto").' };
  }

  // ── Processos: ID no Conexos pela Referência Externa ──────────────────────
  // processos = [{id, referencia, conexos_id, fechado, cancelado}]
  // Resultado: { mudar:[{id, referencia, de, para, referencia_planilha}], iguais, nao_encontrados, ambiguos, conflitos }
  function planoProcessos(itens, processos, RefProcesso) {
    const chave = v => txt(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
    const indice = RefProcesso.criarIndice(processos || []);
    const porProcesso = new Map(); // id -> [{item, como}]
    const nao_encontrados = [], ambiguos = [];
    (itens || []).forEach(it => {
      const achado = RefProcesso.encontrar(indice, it.referencia);
      if (!achado.processo) {
        if (achado.como === 'ambiguo') ambiguos.push({ referencia: it.referencia, codigo: it.codigo_conexos, candidatos: achado.candidatos });
        else nao_encontrados.push({ referencia: it.referencia, codigo: it.codigo_conexos, situacao: it.situacao });
        return;
      }
      const l = porProcesso.get(achado.processo.id) || [];
      l.push({ item: it, como: achado.como });
      porProcesso.set(achado.processo.id, l);
    });
    const porId = new Map((processos || []).map(p => [p.id, p]));
    const mudar = [], iguais = [], conflitos = [];
    porProcesso.forEach((lista, id) => {
      const p = porId.get(id);
      // Mais de uma linha do Conexos para o mesmo processo: vale a de referência
      // idêntica; se ainda sobrar mais de uma (ou nenhuma idêntica), não troca.
      let escolhidas = lista.filter(x => x.como === 'exato');
      if (!escolhidas.length) escolhidas = lista;
      const codigos = [...new Set(escolhidas.map(x => x.item.codigo_conexos))];
      if (codigos.length > 1) { conflitos.push({ referencia: p.referencia, motivo: 'mais de um processo no Conexos com esta referência', codigos }); return; }
      const para = String(codigos[0]);
      const de = txt(p.conexos_id);
      const refPlan = escolhidas[0].item.referencia;
      if (chave(de) === chave(para)) { iguais.push({ referencia: p.referencia, codigo: para }); return; }
      mudar.push({ id, referencia: p.referencia, de: de || null, para, referencia_planilha: refPlan !== p.referencia ? refPlan : null, fechado: !!p.fechado, cancelado: !!p.cancelado });
    });
    // Código que já é de outro processo que não vai mudar → conflito (o banco
    // não deixa repetir; ver conexos-id.js).
    const vaiMudar = new Set(mudar.map(m => m.id));
    const ocupado = new Map();
    (processos || []).forEach(p => { if (txt(p.conexos_id) && !vaiMudar.has(p.id)) ocupado.set(chave(p.conexos_id), p.referencia); });
    const novos = new Map();
    const ok = [];
    mudar.forEach(m => {
      const k = chave(m.para);
      if (ocupado.has(k)) { conflitos.push({ referencia: m.referencia, motivo: `código ${m.para} já está no processo ${ocupado.get(k)}`, codigos: [m.para] }); return; }
      if (novos.has(k)) { conflitos.push({ referencia: m.referencia, motivo: `código ${m.para} também iria para ${novos.get(k)}`, codigos: [m.para] }); return; }
      novos.set(k, m.referencia);
      ok.push(m);
    });
    return { mudar: ok, iguais, nao_encontrados, ambiguos, conflitos };
  }

  // ── Produtos: Catálogo de Produtos ────────────────────────────────────────
  // catalogo = [{id, descricao, codigo_interno, codigo_conexos}]
  // Resultado: { inserir:[item], atualizar:[{id, campos, antes}], iguais, avisos }
  function planoProdutos(itens, catalogo) {
    catalogo = catalogo || [];
    const kTxt = v => semAcento(v).toUpperCase().replace(/\s+/g, ' ').trim();
    const porConexos = new Map(), porInterno = new Map(), porDesc = new Map();
    catalogo.forEach(c => {
      if (c.codigo_conexos != null && c.codigo_conexos !== '') porConexos.set(String(c.codigo_conexos), c);
      if (txt(c.codigo_interno)) porInterno.set(kTxt(c.codigo_interno), c);
      if (txt(c.descricao)) { const k = kTxt(c.descricao); if (!porDesc.has(k)) porDesc.set(k, c); }
    });
    const inserir = [], atualizar = [], iguais = [], avisos = [];
    const internosUsados = new Map(); // codigo_interno -> id do catálogo (para não repetir)
    catalogo.forEach(c => { if (txt(c.codigo_interno)) internosUsados.set(kTxt(c.codigo_interno), c.id); });
    const vistos = new Set();
    (itens || []).forEach(it => {
      const cod = String(it.codigo_conexos);
      if (vistos.has(cod)) return; // linha repetida na planilha
      vistos.add(cod);
      let atual = porConexos.get(cod);
      if (!atual && it.codigo_interno) { const c = porInterno.get(kTxt(it.codigo_interno)); if (c && (c.codigo_conexos == null || c.codigo_conexos === '')) atual = c; }
      if (!atual) { const c = porDesc.get(kTxt(it.descricao)); if (c && (c.codigo_conexos == null || c.codigo_conexos === '')) atual = c; }
      let interno = it.codigo_interno || null;
      if (interno) {
        const dono = internosUsados.get(kTxt(interno));
        if (dono != null && (!atual || dono !== atual.id)) {
          avisos.push(`Cód. Externo ${interno} (Conexos ${cod}) já está em outro produto do catálogo — mantido sem o código interno.`);
          interno = atual ? (atual.codigo_interno || null) : null;
        }
      }
      if (!atual) {
        const novo = { codigo_conexos: it.codigo_conexos, descricao: it.descricao, codigo_interno: interno };
        if (interno) internosUsados.set(kTxt(interno), 'novo:' + cod);
        inserir.push(novo);
        return;
      }
      const campos = {};
      if (String(atual.codigo_conexos == null ? '' : atual.codigo_conexos) !== cod) campos.codigo_conexos = it.codigo_conexos;
      if (kTxt(atual.descricao) !== kTxt(it.descricao)) campos.descricao = it.descricao;
      if (interno && kTxt(atual.codigo_interno) !== kTxt(interno)) { campos.codigo_interno = interno; internosUsados.set(kTxt(interno), atual.id); }
      if (Object.keys(campos).length) atualizar.push({ id: atual.id, campos, antes: { descricao: atual.descricao, codigo_interno: atual.codigo_interno || null, codigo_conexos: atual.codigo_conexos == null ? null : atual.codigo_conexos } });
      else iguais.push(cod);
    });
    return { inserir, atualizar, iguais, avisos };
  }

  // ── Achar o produto do catálogo pela descrição ────────────────────────────
  // "12.4-24 MS957 128A6 12 PLY RATIN G" ↔ "PNEU MAXAM 12.4-24 128A6 MS957".
  // A medida tem de bater; entre os da mesma medida ganha quem divide mais
  // palavras (pattern, índice de carga, lonas…). Empate = não escolhe.
  const PALAVRAS_FORA = new Set(['PNEU', 'PNEUS', 'TIRE', 'TIRES', 'TYRE', 'TYRES', 'NOVO', 'DE', 'PARA', 'COM', 'TL', 'TT', 'E']);
  function tokens(desc) {
    let s = semAcento(desc).toUpperCase();
    s = s.replace(/(\d+)\s*(?:PLY\s*RATI?N?G?|PLY|P\.?R\.?)\b/g, '$1PR');
    s = s.replace(/(\d)\s*([/.,-])\s*(\d)/g, '$1$2$3').replace(/(\d),(\d)/g, '$1.$2');
    s = s.replace(/(\d)\s+(Z?R)\s*(\d)/g, '$1$2$3');
    return s.split(/[^A-Z0-9./-]+/).map(t => t.replace(/^[./-]+|[./-]+$/g, '')).filter(t => t && !PALAVRAS_FORA.has(t));
  }
  const RE_MEDIDA = /^\d{1,3}(?:\.\d{1,2})?(?:\/\d{2,3}(?:\.\d{1,2})?)?(?:Z?R|-|R-)\d{2}(?:\.\d)?(?:LT|C)?$/;
  function medidaDe(toks) { return toks.find(t => RE_MEDIDA.test(t)) || null; }
  function acharProduto(descricao, catalogo) {
    const tq = tokens(descricao);
    const med = medidaDe(tq);
    if (!med) return { produto: null, motivo: 'sem medida na descrição' };
    const setQ = new Set(tq);
    let melhor = [], nota = 0;
    (catalogo || []).forEach(c => {
      if (c == null || c.codigo_conexos == null || c.codigo_conexos === '') return;
      const tc = tokens(c.descricao);
      if (medidaDe(tc) !== med) return;
      const comuns = tc.filter(t => setQ.has(t)).length;
      if (comuns > nota) { nota = comuns; melhor = [c]; }
      else if (comuns === nota) melhor.push(c);
    });
    if (!melhor.length) return { produto: null, motivo: 'medida não está no catálogo' };
    if (melhor.length > 1) return { produto: null, motivo: 'mais de um produto possível', candidatos: melhor.slice(0, 5) };
    if (nota < 2) return { produto: null, motivo: 'só a medida bate', candidatos: melhor };
    return { produto: melhor[0], pontos: nota };
  }

  const api = { lerPlanilha, planoProcessos, planoProdutos, acharProduto, _tokens: tokens };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ConexosCadastro = api;
})();
