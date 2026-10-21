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
        // DADOS!E15 e "Tem TTD" (rotulo B15: "Tem TTD" / "Tem ICMS ST ou TTD").
        // TTD = SIM -> cliente tem o tratamento tributario diferenciado -> SEM
        // ICMS ST (MODELO!K6 = SIM, L21 = 0). Logo tem_icms_st e o INVERSO.
        // Antes estava ehSim(E15) direto: importava TTD=NAO como "sem ST" e lia
        // a aba SEM S.T no lugar da COM S.T (conferido em 14/10/2026 contra as
        // planilhas Rev97: E15=NAO, K6=NAO, L21=79.902 de ICMS ST).
        tem_icms_st: !ehSim(cellVal(ws, 'E15')),
        comissao_br: ehSim(cellVal(ws, 'E16')),
        comissao_br_pct: Number(cellVal(ws, 'F16')) || null,
        comissao_china: comissaoChinaAtiva,
        comissao_china_local: chinaLocalFinal,
        comissao_china_pct: comissaoChinaPct,
        cliente: cellVal(ws, 'E18') ? String(cellVal(ws, 'E18')).trim() : '',
        custos_diversos: Number(cellVal(ws, 'E36')) || 0,
        // #488 (planilhas Rev97 enviadas pelo Jean 14/10/2026): antidumping,
        // prazo interno e cartao. Dumping: DADOS!H19 (SIM/NAO) e H20 (US$/kg);
        // o peso e o SIM/NAO por item vem da aba MIX (colunas L e BG).
        tem_dumping: ehSim(cellVal(ws, 'H19')),
        dumping_taxa_kg: Number(cellVal(ws, 'H20')) || null,
        // Prazo interno: E24 SIM, G24 taxa a.m., H24 prazo ("30/60/90dd").
        // Cartao: E26 SIM, G26 "3 x " (n parcelas). Na planilha so um dos dois vale.
        forma_custo_fin: ehSim(cellVal(ws, 'E24')) ? 'prazo' : (ehSim(cellVal(ws, 'E26')) ? 'cartao' : ''),
        cf_taxa_am: ehSim(cellVal(ws, 'E24')) && cellVal(ws, 'G24') != null ? Number(cellVal(ws, 'G24')) * 100 : null,
        cf_prazo: ehSim(cellVal(ws, 'E24')) && cellVal(ws, 'H24') ? String(cellVal(ws, 'H24')).trim() : '',
        cf_parcelas: ehSim(cellVal(ws, 'E26')) ? (parseInt(String(cellVal(ws, 'G26') || ''), 10) || null) : null,
        // Parcelado (Jean 15/10/2026, planilhas "PRAZO COM ENTRADA"): E28 SIM,
        // E29 com entrada, E30 % entrada, F31 taxa a.m. (E31 e a mesma, por
        // formula), F32 prazo do boleto. Na planilha o juros do parcelado vai
        // SEMPRE no boleto (MODELO K44 entra no lucro L50).
        parcelado: ehSim(cellVal(ws, 'E28')),
        parcelado_com_entrada: ehSim(cellVal(ws, 'E28')) && ehSim(cellVal(ws, 'E29')),
        parcelado_pct_entrada: ehSim(cellVal(ws, 'E28')) && ehSim(cellVal(ws, 'E29')) && cellVal(ws, 'E30') != null ? Number(cellVal(ws, 'E30')) * 100 : null,
        parcelado_taxa_am: ehSim(cellVal(ws, 'E28')) ? Math.round((Number(cellVal(ws, 'F31')) || Number(cellVal(ws, 'E31')) || 0) * 10000) / 100 : null,
        parcelado_prazo: ehSim(cellVal(ws, 'E28')) && cellVal(ws, 'F32') ? String(cellVal(ws, 'F32')).trim() : '',
        avisos: ['Confira: taxas linha a linha nao sao importadas - revise essa secao.'],
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
          // #488: peso unitario (col L, "Weight (Kgs.)") e antidumping por item
          // (col BG: SIM/NAO; vazio = segue o DADOS!H19).
          const pesoUnit = cellVal(ws, XLSX.utils.encode_cell({ r: r, c: 11 }));
          const dumpItem = cellVal(ws, XLSX.utils.encode_cell({ r: r, c: 58 }));
          if (pedido && Number(pedido) > 0 && size) {
                  const item = {
                            medida: String(size).trim(),
                            pat: pattern ? String(pattern).trim() : null,
                            qtd: Number(pedido),
                            preco: Number(fobUnit) || 0,
                  };
                  if (Number(pesoUnit) > 0) item.peso_kg = Number(pesoUnit);
                  if (dumpItem != null && String(dumpItem).trim() !== '') item.dumping = ehSim(dumpItem);
                  itens.push(item);
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
                // Padrao da linha: rotulo | aliquota | USD | CAMBIO | BRL (| extras).
                // O valor em R$ e o primeiro numero >= 1000 logo DEPOIS do cambio
                // (numero entre 1 e 20). Na aba COM S.T da Rev97 existe um valor
                // extra mais a direita (G10 = base do ICMS ST, ~240 mil) — pegar
                // o "ultimo grande" lia esse e estourava o custo (14/10/2026).
                let ultimoGrande = null, viuCambio = false, aposCambio = null;
                for (let c2 = c + 1; c2 <= Math.min(c + 10, range.e.c); c2++) {
                    const cell2 = ws[XLSX.utils.encode_cell({ r, c: c2 })];
                    if (!cell2 || typeof cell2.v !== 'number') continue;
                    if (viuCambio && aposCambio === null && Math.abs(cell2.v) >= 1000) aposCambio = cell2.v;
                    if (!viuCambio && cell2.v > 1 && cell2.v < 20) viuCambio = true;
                    if (Math.abs(cell2.v) >= 1000) ultimoGrande = cell2.v;
                }
                if (aposCambio !== null) return aposCambio;
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
    // Fator NFe (MODELO L11) e juros fixo no boleto (MODELO J48, R$10.000 no
    // modelo "maior juro no boleto"; vazio no "margem fixa"). Com o fator o
    // Calculador reproduz a planilha exatamente (cenario "Fator NFe").
    {
        const wsM = wb.Sheets[campos.tem_icms_st ? 'MODELO - COM S.T' : 'MODELO - SEM S.T'];
        if (wsM) {
            const f = Number(cellVal(wsM, 'L11'));
            if (f > 0.5 && f < 10) campos.fator_nfe = f;
            if (campos.parcelado) campos.juros_boleto_fixo = Number(cellVal(wsM, 'J48')) || 0;
            const tot = Number(cellVal(wsM, 'K47'));
            if (campos.parcelado && tot > 0) campos.total_cliente_planilha = tot;
        }
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
// 'AAAA-MM-DD' -> 'DD/MM/AAAA' (so para mensagens).
function dataBR(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
}
// Segue a celula de uma data ate onde ela foi DIGITADA. Referencia para outra
// aba (Fechamento!F62 = DADOS!E4) e seguida; se a origem e formula (=HOJE(),
// =E4, =H6+3...), a data e automatica -- nao e a data real do processo.
// Aba de destino inexistente tambem conta como "nao digitada" (na duvida,
// nao grava). Devolve { data: 'AAAA-MM-DD'|null, digitada, origem, formula }.
function dataDigitada(wb, aba, addr, nivel) {
    nivel = nivel || 0;
    const ws = wb.Sheets[aba];
    const c = ws && ws[addr];
    const origem = aba + '!' + addr;
    if (!c) return { data: null, digitada: false, origem: origem, formula: '' };
    const data = isoDate(c.v);
    if (!c.f) return { data: data, digitada: true, origem: origem, formula: '' };
    const ref = String(c.f).trim().match(/^(?:'([^']+)'|([^'!\s()=+\-*\/]+))!\$?([A-Z]{1,3})\$?(\d+)$/i);
    if (ref && nivel < 5) {
        const pedida = String(ref[1] || ref[2]).trim().toUpperCase();
        const outraAba = wb.SheetNames.find(function(n) { return n.trim().toUpperCase() === pedida; });
        if (outraAba && outraAba !== aba) {
            const r = dataDigitada(wb, outraAba, ref[3].toUpperCase() + ref[4], nivel + 1);
            return { data: data || r.data, digitada: r.digitada, origem: r.origem, formula: r.formula };
        }
    }
    return { data: data, digitada: false, origem: origem, formula: '=' + String(c.f).replace(/\bTODAY\(\)/gi, 'HOJE()') };
}
function numVal(v) {
    const n = Number(v);
    return (isNaN(n) || v === '' || v === undefined) ? 0 : n;
}

