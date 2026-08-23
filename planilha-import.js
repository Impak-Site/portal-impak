function validarBufferPlanilha(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Arquivo invalido');
    if (buffer.length === 0) throw new Error('Arquivo vazio');
    const MAX_SIZE = 20 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) throw new Error('Arquivo excede o tamanho maximo permitido (20MB)');
    const sig = buffer.slice(0, 4);
    const isZip = sig[0] === 0x50 && sig[1] === 0x4B && (sig[2] === 0x03 || sig[2] === 0x05 || sig[2] === 0x07);
    if (!isZip) throw new Error('Formato de arquivo nao reconhecido (esperado .xlsx/.xlsm)');
}

// IMPORTACAO DE PLANILHA BASE (.xlsm) PRO CALCULADOR
//
// Le o template interno de planilha usado antes de existir o Calculador
// (abas DADOS + MIX - COMPLETO) e devolve os campos ja no formato que o
// wizard do Calculador espera, pra pre-preencher o formulario. O usuario
// sempre revisa os valores antes de calcular - isso aqui e um atalho, nao
// um substituto pra conferencia humana.
//
// As 3 planilhas de exemplo usadas pra validar esse parser (BASE SP/SC,
// TKH2512-UNICAP, SANTA HELENA) tem sempre as mesmas abas e o mesmo layout
// de celulas na aba DADOS - se algum dia o template mudar de layout, os
// valores aqui abaixo (ex: 'E6' pro FOB) precisam ser ajustados.
const XLSX = require('xlsx');

function cellVal(ws, addr) {
    const c = ws[addr];
    return c ? c.v : undefined;
}

