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
// Lógica pura (sem banco) pra ser testável — ver testes_cadastros.js.

// Papel que cada campo do processo procura no cadastro de empresas.
const CAMPOS_PROCESSO_PAPEL = {
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
// Agente e transportadora ficam com a razão social (ROYAL CARGO DO BRASIL,
// RF LOGISTICA LTDA...). Sem nome fantasia, cai na razão social.
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

function papeisDaEmpresa(e) {
  const lista = Array.isArray(e.papeis) ? e.papeis.slice() : [];
  if (e.tipo && !lista.includes(e.tipo)) lista.push(e.tipo);
  return lista.map(p => String(p || '').toUpperCase()).filter(Boolean);
}

function nomeCanonico(e, papel) {
  if (PAPEIS_NOME_CURTO.includes(papel) && e.nome_fantasia && String(e.nome_fantasia).trim()) return String(e.nome_fantasia).trim();
  return String(e.razao_social || e.nome_fantasia || '').trim();
}

// Monta o índice de busca: { porPapel: { ARMADOR: Map(chave → canônico) ... },
// porto_origem: Map(chave → codigo), porto_destino: Map(chave → codigo) }.
// Chaves ambíguas (mesma grafia apontando pra canônicos diferentes dentro do
// mesmo papel) são removidas do mapa.
function montarIndice(empresas, listas) {
  const porPapel = {};
  const ambiguas = {};
  (empresas || []).forEach(e => {
    if (!e || e.ativo === false) return;
    papeisDaEmpresa(e).forEach(papel => {
      const canonico = nomeCanonico(e, papel);
      if (!canonico) return;
      if (!porPapel[papel]) { porPapel[papel] = new Map(); ambiguas[papel] = new Set(); }
      const mapa = porPapel[papel];
      const grafias = [e.razao_social, e.nome_fantasia].concat(Array.isArray(e.sinonimos) ? e.sinonimos : []);
      grafias.forEach(g => {
        const k = chaveNormalizada(g);
        if (!k) return;
        if (mapa.has(k) && mapa.get(k) !== canonico) { ambiguas[papel].add(k); return; }
        mapa.set(k, canonico);
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
  };
}

// Valor canônico pra um campo do processo, ou o próprio valor se não
// reconhecer. Campo = nome do campo do processo (armador, agente, ...).
function normalizarValorCampo(campo, valor, indice) {
  if (valor == null) return valor;
  const texto = String(valor);
  if (!texto.trim() || !indice) return valor;
  const k = chaveNormalizada(texto);
  if (!k) return valor;
  if (campo === 'porto_origem' || campo === 'porto_destino') {
    const cod = indice[campo] && indice[campo].get(k);
    return cod || valor;
  }
  const papeis = CAMPOS_PROCESSO_PAPEL[campo];
  if (!papeis) return valor;
  for (const papel of papeis) {
    const mapa = indice.porPapel[papel];
    if (mapa && mapa.has(k)) return mapa.get(k);
  }
  return valor;
}

// Aplica em todos os campos conhecidos do payload (só nos que vieram no
// payload — o save é parcial). Devolve a lista do que mudou, pro log.
function normalizarProcesso(processo, indice) {
  const mudancas = [];
  if (!processo || !indice) return mudancas;
  Object.keys(CAMPOS_PROCESSO_PAPEL).concat(['porto_origem']).forEach(campo => {
    if (!(campo in processo)) return;
    const antes = processo[campo];
    const depois = normalizarValorCampo(campo, antes, indice);
    if (depois !== antes) {
      processo[campo] = depois;
      mudancas.push({ campo, antes, depois });
    }
  });
  return mudancas;
}

module.exports = {
  CAMPOS_PROCESSO_PAPEL, PAPEIS_NOME_CURTO,
  chaveNormalizada, montarIndice, normalizarValorCampo, normalizarProcesso, nomeCanonico, papeisDaEmpresa,
};
