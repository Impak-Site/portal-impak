// lib/cadastros-normalizar.js
//
// Padronização dos campos de texto livre do processo (armador, agente,
// transportadora, despachante, armazém, depot, porto de origem) a partir
// dos cadastros — pedido do Ayslan (01/10/2026), depois do relatório
// de-para mostrar o mesmo armador escrito de 4 jeitos (PIL / PILL / PIL
// SHIPPING / PACIFIC INTERNATIONAL LINES) em 127 processos, o despachante
// com um erro de digitação em 466 processos, etc.
//
// Regra: ao salvar o processo, o servidor compara o valor digitado (sem
// acento, sem maiúsculas, sem pontuação) com a razão social, o nome
// fantasia e os SINÔNIMOS de cada empresa que tenha o PAPEL daquele campo
// (ARMADOR pro campo armador, AGENTE pro agente...). Achou → grava o nome
// canônico (razão social; pro armador, o nome fantasia curto que o time
// usa, ex.: "PIL"). Não achou → deixa exatamente como veio (nunca inventa).
// Se a mesma grafia bater em 2 cadastros diferentes do mesmo papel, não
// mexe (ambíguo é pior do que não padronizar).
//
// Fase 2a (01/10/2026, revisão da tela de Cadastros): além do texto, o
// processo passa a guardar o ID do cadastro em <campo>_id (cliente_id,
// fornecedor_id, armador_id... — migration 0043). O texto continua sendo
// o "espelho" legível; o id é o vínculo de verdade, pra follow-up, Conexos
// e relatórios não dependerem de bater letra por letra. Cliente e
// fornecedor entram na padronização também. Quando o valor não bate com
// nenhum cadastro (ou é ambíguo), o id vai como null — nunca fica um
// vínculo velho apontando pra empresa errada.
//
// Lógica pura (sem banco) pra ser testável — ver testes_cadastros.js.

// Papel que cada campo do processo procura no cadastro de empresas.
const CAMPOS_PROCESSO_PAPEL = {
  cliente:        ['CLIENTE'],
  fornecedor:     ['FORNECEDOR', 'EXPORTADOR'],
  armador:        ['ARMADOR'],
  agente:         ['AGENTE'],
  transportadora: ['TRANSPORTADORA'],
  despachante:    ['DESPACHANTE'],
  armazem:        ['ARMAZEM_ALFANDEGADO', 'PORTO_ARMAZEM'],
  depot:          ['DEPOT_DEVOLUCAO'],
};

// Papéis em que o nome CURTO (nome fantasia) é o canônico — é como o time
// escreve no dia a dia e como aparece na TV/relatórios ("PIL", "COSCO",
// "FIND COMEX", "PORTONAVE", "LECHMAN TERMINAIS (NAVEGANTES)"). Decisão do
// Ayslan em 01/10/2026 ("mantém tudo como FIND COMEX") + de-para aprovado.
// Agente, transportadora, CLIENTE e FORNECEDOR ficam com a razão social:
// o de-para de 01/10 mostrou que o time escreve o cliente e o fornecedor
// por extenso no processo (UNICAP COMERCIO DE PNEUS NOVOS LTDA, SAILUN
// GROUP (HONGKONG) CO., LIMITED — 22 de 27 clientes e 24 de 34
// fornecedores batem letra por letra com a razão social). Sem nome
// fantasia, cai na razão social.
const PAPEIS_NOME_CURTO = ['ARMADOR', 'DESPACHANTE', 'ARMAZEM_ALFANDEGADO', 'PORTO_ARMAZEM', 'DEPOT_DEVOLUCAO'];