function norm(v) {
    return (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
}

function ehSim(v) {
    return norm(v) === 'SIM';
}

// Mapeia o texto livre da planilha (ex: "CAMINHAO") pro value fixo do
// <select id="produto"> do Calculador (TBR/PCR/AGR/OTR).
function mapearProduto(v) {
    const s = norm(v);
    if (s.indexOf('CAMINH') >= 0) return 'TBR';
    if (s.indexOf('AUTOM') >= 0 || s.indexOf('CARRO') >= 0) return 'PCR';
    if (s.indexOf('AGR') >= 0) return 'AGR';
    return 'OTR';
}

const ORIGENS_VALIDAS = ['DIVERSOS', 'CHINA', 'VIETNAM', 'INDIA'];
function mapearOrigem(v) {
    const s = norm(v);
    return ORIGENS_VALIDAS.indexOf(s) >= 0 ? s : 'DIVERSOS';
}

const TIPOS_IMPORTACAO_VALIDOS = ['ENCOMENDA', 'PROPRIA', 'IMPLEMENTOS', 'TRANSPORTADORA'];
function mapearTipoImportacao(v) {
    const s = norm(v);
    return TIPOS_IMPORTACAO_VALIDOS.indexOf(s) >= 0 ? s : 'ENCOMENDA';
}

function parseDados(wb) {
    const ws = wb.Sheets['DADOS'];
    if (!ws) throw new Error('Aba "DADOS" nao encontrada na planilha.');

  // FIX: o local da Comissao China (Dentro/Fora) esta na coluna F da linha 17
  // (DADOS!F17 - confirmado pela formula MODELO!L8 = DADOS!F17), nao H17.
  // H17 esta sempre vazio, entao o codigo antigo sempre caia no fallback
  // 'FORA' - por coincidencia batia certo nas planilhas de teste (todas
  // FORA), mas quebraria silenciosamente numa planilha com Comissao China
  // "Dentro" (aplicaria FORA em vez de DENTRO, zerando o % errado).
  const comissaoChinaLocal = norm(cellVal(ws, 'F17'));
  const chinaLocalFinal = (comissaoChinaLocal === 'DENTRO' || comissaoChinaLocal === 'FORA') ? comissaoChinaLocal : 'FORA';
  const comissaoChinaAtiva = ehSim(cellVal(ws, 'E17'));
  // A Comissao China nao tem % livre na planilha (diferente da Comissao BR,
  // que tem o % em F16) - o modelo usa uma formula fixa
  // (MODELO!K32 = IF(AND(K8="SIM",L8="Dentro"),3%,"")), ou seja: 3% quando
  // "Dentro" e 0% (nao se aplica) quando "Fora". Replicamos essa regra fixa
  // aqui pra pre-preencher o campo china_pct do Calculador corretamente.
  const comissaoChinaPct = comissaoChinaAtiva && chinaLocalFinal === 'DENTRO' ? 3 : 0;

  return {
        cambio_usd: Number(cellVal(ws, 'E5')) || Number(cellVal(ws, 'E3')) || null,
        fob_usd: Number(cellVal(ws, 'E6')) || 0,
        frete_usd: Number(cellVal(ws, 'E8')) || 0,
        taxa_ce_usd: Number(cellVal(ws, 'E7')) || 0,
        qtde_containers: Number(cellVal(ws, 'E9')) || 1,
        produto: mapearProduto(cellVal(ws, 'E11')),
        origem: mapearOrigem(cellVal(ws, 'E12')),
        // UF de destino (DADOS!E13) - usada pela aliquota de ICMS-ST, que
        // varia por estado (ver MODELO!K4 = DADOS!E13 e as formulas de
        // ICMS-ST que comparam K4 contra "SC"/"RS"/"MG" etc). Nao era
        // importada antes - o wizard ficava sem UF, obrigando preenchimento
        // manual mesmo quando a planilha ja tinha a resposta.
        uf_destino: cellVal(ws, 'E13') ? norm(cellVal(ws, 'E13')) : '',
        tipo_importacao: mapearTipoImportacao(cellVal(ws, 'E14')),
        tem_icms_st: ehSim(cellVal(ws, 'E15')),
        comissao_br: ehSim(cellVal(ws, 'E16')),
        comissao_br_pct: Number(cellVal(ws, 'F16')) || null,
        comissao_china: comissaoChinaAtiva,
        comissao_china_local: chinaLocalFinal,
        comissao_china_pct: comissaoChinaPct,
        cliente: cellVal(ws, 'E18') ? String(cellVal(ws, 'E18')).trim() : '',
        custos_diversos: Number(cellVal(ws, 'E36')) || 0,
        avisos: ['Confira: parcelamento, cartao, prazo/juros e dumping nao sao importados automaticamente - revise essas secoes manualmente.'],
  };
}

function parseMix(wb) {
    const ws = wb.Sheets['MIX - COMPLETO'];
    if (!ws) throw new Error('Aba "MIX - COMPLETO" nao encontrada na planilha.');
    const range = XLSX.utils.decode_range(ws['!ref']);

  const headerRows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
          if (cellVal(ws, XLSX.utils.encode_cell({ r: r, c: 9 })) === 'Pedido') headerRows.push(r);
    }
    if (!headerRows.length) throw new Error('Nao encontrei a tabela de produtos (cabecalho "Pedido") na aba MIX - COMPLETO.');
    const inicio = headerRows[0] + 1;
    const fim = headerRows.length > 1 ? headerRows[1] - 1 : range.e.r;

  const itens = [];
    for (let r = inicio; r <= fim; r++) {
          const size = cellVal(ws, XLSX.utils.encode_cell({ r: r, c: 4 }));
          const pattern = cellVal(ws, XLSX.utils.encode_cell({ r: r, c: 7 }));
          const pedido = cellVal(ws, XLSX.utils.encode_cell({ r: r, c: 9 }));
          const fobUnit = cellVal(ws, XLSX.utils.encode_cell({ r: r, c: 13 }));
          if (pedido && Number(pedido) > 0 && size) {
                  itens.push({
                            medida: String(size).trim(),
                            pat: pattern ? String(pattern).trim() : null,
                            qtd: Number(pedido),
                            preco: Number(fobUnit) || 0,
                  });
          }
    }
    return itens;
}

function importarPlanilhaBase(buffer) {
    validarBufferPlanilha(buffer);
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const campos = parseDados(wb);
    const mix = parseMix(wb);
    return { campos: campos, mix: mix };
}

function isoDate(v) {
    if (v instanceof Date && !isNaN(v)) {
          const y = v.getUTCFullYear();
          const m = String(v.getUTCMonth() + 1).padStart(2, '0');
          const d = String(v.getUTCDate()).padStart(2, '0');
          return y + '-' + m + '-' + d;
    }
    return null;
}
function numVal(v) {
    const n = Number(v);
    return (isNaN(n) || v === '' || v === undefined) ? 0 : n;
}

