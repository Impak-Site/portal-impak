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

  // Marcas de pneu (cadastros fase 2a, 01/10/2026): o campo Marca (brand)
  // do processo tinha 36 grafias e nenhuma entidade por trás. Código = nome
  // canônico em maiúsculas (ex.: ROADCRUZA), sinônimos = outras grafias;
  // "fornecedor" é informativo (quem costuma vender a marca). Começa vazia:
  // é preenchida pela aba Listas / de-para aprovado, não por semente.
  const MARCAS = [];

  // Armazenagem pós-nacionalização no armazém geral (RF) — pedido do Ayslan
  // (13/10/2026): container nacionalizado vai pro armazém pra venda
  // fracionada; a RF cobra por pneu por dia, por tipo, depois da carência.
  // Regra e valores vêm da planilha Modelo Rev97 (MIX - COMPLETO, CJ2):
  // tarifa R$/pneu/dia e 29 dias de carência contados da entrada no armazém.
  const ARMAZENAGEM_RF = [
    { codigo: 'PCR',    nome: 'PCR (passeio)',       dados: { tarifa_dia: 0.045, carencia_dias: 29 }, ordem: 1 },
    { codigo: 'SUV',    nome: 'SUV / LT',            dados: { tarifa_dia: 0.18,  carencia_dias: 29 }, ordem: 2 },
    { codigo: 'TBR',    nome: 'TBR (caminhão/ônibus)', dados: { tarifa_dia: 0.40, carencia_dias: 29 }, ordem: 3 },
    { codigo: 'RODAS',  nome: 'Rodas',               dados: { tarifa_dia: 0.40,  carencia_dias: 29 }, ordem: 4 },
    { codigo: 'METAIS', nome: 'Metais',              dados: { tarifa_dia: 1.65,  carencia_dias: 29 }, ordem: 5 },
  ];

  // ── Agenda (#675) — padrão da Matriz de Atividades v2 (13/10/2026). ─────
  // Funções → logins. Ajuste fino em /cadastros → Listas → "Agenda — Funções".
  const AGENDA_FUNCOES = [
    { codigo: 'IMPORTACAO',     nome: 'Importação',     dados: { usuarios: 'emanuelly, isabella' }, ordem: 1 },
    { codigo: 'LOGISTICA',      nome: 'Logística',      dados: { usuarios: 'emanuelly, isabella, operacional01@impak.com.br' }, ordem: 2 },
    { codigo: 'FINANCEIRO',     nome: 'Financeiro',     dados: { usuarios: 'paula, bianca' }, ordem: 3 },
    { codigo: 'FISCAL',         nome: 'Fiscal',         dados: { usuarios: 'italo, maria, nfe@impak.com.br' }, ordem: 4 },
    { codigo: 'COMERCIAL',      nome: 'Comercial',      dados: { usuarios: 'jean, franciele' }, ordem: 5 },
    { codigo: 'DESPACHANTE',    nome: 'Despachante',    dados: { usuarios: 'amanda' }, ordem: 6 },
    { codigo: 'ADMINISTRATIVO', nome: 'Administrativo', dados: { usuarios: 'everton' }, ordem: 7 },
    { codigo: 'GERENCIA',       nome: 'Gerência',       dados: { usuarios: 'narcelio' }, ordem: 8 },
  ];
  // Atividades: código → nome/etapa/função/prioridade padrão. O "como"
  // (gatilho, prazo, conclusão automática) está em agenda-core.js pelo código.
  const _a = (codigo, etapa, nome, funcao, prioridade, ordem) => ({ codigo, nome, dados: { etapa, funcao, prioridade }, ordem });
  const _af = (codigo, etapa, nome, funcao, prioridade, ordem, obs) => {
    const x = _a(codigo, etapa, nome, funcao, prioridade, ordem);
    x.dados.observacao = obs || 'Prazo em dias em relação ao vencimento da fatura (negativo = antes do vencimento).';
    return x;
  };
  const AGENDA_ATIVIDADES = [
    _a('A01','PI Recebida','Cadastrar o processo no Controle (finalidade, cliente, produtos, forma de pagamento)','IMPORTACAO','ALTA',1),
    _a('A02','PI Recebida','Conferir PI x cotação aprovada (preço, quantidade, incoterm, prazo)','COMERCIAL','MEDIA',2),
    _a('A03','PI Recebida','Cadastrar o processo no Conexos e informar o ID','IMPORTACAO','MEDIA',3),
    _a('A04','PI Recebida','Cadastrar as vendas do processo (clientes, itens e quantidades)','COMERCIAL','ALTA',4),
    _a('A05','PI Recebida','Receber do cliente o valor do câmbio antes de fechá-lo','FINANCEIRO','ALTA',5),
    _a('A06','PI Recebida','Fechar o câmbio da entrada (parcela Inicial) e anexar o comprovante','FINANCEIRO','ALTA',6),
    _a('A07','Ag. Embarque','Acompanhar a prontidão da carga na fábrica','IMPORTACAO','MEDIA',7),
    _a('A08','Ag. Embarque','Confirmar booking (Nº booking, navio, ETD)','IMPORTACAO','ALTA',8),
    _a('A09','Ag. Embarque','Receber e conferir CI / PL / Draft do BL','IMPORTACAO','ALTA',9),
    _a('A10','Ag. Embarque','Aprovar o draft do HBL com o agente de carga','IMPORTACAO','ALTA',10),
    _a('A11','Ag. Embarque','Enviar HBL e CI à despachante para solicitar a LI','IMPORTACAO','MEDIA',11),
    _a('A12','Ag. Embarque','Solicitar a LI','DESPACHANTE','ALTA',12),
    _a('A13','Ag. Embarque','Fechar o câmbio da parcela Pré-embarque e anexar o comprovante','FINANCEIRO','ALTA',13),
    _a('A14','Embarcado','Registrar embarque efetivo, HBL/MBL e free time','IMPORTACAO','ALTA',14),
    _a('A15','Embarcado','Fechar o câmbio do saldo e anexar o comprovante','FINANCEIRO','ALTA',15),
    _a('A16','Embarcado','Câmbio futuro: conferir taxa e nº da mensagem SWIFT','FINANCEIRO','MEDIA',16),
    _a('A17','Embarcado','Conferir o CE Mercante (frete e taxas BL x CE)','IMPORTACAO','MEDIA',17),
    _a('A18','Desembarcado','Confirmar a chegada e a presença de carga','IMPORTACAO','ALTA',18),
    _a('A19','Desembarcado','Informar o armazém e acompanhar a armazenagem (LCL)','LOGISTICA','MEDIA',19),
    _a('A20','Registro DI/DUIMP','Registrar a DUIMP','DESPACHANTE','ALTA',20),
    _a('A21','Registro DI/DUIMP','Pagar os impostos da DUIMP','FINANCEIRO','ALTA',21),
    _a('A22','Registro DI/DUIMP','Informar Nº DUIMP nas parcelas de pagamento antecipado','FINANCEIRO','MEDIA',22),
    _a('A23','Parametrização','Acompanhar canal e liberação da carga','DESPACHANTE','MEDIA',23),
    _a('A24','Faturamento','Emitir a NF de entrada','FISCAL','ALTA',24),
    _a('A25','Faturamento','Emitir a(s) NF(s) de saída conforme as vendas','FISCAL','ALTA',25),
    _a('A26','Faturamento','Receber do cliente (venda a prazo / parcelada)','FINANCEIRO','MEDIA',26),
    // Faturas fase 2 (21/10/2026): uma tarefa por fatura do processo, pela
    // etapa dela (aba Faturas). Prazo em dias em relação ao VENCIMENTO.
    _af('A37','Faturas','Conferir a fatura do fornecedor com os Custos Reais','IMPORTACAO','ALTA',26.1),
    _af('A38','Faturas','Resolver as diferenças da conferência (aceitar ou contestar com o fornecedor)','IMPORTACAO','ALTA',26.2),
    _af('A39','Faturas','Aprovar o pagamento da fatura','GERENCIA','ALTA',26.3),
    _af('A40','Faturas','Pagar a fatura (dar a baixa)','FINANCEIRO','ALTA',26.4),
    _af('A41','Faturas','Acertar o numerário do despachante (abater no acerto ou pedir a devolução)','FINANCEIRO','MEDIA',26.5,
      'Prazo em dias em relação ao vencimento do acerto (ou ao pagamento dele, quando sobra numerário).'),
    _af('A42','Faturas','Receber a fatura (adiantamento de câmbio, operadora do cartão, devolução)','FINANCEIRO','MEDIA',26.6),
    _a('A27','Carregamento','Agendar a retirada (transportadora, placa, horário)','LOGISTICA','ALTA',27),
    _a('A28','Carregamento','Confirmar o carregamento','LOGISTICA','ALTA',28),
    _a('A29','Dev. Vazio','Devolver o container vazio dentro do free time','LOGISTICA','ALTA',29),
    _a('A30','Dev. Vazio','Resolver o RIC (isenção, termo ou lavagem)','LOGISTICA','MEDIA',30),
    _a('A31','Finalizado','Lançar os custos reais do processo','FINANCEIRO','MEDIA',31),
    _a('A32','Finalizado','Conferir o Fechamento / DRE e fechar o processo','GERENCIA','MEDIA',32),
    _a('A36','Dev. Vazio','Validar o processo e liberar para Finalizado','IMPORTACAO','ALTA',32.5),
    _a('A33','Mensal','Exportar e enviar a Pendências de DI ao banco','FINANCEIRO','MEDIA',33),
    _a('A34','Mensal','Enviar a planilha de averbação de seguro','ADMINISTRATIVO','MEDIA',34),
    _a('A35','Trimestral','Enviar a relação de reciclagem aos clientes','ADMINISTRATIVO','BAIXA',35),
    // Dados para conferir (verificação diária, 22/10/2026 — verificacao-dados.js)
    _a('D01','Dados','Conferir HBL e MBL (estão iguais)','IMPORTACAO','BAIXA',40.1),
    _a('D02','Dados','Conferir CE Master e CE House (estão iguais)','IMPORTACAO','BAIXA',40.2),
    _a('D03','Dados','Ler a DUIMP para preencher a taxa do dólar e o total da DI','IMPORTACAO','BAIXA',40.3),
    _a('D04','Dados','Lançar o custo da mercadoria do processo finalizado','FINANCEIRO','MEDIA',40.4),
    _a('D05','Dados','Conferir o valor da CI × PI (diferença acima de 5%)','IMPORTACAO','MEDIA',40.5),
  ];

  const CATEGORIAS = {
    porto_destino: { nome: 'Portos de destino', campos: [['dias_gratis', 'Dias grátis (armazenagem)', 'number']] },
    porto_origem:  { nome: 'Portos de origem',  campos: [['pais', 'País', 'text']] },
    banco_cambio:  { nome: 'Bancos de câmbio',  campos: [['codigo_banco', 'Cód. banco', 'text'], ['agencia', 'Agência', 'text'], ['conta', 'Conta', 'text'], ['pix', 'PIX', 'text']] },
    marca:         { nome: 'Marcas (pneus)',    campos: [['fornecedor', 'Fornecedor(es) habituais', 'text']] },
    // Comissionados (vendedores/representantes, #517 — 13/10/2026). USO INTERNO:
    // nomes e percentuais ficam só no banco (aba Listas) — nunca neste arquivo,
    // o repositório é público. base: FATURAMENTO_TOTAL | NOTA_FISCAL | FOB_DOLAR
    // | LUCRO_BRUTO. clientes: restrição opcional (vírgula). automatico: S = vale
    // sozinho sempre que o cliente bate (ex.: representante de um cliente).
    comissionado:  { nome: 'Comissionados (interno)', campos: [['percentual', '% comissão', 'number'], ['base', 'Base de cálculo', 'select', [['FATURAMENTO_TOTAL','Total faturamento (NF + juros + Boss + chinês)'],['NOTA_FISCAL','Nota fiscal'],['FOB_DOLAR','FOB × dólar médio'],['LUCRO_BRUTO','Lucro bruto da operação']]], ['clientes', 'Só para os clientes (vírgula; vazio = todos)', 'text'], ['automatico', 'Automático pelo cliente? (S/N)', 'select', [['N','Não — marcar no processo'],['S','Sim — sempre que o cliente bater']]], ['observacao', 'Observação', 'text']] },
    armazenagem_rf: { nome: 'Armazenagem pós-nacionalização (RF)', campos: [['tarifa_dia', 'Tarifa (R$ por pneu/dia)', 'number'], ['carencia_dias', 'Carência (dias grátis)', 'number']] },
    // Agenda de atividades por etapa (#675 — 13/10/2026). Quem é responsável
    // por cada função e quais atividades valem: editável aqui, sem deploy.
    // A lógica (quando nasce / quando se conclui sozinha) fica em agenda-core.js.
    agenda_funcao: { nome: 'Agenda — Funções e responsáveis', campos: [['usuarios', 'Logins responsáveis (vírgula)', 'text'], ['substitutos', 'Substitutos nas férias (logins, vírgula)', 'text'], ['observacao', 'Observação', 'text']] },
    // Aprovação por etapa (14/10/2026, pedido Emanuelly/Ayslan): o processo só
    // vai pra FINALIZADO depois que uma pessoa específica valida que o
    // processo inteiro foi revisto. Logins em `usuarios` (ou `substitutos`)
    // veem o botão "Validar e finalizar". Desative a linha pra tirar a trava.
    // Meta de lucro por cliente (Rev97 DADOS!N33 — 14/10/2026). O Calculador
    // usa como Lucro Alvo % ao escolher o cliente e avisa quando o resultado
    // fica abaixo. `clientes` vazio = padrão para quem não tem linha própria.
    // Os % por cliente ficam só no banco (repositório público); aqui só o padrão.
    // `produtos` (15/10/2026, Jean): mesmo cliente pode ter % diferente por
    // produto (ex.: TBR 5%, PCR 4%). Vazio = vale pra todos os produtos.
    meta_lucro:    { nome: 'Meta de lucro por cliente (%)', campos: [['percentual', '% de lucro alvo', 'number'], ['clientes', 'Clientes (vírgula; vazio = padrão)', 'text'], ['produtos', 'Produtos (vírgula, ex.: TBR, PCR; vazio = todos)', 'text'], ['observacao', 'Observação', 'text']] },
    aprovacao_etapa: { nome: 'Aprovação por etapa (vistos)', campos: [['usuarios', 'Quem valida (logins, vírgula)', 'text'], ['substitutos', 'Substitutos (logins, vírgula)', 'text'], ['observacao', 'Observação', 'text']] },
    agenda_atividade: { nome: 'Agenda — Atividades', campos: [['funcao', 'Responsável (função)', 'select', AGENDA_FUNCOES.map(f => [f.codigo, f.nome])], ['prazo_dias', 'Prazo (dias em relação ao marco; vazio = padrão)', 'number'], ['prioridade', 'Prioridade', 'select', [['ALTA','Alta'],['MEDIA','Média'],['BAIXA','Baixa']]], ['etapa', 'Etapa', 'text'], ['observacao', 'Observação', 'text']] },
  };

  function clonar(lista) {
    return lista.map(x => ({
      codigo: x.codigo, nome: x.nome, ordem: x.ordem || 0, ativo: true,
      dados: Object.assign({}, x.dados || {}),
      sinonimos: (x.sinonimos || []).slice(),
    }));
  }

  const APROVACAO_ETAPA = [
    { codigo: 'FINALIZADO', nome: 'Finalização do processo', dados: { usuarios: 'emanuelly', substitutos: 'paula', observacao: 'Último check antes de Finalizado (pedido Emanuelly 14/10/2026)' }, ordem: 1 },
  ];

  const META_LUCRO = [
    { codigo: 'PADRAO', nome: 'Padrão (clientes novos)', dados: { percentual: 2, clientes: '', observacao: 'Vale para cliente sem linha própria' }, ordem: 99 },
  ];

  // Objeto completo no formato que GET /api/listas devolve.
  function listasPadrao() {
    return {
      porto_destino: clonar(PORTOS_DESTINO),
      porto_origem: clonar(PORTOS_ORIGEM),
      banco_cambio: clonar(BANCOS_CAMBIO),
      marca: clonar(MARCAS),
      armazenagem_rf: clonar(ARMAZENAGEM_RF),
      comissionado: [], // só no banco (dados sensíveis, repositório público)
      agenda_funcao: clonar(AGENDA_FUNCOES),
      agenda_atividade: clonar(AGENDA_ATIVIDADES),
      aprovacao_etapa: clonar(APROVACAO_ETAPA),
      meta_lucro: clonar(META_LUCRO),
    };
  }

  const ListasPadrao = { CATEGORIAS, listasPadrao };
  if (typeof module !== 'undefined' && module.exports) module.exports = ListasPadrao;
  if (typeof window !== 'undefined') window.ListasPadrao = ListasPadrao;
})();
