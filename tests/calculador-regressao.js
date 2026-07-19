// tests/calculador-regressao.js
//
// SUITE DE REGRESSÃO do motor de cálculo do Calculador (calcular(), em
// calculador.html). Não é um teste automatizado de CI — é um script pra
// colar no Console do navegador, na aba /calculador, sempre que alguém
// mexer em calcular() (ou em qualquer função que ele chama: lerTaxasOperacionais,
// lerCustosReais, calcularArmazenagemUI etc.) e quiser ter certeza de que não
// quebrou nenhum número que já foi conferido manualmente antes.
//
// COMO RODAR:
//   1. Abra a tela /calculador no navegador (precisa estar logado).
//   2. Abra o Console (F12 → aba "Console").
//   3. Cole o conteúdo deste arquivo inteiro e aperte Enter.
//   4. Leia o relatório: cada caso mostra PASS ou FAIL por campo. Se algum
//      campo vier FAIL, é sinal de que uma mudança recente alterou uma conta
//      que já tinha sido conferida à mão contra a planilha/processo real —
//      pare e investigue antes de dar deploy.
//
// Isso roda direto no estado global da página (mesmo truque de arquivos
// <script> separados: _toggles, _ultimoResultado etc. são variáveis
// compartilhadas), então usa o calcular() de verdade, sem simular nada.
//
// COMO ADICIONAR UM CASO NOVO:
//   Sempre que auditar um número novo contra uma planilha/processo real
//   (do jeito que já foi feito pra Seguro Compra, AFRMM, IOF — ver os
//   comentários "FIX (auditoria ...)" em calculador.html), documente aqui
//   também: os inputs exatos, o valor esperado, e DE ONDE veio esse valor
//   (comentário no código, print de conversa, processo real). Isso vira uma
//   trava permanente contra qualquer alteração futura desfazer sem querer
//   uma correção que já custou trabalho pra descobrir.