// ── ABA "FECHAMENTO" ────────────────────────────────────────────────────
//
// A aba Fechamento NAO tem posicao fixa: o bloco "NOTAS SAIDAS" cresce uma
// linha por nota fiscal e mais uma linha "JUROS" por nota vendida a prazo.
// Com 3 notas a prazo (ex.: BR26T056A, BR26R034B) tudo abaixo desce 3 linhas
// e a leitura por celula fixa (G22, G26, G29...) passa a devolver o valor da
// linha errada: "Agente Frete" entrava como Marjoracao, "ICMS Sub. Tributaria"
// como Comissao Vendedor, "Reciclagem" como Comissao Chines, "Lavacao" como
// Timp (auditoria #580, 30/09/2026). Por isso cada linha e localizada pelo
// ROTULO da coluna B (ou D/E nos blocos de datas, notas e Boss), nunca pela
// posicao.
function semAcento(s) {
    return norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Lê a aba inteira uma vez: [{ r, B, D, E, F, G, H, I, K }] por linha.
function linhasFechamento(ws) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    const linhas = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
        const l = { r: r + 1 };
        ['B', 'D', 'E', 'F', 'G', 'H', 'I', 'K'].forEach(function(col) { l[col] = cellVal(ws, col + (r + 1)); });
        linhas.push(l);
    }
    return linhas;
}

// Rotulos da coluna B → chave do real_json (ordem irrelevante). A regex casa
// com o INICIO do rotulo sem acento, em maiusculas.
const FECHAMENTO_LINHAS_B = [
    { re: /^ADIANTAMENTO PORTO/, chave: 'adiantamento_porto', importar: false },
    { re: /^AGENTE FRETE/, chave: 'agente_frete', importar: false },
    { re: /^DIFERENCA PIS/, chave: 'diferenca_pis' },
    { re: /^DIFERENCA COFINS/, chave: 'diferenca_cofins' },
    { re: /^MA[RJ]+ORACAO/, chave: 'marjoracao' },
    { re: /^DIFERENCA IPI/, chave: 'diferenca_ipi' },
    { re: /^DIFERENCA ICMS/, chave: 'diferenca_icms_proprio' },
    { re: /^ICMS SUB/, chave: 'icms_st' },
    { re: /^IBS$/, chave: 'diferenca_ibs' },
    { re: /^CBS$/, chave: 'diferenca_cbs' },
    { re: /^COMISSAO VENDEDOR/, chave: 'comissao_vendedor' },
    { re: /^RECICLAGEM/, chave: 'reciclagem_fechamento' },
    { re: /^LAVACAO/, chave: 'lavacao' },
    { re: /^DESPESAS/, chave: 'despesas_baixa_patio_venda' },
    { re: /^COMISSAO CHIN/, chave: 'comissao_china' },
    { re: /^TIMP/, chave: 'timp' },
    { re: /^TRADEMASTER/, chave: 'trademaster' },
    { re: /^SEGURO$/, chave: 'seguro', moeda: 'BRL' },
];

