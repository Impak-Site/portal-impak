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
        // NOTA: cambio_usd aqui e o cambio "medio ult. 2 dias" (DADOS!E5) -
        // e a base de calculo dos IMPOSTOS (II/IPI/PIS/COFINS/ICMS/IBS/CBS),
        // formula confirmada em MODELO!E10 = 'MIX - COMPLETO'!$S$48 = DADOS!E5.
        // NAO e o cambio do FOB nem do Frete/Seguro/Taxas de destino - a
        // planilha usa 3 cambios DIFERENTES (ver parseCambiosReais abaixo).
        // Mantido como cambio_medio_di explicito + cambio_usd por
        // compatibilidade (ambos preenchidos com o mesmo valor aqui;
        // importarPlanilhaBase() sobrescreve cambio_usd com o cambio
        // ponderado do FOB quando consegue le-lo do MODELO).
        cambio_usd: Number(cellVal(ws, 'E5')) || Number(cellVal(ws, 'E3')) || null,
        cambio_medio_di: Number(cellVal(ws, 'E5')) || Number(cellVal(ws, 'E3')) || null,
        fob_usd: Number(cellVal(ws, 'E6')) || 0,
        // FIX: FRETE (DADOS!E8) e digitado POR CONTAINER, nao total - formula
        // confirmada na planilha (MODELO!D5 = DADOS!E8*C2, onde C2 e a
        // quantidade de containers). Sem multiplicar, o CIF ficava sub-
        // avaliado em embarques com 2+ containers (confirmado: IPK-05-2026,
        // 2 containers, US$2.150 lido vs US$4.300 real - ~3% de erro no
        // Custo Total). Taxa C.E. e FOB NAO seguem essa regra (Taxa C.E. =
        // DADOS!E7 direto, sem multiplicar; FOB vem do total da aba MIX,
        // ja agregado) - confirmado tambem por formula, nao presumido.
        frete_usd: (Number(cellVal(ws, 'E8')) || 0) * (Number(cellVal(ws, 'E9')) || 1),
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

// Busca uma celula rotulada (ex: "VALOR TOTAL da NOTA") em qualquer lugar da
// planilha e retorna o primeiro valor numerico > 0 nas colunas seguintes da
// mesma linha. Usado pra achar totais sem depender de endereco fixo de
// celula, ja que o layout da planilha tem varios blocos de tabela
// sobrepostos na mesma aba (nem todo rotulo "Total"-like esta no mesmo lugar
// nas 2 planilhas usadas pra validar isso).
function buscarValorPorRotulo(ws, regexRotulo) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && typeof cell.v === 'string' && regexRotulo.test(cell.v)) {
                // Coleta todos os numeros na mesma linha, a direita do rotulo.
                // Prefere o primeiro valor "grande" (>=1000, tipico de total
                // em R\$) em vez do primeiro numero puro e simples - celulas
                // vizinhas costumam ter percentuais/indices pequenos (ex: uma
                // celula de "% Lucro Alvo" logo ao lado de "LUCRO BRUTO
                // IMPAK") que nao sao o total que queremos.
                const candidatos = [];
                for (let c2 = c; c2 <= Math.min(c + 10, range.e.c); c2++) {
                    const cell2 = ws[XLSX.utils.encode_cell({ r, c: c2 })];
                    if (cell2 && typeof cell2.v === 'number') candidatos.push(cell2.v);
                }
                const grande = candidatos.find(v => Math.abs(v) >= 1000);
                if (grande !== undefined) return grande;
                if (candidatos.length) return candidatos[0];
            }
        }
    }
    return null;
}