function parseFechamento(wb) {
    const ws = wb.Sheets['Fechamento'];
    if (!ws) throw new Error('Aba "Fechamento" nao encontrada na planilha.');

  const avisos = [];

  const dataRegistroDi = isoDate(cellVal(ws, 'I4'));
    const dataEmbarque = isoDate(cellVal(ws, 'F61'));
    const dataChegada = isoDate(cellVal(ws, 'F62'));
    const dataPedido = isoDate(cellVal(ws, 'F60'));

  const datas = {};
    if (dataEmbarque) datas.data_embarque = dataEmbarque;
    if (dataChegada) datas.data_chegada = dataChegada;
    if (dataRegistroDi) datas.data_registro_di = dataRegistroDi;
    if (dataPedido) avisos.push('Data do Pedido na planilha: ' + dataPedido + ' (sem campo correspondente no Controle - confira manualmente).');

  const fobPago = numVal(cellVal(ws, 'G17')) + numVal(cellVal(ws, 'G18')) + numVal(cellVal(ws, 'G19')) + numVal(cellVal(ws, 'G20'));

  const seguroBrl = numVal(cellVal(ws, 'G39'));

  const real_json = {};
    const moedas = {};
    if (fobPago > 0) { real_json.fob = fobPago; moedas.fob = 'BRL'; }
    if (seguroBrl > 0) { real_json.seguro = seguroBrl; moedas.seguro = 'BRL'; }
    const lavacao = numVal(cellVal(ws, 'G34')); if (lavacao > 0) real_json.lavacao = lavacao;
    const comissaoChina = numVal(cellVal(ws, 'G36')); if (comissaoChina > 0) real_json.comissao_china = comissaoChina;

  const adiantamentoPorto = numVal(cellVal(ws, 'G22')); if (adiantamentoPorto > 0) real_json.adiantamento_porto = adiantamentoPorto;
    const agenteFrete = numVal(cellVal(ws, 'G23')); if (agenteFrete > 0) real_json.agente_frete = agenteFrete;
    const diferencaPis = numVal(cellVal(ws, 'G24')); if (diferencaPis > 0) real_json.diferenca_pis = diferencaPis;
    const diferencaCofins = numVal(cellVal(ws, 'G25')); if (diferencaCofins > 0) real_json.diferenca_cofins = diferencaCofins;
    const marjoracao = numVal(cellVal(ws, 'G26')); if (marjoracao > 0) real_json.marjoracao = marjoracao;
    const diferencaIpi = numVal(cellVal(ws, 'G27')); if (diferencaIpi > 0) real_json.diferenca_ipi = diferencaIpi;
    const diferencaIcmsProprio = numVal(cellVal(ws, 'G28')); if (diferencaIcmsProprio > 0) real_json.diferenca_icms_proprio = diferencaIcmsProprio;
    const icmsSt = numVal(cellVal(ws, 'G29')); if (icmsSt > 0) real_json.icms_st = icmsSt;
    const comissaoVendedor = numVal(cellVal(ws, 'G32')); if (comissaoVendedor > 0) real_json.comissao_vendedor = comissaoVendedor;
    const reciclagem = numVal(cellVal(ws, 'G33')); if (reciclagem > 0) real_json.reciclagem = reciclagem;
    const despesasBaixaPatioVenda = numVal(cellVal(ws, 'G35')); if (despesasBaixaPatioVenda > 0) real_json.despesas_baixa_patio_venda = despesasBaixaPatioVenda;
    const timp = numVal(cellVal(ws, 'G37')); if (timp > 0) real_json.timp = timp;
    const trademaster = numVal(cellVal(ws, 'G38')); if (trademaster > 0) real_json.trademaster = trademaster;

  const ibs = numVal(cellVal(ws, 'G30')); if (ibs > 0) real_json.diferenca_ibs = ibs;
    const cbs = numVal(cellVal(ws, 'G31')); if (cbs > 0) real_json.diferenca_cbs = cbs;

  return { datas: datas, real_json: real_json, moedas: moedas, avisos: avisos };
}

function importarFechamentoBase(buffer) {
    validarBufferPlanilha(buffer);
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    return parseFechamento(wb);
}

module.exports = { importarPlanilhaBase: importarPlanilhaBase, importarFechamentoBase: importarFechamentoBase };