(function () {
  const casos = [
    {
      nome: 'Seguro Compra — auditoria original (FOB 37.472,80 + Frete 5.000)',
      fonte: 'Comentário em calculador.html (~linha 1369): "FOB 37.472,80 + Frete 5.000 → Seguro USD 20,5568352 confirmado". ' +
             'Conferido à mão: seguro_total=42.472,80; +10% despesas=4.247,28; +10% lucro esperado sobre (42.472,80+4.247,28)=4.672,008; ' +
             'base=51.392,088; × taxa 0,04% = 20,5568352.',
      preparar() {
        setVal('cambio_usd', 5.0827);
        setVal('fob_usd', 37472.80);
        setVal('frete_usd', 5000);
        setVal('taxa_ce_usd', 0);
        setVal('qtde_containers', 1);
        setVal('custos_diversos', 0);
        setVal('cenario_valor', 20);
        setVal('taxa_seguro_compra', 0.04);
        setVal('cambio_chegada', '');
        setVal('produto', 'TBR');
        setVal('uf_destino', 'MG');
        _toggles = { ttd: 'SIM', st: 'NAO', dump: 'NAO', uc: 'NAO', ie: 'SIM', br: 'NAO', china: 'NAO', boss: 'NAO', fobpar: 'NAO' };
        setChecked('auto_marinha', true);
        setChecked('auto_agente', true);
        setChecked('auto_iof', true);
      },
      esperado: {
        'seguro_compra_usd': { valor: 20.5568352, tolerancia: 0.0001 },
      },
    },
    {
      nome: 'AFRMM/Marinha + IOF automáticos — auditoria UD25-305',
      fonte: 'Comentários em calculador.html (~linhas 1445-1475): fórmula Marinha/AFRMM = (((Frete×câmbio)+Capatazia)×8%)+20, ' +
             'confirmada com o usuário via print de conversa: (2.050×5,0827+1.100)×8%+20 = R$941,56. ' +
             'IOF (US$) = Frete×3,5% = 2.050×3,5% = R$71,75.',
      preparar() {
        setVal('cambio_usd', 5.0827);
        setVal('fob_usd', 10000); // não afeta AFRMM/IOF, só precisa ser >0 pra calcular() não recusar
        setVal('frete_usd', 2050);
        setVal('taxa_ce_usd', 0);
        setVal('qtde_containers', 1);
        setVal('custos_diversos', 0);
        setVal('cenario_valor', 20);
        setVal('taxa_seguro_compra', 0.04);
        setVal('cambio_chegada', 5.0827);
        setVal('tx_capatazia', 1100); // valor padrão do formulário — deixado explícito aqui
        setVal('produto', 'TBR');
        setVal('uf_destino', 'MG');
        _toggles = { ttd: 'SIM', st: 'NAO', dump: 'NAO', uc: 'NAO', ie: 'SIM', br: 'NAO', china: 'NAO', boss: 'NAO', fobpar: 'NAO' };
        setChecked('auto_marinha', true);
        setChecked('auto_agente', true);
        setChecked('auto_iof', true);
      },
      esperado: {
        'txOp.fixas.marinha': { valor: 941.56, tolerancia: 0.01 },
        'txOp.usd.iof': { valor: 71.75, tolerancia: 0.01 },
      },
    },
    {
      nome: 'Snapshot amplo — cenário COM S.T em SC, alvo de lucro 25% (trava contra mudança não intencional)',
      fonte: 'NÃO é um valor auditado de forma independente contra planilha/processo real — é uma FOTO do resultado ' +
             'do calcular() em 18/07/2026, capturada de propósito pra servir de rede de segurança: se uma mudança ' +
             'futura no motor de cálculo alterar qualquer um destes números sem essa ser a intenção, este caso acusa. ' +
             'Se a mudança for intencional (nova regra de negócio), atualize os valores esperados aqui junto com a mudança.',
      preparar() {
        setVal('cambio_usd', 5.20);
        setVal('fob_usd', 15000);
        setVal('frete_usd', 1800);
        setVal('taxa_ce_usd', 300);
        setVal('qtde_containers', 2);
        setVal('custos_diversos', 0);
        setVal('cenario_valor', 25);
        setVal('taxa_seguro_compra', 0.04);
        setVal('cambio_chegada', 5.25);
        setVal('produto', 'PCR');
        setVal('uf_destino', 'SC');
        setChecked('auto_marinha', true);
        setChecked('auto_agente', true);
        setChecked('auto_iof', true);
        _toggles = { ttd: 'SIM', st: 'SIM', dump: 'NAO', uc: 'NAO', ie: 'SIM', br: 'NAO', china: 'NAO', boss: 'NAO', fobpar: 'NAO' };
        _cenario = 1;
      },
      esperado: {
        'seguro_compra_usd':  { valor: 8.1312,             tolerancia: 0.01 },
        'cif_brl':            { valor: 87682.542576,       tolerancia: 0.5 },
        'base_imp_brl':       { valor: 88963.542576,       tolerancia: 0.5 },
        'II':                 { valor: 22240.885644,       tolerancia: 0.5 },
        'IPI_e':              { valor: 10842.43175145,     tolerancia: 0.5 },
        'PIS_e':              { valor: 2384.2229410368004, tolerancia: 0.5 },
        'COFINS_e':           { valor: 10986.997508136,    tolerancia: 0.5 },
        'IBS_e':              { valor: 114.05402822,       tolerancia: 0.1 },
        'CBS_e':               { valor: 1026.48625398,      tolerancia: 0.5 },
        'ICMS_e':             { valor: 1440.2883377148212, tolerancia: 0.5 },
        'custo_total':        { valor: 132179.824344,      tolerancia: 1 },
        'vlr_total_nfe':      { valor: 337220.904059166,   tolerancia: 2 },
        'icms_st':            { valor: 65872.86526431257,  tolerancia: 2 },
        'lucro_bruto':        { valor: 84305.22601479148,  tolerancia: 2 },
        'pct_lucro':          { valor: 25,                 tolerancia: 0.01 },
        'txOp.fixas.marinha': { valor: 944.8,               tolerancia: 0.01 },
        'txOp.usd.iof':       { valor: 63,                  tolerancia: 0.01 },
        'txOp.fixas.agente':  { valor: 985.8,               tolerancia: 0.01 },
      },
    },
  ];

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v;
    else console.warn(`  ⚠ campo #${id} não encontrado no DOM (a tela mudou desde que este teste foi escrito?)`);
  }
  function setChecked(id, v) {
    const el = document.getElementById(id);
    if (el) el.checked = v;
  }
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  if (typeof calcular !== 'function' || !document.getElementById('cambio_usd')) {
    console.error('✗ Este script precisa rodar na tela /calculador (função calcular() não encontrada).');
    return;
  }

  console.log('══════════════════════════════════════════════════════');
  console.log('SUITE DE REGRESSÃO — Calculador (calcular())');
  console.log('══════════════════════════════════════════════════════');

  let totalOk = 0, totalFail = 0;

  casos.forEach((caso, i) => {
    console.log(`\n[Caso ${i + 1}] ${caso.nome}`);
    console.log(`  Fonte: ${caso.fonte}`);
    try {
      caso.preparar();
      calcular();
    } catch (e) {
      console.error(`  ✗ ERRO ao rodar calcular(): ${e.message}`);
      totalFail += Object.keys(caso.esperado).length;
      return;
    }
    const r = _ultimoResultado;
    if (!r) {
      console.error('  ✗ _ultimoResultado não foi preenchido — calcular() deve ter retornado cedo (câmbio/FOB vazio? NCM não encontrado?)');
      totalFail += Object.keys(caso.esperado).length;
      return;
    }
    Object.entries(caso.esperado).forEach(([campo, { valor, tolerancia }]) => {
      const obtido = getPath(r, campo);
      const ok = typeof obtido === 'number' && Math.abs(obtido - valor) <= tolerancia;
      if (ok) {
        console.log(`  ✓ PASS  ${campo} = ${obtido} (esperado ${valor} ± ${tolerancia})`);
        totalOk++;
      } else {
        console.error(`  ✗ FAIL  ${campo} = ${obtido}  —  esperado ${valor} ± ${tolerancia}  (diferença: ${typeof obtido === 'number' ? (obtido - valor).toFixed(6) : 'n/a'})`);
        totalFail++;
      }
    });
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(totalFail === 0
    ? `✓ TUDO OK — ${totalOk} verificações passaram.`
    : `✗ ATENÇÃO — ${totalFail} verificação(ões) falharam, ${totalOk} passaram. Não faça deploy sem investigar.`);
  console.log('══════════════════════════════════════════════════════');
})();
