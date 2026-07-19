// excel-styles.js
//
// Paleta de cores, bordas e funções de estilização de planilhas (ExcelJS)
// compartilhadas pelos 3 exports Excel do sistema:
//   - controle_v2.html  → exportarFormatoCliente()
//   - calculador.html   → exportarExcel() (abas "Demonstrativo" e "Cliente")
//   - tyredesk.html     → exportarExcel() (abas por fornecedor + "Mix Otimizado")
//
// Antes, cada um dos 3 arquivos redefinia sua própria cópia dessas mesmas
// constantes/funções — risco de "consertar/ajustar em um e esquecer nos
// outros". Agora existe uma cópia só, carregada via
// <script src="excel-styles.js"></script> (no <head>, ANTES do <script> de
// cada página) e exposta em window.ExcelStyles.
//
// Este arquivo não muda nenhum resultado visual das planilhas — são
// exatamente os mesmos valores/estilos que já existiam duplicados.
(function () {
  'use strict';

  // ── Paleta — mesmos tons do design system do app (--ac, --ac2, --ac-soft,
  // --border, --muted), pra planilha exportada "combinar" com o sistema. ──
  const CORES = {
    AZUL: 'FF1A7FD4',
    AZUL_ESCURO: 'FF102A45',
    AZUL_CLARO: 'FFEAF3FC',
    BORDA: 'FFD2DAE6',
    CINZA: 'FF5C7089',
    CINZA_CLARO: 'FFF5F7FB',
    BRANCO: 'FFFFFFFF',
    TEXTO: 'FF101A2B',
    ZEBRA: 'FFFAFBFD',
  };

  const bordaFina = {
    top: { style: 'thin', color: { argb: CORES.BORDA } },
    bottom: { style: 'thin', color: { argb: CORES.BORDA } },
    left: { style: 'thin', color: { argb: CORES.BORDA } },
    right: { style: 'thin', color: { argb: CORES.BORDA } },
  };
  const bordaFio = {
    top: { style: 'hair', color: { argb: CORES.BORDA } },
    bottom: { style: 'hair', color: { argb: CORES.BORDA } },
    left: { style: 'hair', color: { argb: CORES.BORDA } },
    right: { style: 'hair', color: { argb: CORES.BORDA } },
  };

  // ── Linha de título (linha 1, mesclada) ─────────────────────────────
  function estilizarTitulo(cell, opts) {
    const size = (opts && opts.size) || 15;
    cell.font = { name: 'Calibri', bold: true, size, color: { argb: CORES.BRANCO } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.AZUL_ESCURO } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // ── Linha de subtítulo (linha 2, mesclada — ex: "Gerado em ...") ────
  function estilizarSubtitulo(cell, opts) {
    const size = (opts && opts.size) || 10;
    cell.font = { name: 'Calibri', italic: true, size, color: { argb: CORES.CINZA } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.CINZA_CLARO } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // ── Célula de cabeçalho de coluna ────────────────────────────────────
  function estilizarHeaderCell(cell, opts) {
    const size = (opts && opts.size) || 10.5;
    cell.font = { name: 'Calibri', bold: true, size, color: { argb: CORES.BRANCO } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.AZUL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = bordaFina;
  }

  // ── Cabeçalho de grupo dentro da aba (ex: nome do fornecedor) ───────
  function estilizarGrupoHeader(cell, opts) {
    const size = (opts && opts.size) || 11;
    cell.font = { name: 'Calibri', bold: true, size, color: { argb: CORES.AZUL_ESCURO } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.AZUL_CLARO } };
  }

  // ── Célula de linha de dado, com zebra opcional (idx ímpar = listrado) ──
  function estilizarCelulaDado(cell, opts) {
    opts = opts || {};
    const idx = opts.idx || 0;
    const alinhamento = opts.alinhamento || 'left';
    const size = opts.size || 10;
    cell.font = { name: 'Calibri', size, color: { argb: CORES.TEXTO } };
    cell.alignment = { vertical: 'middle', horizontal: alinhamento };
    cell.border = bordaFio;
    if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.ZEBRA } };
  }

  // ── Tabela genérica: header + linhas de dado (com zebra) + linha de
  // total opcional (fundo AZUL_CLARO, texto AZUL_ESCURO em negrito).
  // Usada quando a aba inteira é "só uma tabela" (sem título/subtítulo/
  // agrupamento por cima) — caso do tyredesk.html (uma aba por fornecedor
  // + aba "Mix Otimizado"). ──────────────────────────────────────────
  function estilizarAba(ws, headerLabels, linhasDados, linhaTotal, larguras) {
    const numCols = headerLabels.length;
    const headerRow = ws.getRow(1);
    headerLabels.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      estilizarHeaderCell(cell);
    });
    headerRow.height = 26;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: numCols } };

    linhasDados.forEach((vals, idx) => {
      const row = ws.addRow(vals);
      vals.forEach((v, i) => {
        estilizarCelulaDado(row.getCell(i + 1), { idx, alinhamento: i === 1 ? 'left' : 'center' });
      });
    });

    if (linhaTotal) {
      const row = ws.addRow(linhaTotal);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', bold: true, size: 10.5, color: { argb: CORES.AZUL_ESCURO } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.AZUL_CLARO } };
        cell.border = { top: { style: 'thin', color: { argb: CORES.BORDA } } };
      });
      row.height = 20;
    }

    larguras.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  }

  window.ExcelStyles = {
    CORES,
    bordaFina,
    bordaFio,
    estilizarTitulo,
    estilizarSubtitulo,
    estilizarHeaderCell,
    estilizarGrupoHeader,
    estilizarCelulaDado,
    estilizarAba,
  };
})();