// "Chave" de comparação: sem acento, maiúsculas, só letras/números, um
// espaço entre palavras. "CMA-CGM" e "CMA CGM" viram a mesma chave;
// "Itajaí"/"ITAJAI" também.
function chaveNormalizada(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// CNPJ de matriz: 8 dígitos de raiz + "0001" + 2 dígitos verificadores.
function ehMatriz(e) {
  const d = String(e.cnpj || e.documento || '').replace(/\D/g, '');
  return d.length === 14 && d.slice(8, 12) === '0001';
}

function papeisDaEmpresa(e) {
  const lista = Array.isArray(e.papeis) ? e.papeis.slice() : [];
  if (e.tipo && !lista.includes(e.tipo)) lista.push(e.tipo);
  return lista.map(p => String(p || '').toUpperCase()).filter(Boolean);
}

function nomeCanonico(e, papel) {
  if (PAPEIS_NOME_CURTO.includes(papel) && e.nome_fantasia && String(e.nome_fantasia).trim()) return String(e.nome_fantasia).trim();
  return String(e.razao_social || e.nome_fantasia || '').trim();
}

// Monta o índice de busca: { porPapel: { ARMADOR: Map(chave → {nome, id}) ... },
// porto_origem: Map(chave → codigo), porto_destino: Map(chave → codigo),
// marca: Map(chave → codigo) }.
// Chaves ambíguas (mesma grafia apontando pra cadastros diferentes dentro do
// mesmo papel) são removidas do mapa. O mesmo cadastro listado duas vezes
// (ex.: razão social igual ao nome fantasia) não é ambiguidade.
function montarIndice(empresas, listas) {
  const porPapel = {};
  const ambiguas = {};
  (empresas || []).forEach(e => {
    if (!e || e.ativo === false) return;
    const id = e.id != null ? String(e.id) : null;
    papeisDaEmpresa(e).forEach(papel => {
      const canonico = nomeCanonico(e, papel);
      if (!canonico) return;
      if (!porPapel[papel]) { porPapel[papel] = new Map(); ambiguas[papel] = new Set(); }
      const mapa = porPapel[papel];
      const grafias = [e.razao_social, e.nome_fantasia].concat(Array.isArray(e.sinonimos) ? e.sinonimos : []);
      grafias.forEach(g => {
        const k = chaveNormalizada(g);
        if (!k) return;
        const atual = mapa.get(k);
        if (atual) {
          if (atual.nome !== canonico) { ambiguas[papel].add(k); return; }
          // Mesmo nome canônico em dois cadastros (matriz e filiais com CNPJs
          // diferentes — UNICAP, IRMÃOS SILVA, CDO...): o TEXTO continua
          // padronizável e o vínculo vai pra MATRIZ (CNPJ .../0001-xx), regra
          // aprovada pelo Ayslan em 01/10/2026. Se nenhum dos dois for a
          // matriz, não dá pra escolher → id null.
          if (id && atual.id !== id) {
            if (ehMatriz(e)) { atual.id = id; atual.matriz = true; }
            else if (!atual.matriz) atual.id = null;
          }
          return;
        }
        mapa.set(k, { nome: canonico, id, matriz: ehMatriz(e) });
      });
    });
  });
  Object.keys(ambiguas).forEach(papel => ambiguas[papel].forEach(k => porPapel[papel].delete(k)));

  const mapaLista = (itens) => {
    const m = new Map();
    const amb = new Set();
    (itens || []).forEach(it => {
      if (!it || it.ativo === false || !it.codigo) return;
      [it.codigo, it.nome].concat(Array.isArray(it.sinonimos) ? it.sinonimos : []).forEach(g => {
        const k = chaveNormalizada(g);
        if (!k) return;
        if (m.has(k) && m.get(k) !== it.codigo) { amb.add(k); return; }
        m.set(k, it.codigo);
      });
    });
    amb.forEach(k => m.delete(k));
    return m;
  };
  return {
    porPapel,
    porto_origem: mapaLista(listas && listas.porto_origem),
    porto_destino: mapaLista(listas && listas.porto_destino),
    marca: mapaLista(listas && listas.marca),
  };
}

// Campos de lista (código canônico em vez de empresa).
const CAMPOS_LISTA = { porto_origem: 'porto_origem', porto_destino: 'porto_destino', brand: 'marca' };

// Resolve um campo do processo: { nome, id } do cadastro que bate com o
// valor (id null pra listas), ou null quando não reconhece.
function resolverCampo(campo, valor, indice) {
  if (valor == null || !indice) return null;
  const k = chaveNormalizada(valor);
  if (!k) return null;
  if (CAMPOS_LISTA[campo]) {
    const mapa = indice[CAMPOS_LISTA[campo]];
    const cod = mapa && mapa.get(k);
    return cod ? { nome: cod, id: null } : null;
  }
  const papeis = CAMPOS_PROCESSO_PAPEL[campo];
  if (!papeis) return null;
  for (const papel of papeis) {
    const mapa = indice.porPapel[papel];
    if (mapa && mapa.has(k)) return { nome: mapa.get(k).nome, id: mapa.get(k).id };
  }
  return null;
}

// Valor canônico pra um campo do processo, ou o próprio valor se não
// reconhecer. Campo = nome do campo do processo (armador, agente, ...).
function normalizarValorCampo(campo, valor, indice) {
  if (valor == null) return valor;
  const texto = String(valor);
  if (!texto.trim() || !indice) return valor;
  const r = resolverCampo(campo, texto, indice);
  return r ? r.nome : valor;
}

// Campos de empresa que ganham <campo>_id no processo (migration 0043).
const CAMPOS_COM_ID = Object.keys(CAMPOS_PROCESSO_PAPEL);
const COLUNAS_ID = CAMPOS_COM_ID.map(c => c + '_id');

// Aplica em todos os campos conhecidos do payload (só nos que vieram no
// payload — o save é parcial). Devolve a lista do que mudou de TEXTO, pro
// log. Os ids (<campo>_id) são sempre reescritos quando o campo veio no
// payload: id do cadastro reconhecido, ou null.
function normalizarProcesso(processo, indice) {
  const mudancas = [];
  if (!processo || !indice) return mudancas;
  Object.keys(CAMPOS_PROCESSO_PAPEL).concat(Object.keys(CAMPOS_LISTA).filter(c => c !== 'porto_destino')).forEach(campo => {
    if (!(campo in processo)) return;
    const antes = processo[campo];
    const r = (antes != null && String(antes).trim()) ? resolverCampo(campo, antes, indice) : null;
    if (r && r.nome !== antes) {
      processo[campo] = r.nome;
      mudancas.push({ campo, antes, depois: r.nome });
    }
    if (CAMPOS_PROCESSO_PAPEL[campo]) processo[campo + '_id'] = r && r.id ? r.id : null;
  });
  // Vendas (aba Vendas): cada venda tem o próprio cliente — mesma regra.
  if ('vendas_json' in processo && processo.vendas_json) {
    let vendas = null;
    try { vendas = typeof processo.vendas_json === 'string' ? JSON.parse(processo.vendas_json) : processo.vendas_json; } catch (e) { vendas = null; }
    if (Array.isArray(vendas)) {
      let mexeu = false;
      vendas.forEach((v, i) => {
        if (!v || typeof v !== 'object') return;
        if (!('cliente' in v)) return;
        const antes = v.cliente;
        const r = (antes != null && String(antes).trim()) ? resolverCampo('cliente', antes, indice) : null;
        if (r && r.nome !== antes) {
          v.cliente = r.nome; mexeu = true;
          mudancas.push({ campo: 'vendas[' + (i + 1) + '].cliente', antes, depois: r.nome });
        }
        const idNovo = r && r.id ? r.id : null;
        if (!('cliente_id' in v) || (v.cliente_id || null) !== idNovo) { v.cliente_id = idNovo; mexeu = true; }
      });
      if (mexeu) processo.vendas_json = typeof processo.vendas_json === 'string' ? JSON.stringify(vendas) : vendas;
    }
  }
  return mudancas;
}

module.exports = {
  CAMPOS_PROCESSO_PAPEL, PAPEIS_NOME_CURTO, CAMPOS_LISTA, CAMPOS_COM_ID, COLUNAS_ID,
  chaveNormalizada, montarIndice, resolverCampo, normalizarValorCampo, normalizarProcesso, nomeCanonico, papeisDaEmpresa, ehMatriz,
};