// ── PACOTES ITEM A ITEM PELA ABA MODELO (20/10/2026, UD26-047) ──────────
// "Adiantamento Porto" e "Agente Frete" da aba Fechamento sao SOMAS da aba
// MODELO: Fechamento!O10 = MODELO!G23 (II + IPI + PIS + COFINS + ICMS +
// Siscomex + AFRMM + armazenagem + antidumping + L.I.) e O12 = MODELO!G37 -
// seguro (frete + diferenca de frete + capatazia, liberacao do BL, taxas do
// agente, IOF...). Antes os dois ficavam so no resumo (para nao somar duas
// vezes com os itens ja lancados) e o processo importado so pela planilha
// ficava sem esses ~R$ 96 mil de custo — o Fechamento nao batia.
// Agora cada pacote entra ITEM A ITEM, lido da MODELO pelo rotulo da coluna
// B (valor em R$ na coluna F), quando a soma dos itens bate com o valor do
// pacote no Fechamento (tolerancia R$ 1). Nao bateu (pacote digitado a mao,
// linha nova na MODELO...)? Entra o pacote inteiro, com aviso. Quem aplica
// no processo (crResolverPacotesImportados, controle-modal.js) nunca deixa
// pacote e itens do mesmo grupo juntos na grade.
const MODELO_ITENS_PACOTE = {
    adiantamento: [
        { id: 'ii', re: /^IMP(OSTO|\.)? ?(DE )?IMPORTACAO$|^I\.I\.?$/ },
        { id: 'ipi', re: /^IPI$/ },
        { id: 'pis', re: /^PIS$/ },
        { id: 'cofins', re: /^COFINS$/ },
        { id: 'icms', re: /^ICMS$/ },
        { id: 'siscomex', re: /^(TAXA )?SISCOMEX/ },
        { id: 'marinha', re: /^MARINHA MERCANTE|^AFRMM/ },
        { id: 'armazenagem', re: /^ARMAZENAGEM$/ },
        { id: 'antidumping', re: /^ANTIDUMPING$/ },
        { id: 'emissao_li', re: /^EMISSAO (DE )?L\.? ?I/, li: true },
    ],
    agente: [
        { id: 'frete', re: /^FRETE$/, rotulo: 'Frete' },
        // Frete que o agente cobrou acima do declarado no BL (4.800 x 1.850,
        // por ex.): e frete pago, entra junto no Frete Internacional.
        { id: 'frete', re: /^DIFERENCA DE FRETE/, rotulo: 'Diferenca de frete' },
        { id: 'capatazia', re: /^CAPATAZIA/ },
        { id: 'liberacao_bl', re: /^LIBERACAO (DE |DO )?B\.?L/ },
        { id: 'additional_costs', re: /^ADDITIONAL COST/ },
        { id: 'import_logistics', re: /^IMPORT LOGISTIC/ },
        { id: 'trs', re: /^TRS\b/ },
        { id: 'trs', re: /^CRS\b/ }, // "CRS - Container Repair Surcharge" (o Controle chama a linha trs de CRS)
        { id: 'tsc', re: /^TSC\b/ },
        { id: 'drop_off', re: /^DROP OFF/ },
        { id: 'isps', re: /^ISPS/ },
        { id: 'iof', re: /^IOF$/ },
        { id: 'desconsolidacao', re: /^DESCONSOLIDACAO/ },
        { id: 'agente', re: /^TAXA ?-? ?AGENTE/ },
        { id: 'handling', re: /^HANDLING|^DISBURSEMENT/ },
    ],
};
// Informativos (credito de IBS/CBS da importacao): vao para a grade, mas nao
// fazem parte do pacote nem do custo (temCredito em controle-core.js).
const MODELO_ITENS_CREDITO = [{ id: 'ibs', re: /^IBS$/ }, { id: 'cbs', re: /^CBS$/ }];

// Linhas da aba MODELO ate "CUSTO TOTAL" (abaixo dela vem o bloco da venda,
// que repete IPI/PIS/COFINS/ICMS — esses nao sao custo de importacao).
function linhasModelo(ws) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    const linhas = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
        const l = { r: r + 1 };
        ['B', 'C', 'D', 'E', 'F'].forEach(function(col) { l[col] = cellVal(ws, col + (r + 1)); });
        if (/^CUSTO TOTAL/.test(semAcento(l.B))) break;
        linhas.push(l);
    }
    return linhas;
}

// Abas MODELO candidatas, na ordem: a que as formulas do Fechamento citam
// (='MODELO - COM S.T'!G23), depois COM S.T e SEM S.T.
function abasModeloCandidatas(wb, wsFech) {
    const cont = {};
    Object.keys(wsFech).forEach(function(a) {
        const f = a[0] !== '!' && wsFech[a] && wsFech[a].f;
        if (!f) return;
        const re = /'?(MODELO[^'!]*)'?!/gi;
        let m;
        while ((m = re.exec(String(f)))) { const n = m[1].trim().toUpperCase(); cont[n] = (cont[n] || 0) + 1; }
    });
    const pedidas = Object.keys(cont).sort(function(a, b) { return cont[b] - cont[a]; });
    const nomes = [];
    pedidas.concat(['MODELO - COM S.T', 'MODELO - SEM S.T']).forEach(function(n) {
        const aba = wb.SheetNames.find(function(s) { return s.trim().toUpperCase() === n; });
        if (aba && nomes.indexOf(aba) < 0) nomes.push(aba);
    });
    return nomes;
}

const r2pi = function(v) { return Math.round(v * 100) / 100; };