// Faturamento e Lucro Bruto REAIS (negociados/apurados), extraidos da aba
// "MODELO - COM S.T" (fallback SEM S.T):
//
// - faturamento_real: celula "VALOR TOTAL da NOTA" - o valor de venda
//   efetivamente faturado ao cliente (produtos + IPI + ICMS-ST, quando
//   houver). CUIDADO: existe uma OUTRA celula na mesma aba rotulada
//   "TOTAL - Faturamento" (bloco de custos, colunas B:F, nao tem relacao
//   com o faturamento de venda) - nao confundir as duas; a fonte de
//   verdade e "VALOR TOTAL da NOTA".
// - lucro_bruto_real: celula "LUCRO BRUTO IMPAK" - formula da propria
//   planilha (Faturamento - PIS - COFINS - IPI - ICMS(venda) - Custo Total
//   - Comissao - Comissao China), lida direto em vez de reimplementada
//   aqui (menos risco de divergir se a formula mudar de novo).
//
// Isso e diferente do Custo Total (que o Calculador SABE estimar, porque e
// uma conta de custos de importacao) - Faturamento/Lucro aqui NAO sao um
// "estimado" independente: sao os valores que foram de fato negociados/
// apurados pra esse processo, que o Calculador nao tem como recalcular
// sozinho (ele so sabe sugerir preco por margem-alvo %, nao tem os precos
// negociados por item). Por isso extraimos os valores reais da planilha em
// vez de tentar re-calcular.
function parseFaturamentoReal(wb) {
    const ws = wb.Sheets['MODELO - COM S.T'] || wb.Sheets['MODELO - SEM S.T'];
    if (!ws) return { faturamento_real: null, lucro_bruto_real: null };
    return {
        faturamento_real: buscarValorPorRotulo(ws, /VALOR TOTAL da NOTA/i),
        lucro_bruto_real: buscarValorPorRotulo(ws, /LUCRO BRUTO IMPAK/i),
    };
}

// A planilha legado usa 3 cambios DIFERENTES na mesma cotacao, nao um
// cambio unico (confirmado por rastreio de formula em MODELO - COM S.T):
//  - FOB: cambio PONDERADO pelas parcelas pagas (MODELO!E4 = F4/D4, onde
//    F4 = SOMA das parcelas convertidas cada uma pelo seu proprio cambio
//    de pagamento - MIX - COMPLETO!T44:T47). Varia por processo, as vezes
//    MAIOR e as vezes MENOR que o cambio de impostos.
//  - Impostos (II/IPI/PIS/COFINS/ICMS/IBS/CBS): cambio "medio ult. 2 dias"
//    (DADOS!E5), ja capturado em campos.cambio_medio_di.
//  - Frete/Seguro/Taxas de destino: cambio "de abertura do dia da chegada"
//    (MODELO!E5, um valor manual/literal na planilha - nao tem celula fonte
//    em DADOS). O Calculador aplica esse cambio como cambio_chegada * 1.02
//    (margem de 2% embutida na regra do sistema), entao gravamos aqui
//    cambio_chegada = MODELO!E5 / 1.02 pra reproduzir o mesmo valor final.
// Sem isso, o wizard aplicava o cambio de impostos (DADOS!E5) tambem no
// FOB e no Frete - e como o FOB e ~75-80% do Custo Total, um cambio errado
// ali sozinho ja gerava ~1.5-2% de diferenca no Custo Total estimado
// (confirmado no piloto UD26-001/UD26-023/UD26-051: erro caiu de ~1.5-2%
// para ~0.07-0.22% depois desse fix).
function parseCambiosReais(wb, temIcmsSt) {
    const sheetName = temIcmsSt ? 'MODELO - COM S.T' : 'MODELO - SEM S.T';
    const ws = wb.Sheets[sheetName];
    if (!ws) return { cambio_fob_ponderado: null, cambio_chegada: null };
    const e4 = cellVal(ws, 'E4');
    const e5 = cellVal(ws, 'E5');
    const cambioFobPonderado = Number(e4) || null;
    const cambioFreteOuChegada = Number(e5) || null;
    return {
        cambio_fob_ponderado: cambioFobPonderado,
        cambio_chegada: cambioFreteOuChegada ? cambioFreteOuChegada / 1.02 : null,
    };
}

