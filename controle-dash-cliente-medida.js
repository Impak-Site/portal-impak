// controle-dash-cliente-medida.js
//
// Dashboard "Por Cliente/Medida" — pedido do Ayslan (06/09/2026), depois de
// mostrar um vídeo de como a Paula hoje descobre "quantos pneus de tal
// medida tem pra tal cliente": ela mantém uma planilha Excel pessoal (fora
// do sistema, alimentada por PROCV de outro arquivo no Dropbox) onde a
// coluna Cliente já vem escrita junto com a medida (ex: "UNICAP 295 LISO")
// e ela usa o Autofiltro do Excel pra isolar as linhas de um cliente.
//
// V1 deste painel (06/09/2026) era uma tabela fixa: Cliente → Medida, sem
// jeito de restringir por Fornecedor ou Marca. V2 (mesmo dia) adicionou
// filtros (Cliente, Fornecedor, Marca, Fase) que restringem os dados antes
// de agrupar. V3 (mesmo dia, feedback seguinte do Ayslan: "o melhor seria
// colocar cada linha por um fornecedor/marca com suas quantidades"): além
// de filtrar, cada LINHA da tabela agora é Fornecedor + Marca + Medida —
// dois lotes da mesma medida vindos de fornecedores diferentes aparecem em
// linhas separadas, em vez de somados juntos numa linha só "Medida".
//
// V4 (07/09/2026, pedido do Ayslan: "tem fornecedores que sao o mesmo,
// porem, com escrita um pouco diferente" — ex: "JIMI RUBBER PTE. LTD."
// vs "JIMI RUBBER PTE.LTD.", "SAILUN GROUP (HONGKONG) CO., LIMITED" vs
// "SAILUN GROUP(HONGKONG)CO.,LIMITED"): Fornecedor e Marca agora agrupam
// por uma CHAVE normalizada (_cmChaveEmpresa — maiúsculas sem espaço nem
// pontuação), então pequenas diferenças de espaçamento/pontuação na
// escrita do cadastro não geram mais linhas nem opções de filtro
// duplicadas. O texto exibido continua sendo a grafia original (a
// primeira encontrada), só o agrupamento é que ignora essas diferenças.
//
// Cada processo já tem Cliente (proc.cliente, ou por venda em vendas_json
// quando vendido pra mais de um cliente), Fornecedor (proc.fornecedor) e
// Marca (proc.brand — quando em branco, usa o próprio Fornecedor, mesmo
// fallback do Dashboard TV) e a lista de Produtos (produtos_json,
// descrição + quantidade — a "medida" é a própria descrição, ex: "PNEU TBR
// 295/80R22.5"). Este painel soma tudo isso agrupado por Cliente × Medida
// × Fase, só com o que passar pelos filtros escolhidos.
//
// Escopo de fase (confirmado com o Ayslan, 06/09/2026): só processos "em
// andamento" nas fases PI Recebida, Aguardando Embarque, Embarcado,
// Desembarcado e Registro DI — ou seja, o pneu já foi pedido/está a
// caminho/chegou mas ainda não virou estoque disponível (Parametrização
// em diante) nem foi finalizado. Cada fase pode ser ligada/desligada no
// filtro; processos cancelados nunca entram, filtro nenhum traz eles de
// volta.
//
// Parte do controle_v2.html, carregado via <script src> — não é ES module.
// Depende de: _processos, calcularFase, FASE_LABEL, parseVendas, esc(),
// fecharTodosDashboards (controle-core.js).