// Itens de um pacote lidos da MODELO. A Emissao de L.I. tem duas partes
// (R$ 100 por L.I. + taxa): o pacote do modelo atual soma so a taxa
// (=SOMA(...)-D23*100), entao, se a soma nao bater com a L.I. inteira,
// testa a L.I. sem os R$ 100, so a taxa (coluna E) e sem a L.I.
// bloco: no pacote do agente o modelo soma TODAS as linhas de CAPATAZIA ate
// TAXA - AGENTE CARGA (=SOMA(F26:F37)); linha desse bloco sem taxa
// correspondente no Controle ("Lift ON / Lift OFF", por ex.) vai para Custos
// Diversos com o rotulo dela, para a soma continuar igual a do pacote.
function itensPacoteModelo(linhas, defs, valorPacote, bloco) {
    const itens = {}, partes = {}, usadas = new Set();
    let li = null;
    const somar = function(id, rotulo, v) {
        itens[id] = r2pi((itens[id] || 0) + v);
        (partes[id] = partes[id] || []).push({ rotulo: rotulo, valor: v });
    };
    defs.forEach(function(def) {
        const l = linhas.find(function(x) { return !usadas.has(x.r) && def.re.test(semAcento(x.B)); });
        if (!l) return;
        usadas.add(l.r);
        const v = r2pi(numVal(l.F));
        if (def.li) li = { f: v, d: numVal(l.D), e: r2pi(numVal(l.E)) };
        if (v) somar(def.id, def.rotulo || String(l.B).trim(), v);
    });
    if (bloco) {
        const iDe = linhas.findIndex(function(x) { return bloco.de.test(semAcento(x.B)); });
        const iAte = linhas.findIndex(function(x) { return bloco.ate.test(semAcento(x.B)); });
        if (iDe >= 0 && iAte > iDe) {
            linhas.slice(iDe, iAte + 1).forEach(function(l) {
                const v = r2pi(numVal(l.F));
                if (usadas.has(l.r) || !v || !semAcento(l.B)) return;
                usadas.add(l.r);
                somar('custos_diversos', String(l.B).trim(), v);
            });
        }
    }
    const soma = function() { return r2pi(Object.keys(itens).reduce(function(s, k) { return s + itens[k]; }, 0)); };
    const bate = function() { return Math.abs(soma() - valorPacote) <= 1; };
    if (!bate() && li && li.f) {
        const alternativas = [li.d > 0 ? r2pi(li.f - 100 * li.d) : null, li.e || null, 0];
        for (let i = 0; i < alternativas.length && !bate(); i++) {
            const alt = alternativas[i];
            if (alt === null || alt < 0) continue;
            if (alt) itens.emissao_li = alt; else delete itens.emissao_li;
            if (bate()) {
                if (alt) partes.emissao_li = [{ rotulo: 'Emissao de L.I. (sem os R$ 100 por L.I.)', valor: alt }];
                else delete partes.emissao_li;
            }
        }
        if (!bate()) { itens.emissao_li = li.f; partes.emissao_li = [{ rotulo: 'Emissao de L.I.', valor: li.f }]; }
    }
    return { itens: itens, partes: partes, soma: soma(), bate: bate() };
}