// TOTAL TAXAS: soma, em BRL, de todas as taxas operacionais/destino da
// cotacao (Handling, TRS, TSC, Desconsolidacao, Agente de Carga, Armazenagem,
// Siscomex, AFRMM, Despachante, SDA etc.) - linha "TOTAL TAXAS" na aba MODELO,
// logo acima de "CUSTO TOTAL" (CUSTO TOTAL = TOTAL CIF + TOTAL IMPOSTOS +
// TOTAL TAXAS, confirmado por soma manual em varias planilhas).
//
// NAO tentamos mapear cada taxa individual (Handling/TRS/TSC/Drop
// Off/Desconsolidacao/etc) pros campos correspondentes do Calculador,
// porque o NOME dessas linhas varia livremente de planilha pra planilha -
// cada agente de carga/fornecedor usa nomenclatura propria (ex: "TRS/TSC/
// Desconsolidacao/ISPS/Drop Off Fee" numa cotacao, "DDP/Pick Up/BL Fee/EXW
// Charges/Logistics Fee" noutra pro mesmo tipo de custo). O Calculador
// calcula essas taxas por FORMULA/padrao (valores medios por container),
// que diverge do que foi realmente negociado nessa cotacao especifica -
// gerando ate ~7% de erro no Custo Total em embarques pequenos (onde esse
// residuo de poucos milhares de reais pesa mais, proporcionalmente).
//
// Em vez de tentar decifrar nomenclatura variavel, lemos o TOTAL ja pronto
// (rotulo fixo "TOTAL TAXAS", robusto a qualquer nomenclatura das linhas
// acima dele) e usamos como OVERRIDE do total_taxas calculado por formula
// no calculador.html - o Calculador mantem o detalhamento por campo (util
// pra reusar/ajustar manualmente), mas o Custo Total final bate exato com
// o que a planilha realmente apurou pra essa cotacao.
function parseTaxasTotaisReais(wb, temIcmsSt) {
    const sheetName = temIcmsSt ? 'MODELO - COM S.T' : 'MODELO - SEM S.T';
    const ws = wb.Sheets[sheetName] || wb.Sheets['MODELO - COM S.T'] || wb.Sheets['MODELO - SEM S.T'];
    if (!ws) return null;
    return buscarValorPorRotulo(ws, /^TOTAL\s*TAXAS$/i);
}