// Normaliza nome de Fornecedor/Marca só pra efeito de AGRUPAMENTO —
// maiúsculas, sem acento, sem nenhum espaço ou pontuação — assim
// "JIMI RUBBER PTE. LTD." e "JIMI RUBBER PTE.LTD." caem na mesma chave.
// Nunca usado pra exibir o nome, só pra decidir se duas grafias são a
// mesma empresa.
function _cmChaveEmpresa(nome){
  return (nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
}

const FASES_CLIENTE_MEDIDA = ['PI','AGUARDANDO_EMBARQUE','EMBARCADO','DESEMBARCADO','REGISTRO_DI'];
const FASES_CLIENTE_MEDIDA_SET = new Set(FASES_CLIENTE_MEDIDA);
// Cabeçalho curto de cada coluna — mais enxuto que o label completo de
// FASE_LABEL ("Ag. Embarque" em vez de repetir "Aguardando Embarque" numa
// coluna estreita).
const FASE_COLUNA_LABEL = {
  PI: 'PI Recebida',
  AGUARDANDO_EMBARQUE: 'Ag. Embarque',
  EMBARCADO: 'Embarcado',
  DESEMBARCADO: 'Desembarcado',
  REGISTRO_DI: 'Registro DI',
};

// Estado dos filtros — guardado fora da função pra sobreviver aos
// re-renders disparados a cada interação (sem isso, cada seleção
// "esqueceria" o que já tinha sido escolhido a cada re-render).
let _cmFiltroTexto = '';       // busca livre (medida)
let _cmFiltroCliente = '';     // '' = todos
let _cmFiltroFornecedor = '';  // '' = todos
let _cmFiltroMarca = '';       // '' = todas
let _cmFasesAtivas = new Set(FASES_CLIENTE_MEDIDA); // fases marcadas nos checkboxes
let _cmIntervaloId = null; // id do setInterval de auto-refresh (null = parado)
// Snapshot da última lista renderizada (Cliente → Marca → Pedidos), usado
// pelos exports Excel/PDF (pedido do Ayslan 08/09/2026: "é possivel
// exportar no modelo que te mandei em excel e/ou pdf?") — assim o arquivo
// exportado é SEMPRE exatamente o que está na tela (mesmos filtros/fases
// ativos), sem recalcular a agregação de novo nem arriscar divergir dela.
let _cmUltimoResultado = null;

function toggleDashClienteMedida(){
  const el = document.getElementById('dash-clientemedida');
  if(!el) return;
  const visivel = el.style.display !== 'none';
  if(!visivel) fecharTodosDashboards();
  document.querySelector('.table-wrap') && (document.querySelector('.table-wrap').style.display = visivel ? '' : 'none');
  el.style.display = visivel ? 'none' : 'block';
  if(!visivel){
    renderDashClienteMedida();
    _cmIniciarAutoRefresh();
  } else {
    _cmPararAutoRefresh();
  }
  document.getElementById('menu-clientemedida')?.classList.toggle('active', !visivel);
}

// Atualiza sozinho a cada 2 min — pedido do Ayslan (07/09/2026), depois de
// perguntar se 2 min "sobrecarrega o sistema": não sobrecarrega, porque o
// _processos já é recarregado do servidor a cada 30s em background (loop
// global que já existe independente deste dashboard) — aqui a gente só
// RE-RENDERIZA a partir do que já está em memória, sem nenhuma requisição
// extra. Para sozinho se o painel for fechado por qualquer caminho
// (inclusive fecharTodosDashboards() de outro dashboard sendo aberto),
// checando a visibilidade a cada tick em vez de depender de um evento
// explícito de "fechou".
function _cmIniciarAutoRefresh(){
  _cmPararAutoRefresh();
  _cmIntervaloId = setInterval(() => {
    const el = document.getElementById('dash-clientemedida');
    if(!el || el.style.display !== 'block'){ _cmPararAutoRefresh(); return; }
    renderDashClienteMedida();
  }, 2 * 60 * 1000);
}
function _cmPararAutoRefresh(){
  if(_cmIntervaloId){ clearInterval(_cmIntervaloId); _cmIntervaloId = null; }
}

let _cmDebounceFiltroTexto = null; // timer do debounce da busca por medida

// Bug reportado pelo Ayslan (07/09/2026): digitar no campo de busca fazia o
// texto "sumir"/parar de aparecer, como se não desse pra digitar. Causa: a
// cada tecla, renderDashClienteMedida() reconstruía a tabela INTEIRA (527
// processos) e recriava o próprio <input> do zero — se uma tecla mais
// lenta terminasse de renderizar DEPOIS de uma tecla mais rápida seguinte,
// a renderização antiga "vencia" por último e sobrescrevia o campo com um
// valor desatualizado, fora de sincronia com o que você via na tela.
// Correção: o valor digitado é salvo na hora (_cmFiltroTexto), mas a
// renderização pesada só acontece depois de uma pequena pausa na digitação
// (debounce) — assim nunca tem duas renderizações concorrentes disputando
// o mesmo campo, e a digitação em si (que o próprio campo já mostra
// nativamente, sem precisar de JS) nunca é interrompida.
function _cmAtualizarFiltroTexto(valor){
  _cmFiltroTexto = valor || '';
  if(_cmDebounceFiltroTexto) clearTimeout(_cmDebounceFiltroTexto);
  _cmDebounceFiltroTexto = setTimeout(() => {
    renderDashClienteMedida();
    // Mantém o foco e o cursor no campo depois do re-render (senão a
    // tecla que disparou o re-render final perde o foco, porque o
    // innerHTML inteiro é recriado).
    const input = document.getElementById('cm-filtro-texto');
    if(input){
      input.focus();
      const pos = input.value.length;
      input.setSelectionRange(pos, pos);
    }
  }, 250);
}
function _cmSetFiltroSelect(campo, valor){
  if(campo === 'cliente') _cmFiltroCliente = valor;
  else if(campo === 'fornecedor') _cmFiltroFornecedor = valor;
  else if(campo === 'marca') _cmFiltroMarca = valor;
  renderDashClienteMedida();
}
function _cmToggleFase(fase, marcado){
  if(marcado) _cmFasesAtivas.add(fase);
  else _cmFasesAtivas.delete(fase);
  renderDashClienteMedida();
}
function _cmLimparFiltros(){
  if(_cmDebounceFiltroTexto) clearTimeout(_cmDebounceFiltroTexto);
  _cmFiltroTexto = '';
  _cmFiltroCliente = '';
  _cmFiltroFornecedor = '';
  _cmFiltroMarca = '';
  _cmFasesAtivas = new Set(FASES_CLIENTE_MEDIDA);
  renderDashClienteMedida();
}

function renderDashClienteMedida(){
  const el = document.getElementById('dash-clientemedida-content');
  if(!el) return;

  // ── Passo 1: opções dos selects (Cliente/Fornecedor/Marca) ─────────
  // Calculadas a partir de TODOS os processos elegíveis (fase certa, não
  // cancelado), ignorando os filtros já escolhidos — assim as opções da
  // lista nunca "somem" quando você já filtrou por outra coisa; só o
  // conteúdo da tabela embaixo é que reage aos filtros.
  // Mapa chave-normalizada -> label exibido (a primeira grafia encontrada
  // "vence" e vira o rótulo do filtro/coluna pra aquela empresa).
  const clientesDisponiveis = new Map();
  const fornecedoresDisponiveis = new Map();
  const marcasDisponiveis = new Map();
  // chaveFn default = identidade (maiúsculas/trim) usada pro Cliente — o
  // Cliente já é comparado assim no resto do código (chaveCliente em
  // addItem). Fornecedor/Marca usam _cmChaveEmpresa (ignora pontuação e
  // espaço) pra agrupar grafias diferentes da mesma empresa.
  function _cmAddOpcao(mapa, nome, chaveFn){
    const label = (nome || '').trim();
    if(!label) return;
    const chave = (chaveFn || (s => s.toUpperCase()))(label);
    if(!mapa.has(chave)) mapa.set(chave, label);
  }
  _processos.forEach(p => {
    if(p.cancelado) return;
    if(!FASES_CLIENTE_MEDIDA_SET.has(calcularFase(p))) return;
    const vendas = typeof parseVendas === 'function' ? parseVendas(p) : [];
    if(vendas.length) vendas.forEach(v => _cmAddOpcao(clientesDisponiveis, v.cliente || p.cliente || 'Sem cliente'));
    else _cmAddOpcao(clientesDisponiveis, p.cliente || 'Sem cliente');
    _cmAddOpcao(fornecedoresDisponiveis, p.fornecedor || 'Sem fornecedor', _cmChaveEmpresa);
    _cmAddOpcao(marcasDisponiveis, p.brand || p.fornecedor || 'Sem marca', _cmChaveEmpresa);
  });

  // ── Passo 2: agregação Cliente → Marca → Pedido (Invoice), já com os
  // filtros ──────────────────────────────────────────────────────────
  // V5 (08/09/2026, pedido do Ayslan: mostrou a planilha pessoal da Paula
  // "PEDIDOS TWI" — Cliente → Marca/Fábrica → um bloco por Invoice, com
  // Medida/Qte/4 datas/Porto — e perguntou "voce consegue fazer igual?").
  // Confirmado com o Ayslan que os DADOS continuam vindo só do sistema
  // (_processos) — a planilha foi só a referência visual de como já é
  // feito hoje, nunca uma fonte de importação. Cada processo vira um
  // "pedido" (linha de Invoice) dentro da Marca do Cliente; quando o
  // processo tem mais de um Produto (produtos_json), a 1ª linha leva
  // Invoice/Datas/Porto e as linhas seguintes só Medida/Qte — igual à
  // planilha.
  const porCliente = {}; // chave (CLIENTE em caixa alta) -> {nome, porMarca:{}, total}
  let totalGeral = 0;
  const processosContadosIds = new Set();

  function fmtData(d){
    if(!d) return null;
    try{ return new Date(d+'T00:00:00').toLocaleDateString('pt-BR'); }catch(e){ return d; }
  }
  // Data "real" tem prioridade; sem ela, cai pra previsão (ETD/ETA/Previsão
  // Prontidão) marcada como tal (itálico + "(prev.)" na exibição) — sem
  // data nenhuma, mostra "—". Nunca inventa nem copia valor da planilha.
  function celulaData(realISO, previstoISO){
    if(realISO) return { texto: fmtData(realISO), previsto: false };
    if(previstoISO) return { texto: fmtData(previstoISO), previsto: true };
    return { texto: '—', previsto: false };
  }

  function addPedido(clienteNomeOriginal, marcaOriginal, p, itens, fase){
    const clienteNome = (clienteNomeOriginal || 'Sem cliente').trim() || 'Sem cliente';
    if(_cmFiltroCliente && clienteNome.toUpperCase() !== _cmFiltroCliente.toUpperCase()) return;
    const chaveCliente = clienteNome.toUpperCase();
    const marcaNome = (marcaOriginal || 'Sem marca').trim() || 'Sem marca';
    const chaveMarca = _cmChaveEmpresa(marcaNome);

    if(!porCliente[chaveCliente]) porCliente[chaveCliente] = { nome: clienteNome, porMarca: {}, total: 0 };
    const cli = porCliente[chaveCliente];
    if(!cli.porMarca[chaveMarca]) cli.porMarca[chaveMarca] = { nome: marcaNome, pedidos: {}, total: 0 };
    const marcaBucket = cli.porMarca[chaveMarca];

    // Chave do pedido = processo + cliente (um processo vendido pra mais
    // de um cliente vira um "pedido" por cliente, cada um só com os itens
    // que couberam àquela venda).
    const chavePedido = p.id + '||' + chaveCliente;
    if(!marcaBucket.pedidos[chavePedido]){
      const dtChegadaOuEta = p.data_chegada || p.eta;
      marcaBucket.pedidos[chavePedido] = {
        id: p.id,
        referencia: p.referencia || '—',
        porto: (typeof formatarPortoDestino === 'function' ? formatarPortoDestino(p.porto_destino) : p.porto_destino) || '',
        dataPedido: celulaData(p.pi_data),
        prontidao: celulaData(p.data_prontidao, p.previsao_prontidao),
        embarque: celulaData(p.data_embarque, p.etd),
        chegada: celulaData(p.data_chegada, p.eta),
        // Timestamp puro (não formatado) só pra ordenar — pedido do Ayslan
        // (08/09/2026): "precisa ordenar por data de chegada antes (o mais
        // proximo) vir em cima, sempre". Chegada REAL tem prioridade; sem
        // ela, usa a previsão (ETA) — mesmo critério já usado no Exportar
        // p/ Cliente (montarLinhasFollowUpCliente). Sem nenhuma das duas,
        // fica pro final (Infinity), nunca no topo.
        _chegadaTs: dtChegadaOuEta ? parseDataLocal(dtChegadaOuEta).getTime() : Infinity,
        itens: [],
        qtd: 0,
      };
    }
    const pedido = marcaBucket.pedidos[chavePedido];
    (itens || []).forEach(it => {
      const qtd = parseFloat(it.quantidade) || 0;
      const descricao = (it.descricao || 'Sem medida informada').trim() || 'Sem medida informada';
      pedido.itens.push({ descricao, qtd });
      pedido.qtd += qtd;
      marcaBucket.total += qtd;
      cli.total += qtd;
      totalGeral += qtd;
    });
    processosContadosIds.add(p.id);
  }

  _processos.forEach(p => {
    if(p.cancelado) return;
    const fase = calcularFase(p);
    if(!_cmFasesAtivas.has(fase)) return;

    const fornecedor = (p.fornecedor || 'Sem fornecedor').trim() || 'Sem fornecedor';
    if(_cmFiltroFornecedor && _cmChaveEmpresa(fornecedor) !== _cmFiltroFornecedor) return;
    const marca = (p.brand || p.fornecedor || 'Sem marca').trim() || 'Sem marca';
    if(_cmFiltroMarca && _cmChaveEmpresa(marca) !== _cmFiltroMarca) return;

    let produtos = [];
    try{ produtos = JSON.parse(p.produtos_json || '[]'); }catch(e){ /* ignora produtos_json inválido */ }
    if(!Array.isArray(produtos) || !produtos.length){
      if(p.produto) produtos = [{ descricao: p.produto, quantidade: null }];
    }

    // Processo vendido pra mais de um cliente (aba Vendas): usa o cliente
    // e os itens de CADA venda, em vez do proc.cliente único — reflete
    // corretamente quem vai ficar com qual medida. Sem venda cadastrada
    // (o normal pra processo ainda em andamento), cai no caso simples:
    // 1 cliente (proc.cliente), a lista de Produtos inteira.
    const vendas = typeof parseVendas === 'function' ? parseVendas(p) : [];
    if(vendas.length){
      vendas.forEach(v => {
        const itens = (v.itens && v.itens.length) ? v.itens : produtos;
        addPedido(v.cliente || p.cliente, marca, p, itens, fase);
      });
    } else {
      addPedido(p.cliente, marca, p, produtos, fase);
    }
  });
  const processosConsiderados = processosContadosIds.size;

  // ── Filtro de busca livre (medida/invoice/marca) ────────────────────
  // Mesma lógica de antes: se o termo bate no nome do CLIENTE, mantém
  // tudo dele; senão, filtra Marca → Pedido pelo termo (referência,
  // marca ou descrição de algum item) e descarta o que sobrar vazio.
  const termo = _cmFiltroTexto.trim().toLowerCase();
  let clientesLista = Object.entries(porCliente).map(([chave, dados]) => ({ chave, ...dados }));
  if(termo){
    clientesLista = clientesLista
      .map(c => {
        const nomeBate = c.nome.toLowerCase().includes(termo);
        if(nomeBate) return c;
        const porMarcaFiltrado = {};
        let totalFiltrado = 0;
        Object.entries(c.porMarca).forEach(([chaveMarca, m]) => {
          const marcaBate = m.nome.toLowerCase().includes(termo);
          const pedidosFiltrados = {};
          let totalMarca = 0;
          Object.entries(m.pedidos).forEach(([chavePedido, ped]) => {
            const bate = marcaBate
              || (ped.referencia || '').toLowerCase().includes(termo)
              || ped.itens.some(it => it.descricao.toLowerCase().includes(termo));
            if(bate){ pedidosFiltrados[chavePedido] = ped; totalMarca += ped.qtd; }
          });
          if(Object.keys(pedidosFiltrados).length){
            porMarcaFiltrado[chaveMarca] = { nome: m.nome, pedidos: pedidosFiltrados, total: totalMarca };
            totalFiltrado += totalMarca;
          }
        });
        return { ...c, porMarca: porMarcaFiltrado, total: totalFiltrado };
      })
      .filter(c => Object.keys(c.porMarca).length > 0);
  }
  clientesLista.sort((a,b) => b.total - a.total);

  // Snapshot pros exports Excel/PDF (ver exportarCMExcel/exportarCMPDF mais
  // abaixo) — sempre o que está na tela agora, com os mesmos filtros.
  _cmUltimoResultado = { clientesLista, totalGeral, processosConsiderados };

  const fmtN = v => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  // Uma linha na exibição = uma "célula de data" — mostra a data real em
  // negrito normal; sem data real, mostra a previsão em itálico com
  // "(prev.)"; sem nenhuma das duas, um traço cinza.
  function celDataHtml(d){
    if(!d || d.texto === '—') return `<span style="color:var(--border);">—</span>`;
    if(d.previsto) return `<span style="color:var(--muted);font-style:italic;">${esc(d.texto)} <span style="font-size:9px;">(prev.)</span></span>`;
    return esc(d.texto);
  }

  // Um "pedido" (Invoice) vira 1+ linhas de tabela: a 1ª linha leva
  // Invoice/Datas/Porto (rowspan cobrindo todas as linhas do pedido) +
  // Medida/Qte do 1º item; linhas seguintes (quando o processo tem mais
  // de 1 Produto) só repetem Medida/Qte — igual ao formato da planilha
  // "PEDIDOS TWI" mostrada pelo Ayslan (linhas de produto extra do mesmo
  // Invoice não repetem Invoice/Datas/Porto).
  function linhasPedido(pedido){
    const itens = pedido.itens.length ? pedido.itens : [{ descricao: '—', qtd: 0 }];
    const n = itens.length;
    return itens.map((it, i) => {
      const onclick = `onclick="abrirProcesso('${pedido.id}')" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''" style="cursor:pointer;${i===0?'border-top:1px solid var(--border);':''}"`;
      if(i === 0){
        return `<tr ${onclick}>
          <td rowspan="${n}" style="padding:6px 10px;font-weight:700;white-space:nowrap;text-align:center;vertical-align:middle;border-right:1px solid var(--border);">${esc(pedido.referencia)}</td>
          <td style="padding:6px 10px;text-align:center;white-space:nowrap;">${esc(it.descricao)}</td>
          <td style="padding:6px 10px;text-align:center;white-space:nowrap;">${fmtN(it.qtd)}</td>
          <td rowspan="${n}" style="padding:6px 10px;text-align:center;white-space:nowrap;vertical-align:middle;border-left:1px solid var(--border);">${celDataHtml(pedido.dataPedido)}</td>
          <td rowspan="${n}" style="padding:6px 10px;text-align:center;white-space:nowrap;vertical-align:middle;">${celDataHtml(pedido.prontidao)}</td>
          <td rowspan="${n}" style="padding:6px 10px;text-align:center;white-space:nowrap;vertical-align:middle;">${celDataHtml(pedido.embarque)}</td>
          <td rowspan="${n}" style="padding:6px 10px;text-align:center;white-space:nowrap;vertical-align:middle;">${celDataHtml(pedido.chegada)}</td>
          <td rowspan="${n}" style="padding:6px 10px;text-align:center;white-space:nowrap;vertical-align:middle;">${esc(pedido.porto || '—')}</td>
        </tr>`;
      }
      return `<tr ${onclick}>
        <td style="padding:6px 10px;text-align:center;white-space:nowrap;">${esc(it.descricao)}</td>
        <td style="padding:6px 10px;text-align:center;white-space:nowrap;">${fmtN(it.qtd)}</td>
      </tr>`;
    }).join('');
  }

  function blocoMarca(m){
    const pedidos = Object.values(m.pedidos).sort((a,b) => a._chegadaTs - b._chegadaTs || (a.referencia||'').localeCompare(b.referencia||'', 'pt-BR', { numeric: true }));
    return `<div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg);border-radius:6px;margin-bottom:4px;">
        <span style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.3px;">${esc(m.nome)}</span>
        <span style="font-weight:700;font-size:12px;color:var(--ac);">${fmtN(m.total)} <span style="font-weight:600;color:var(--muted);font-size:10px;">pneus</span></span>
      </div>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:780px;">
        <thead><tr style="text-align:center;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;">
          <th style="padding:6px 10px;text-align:center;border-right:1px solid var(--border);">Invoice</th>
          <th style="padding:6px 10px;text-align:center;">Medida</th>
          <th style="padding:6px 10px;text-align:center;">Qte</th>
          <th style="padding:6px 10px;text-align:center;border-left:1px solid var(--border);">Data do Pedido</th>
          <th style="padding:6px 10px;text-align:center;">Data de Prontidão</th>
          <th style="padding:6px 10px;text-align:center;">Data de Embarque</th>
          <th style="padding:6px 10px;text-align:center;">Data Chegada</th>
          <th style="padding:6px 10px;text-align:center;">Porto</th>
        </tr></thead>
        <tbody>${pedidos.map(linhasPedido).join('')}</tbody>
      </table>
      </div>
    </div>`;
  }

  function blocoCliente(c){
    const marcas = Object.values(c.porMarca).sort((a,b) => {
      const da = Math.min(...Object.values(a.pedidos).map(p => p._chegadaTs));
      const db = Math.min(...Object.values(b.pedidos).map(p => p._chegadaTs));
      return da - db || a.nome.localeCompare(b.nome, 'pt-BR');
    });
    return `<details style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden;" ${clientesLista.length===1?'open':''}>
      <summary style="cursor:pointer;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;list-style:none;background:var(--bg);">
        <span style="font-weight:700;font-size:13px;">${esc(c.nome)}</span>
        <span style="font-weight:800;font-size:15px;color:var(--ac);font-family:'DM Sans',sans-serif;">${fmtN(c.total)} <span style="font-size:11px;font-weight:600;color:var(--muted);">pneus</span></span>
      </summary>
      <div style="padding:10px 12px;">
        ${marcas.map(blocoMarca).join('')}
      </div>
    </details>`;
  }

  const corpoHtml = clientesLista.length
    ? clientesLista.map(blocoCliente).join('')
    : `<div style="font-size:13px;color:var(--muted);padding:20px 0;text-align:center;">${(termo||_cmFiltroCliente||_cmFiltroFornecedor||_cmFiltroMarca) ? 'Nenhum resultado para os filtros escolhidos.' : 'Nenhum processo em andamento no momento.'}</div>`;

  function selectFiltro(campo, label, valorAtual, opcoesMap){
    // opcoesMap: chave normalizada -> label exibido. O <option value> é a
    // chave normalizada (pra bater com o que o filtro compara), o texto é
    // sempre a grafia original.
    const entradas = [...opcoesMap.entries()].sort((a,b) => a[1].localeCompare(b[1],'pt-BR'));
    const opts = ['<option value="">Todos'+(label==='Cliente'?' os clientes':label==='Fornecedor'?' os fornecedores':' as marcas')+'</option>']
      .concat(entradas.map(([chave,lbl]) => `<option value="${esc(chave)}" ${chave===valorAtual?'selected':''}>${esc(lbl)}</option>`));
    return `<select onchange="_cmSetFiltroSelect('${campo}',this.value)" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--text);outline:none;min-width:170px;flex:1;">
      ${opts.join('')}
    </select>`;
  }

  const temFiltroAtivo = _cmFiltroTexto || _cmFiltroCliente || _cmFiltroFornecedor || _cmFiltroMarca || _cmFasesAtivas.size !== FASES_CLIENTE_MEDIDA.length;

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="background:#fff;border:1px solid var(--border);border-left:3px solid var(--ac);border-radius:10px;padding:12px 16px;flex:1;min-width:160px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Total de Pneus</div>
        <div style="font-size:22px;font-weight:800;color:var(--ac);font-family:'DM Sans',sans-serif;">${fmtN(totalGeral)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Considerando os filtros abaixo</div>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-left:3px solid #64748b;border-radius:10px;padding:12px 16px;flex:1;min-width:160px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Clientes</div>
        <div style="font-size:22px;font-weight:800;color:var(--text);font-family:'DM Sans',sans-serif;">${Object.keys(porCliente).length}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${processosConsiderados} processo(s) considerados</div>
      </div>
    </div>

    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        ${selectFiltro('cliente','Cliente',_cmFiltroCliente,clientesDisponiveis)}
        ${selectFiltro('fornecedor','Fornecedor',_cmFiltroFornecedor,fornecedoresDisponiveis)}
        ${selectFiltro('marca','Marca',_cmFiltroMarca,marcasDisponiveis)}
        <input id="cm-filtro-texto" class="form-input" placeholder="Buscar invoice, medida ou marca (ex: 295/80R22.5)..." value="${esc(_cmFiltroTexto)}"
          oninput="_cmAtualizarFiltroTexto(this.value)" style="flex:2;min-width:200px;">
        ${temFiltroAtivo ? `<button class="btn btn-outline" onclick="_cmLimparFiltros()" style="white-space:nowrap;">✕ Limpar filtros</button>` : ''}
        <button class="btn btn-outline" onclick="exportarCMExcel()" style="white-space:nowrap;">📊 Exportar Excel</button>
        <button class="btn btn-outline" onclick="exportarCMPDF()" style="white-space:nowrap;">📄 Exportar PDF</button>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text);">
        ${FASES_CLIENTE_MEDIDA.map(f => `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" ${_cmFasesAtivas.has(f)?'checked':''} onchange="_cmToggleFase('${f}',this.checked)"> ${FASE_COLUNA_LABEL[f]}
        </label>`).join('')}
      </div>
    </div>

    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Agrupado por Cliente → Marca/Fábrica → Invoice. Clique numa linha pra abrir o processo.</div>
    <div>${corpoHtml}</div>
  `;
}

// ── EXPORT EXCEL / PDF (pedido do Ayslan, 08/09/2026: "é possivel exportar
// no modelo que te mandei em excel e/ou pdf?", mostrando a planilha
// pessoal do despachante "PEDIDOS TWI") ──────────────────────────────────
// Usa o snapshot _cmUltimoResultado (preenchido no fim de
// renderDashClienteMedida) — o arquivo exportado é sempre exatamente o que
// está na tela, com os mesmos filtros/fases ativos. Uma aba/página por
// Cliente, agrupado por Marca, com Invoice/Datas/Porto mesclados quando o
// pedido tem mais de uma Medida — igual ao modelo mostrado.
const CM_EXPORT_COLUNAS = ['Invoice','Medida','Qte','Data do Pedido','Data de Prontidão na Fábrica','Data de Embarque','Data Chegada','Porto'];
const CM_EXPORT_LARGURAS = {Invoice:14,Medida:28,Qte:8,'Data do Pedido':16,'Data de Prontidão na Fábrica':22,'Data de Embarque':16,'Data Chegada':16,Porto:14};
// Colunas que vem do PEDIDO (repetem em toda linha do mesmo Invoice) — por
// isso mescladas verticalmente em vez de repetidas, igual ao modelo.
const CM_EXPORT_COLUNAS_PEDIDO = new Set(['Invoice','Data do Pedido','Data de Prontidão na Fábrica','Data de Embarque','Data Chegada','Porto']);

function _cmTextoData(d){
  if(!d || d.texto === '—') return '—';
  return d.previsto ? `${d.texto} (previsto)` : d.texto;
}

// Nome de aba do Excel: máx 31 caracteres, sem os caracteres que o Excel
// proíbe, e sem repetir nome entre clientes com grafia parecida (ex: dois
// clientes cujo nome só difere depois do caractere 31).
function _cmNomeAba(nome, usados){
  let base = (nome || 'Cliente').replace(/[\\\/\?\*\[\]:]/g,'').substring(0,31).trim() || 'Cliente';
  let final = base;
  let n = 2;
  while(usados.has(final.toUpperCase())){
    const sufixo = ' ('+n+')';
    final = base.substring(0, 31-sufixo.length) + sufixo;
    n++;
  }
  usados.add(final.toUpperCase());
  return final;
}

// Resumo por cliente (pedido do Ayslan, 08/09/2026: "colocar o total de
// pneus pedido por medida" + "quantos tem previsto embarque e o total" +
// "quantos tem embarcado e o total") — agrega, através de TODAS as
// marcas/pedidos do cliente: (a) total de pneus por Medida; (b) quantos
// pedidos (Invoices) têm só previsão de embarque (ETD, ainda sem embarque
// real) e o total de pneus deles; (c) quantos já embarcaram de verdade
// (Data de Embarque real preenchida) e o total de pneus deles. Usa o
// mesmo pedido (nível Invoice, não item) pra contar "quantos", e soma
// pedido.qtd (todos os itens daquele Invoice) pro total — critério igual
// ao já usado em pedido.embarque (celulaData: previsto=true só quando não
// tem data real, texto!=='—' quando tem real ou previsão).
function _cmResumoCliente(c){
  const medidasMap = new Map(); // descrição -> qtd total
  let previstoCount = 0, previstoQtd = 0, embarcadoCount = 0, embarcadoQtd = 0;
  Object.values(c.porMarca).forEach(m => {
    Object.values(m.pedidos).forEach(pedido => {
      pedido.itens.forEach(it => {
        const key = it.descricao || 'Sem medida informada';
        medidasMap.set(key, (medidasMap.get(key) || 0) + (it.qtd || 0));
      });
      if(pedido.embarque && pedido.embarque.previsto){
        previstoCount++;
        previstoQtd += pedido.qtd;
      } else if(pedido.embarque && pedido.embarque.texto !== '—'){
        embarcadoCount++;
        embarcadoQtd += pedido.qtd;
      }
    });
  });
  const medidas = [...medidasMap.entries()]
    .map(([descricao, qtd]) => ({ descricao, qtd }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR', { numeric: true }));
  return { medidas, previstoCount, previstoQtd, embarcadoCount, embarcadoQtd };
}

async function exportarCMExcel(){
  if(!_cmUltimoResultado || !_cmUltimoResultado.clientesLista.length){
    showToast('Nenhum dado pra exportar com os filtros atuais','warn');
    return;
  }
  if(typeof ExcelJS === 'undefined'){
    showToast('Biblioteca de exportação ainda carregando, tente novamente em 1 segundo','err');
    return;
  }
  showToast('Gerando planilha...','info');
  try{
    const { CORES, estilizarTitulo, estilizarSubtitulo, estilizarHeaderCell, estilizarGrupoHeader, estilizarCelulaDado } = window.ExcelStyles;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'IMPAK';
    wb.created = new Date();
    const numCols = CM_EXPORT_COLUNAS.length;
    const nomesUsados = new Set();

    _cmUltimoResultado.clientesLista.forEach(c => {
      const ws = wb.addWorksheet(_cmNomeAba(c.nome, nomesUsados));

      ws.mergeCells(1,1,1,numCols);
      const titulo = ws.getCell(1,1);
      titulo.value = `PEDIDOS ${c.nome.toUpperCase()}`;
      estilizarTitulo(titulo, {size:14});
      ws.getRow(1).height = 28;

      ws.mergeCells(2,1,2,numCols);
      const agora = new Date();
      const sub = ws.getCell(2,1);
      sub.value = `Gerado em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — Total: ${c.total.toLocaleString('pt-BR')} pneus`;
      estilizarSubtitulo(sub);
      ws.getRow(2).height = 18;

      // ── Resumo (pedido do Ayslan, 08/09/2026): total por Medida +
      // quantos pedidos estão só com previsão de embarque x quantos já
      // embarcaram de fato, com o total de pneus de cada grupo. Fica
      // entre o subtítulo e a tabela principal, antes de tudo — pra dar
      // uma visão geral do cliente antes do detalhe por Invoice. ──────
      const resumo = _cmResumoCliente(c);
      let rowIdx = 3;

      ws.mergeCells(rowIdx,1,rowIdx,numCols);
      const resumoTitulo = ws.getCell(rowIdx,1);
      resumoTitulo.value = 'RESUMO POR MEDIDA';
      estilizarGrupoHeader(resumoTitulo);
      resumoTitulo.alignment = {vertical:'middle', horizontal:'center'};
      ws.getRow(rowIdx).height = 20;
      rowIdx++;

      resumo.medidas.forEach((md, idx) => {
        const row = ws.getRow(rowIdx);
        ws.mergeCells(rowIdx,1,rowIdx,2);
        const cMedida = row.getCell(1);
        cMedida.value = md.descricao;
        estilizarCelulaDado(cMedida, {idx, alinhamento:'left', size:10});
        const cQtd = row.getCell(3);
        cQtd.value = md.qtd;
        estilizarCelulaDado(cQtd, {idx, alinhamento:'center', size:10});
        rowIdx++;
      });

      rowIdx++; // linha em branco separando o resumo por medida do resumo de embarque

      ws.mergeCells(rowIdx,1,rowIdx,numCols);
      const cPrevisto = ws.getCell(rowIdx,1);
      cPrevisto.value = `Previsto embarque: ${resumo.previstoCount.toLocaleString('pt-BR')} pedido(s) — ${resumo.previstoQtd.toLocaleString('pt-BR')} pneus`;
      cPrevisto.font = {name:'Calibri', bold:true, size:10.5, color:{argb:CORES.AZUL_ESCURO}};
      cPrevisto.fill = {type:'pattern', pattern:'solid', fgColor:{argb:CORES.CINZA_CLARO}};
      cPrevisto.alignment = {vertical:'middle', horizontal:'left', indent:1};
      ws.getRow(rowIdx).height = 18;
      rowIdx++;

      ws.mergeCells(rowIdx,1,rowIdx,numCols);
      const cEmbarcado = ws.getCell(rowIdx,1);
      cEmbarcado.value = `Embarcado: ${resumo.embarcadoCount.toLocaleString('pt-BR')} pedido(s) — ${resumo.embarcadoQtd.toLocaleString('pt-BR')} pneus`;
      cEmbarcado.font = {name:'Calibri', bold:true, size:10.5, color:{argb:CORES.AZUL_ESCURO}};
      cEmbarcado.fill = {type:'pattern', pattern:'solid', fgColor:{argb:CORES.CINZA_CLARO}};
      cEmbarcado.alignment = {vertical:'middle', horizontal:'left', indent:1};
      ws.getRow(rowIdx).height = 18;
      rowIdx++;

      rowIdx++; // linha em branco antes da tabela principal

      const headerRowIdx = rowIdx;
      const headerRow = ws.getRow(headerRowIdx);
      CM_EXPORT_COLUNAS.forEach((col,i) => {
        const cell = headerRow.getCell(i+1);
        cell.value = col;
        estilizarHeaderCell(cell, {size:10.5});
      });
      headerRow.height = 30;
      ws.autoFilter = {from:{row:headerRowIdx,column:1}, to:{row:headerRowIdx,column:numCols}};
      ws.views = [{state:'frozen', ySplit:headerRowIdx}];

      rowIdx = headerRowIdx + 1;
      const marcas = Object.values(c.porMarca).sort((a,b) => {
        const da = Math.min(...Object.values(a.pedidos).map(p => p._chegadaTs));
        const db = Math.min(...Object.values(b.pedidos).map(p => p._chegadaTs));
        return da - db || a.nome.localeCompare(b.nome,'pt-BR');
      });
      marcas.forEach(m => {
        ws.mergeCells(rowIdx,1,rowIdx,numCols);
        const gcell = ws.getCell(rowIdx,1);
        gcell.value = m.nome.toUpperCase();
        estilizarGrupoHeader(gcell);
        gcell.alignment = {vertical:'middle', horizontal:'center'};
        gcell.border = {bottom:{style:'thin',color:{argb:CORES.BORDA}}};
        ws.getRow(rowIdx).height = 20;
        rowIdx++;

        const pedidos = Object.values(m.pedidos).sort((a,b) => a._chegadaTs - b._chegadaTs || (a.referencia||'').localeCompare(b.referencia||'','pt-BR',{numeric:true}));
        let idxZebra = 0;
        pedidos.forEach(pedido => {
          const itens = pedido.itens.length ? pedido.itens : [{descricao:'—', qtd:0}];
          const linhaInicioPedido = rowIdx;
          itens.forEach(it => {
            const row = ws.getRow(rowIdx);
            const valores = {
              Invoice: pedido.referencia,
              Medida: it.descricao,
              Qte: it.qtd,
              'Data do Pedido': _cmTextoData(pedido.dataPedido),
              'Data de Prontidão na Fábrica': _cmTextoData(pedido.prontidao),
              'Data de Embarque': _cmTextoData(pedido.embarque),
              'Data Chegada': _cmTextoData(pedido.chegada),
              Porto: pedido.porto || '—',
            };
            CM_EXPORT_COLUNAS.forEach((col,i) => {
              const cell = row.getCell(i+1);
              cell.value = valores[col];
              estilizarCelulaDado(cell, {idx: idxZebra, alinhamento: 'center', size:10});
            });
            rowIdx++;
          });
          idxZebra++;
          const linhaFimPedido = rowIdx - 1;
          if(linhaFimPedido > linhaInicioPedido){
            CM_EXPORT_COLUNAS.forEach((col,i) => {
              if(!CM_EXPORT_COLUNAS_PEDIDO.has(col)) return;
              ws.mergeCells(linhaInicioPedido, i+1, linhaFimPedido, i+1);
              ws.getCell(linhaInicioPedido, i+1).alignment = {vertical:'middle', horizontal:'center'};
            });
          }
        });
      });

      ws.mergeCells(rowIdx,1,rowIdx,numCols);
      const totalCell = ws.getCell(rowIdx,1);
      totalCell.value = `Total: ${c.total.toLocaleString('pt-BR')} pneus em ${marcas.length} marca(s)/fábrica(s)`;
      totalCell.font = {name:'Calibri', bold:true, italic:true, size:10, color:{argb:CORES.CINZA}};
      totalCell.alignment = {horizontal:'right'};
      ws.getRow(rowIdx).height = 20;

      CM_EXPORT_COLUNAS.forEach((col,i) => { ws.getColumn(i+1).width = CM_EXPORT_LARGURAS[col]||14; });
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IMPAK_PorClienteMedida_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`✓ Planilha exportada: ${_cmUltimoResultado.clientesLista.length} cliente(s)`,'ok');
  }catch(e){
    showToast('Erro ao exportar: '+e.message,'err');
    console.error(e);
  }
}

async function exportarCMPDF(){
  if(!_cmUltimoResultado || !_cmUltimoResultado.clientesLista.length){
    showToast('Nenhum dado pra exportar com os filtros atuais','warn');
    return;
  }
  if(typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined'){
    showToast('Biblioteca de PDF ainda carregando, tente novamente em 1 segundo','err');
    return;
  }
  showToast('Gerando PDF...','info');
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
    const clientesLista = _cmUltimoResultado.clientesLista;

    clientesLista.forEach((c, ci) => {
      if(ci > 0) doc.addPage();

      doc.setFontSize(14);
      doc.setTextColor(16,42,69);
      doc.setFont(undefined,'bold');
      doc.text(`PEDIDOS ${c.nome.toUpperCase()}`, 40, 40);
      doc.setFont(undefined,'normal');
      doc.setFontSize(9);
      doc.setTextColor(100,116,139);
      const agora = new Date();
      doc.text(`Gerado em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — Total: ${c.total.toLocaleString('pt-BR')} pneus`, 40, 56);

      // ── Resumo (pedido do Ayslan, 08/09/2026): total por Medida +
      // quantos pedidos estão só com previsão de embarque x quantos já
      // embarcaram de fato, com o total de pneus de cada grupo — mesmo
      // resumo do Excel (_cmResumoCliente), exibido numa tabelinha antes
      // da tabela principal do cliente. ───────────────────────────────
      const resumo = _cmResumoCliente(c);
      const resumoBody = resumo.medidas.map(md => [md.descricao, md.qtd.toLocaleString('pt-BR')]);
      resumoBody.push([
        { content: `Previsto embarque: ${resumo.previstoCount.toLocaleString('pt-BR')} pedido(s)`, styles:{fontStyle:'bold', fillColor:[245,247,251]} },
        { content: `${resumo.previstoQtd.toLocaleString('pt-BR')} pneus`, styles:{fontStyle:'bold', fillColor:[245,247,251]} },
      ]);
      resumoBody.push([
        { content: `Embarcado: ${resumo.embarcadoCount.toLocaleString('pt-BR')} pedido(s)`, styles:{fontStyle:'bold', fillColor:[245,247,251]} },
        { content: `${resumo.embarcadoQtd.toLocaleString('pt-BR')} pneus`, styles:{fontStyle:'bold', fillColor:[245,247,251]} },
      ]);
      doc.autoTable({
        startY: 66,
        head: [['Medida','Qte']],
        body: resumoBody,
        theme: 'grid',
        styles: { fontSize:8, cellPadding:3, valign:'middle', halign:'left', lineColor:[226,232,240], lineWidth:0.5 },
        headStyles: { fillColor:[26,127,212], textColor:255, fontStyle:'bold', fontSize:8.5, halign:'center' },
        columnStyles: { 0:{cellWidth:220}, 1:{cellWidth:90, halign:'center'} },
        margin: { left:40, right:40 },
        tableWidth: 'wrap',
      });
      const resumoFinalY = doc.lastAutoTable.finalY;

      const marcas = Object.values(c.porMarca).sort((a,b) => {
        const da = Math.min(...Object.values(a.pedidos).map(p => p._chegadaTs));
        const db = Math.min(...Object.values(b.pedidos).map(p => p._chegadaTs));
        return da - db || a.nome.localeCompare(b.nome,'pt-BR');
      });
      const body = [];
      marcas.forEach(m => {
        body.push([{ content: m.nome.toUpperCase(), colSpan: CM_EXPORT_COLUNAS.length, styles:{fillColor:[234,243,252], textColor:[16,42,69], fontStyle:'bold', halign:'center'} }]);
        const pedidos = Object.values(m.pedidos).sort((a,b) => a._chegadaTs - b._chegadaTs || (a.referencia||'').localeCompare(b.referencia||'','pt-BR',{numeric:true}));
        pedidos.forEach(pedido => {
          const itens = pedido.itens.length ? pedido.itens : [{descricao:'—', qtd:0}];
          const span = itens.length;
          itens.forEach((it, ii) => {
            const valoresPedido = {
              Invoice: pedido.referencia,
              'Data do Pedido': _cmTextoData(pedido.dataPedido),
              'Data de Prontidão na Fábrica': _cmTextoData(pedido.prontidao),
              'Data de Embarque': _cmTextoData(pedido.embarque),
              'Data Chegada': _cmTextoData(pedido.chegada),
              Porto: pedido.porto || '—',
            };
            const row = CM_EXPORT_COLUNAS.map(col => {
              if(col === 'Medida') return it.descricao || '';
              if(col === 'Qte') return it.qtd != null ? it.qtd.toLocaleString('pt-BR') : '';
              if(CM_EXPORT_COLUNAS_PEDIDO.has(col)){
                if(ii !== 0) return null; // coberto pelo rowSpan da linha âncora
                return span > 1 ? { content: valoresPedido[col]||'', rowSpan: span, styles:{valign:'middle'} } : (valoresPedido[col]||'');
              }
              return '';
            }).filter(v => v !== null);
            body.push(row);
          });
        });
      });

      doc.autoTable({
        startY: resumoFinalY + 16,
        head: [CM_EXPORT_COLUNAS],
        body,
        theme: 'grid',
        styles: { fontSize:8, cellPadding:4, valign:'middle', halign:'center', lineColor:[226,232,240], lineWidth:0.5 },
        headStyles: { fillColor:[16,42,69], textColor:255, fontStyle:'bold', fontSize:8.5, halign:'center' },
        margin: { left:40, right:40 },
      });
    });

    doc.save(`IMPAK_PorClienteMedida_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast(`✓ PDF exportado: ${clientesLista.length} cliente(s)`,'ok');
  }catch(e){
    showToast('Erro ao exportar PDF: '+e.message,'err');
    console.error(e);
  }
}