function pacotesPelaModelo(wb, wsFech, resumo, real_json, moedas, avisos) {
    const abas = abasModeloCandidatas(wb, wsFech);
    const pacotes = {};
    const NOMES = { adiantamento: 'Adiantamento Porto', agente: 'Agente Frete' };
    const CHAVES = { adiantamento: 'adiantamento_porto', agente: 'agente_frete' };
    const brl = function(v) { return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    let abaUsada = null;
    Object.keys(MODELO_ITENS_PACOTE).forEach(function(chave) {
        const valor = r2pi(numVal(resumo[CHAVES[chave]]));
        if (!(valor > 0)) return;
        let achado = null, melhor = null;
        const bloco = chave === 'agente' ? { de: /^CAPATAZIA/, ate: /^TAXA ?-? ?AGENTE/ } : null;
        for (let i = 0; i < abas.length && !achado; i++) {
            const r = itensPacoteModelo(linhasModelo(wb.Sheets[abas[i]]), MODELO_ITENS_PACOTE[chave], valor, bloco);
            if (r.bate && Object.keys(r.itens).length) { achado = r; abaUsada = abaUsada || abas[i]; }
            else if (!melhor && Object.keys(r.itens).length) melhor = r;
        }
        if (achado) {
            Object.keys(achado.itens).forEach(function(id) { real_json[id] = achado.itens[id]; moedas[id] = 'BRL'; });
            pacotes[chave] = { id: CHAVES[chave], nome: NOMES[chave], valor: valor, modo: 'itens', soma: achado.soma, itens: achado.itens, partes: achado.partes };
            return;
        }
        // Nao deu para abrir: o pacote entra inteiro (modo planilha).
        real_json[CHAVES[chave]] = valor;
        moedas[CHAVES[chave]] = 'BRL';
        pacotes[chave] = { id: CHAVES[chave], nome: NOMES[chave], valor: valor, modo: 'pacote', soma: melhor ? melhor.soma : null };
        avisos.push(NOMES[chave] + ' entrou como um valor so (' + brl(valor) + '): ' + (melhor ? 'os itens da aba MODELO somam ' + brl(melhor.soma) + ' e nao batem com o Fechamento' : 'nao achei os itens dele na aba MODELO') + '. Para lancar item a item, leia o documento (acerto do despachante / fatura do agente) em "Ler fatura (IA)".');
    });
    if (abaUsada) {
        // IBS/CBS da importacao (credito): so informativo, mesma aba MODELO.
        const linhas = linhasModelo(wb.Sheets[abaUsada]);
        MODELO_ITENS_CREDITO.forEach(function(def) {
            const l = linhas.find(function(x) { return def.re.test(semAcento(x.B)); });
            const v = l ? r2pi(numVal(l.F)) : 0;
            if (v > 0) { real_json[def.id] = v; moedas[def.id] = 'BRL'; }
        });
    }
    return pacotes;
}

function parseFechamento(wb) {
    const ws = wb.Sheets['Fechamento'];
    if (!ws) throw new Error('Aba "Fechamento" nao encontrada na planilha.');

    const avisos = [];
    const linhas = linhasFechamento(ws);
    const porRotuloB = function(re) { return linhas.find(function(l) { return re.test(semAcento(l.B)); }); };
    const porRotuloD = function(re) { return linhas.find(function(l) { return re.test(semAcento(l.D)); }); };
    const porRotuloE = function(re) { return linhas.find(function(l) { return re.test(semAcento(l.E)); }); };

    // Datas: "Data Registro D.I" fica em G4/I4 (cabecalho fixo); as outras
    // tres ficam na coluna D com o valor em F, no rodape.
    //
    // So entra no processo a data que alguem DIGITOU na planilha (17/10/2026).
    // O modelo ja vem com datas automaticas: DADOS!E4 ("DATA D.I") = HOJE(),
    // DADOS!H6 ("DATA EMBARQUE") = E4 e DADOS!H4 ("DATA DO PEDIDO") = H6; e
    // aqui no Fechamento "Embarque" = DADOS!H6, "Chegada Porto" = DADOS!E4 e
    // "Data Registro D.I" = DADOS!E4. Enquanto ninguem digita, as tres mostram
    // o dia em que a planilha foi salva -- e a importacao gravava isso como
    // embarque, chegada e registro da DI (processos ficavam com as tres datas
    // iguais, ou com o embarque copiado da Data da D.I.).
    const lDi = linhas.find(function(l) { return /^DATA REGISTRO/.test(semAcento(l.G)); });
    const lPedido = porRotuloD(/^DATA DO PEDIDO/);
    const lEmbarque = porRotuloD(/^EMBARQUE$/);
    const lChegada = porRotuloD(/^CHEGADA/);
    const fDi = dataDigitada(wb, 'Fechamento', lDi ? 'I' + lDi.r : 'I4');
    const fPedido = lPedido ? dataDigitada(wb, 'Fechamento', 'F' + lPedido.r) : null;
    const fEmbarque = lEmbarque ? dataDigitada(wb, 'Fechamento', 'F' + lEmbarque.r) : null;
    const fChegada = lChegada ? dataDigitada(wb, 'Fechamento', 'F' + lChegada.r) : null;

    // "Chegada Porto" no modelo e a MESMA celula da Data da D.I. (DADOS!E4):
    // a DI costuma ser registrada dias depois da atracacao, e a chegada e o
    // que conta o prazo de demurrage. Quando as duas vem da mesma celula, a
    // chegada nao e importada (vem do despachante, do CE ou e digitada).
    const chegadaEhDi = !!(fChegada && fDi && fChegada.digitada && fChegada.data && fChegada.origem === fDi.origem);
    const datas = {};
    const naoDigitadas = [];
    [['data_embarque', 'Embarque', fEmbarque], ['data_chegada', 'Chegada', fChegada], ['data_registro_di', 'Registro da D.I.', fDi]].forEach(function(d) {
        const info = d[2];
        if (!info || !info.data) return;
        if (d[0] === 'data_chegada' && chegadaEhDi) return;
        if (info.digitada) datas[d[0]] = info.data;
        else naoDigitadas.push(d[1] + ' (' + info.origem + (info.formula ? ' ' + info.formula : '') + ')');
    });
    if (naoDigitadas.length) {
        const dia = (fChegada && fChegada.data) || (fEmbarque && fEmbarque.data) || (fDi && fDi.data);
        avisos.push('Nao importei ' + naoDigitadas.join(', ') + ': na planilha essa data ainda e automatica (mostra ' + dataBR(dia) + ', o dia em que a planilha foi salva ou a copia de outra data), nao a data real. Digite a data na planilha ou direto no processo.');
    }
    if (chegadaEhDi) avisos.push('Chegada nao importada: na planilha a "Chegada Porto" e a propria Data da D.I. (' + fDi.origem + '), nao o dia em que o navio chegou. A chegada vem do despachante, do CE Mercante ou e digitada no processo.');
    if (fPedido && fPedido.data && fPedido.digitada) avisos.push('Data do Pedido na planilha: ' + fPedido.data + ' (sem campo correspondente no Controle - confira manualmente).');

    // Notas de saida: do rotulo "NOTAS SAIDAS" (coluna B) ate a linha "TOTAL"
    // (coluna E). Cada nota tem numero em E, valor em G, cliente em H, data em
    // K; a linha seguinte pode ser "JUROS" (valor em G, % em H, prazo em I).
    // Nota com valor e SEM numero (a planilha calcula o valor da NF e ninguem
    // digitou o numero — UD26-047, 20/10/2026) tambem entra, com numero null:
    // antes ela sumia e o processo ficava sem receita. O bloco para no TOTAL
    // ou, se ele faltar, no cabecalho dos pagamentos (Dolar/Real/Adance
    // Payment), para nunca ler pagamento como nota.
    const notas = [];
    const lNotas = porRotuloB(/^NOTAS SAIDAS/);
    let totalNotasPlanilha = null;
    if (lNotas) {
        for (let i = linhas.indexOf(lNotas); i < linhas.length; i++) {
            const l = linhas[i];
            const e = semAcento(l.E);
            if (e === 'TOTAL') { totalNotasPlanilha = numVal(l.G); break; }
            if (semAcento(l.F) === 'DOLAR' || /^ADV?ANCE PAYMENT|^ADIANTAMENTO PORTO|^CREDIT NOTE/.test(semAcento(l.B))) break;
            if (e === 'JUROS') {
                if (notas.length) { const n = notas[notas.length - 1]; n.juros = Math.round(numVal(l.G) * 100) / 100; n.juros_pct = numVal(l.H) || null; n.prazo = l.I != null ? String(l.I).trim() : null; }
                continue;
            }
            // Sem numero, so vale a linha do proprio "NOTAS SAIDAS" ou com
            // cliente na coluna H (a linha de soma sem o rotulo TOTAL nao tem).
            const numero = (e.match(/\d{3,}/) || [])[0] || null;
            const temCliente = l.H != null && String(l.H).trim() !== '';
            if (numVal(l.G) > 0 && (numero || (!e && (l === lNotas || temCliente)))) {
                notas.push({ numero: numero, valor: Math.round(numVal(l.G) * 100) / 100, cliente: l.H != null ? String(l.H).trim() : '', data: isoDate(l.K) || (l.K != null ? String(l.K).trim() : null), juros: 0, juros_pct: null, prazo: null });
            }
        }
    }
    const jurosTotal = notas.reduce(function(s, n) { return s + (n.juros || 0); }, 0);

    // FOB pago: o bloco de pagamentos fica entre o cabecalho "Dolar / Real /
    // TX Dolar" e a linha "Adiantamento Porto". Entram TODAS as linhas com
    // rotulo e valor em R$ (coluna G): "Adance/Advance Payment" e tambem
    // "Credit Note" (credito do fornecedor, valor negativo, ex.: UD26-051,
    // PVN2512, PVN2601-8). Somar so "Adance Payment" deixava o FOB maior que
    // o da planilha.
    const iCab = linhas.findIndex(function(l) { return semAcento(l.F) === 'DOLAR' && semAcento(l.G) === 'REAL'; });
    const iAdi = linhas.findIndex(function(l) { return /^ADIANTAMENTO PORTO/.test(semAcento(l.B)); });
    let fobPago = 0;
    const blocoPagamentos = (iCab >= 0 && iAdi > iCab) ? linhas.slice(iCab + 1, iAdi) : linhas.filter(function(l) { return /^ADV?ANCE PAYMENT|^CREDIT NOTE/.test(semAcento(l.B)); });
    blocoPagamentos.forEach(function(l) { if (semAcento(l.B) && typeof l.G === 'number') fobPago += l.G; });

    const real_json = {};
    const moedas = {};
    const resumo = { notas: notas, juros_total: jurosTotal, total_notas: totalNotasPlanilha, fob_pago: fobPago };
    if (fobPago > 0) { real_json.fob = fobPago; moedas.fob = 'BRL'; }

    // Adiantamento Porto e Agente Frete nao entram direto da coluna G: sao os
    // pacotes (numerario do despachante / fatura do agente) e vao para o
    // real_json ITEM A ITEM pela aba MODELO, ou inteiros quando os itens nao
    // batem (ver pacotesPelaModelo acima). Nunca os dois juntos.
    FECHAMENTO_LINHAS_B.forEach(function(def) {
        const l = porRotuloB(def.re);
        if (!l) return;
        const v = numVal(l.G);
        resumo[def.chave] = v;
        if (def.importar === false) return;
        // Diferenca de imposto NEGATIVA e credito (o PIS/COFINS da entrada
        // passou o da venda): reduz o custo na planilha e tem de reduzir aqui
        // tambem — antes so entrava valor positivo e o custo ficava maior.
        const aceita = /^diferenca_/.test(def.chave) ? v !== 0 : v > 0;
        if (aceita) { real_json[def.chave] = v; if (def.moeda) moedas[def.chave] = def.moeda; }
    });
    resumo.pacotes = pacotesPelaModelo(wb, ws, resumo, real_json, moedas, avisos);

    // Linha de custo que o modelo nao tem, digitada no meio do bloco (ex.:
    // "Armazenagem" no lugar de "Comissao Chines", HK60480): soma no TOTAL da
    // planilha e sumia do processo. Entra em Custos Diversos, com aviso.
    const iTotal = linhas.findIndex(function(l) { return /^TOTAL$/.test(semAcento(l.B)); });
    if (iAdi >= 0 && iTotal > iAdi) {
        const extras = [];
        linhas.slice(iAdi, iTotal).forEach(function(l) {
            const b = semAcento(l.B);
            if (!b || FECHAMENTO_LINHAS_B.some(function(d) { return d.re.test(b); }) || /^DIF\.? DE SEGURO|^SEGURO|^ADIANTAMENTO|^AGENTE/.test(b)) return;
            const v = r2pi(numVal(l.G));
            if (v > 0) extras.push({ rotulo: String(l.B).trim(), valor: v });
        });
        if (extras.length) {
            const soma = r2pi(extras.reduce(function(s, x) { return s + x.valor; }, 0));
            real_json.custos_diversos = r2pi((real_json.custos_diversos || 0) + soma);
            moedas.custos_diversos = 'BRL';
            resumo.custos_diversos_planilha = extras;
            avisos.push('Linha(s) do Fechamento sem campo próprio no Controle foram para Custos Diversos: ' + extras.map(function(x) { return x.rotulo + ' R$ ' + x.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }).join(', ') + '.');
        }
    }

    // "Dif. de Seguro" (seguro de venda) fica na coluna F; TOTAL e lucros em G.
    const lDifSeguro = porRotuloB(/^DIF\.? DE SEGURO/);
    if (lDifSeguro) resumo.dif_seguro = numVal(lDifSeguro.F);
    const lTotal = porRotuloB(/^TOTAL$/);
    if (lTotal) resumo.total_custos = numVal(lTotal.G);
    // Lucro antes das notas Boss ("LUCRO BRUTO da IMPAK"; planilhas antigas
    // repetem "do PROCESSO" nas duas linhas) e lucro final (ultima linha).
    const lLucros = linhas.filter(function(l) { return /^LUCRO BRUTO/.test(semAcento(l.B)); });
    if (lLucros.length) { resumo.lucro_impak = numVal(lLucros[0].G); resumo.lucro_processo = numVal(lLucros[lLucros.length - 1].G); }
    const lBoss = porRotuloE(/^NOTAS FISCAIS BOSS/);
    if (lBoss) resumo.notas_boss = numVal(lBoss.G);
    const lReceber = porRotuloE(/^TOTAL A RECEBER/);
    if (lReceber) resumo.boss_liquido = numVal(lReceber.G);

    if (!lNotas || !lTotal) avisos.push('Aba Fechamento fora do padrao (nao achei o bloco "NOTAS SAIDAS" ou a linha "TOTAL") - confira os valores importados.');
    if (jurosTotal > 0) avisos.push('A planilha tem R$ ' + jurosTotal.toFixed(2) + ' de juros cobrados do cliente em ' + notas.filter(function(n) { return n.juros > 0; }).length + ' nota(s); lance como venda a prazo na aba Vendas para a receita bater.');

    return { datas: datas, real_json: real_json, moedas: moedas, avisos: avisos, resumo: resumo };
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

// A planilha do despachante ja mudou de formato mais de uma vez (a Amanda
// reorganiza as colunas de tempos em tempos -- por isso procurar por UM
// unico conjunto fixo de palavras-chave quebra silenciosamente quando o
// cabecalho muda). Tenta cada conjunto de palavras-chave em ordem de
// prioridade e usa o primeiro que der match.
function acharColunaComAlternativas(headers, listasDeKeywords) {
    for (var i = 0; i < listasDeKeywords.length; i++) {
        var idx = acharColunaDespachante(headers, listasDeKeywords[i]);
        if (idx >= 0) return idx;
    }
    return -1;
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
    // A coluna "CHEGADA TERMINAL DESCARGA" da planilha do despachante quase
    // sempre vem com texto extra colado na data (codigo do terminal, prefixo
    // "ETA", as vezes ate 2 datas na mesma celula -- ex: "24/08/26\nNVT\n25/08"
    // ou "ETA 07/09/26\nIOA"). O regex antigo exigia a celula inteira limpa
    // (^...$) e por isso nunca dava match nessas linhas -- a data so era lida
    // quando a celula continha SOMENTE "DD/MM/AAAA", o que praticamente nunca
    // acontece nessa planilha. Agora extrai a PRIMEIRA data D/M/AA(AA)
    // encontrada em qualquer parte da string.
    var m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m2) return null;
    var dd = m2[1].padStart(2, '0');
    var mm = m2[2].padStart(2, '0');
    var yy = m2[3];
    if (yy.length === 2) yy = '20' + yy;
    return yy + '-' + mm + '-' + dd;
}

// ── Coluna "DATA CI" = Data de Liberação (21/10/2026, Emanuelly: "para
// automatizar a data do desembaraço no sistema, incluir na leitura da
// planilha despachante a coluna data CI para preencher a Data Liberação").
// Na planilha do despachante "CI" é o Comprovante de Importação, emitido no
// desembaraço — NÃO a Commercial Invoice (ci_numero/ci_data do Controle).
// O cabeçalho é lido por palavra inteira: "DATA CI", "DT CI", "DATA DA C.I.",
// "COMPROVANTE DE IMPORTAÇÃO" ou "DATA DESEMBARAÇO" (sem PREVISÃO) — "CIF",
// "Nº CI" ou "COMERCIAL" não contam.
function tokensCabecalho(h) {
    return norm(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').split(/[^A-Z0-9]+/).filter(Boolean);
}
function acharColunaDataCI(headers) {
    var t = (headers || []).map(tokensCabecalho);
    var tem = function(tk, p) { return tk.indexOf(p) >= 0; };
    var i = t.findIndex(function(tk) { return tem(tk, 'CI') && (tem(tk, 'DATA') || tem(tk, 'DT')); });
    if (i < 0) i = t.findIndex(function(tk) { return tem(tk, 'COMPROVANTE') && (tem(tk, 'IMPORTACAO') || tem(tk, 'IMP')); });
    if (i < 0) i = t.findIndex(function(tk) { return tem(tk, 'DESEMBARACO') && (tem(tk, 'DATA') || tem(tk, 'DT')) && !tk.some(function(x) { return /^PREV/.test(x); }); });
    return i;
}
// Data do dia (AAAA-MM-DD) ou null. A célula pode vir como data de verdade,
// número de série do Excel (46258, às vezes digitado como texto), texto
// D/M/AAAA ou AAAA-MM-DD; "-" ou vazio = sem data. Data que não existe
// (ex.: mês 13) volta null — nunca grava uma data inventada.
function isoValido(a, m, d) {
    a = Number(a); m = Number(m); d = Number(d);
    if (!(a >= 2000 && a <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    var dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function isoDeDate(v) {
    // +12h: a data da célula vem à meia-noite (local ou UTC) — assim o dia
    // não muda com fuso nem com arredondamento de segundos do Excel.
    var x = new Date(v.getTime() + 12 * 3600 * 1000);
    return isoValido(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}
function parseDataCI(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : isoDeDate(v);
    if (typeof v === 'number') {
        if (!(v > 20000 && v < 80000)) return null;
        return isoDeDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000));
    }
    var s = String(v).trim();
    if (!s || /^[-–—_./\s]+$/.test(s)) return null;
    if (/^\d{5}([.,]\d+)?$/.test(s)) return parseDataCI(parseFloat(s.replace(',', '.')));
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return isoValido(iso[1], iso[2], iso[3]);
    var m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
    if (m) return isoValido(m[3].length === 2 ? '20' + m[3] : m[3], m[2], m[1]);
    return null;
}

function importarDespachanteBase(buffer) {
    validarBufferPlanilha(buffer);
    var wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    var sheetName = wb.SheetNames.find(function(n) { return norm(n).indexOf('ANDAMENTO') >= 0; }) || wb.SheetNames[0];
    var ws = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (!rows.length) return { linhas: [], erro: 'Planilha vazia' };
    // Valores crus (data como data, número como número) — usados só na DATA
    // CI, para não depender do formato de exibição da célula (dd/mm x mm/dd).
    var rowsCru = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

    var headers = rows[0];
    var idx = {
        // Formato antigo usava cabecalho "REFERENCIA"; a partir de
        // 01/09/2026 a Amanda passou a usar "PROCESSOS".
        referencia: acharColunaComAlternativas(headers, [['REFER'], ['PROCESSO']]),
        hbl: acharColunaDespachante(headers, ['HBL']),
        mbl: acharColunaDespachante(headers, ['MBL']),
        // Existem 2 colunas relacionadas a chegada no formato novo:
        // "CHEGADA TERMINAL DESCARGA" (texto misturado, ver
        // parseDataDespachante) e a coluna dedicada "ETA (Previsao de
        // Chegada)" (so a data, mais limpa). O formato antigo tinha uma
        // unica coluna "CHEGADA UNICA".
        chegada: acharColunaComAlternativas(headers, [['CHEGADA', 'TERMINAL'], ['CHEGADA', 'UNICA'], ['CHEGADA']]),
        eta: acharColunaDespachante(headers, ['ETA']),
        porto: acharColunaDespachante(headers, ['PORTO', 'DESTINO']),
        navio: acharColunaDespachante(headers, ['NAVIO']),
        // O formato novo tem 2 colunas com "CONTAINER" no nome: "CONTAINER"
        // (o numero do container, ex: FFAU3414856) e "Qtd. Containers
        // (previsto)" (a quantidade, o que realmente queremos aqui). Sem
        // priorizar QTD/QUANT primeiro, cairia no numero do container e
        // geraria uma "quantidade" absurda (parseInt de FFAU3414856).
        container: acharColunaComAlternativas(headers, [['QTD', 'CONTAINER'], ['QUANT', 'CONTAINER'], ['CONTAINER']]),
        demanda: acharColunaDespachante(headers, ['DEMANDA']),
        // DATA CI (Comprovante de Importacao) -> Data de Liberacao (21/10/2026).
        data_ci: acharColunaDataCI(headers),
    };
    if (idx.referencia === -1) return { linhas: [], erro: 'Coluna REFERENCIA/PROCESSOS nao encontrada na planilha' };

    var linhas = [];
    for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var ref = r[idx.referencia];
        if (!ref || !String(ref).trim()) continue;
        // Preferir a coluna ETA dedicada (mais limpa) quando ela vier
        // preenchida; cair pro parse da coluna CHEGADA (texto misturado) so
        // quando a ETA estiver vazia -- e o caso das linhas ja chegadas, onde
        // a planilha do despachante deixa de preencher a previsao e so
        // mantem a data real na coluna CHEGADA.
        var dataChegadaEta = idx.eta >= 0 ? parseDataDespachante(r[idx.eta]) : null;
        var dataChegadaCol = idx.chegada >= 0 ? parseDataDespachante(r[idx.chegada]) : null;
        var celulaCI = idx.data_ci >= 0 ? (rowsCru[i] || [])[idx.data_ci] : '';
        var dataCI = idx.data_ci >= 0 ? parseDataCI(celulaCI) : null;
        // Preenchida, mas não deu pra ler como data: volta o texto para o
        // relatório da importação mostrar (nada é gravado).
        var textoCI = (!dataCI && idx.data_ci >= 0 && String(r[idx.data_ci] || '').trim() && !/^[-–—_./\s]+$/.test(String(r[idx.data_ci]).trim())) ? String(r[idx.data_ci]).trim().slice(0, 40) : '';
        linhas.push({
            referencia: String(ref).trim(),
            hbl: idx.hbl >= 0 ? String(r[idx.hbl] || '').trim() : '',
            mbl: idx.mbl >= 0 ? String(r[idx.mbl] || '').trim() : '',
            data_chegada: dataChegadaEta || dataChegadaCol,
            porto_destino: idx.porto >= 0 ? String(r[idx.porto] || '').trim() : '',
            navio: idx.navio >= 0 ? String(r[idx.navio] || '').trim() : '',
            qtd_containers: idx.container >= 0 ? parseInt(String(r[idx.container] || '').replace(/\D/g, ''), 10) : null,
            demanda_impak: idx.demanda >= 0 ? String(r[idx.demanda] || '').trim() : '',
            data_liberacao: dataCI,
            data_ci_ilegivel: textoCI,
        });
    }
    return { linhas: linhas, tem_data_ci: idx.data_ci >= 0 };
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
            data_prontidao: idx.prontidao >= 0 ? parseDataManu(r[idx.prontidao]) : null,
            agente: idx.agente >= 0 ? String(r[idx.agente] || '').trim() : '',
            etd: idx.etd >= 0 ? parseDataManu(r[idx.etd]) : null,
        });
    }
    return { linhas: linhas };
}