// I.I. (Imposto de Importacao) REAL EM BRL: lido direto da aba MODELO
// (linha "IMP. IMPORTACAO", valor ja convertido em R$) em vez de recalculado
// a partir da aliquota da TABELA_NCM x base de calculo.
//
// Contexto do bug que isso corrige: o Calculador mapeia o texto livre de
// Produto pra uma de so 4 categorias de pneu (TBR/PCR/AGR/OTR, cada uma com
// NCM e aliquota fixos) via mapearProduto() - mas a tabela real de NCMs
// (TABELA_NCM no calculador.html) tem varias dezenas de outros produtos que
// essa importadora tambem movimenta (Compactadores, Rodas, Maquina de
// Nitrogenio, Pecas, etc), nenhum alcancavel pelas 4 opcoes do dropdown. Um
// produto assim cai sempre no fallback 'OTR' (aliquota 16%), que pode
// divergir muito da aliquota real (confirmado: planilha CA26012026, produto
// "COMPACTADOR", aliquota real 20% x 16% do fallback OTR).
//
// A principio bastaria sobrescrever so a aliquota (t.ii) e deixar o
// Calculador recalcular II = base_imp_brl x aliquota - e foi o que essa
// funcao fazia antes. Mas um segundo caso real (planilha UD26-016) mostrou
// que a BASE de calculo do II na planilha tambem pode divergir do
// CIF calculado (FOB+Frete+Taxa C.E.+Seguro): a linha "IMP. IMPORTACAO" usa
// C9 ("Total Duimp", um valor digitado a mao vindo do registro de DUIMP
// real, nao uma formula) como base, nao o "TOTAL CIF" (D8/F8) - ou seja, a
// base tambem e um dado externo que so existe na propria planilha, nao e
// deduzivel de outras celulas.
//
// Por isso lemos e usamos o valor final do II EM BRL, ja calculado pela
// planilha (aliquota x base x cambio, tudo resolvido) - sempre exato,
// independente de aliquota OU base de calculo divergentes. So o I.I. e
// sobrescrito (e o unico imposto que entra no Custo Total hoje -
// RBC/IPI/PIS/COFINS/ICMS/IBS/CBS sao creditos recuperaveis, ver
// imp_custo = II no calculador.html).
function parseIIRealBrl(wb, temIcmsSt) {
    const sheetName = temIcmsSt ? 'MODELO - COM S.T' : 'MODELO - SEM S.T';
    const ws = wb.Sheets[sheetName] || wb.Sheets['MODELO - COM S.T'] || wb.Sheets['MODELO - SEM S.T'];
    if (!ws) return null;
    // NAO usamos buscarValorPorRotulo aqui: essa linha tem varios valores
    // >=1000 na mesma linha (USD em D, BRL em F) e buscarValorPorRotulo
    // pega o PRIMEIRO >=1000 da esquerda pra direita (pegaria o USD, D, por
    // engano). O valor em R$ (o que queremos) e sempre o ULTIMO/mais a
    // direita dos candidatos >=1000 nessa linha (padrao: rotulo | aliquota
    // | valor USD | cambio | valor BRL) - pegamos o ultimo, nao o primeiro.
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && typeof cell.v === 'string' && /^IMP\.\s*IMPORTACAO$/i.test(cell.v.trim())) {
                let ultimoGrande = null;
                for (let c2 = c; c2 <= Math.min(c + 10, range.e.c); c2++) {
                    const cell2 = ws[XLSX.utils.encode_cell({ r, c: c2 })];
                    if (cell2 && typeof cell2.v === 'number' && Math.abs(cell2.v) >= 1000) {
                        ultimoGrande = cell2.v;
                    }
                }
                if (ultimoGrande !== null) return ultimoGrande;
            }
        }
    }
    return null;
}

// SEGURO (COMPRA) REAL EM BRL: lido direto da aba MODELO (linha "SEGURO",
// coluna USD - D7/D-da-linha) quando o valor la e um numero digitado a mao
// (nao uma formula), sinal de que o segurado pagou um premio real diferente
// da estimativa padrao (0,04% sobre FOB+Frete) usada pelo calcular() do
// Calculador. Ex.: planilha CA31032026, Seguro real US$185,72 x estimativa
// da formula padrao US$19,25 - quase 10x menor, gerando ~R$878 de diferenca
// no CIF (unico residuo depois dos fixes de I.I./aliquota nesse arquivo).
//
// So sobrescrevemos quando o valor vem de uma celula SEM formula (numero
// literal): se a planilha usa a formula padrao normalmente (a maioria dos
// casos ja bate exato sem essa sobrescrita), nao ha necessidade nem
// vantagem em travar no valor congelado daquele calculo especifico.
function parseSeguroCompraRealBrl(wb, temIcmsSt) {
    const sheetName = temIcmsSt ? 'MODELO - COM S.T' : 'MODELO - SEM S.T';
    const ws = wb.Sheets[sheetName] || wb.Sheets['MODELO - COM S.T'] || wb.Sheets['MODELO - SEM S.T'];
    if (!ws) return null;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && typeof cell.v === 'string' && /^SEGURO$/i.test(cell.v.trim())) {
                // Coluna do valor em USD (logo apos o rotulo) - so aceitamos se
                // for celula SEM formula (dado digitado, nao calculado).
                const usdCell = ws[XLSX.utils.encode_cell({ r, c: c + 2 })];
                if (!usdCell || usdCell.f || typeof usdCell.v !== 'number') return null;
                // Valor em BRL fica mais a direita na mesma linha (ultimo
                // numero >=1 nas proximas colunas, tolerando layout variavel).
                let brl = null;
                for (let c2 = c + 3; c2 <= Math.min(c + 10, range.e.c); c2++) {
                    const cell2 = ws[XLSX.utils.encode_cell({ r, c: c2 })];
                    if (cell2 && typeof cell2.v === 'number' && Math.abs(cell2.v) >= 1) brl = cell2.v;
                }
                return brl;
            }
        }
    }
    return null;
}

