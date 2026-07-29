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

                                const comissaoChinaLocal = norm(cellVal(ws, 'H17'));

                                  return {
                                      cambio_usd: Number(cellVal(ws, 'E5')) || Number(cellVal(ws, 'E3')) || null,
                                          fob_usd: Number(cellVal(ws, 'E6')) || 0,
                                              frete_usd: Number(cellVal(ws, 'E8')) || 0,
                                                  taxa_ce_usd: Number(cellVal(ws, 'E7')) || 0,
                                                      qtde_containers: Number(cellVal(ws, 'E9')) || 1,
                                                          produto: mapearProduto(cellVal(ws, 'E11')),
                                                              origem: mapearOrigem(cellVal(ws, 'E12')),
                                                                  tipo_importacao: mapearTipoImportacao(cellVal(ws, 'E14')),
                                                                      tem_icms_st: ehSim(cellVal(ws, 'E15')),
                                                                          comissao_br: ehSim(cellVal(ws, 'E16')),
                                                                              comissao_br_pct: Number(cellVal(ws, 'F16')) || null,
                                                                                  comissao_china: ehSim(cellVal(ws, 'E17')),
                                                                                      comissao_china_local: (comissaoChinaLocal === 'DENTRO' || comissaoChinaLocal === 'FORA') ? comissaoChinaLocal : 'FORA',
                                                                                          cliente: cellVal(ws, 'E18') ? String(cellVal(ws, 'E18')).trim() : '',
                                                                                              custos_diversos: Number(cellVal(ws, 'E36')) || 0,
                                                                                                  avisos: ['Confira: parcelamento, cartao, prazo/juros e dumping nao sao importados automaticamente - revise essas secoes manualmente.'],
                                                                                                    };
                                                                                                    }
                                                                                                    
                                                                                                    function parseMix(wb) {
                                                                                                      const ws = wb.Sheets['MIX - COMPLETO'];
                                                                                                        if (!ws) throw new Error('Aba "MIX - COMPLETO" nao encontrada na planilha.');
                                                                                                          const range = XLSX.utils.decode_range(ws['!ref']);
                                                                                                          
                                                                                                            // A aba repete a mesma tabela duas vezes (uma pro fator "COM S.T", outra
                                                                                                              // pro fator "SEM S.T" - produtos/quantidades identicos, so muda um
                                                                                                                // multiplicador usado em outro lugar da planilha). Achamos todas as
                                                                                                                  // linhas de cabecalho (coluna J = "Pedido") e usamos so a primeira
                                                                                                                    // tabela, pra nao duplicar os itens do mix.
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
                                                                                                                                                                                                                  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
                                                                                                                                                                                                                    const campos = parseDados(wb);
                                                                                                                                                                                                                      const mix = parseMix(wb);
                                                                                                                                                                                                                        return { campos: campos, mix: mix };
                                                                                                                                                                                                                        }
                                                                                                                                                                                                                        
                                                                                                                                                                                                                        module.exports = { importarPlanilhaBase: importarPlanilhaBase };
                                                                                                                                                                                                                        
