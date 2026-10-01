// listas-padrao.js
//
// Listas/parâmetros padrão do sistema — portos de destino (com dias grátis
// de armazenagem), portos de origem (com país) e bancos de câmbio.
//
// Desde 01/10/2026 a fonte da verdade dessas listas é a tabela
// cadastros_listas (editável em /cadastros → aba Listas, sem deploy — ver
// migration 0040). Este arquivo é o FALLBACK: é o que o servidor devolve em
// GET /api/listas quando a tabela ainda não existe/está vazia, e é o que o
// navegador usa até a resposta da API chegar (ou se ela falhar). Também é a
// semente usada pela migration 0040 — mantenha os dois iguais.
//
// Mesmo padrão UMD do taxas-catalogo.js: um arquivo só, carregado pelo
// navegador via <script src="/listas-padrao.js"> e pelo servidor via
// require('./listas-padrao.js').
(function () {
  const PORTOS_DESTINO = [
    { codigo: 'ITJ',   nome: 'Itajaí',     dados: { dias_gratis: 5 }, sinonimos: ['ITAJAI', 'ITAJAÍ', 'PORTO DE ITAJAI'], ordem: 1 },
    { codigo: 'IOA',   nome: 'Itapoá',     dados: { dias_gratis: 4 }, sinonimos: ['ITAPOA', 'ITAPOÁ', 'PORTO ITAPOA'], ordem: 2 },
    { codigo: 'NVT',   nome: 'Navegantes', dados: { dias_gratis: 5 }, sinonimos: ['NAVEGANTES', 'PORTONAVE'], ordem: 3 },
    // Porto de Imbituba (SC) — pedido Emanuelly (14/09/2026). BRIBB é o
    // UN/LOCODE oficial usado no CE Mercante/Siscomex Carga. Dias grátis
    // provisórios (5, igual Navegantes) até confirmar com o terminal.
    { codigo: 'BRIBB', nome: 'Imbituba',   dados: { dias_gratis: 5 }, sinonimos: ['IMBITUBA', 'PORTO DE IMBITUBA'], ordem: 4 },
  ];

  // Principais polos de fabricação de pneus na Ásia. Sinônimos = grafias que
  // aparecem nos processos hoje (relatório de-para 01/10/2026).
  const PORTOS_ORIGEM = [
    { codigo: 'SHANGHAI',      nome: 'Shanghai',      dados: { pais: 'China' }, ordem: 1 },
    { codigo: 'NINGBO',        nome: 'Ningbo',        dados: { pais: 'China' }, ordem: 2 },
    { codigo: 'QINGDAO',       nome: 'Qingdao',       dados: { pais: 'China' }, sinonimos: ['QINGDAO, CHINA', 'QINGDAO CHINA'], ordem: 3 },
    { codigo: 'TIANJIN',       nome: 'Tianjin',       dados: { pais: 'China' }, ordem: 4 },
    { codigo: 'XIAMEN',        nome: 'Xiamen',        dados: { pais: 'China' }, ordem: 5 },
    { codigo: 'SHENZHEN',      nome: 'Shenzhen',      dados: { pais: 'China' }, ordem: 6 },
    { codigo: 'GUANGZHOU',     nome: 'Guangzhou',     dados: { pais: 'China' }, ordem: 7 },
    { codigo: 'NANSHA',        nome: 'Nansha',        dados: { pais: 'China' }, ordem: 8 },
    { codigo: 'YANTIAN',       nome: 'Yantian',       dados: { pais: 'China' }, ordem: 9 },
    { codigo: 'DALIAN',        nome: 'Dalian',        dados: { pais: 'China' }, ordem: 10 },
    { codigo: 'LIANYUNGANG',   nome: 'Lianyungang',   dados: { pais: 'China' }, ordem: 11 },
    { codigo: 'ZHANGJIAGANG',  nome: 'Zhangjiagang',  dados: { pais: 'China' }, ordem: 12 },
    { codigo: 'HO CHI MINH',   nome: 'Ho Chi Minh',   dados: { pais: 'Vietnã' }, sinonimos: ['HO CHI MINH PORT, VIETNAM', 'HO CHI MINH CITY PORT, VIETNAM', 'HOCHIMINH, VIETNAM', 'HO CHI MINH, VIETNAM', 'HO CHI MINH - VIETNAM', 'HO CHI MINH CITY', 'HOCHIMINH', 'HCMC'], ordem: 20 },
    { codigo: 'HAI PHONG',     nome: 'Hai Phong',     dados: { pais: 'Vietnã' }, ordem: 21 },
    { codigo: 'VUNG TAU',      nome: 'Vung Tau',      dados: { pais: 'Vietnã' }, sinonimos: ['VUNG TAU PORT, VIETNAM', 'VUNG TAU, VIETNAM', 'VUNGTAU'], ordem: 22 },
    { codigo: 'SIHANOUKVILLE', nome: 'Sihanoukville', dados: { pais: 'Camboja' }, ordem: 30 },
    { codigo: 'PHNOM PENH',    nome: 'Phnom Penh',    dados: { pais: 'Camboja' }, ordem: 31 },
    { codigo: 'LAEM CHABANG',  nome: 'Laem Chabang',  dados: { pais: 'Tailândia' }, ordem: 40 },
    { codigo: 'BANGKOK',       nome: 'Bangkok',       dados: { pais: 'Tailândia' }, ordem: 41 },
    { codigo: 'JAKARTA',       nome: 'Jakarta',       dados: { pais: 'Indonésia' }, ordem: 50 },
    { codigo: 'SURABAYA',      nome: 'Surabaya',      dados: { pais: 'Indonésia' }, ordem: 51 },
    { codigo: 'SEMARANG',      nome: 'Semarang',      dados: { pais: 'Indonésia' }, sinonimos: ['SEMARANG PORT, INDONESIA', 'SEMARANG, INDONESIA'], ordem: 52 },
    { codigo: 'CHENNAI',       nome: 'Chennai',       dados: { pais: 'Índia' }, ordem: 60 },
    { codigo: 'NHAVA SHEVA',   nome: 'Nhava Sheva',   dados: { pais: 'Índia' }, ordem: 61 },
    { codigo: 'MUNDRA',        nome: 'Mundra',        dados: { pais: 'Índia' }, ordem: 62 },
    { codigo: 'BUSAN',         nome: 'Busan',         dados: { pais: 'Coreia do Sul' }, ordem: 70 },
    { codigo: 'PORT KLANG',    nome: 'Port Klang',    dados: { pais: 'Malásia' }, ordem: 80 },
  ];

  // Contas da própria Impak usadas pra fechar câmbio (pedido Ayslan,
  // 17/09/2026). Agência/conta/PIX ficam só no banco de dados (aba Listas),
  // não aqui — o repositório é público.
  const BANCOS_CAMBIO = [
    { codigo: 'ITAU',      nome: 'Itaú',      dados: { codigo_banco: '341' }, ordem: 1 },
    { codigo: 'SANTANDER', nome: 'Santander', dados: { codigo_banco: '033' }, ordem: 2 },
  ];

  const CATEGORIAS = {
    porto_destino: { nome: 'Portos de destino', campos: [['dias_gratis', 'Dias grátis (armazenagem)', 'number']] },
    porto_origem:  { nome: 'Portos de origem',  campos: [['pais', 'País', 'text']] },
    banco_cambio:  { nome: 'Bancos de câmbio',  campos: [['codigo_banco', 'Cód. banco', 'text'], ['agencia', 'Agência', 'text'], ['conta', 'Conta', 'text'], ['pix', 'PIX', 'text']] },
  };

  function clonar(lista) {
    return lista.map(x => ({
      codigo: x.codigo, nome: x.nome, ordem: x.ordem || 0, ativo: true,
      dados: Object.assign({}, x.dados || {}),
      sinonimos: (x.sinonimos || []).slice(),
    }));
  }

  // Objeto completo no formato que GET /api/listas devolve.
  function listasPadrao() {
    return {
      porto_destino: clonar(PORTOS_DESTINO),
      porto_origem: clonar(PORTOS_ORIGEM),
      banco_cambio: clonar(BANCOS_CAMBIO),
    };
  }

  const ListasPadrao = { CATEGORIAS, listasPadrao };
  if (typeof module !== 'undefined' && module.exports) module.exports = ListasPadrao;
  if (typeof window !== 'undefined') window.ListasPadrao = ListasPadrao;
})();