function importarPlanilhaBase(buffer) {
    validarBufferPlanilha(buffer);
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const campos = parseDados(wb);
    const mix = parseMix(wb);
    const { faturamento_real, lucro_bruto_real } = parseFaturamentoReal(wb);
    campos.faturamento_real = faturamento_real;
    campos.lucro_bruto_real = lucro_bruto_real;
    const { cambio_fob_ponderado, cambio_chegada } = parseCambiosReais(wb, campos.tem_icms_st);
    if (cambio_fob_ponderado) campos.cambio_usd = cambio_fob_ponderado;
    if (cambio_chegada) campos.cambio_chegada = cambio_chegada;
    const taxasTotaisReais = parseTaxasTotaisReais(wb, campos.tem_icms_st);
    if (taxasTotaisReais !== null && taxasTotaisReais !== undefined) {
        campos.taxas_totais_planilha_brl = taxasTotaisReais;
    }
    const iiRealBrl = parseIIRealBrl(wb, campos.tem_icms_st);
    if (iiRealBrl !== null && iiRealBrl !== undefined) {
        campos.ii_planilha_brl = iiRealBrl;
    }
    const seguroCompraRealBrl = parseSeguroCompraRealBrl(wb, campos.tem_icms_st);
    if (seguroCompraRealBrl !== null && seguroCompraRealBrl !== undefined) {
        campos.seguro_compra_planilha_brl = seguroCompraRealBrl;
    }
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

// ── IMPORTACAO DE PLANILHA DO DESPACHANTE ("Separa Data.xlsx") ───────────
//
// Planilha recorrente que o despachante manda com o status dos processos
// em andamento (aba "EM ANDAMENTO") -- cada linha tem a referencia do
// processo + HBL/MBL/data de chegada (CHEGADA UNICA)/porto de destino/
// navio/qtd de containers/observacoes (DEMANDA IMPAK). Pedido da
// Emanuelly, 26/08/2026. So devolve as linhas parseadas aqui; o match
// contra controle_processos e o UPDATE (com log de auditoria) ficam no
// server.js -- mesma separacao dos outros parsers deste arquivo.
function acharColunaDespachante(headers, palavrasChave) {
    return headers.findIndex(function(h) {
        var hh = norm(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return palavrasChave.every(function(p) { return hh.indexOf(p) >= 0; });
    });
}

function parseDataDespachante(v) {
    if (!v) return null;
    if (v instanceof Date) {
        var y = v.getUTCFullYear();
        var m = String(v.getUTCMonth() + 1).padStart(2, '0');
        var d = String(v.getUTCDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }
    var s = String(v).trim();
    var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m2) return null;
    var dd = m2[1].padStart(2, '0');
    var mm = m2[2].padStart(2, '0');
    var yy = m2[3];
    if (yy.length === 2) yy = '20' + yy;
    return yy + '-' + mm + '-' + dd;
}

function importarDespachanteBase(buffer) {
    validarBufferPlanilha(buffer);
    var wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    var sheetName = wb.SheetNames.find(function(n) { return norm(n).indexOf('ANDAMENTO') >= 0; }) || wb.SheetNames[0];
    var ws = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (!rows.length) return { linhas: [], erro: 'Planilha vazia' };

    var headers = rows[0];
    var idx = {
        referencia: acharColunaDespachante(headers, ['REFER']),
        hbl: acharColunaDespachante(headers, ['HBL']),
        mbl: acharColunaDespachante(headers, ['MBL']),
        chegada: acharColunaDespachante(headers, ['CHEGADA']),
        porto: acharColunaDespachante(headers, ['PORTO', 'DESTINO']),
        navio: acharColunaDespachante(headers, ['NAVIO']),
        container: acharColunaDespachante(headers, ['CONTAINER']),
        demanda: acharColunaDespachante(headers, ['DEMANDA']),
    };
    if (idx.referencia === -1) return { linhas: [], erro: 'Coluna REFERENCIA nao encontrada na planilha' };

    var linhas = [];
    for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var ref = r[idx.referencia];
        if (!ref || !String(ref).trim()) continue;
        linhas.push({
            referencia: String(ref).trim(),
            hbl: idx.hbl >= 0 ? String(r[idx.hbl] || '').trim() : '',
            mbl: idx.mbl >= 0 ? String(r[idx.mbl] || '').trim() : '',
            data_chegada: idx.chegada >= 0 ? parseDataDespachante(r[idx.chegada]) : null,
            porto_destino: idx.porto >= 0 ? String(r[idx.porto] || '').trim() : '',
            navio: idx.navio >= 0 ? String(r[idx.navio] || '').trim() : '',
            qtd_containers: idx.container >= 0 ? parseInt(String(r[idx.container] || '').replace(/\D/g, ''), 10) : null,
            demanda_impak: idx.demanda >= 0 ? String(r[idx.demanda] || '').trim() : '',
        });
    }
    return { linhas: linhas };
}

// ── IMPORTACAO DE PLANILHA INTERNA (Manu/Emanuelly, "processos manu.xlsx") ──
//
// Planilha interna (nao do despachante) com Data de Prontidao Real,
// Agente de Carga e Previsao de Embarque (ETD). Pedido da Emanuelly,
// 27/08/2026: "la tem data de prontidao e os bookings" -- so essas
// informacoes (prontidao, agente/booking, ETD) devem ser importadas;
// a Previsao de Chegada (ETA) desta planilha NAO deve ser tocada, pois
// aquele campo e mantido pela planilha da Amanda/despachante. Datas
// nesta planilha vem no formato M/D/AA (US), diferente da planilha do
// despachante (D/M/AAAA) -- por isso um parser de data separado.
function acharColunaManu(headers, palavrasChave) {
    return headers.findIndex(function(h) {
        var hh = norm(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return palavrasChave.every(function(p) { return hh.indexOf(p) >= 0; });
    });
}

function parseDataManu(v) {
    if (!v) return null;
    if (v instanceof Date) {
        var y = v.getUTCFullYear();
        var m = String(v.getUTCMonth() + 1).padStart(2, '0');
        var d = String(v.getUTCDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }
    var s = String(v).trim();
    var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m2) return null;
    var mm = m2[1].padStart(2, '0');
    var dd = m2[2].padStart(2, '0');
    var yy = m2[3];
    if (yy.length === 2) yy = '20' + yy;
    return yy + '-' + mm + '-' + dd;
}

function importarManuBase(buffer) {
    validarBufferPlanilha(buffer);
    var wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (!rows.length) return { linhas: [], erro: 'Planilha vazia' };

    var headers = rows[0];
    var idx = {
        referencia: acharColunaManu(headers, ['PROCESSO']),
        prontidao: acharColunaManu(headers, ['PRONTIDAO']),
        agente: acharColunaManu(headers, ['AGENTE', 'CARGA']),
        etd: acharColunaManu(headers, ['PREVISAO', 'EMBARQUE']),
    };
    if (idx.referencia === -1) return { linhas: [], erro: 'Coluna PROCESSOS nao encontrada na planilha' };

    var linhas = [];
    for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var ref = r[idx.referencia];
        if (!ref || !String(ref).trim()) continue;
        linhas.push({
            referencia: String(ref).trim(),
            data_presenca: idx.prontidao >= 0 ? parseDataManu(r[idx.prontidao]) : null,
            agente: idx.agente >= 0 ? String(r[idx.agente] || '').trim() : '',
            etd: idx.etd >= 0 ? parseDataManu(r[idx.etd]) : null,
        });
    }
    return { linhas: linhas };
}

module.exports = { importarPlanilhaBase: importarPlanilhaBase, importarFechamentoBase: importarFechamentoBase, importarDespachanteBase: importarDespachanteBase, importarManuBase: importarManuBase };