// ── IMPORTACAO DO CATALOGO DE PRODUTOS (aba "Cod Prod.", vinculo com Conexos) ──
//
// A aba "Cod Prod." das planilhas de fechamento traz uma lista de produtos
// com 3 colunas: Descricao Completa, Codigo interno (UD00xx, usado nas
// planilhas do time) e Cod.Conexos (codigo do item no ERP Conexos, usado
// pro estoque/faturamento). Nem toda linha tem os 3 campos preenchidos --
// o Codigo interno as vezes falta, o Cod.Conexos e o mais confiavel (e a
// chave que usamos pra evitar duplicar o mesmo produto ao reimportar).
function importarCatalogoProdutos(buffer) {
    validarBufferPlanilha(buffer);
    var wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    var sheetName = wb.SheetNames.find(function(n) { return norm(n).indexOf('PROD') >= 0; });
    if (!sheetName) return { itens: [], erro: 'Aba "Cod Prod." nao encontrada nesta planilha' };
    var ws = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!rows.length) return { itens: [], erro: 'Aba vazia' };

    var headerIdx = rows.findIndex(function(r) {
        return r.some(function(c) { return norm(c).indexOf('DESCRI') >= 0; }) &&
               r.some(function(c) { return norm(c).indexOf('CONEXOS') >= 0; });
    });
    if (headerIdx === -1) return { itens: [], erro: 'Cabecalho (Descricao/Cod.Conexos) nao encontrado na aba' };
    var headers = rows[headerIdx];
    var idxDescricao = headers.findIndex(function(h) { return norm(h).indexOf('DESCRI') >= 0; });
    var idxCodigo = headers.findIndex(function(h) { return norm(h) === 'CODIGO' || norm(h) === 'CÓDIGO'; });
    var idxConexos = headers.findIndex(function(h) { return norm(h).indexOf('CONEXOS') >= 0; });

    var itens = [];
    for (var i = headerIdx + 1; i < rows.length; i++) {
        var r = rows[i];
        var descricao = idxDescricao >= 0 ? String(r[idxDescricao] || '').trim() : '';
        var codigoConexosRaw = idxConexos >= 0 ? r[idxConexos] : '';
        var codigoConexos = codigoConexosRaw !== '' && !isNaN(parseInt(codigoConexosRaw, 10)) ? parseInt(codigoConexosRaw, 10) : null;
        if (!descricao && codigoConexos === null) continue;
        var codigoInterno = idxCodigo >= 0 ? String(r[idxCodigo] || '').trim() : '';
        itens.push({
            descricao: descricao,
            codigo_interno: codigoInterno || null,
            codigo_conexos: codigoConexos,
        });
    }
    return { itens: itens };
}

module.exports = { importarPlanilhaBase: importarPlanilhaBase, importarFechamentoBase: importarFechamentoBase, importarDespachanteBase: importarDespachanteBase, importarManuBase: importarManuBase, importarCatalogoProdutos: importarCatalogoProdutos,
    // Só para os testes (testes_planilha.js).
    _parseDataCI: parseDataCI, _acharColunaDataCI: acharColunaDataCI };
