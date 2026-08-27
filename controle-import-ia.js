// controle-import-ia.js
//
// Importação de planilha de fornecedor e extração de PI via IA (extrairComIA) — os dois fluxos de import de dados externos, e edição inline da lista (inlineEditData/inlineEditFase).
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
async function importarPlanilha(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  // Criar modal de diagnóstico visível na tela
  let logDiv = document.getElementById('import-log-modal');
  if(!logDiv){
    logDiv = document.createElement('div');
    logDiv.id = 'import-log-modal';
    logDiv.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:#0a2d5e;color:#fff;border-radius:12px;padding:16px 20px;min-width:320px;max-width:420px;font-size:12px;font-family:"DM Mono",monospace;max-height:300px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);';
    document.body.appendChild(logDiv);
  }
  logDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:13px;">📊 Importando: ${file.name}</div>`;
  const addLog = (msg, cor) => {
    const d = document.createElement('div');
    d.style.cssText = `color:${cor||'#fff'};padding:2px 0;`;
    d.textContent = msg;
    logDiv.appendChild(d);
    logDiv.scrollTop = logDiv.scrollHeight;
  };
  const fecharLog = (delay) => setTimeout(()=>{ if(logDiv) logDiv.remove(); }, delay||5000);

  showToast('Lendo planilha...','info');
  addLog('Lendo arquivo...', '#7dd3fc');

  try{
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const buf = await file.arrayBuffer();
    // raw:true para não converter datas automaticamente (evita conflito com cellDates)
    const wb = XLSX.read(buf, {type:'array', cellDates:true, raw:false});

    const processos = [];
    const refs = new Set(_processos.map(p=>p.referencia));

    function parseDate(v){
      if(!v) return null;
      if(v instanceof Date){
        if(isNaN(v.getTime())||v.getFullYear()<1950) return null;
        return v.toISOString().split('T')[0];
      }
      // Serial numérico do Excel (ex: 45667)
      if(typeof v === 'number' && v > 25000 && v < 60000){
        const d = new Date(Math.round((v - 25569) * 86400 * 1000));
        if(!isNaN(d.getTime())&&d.getFullYear()>=1950) return d.toISOString().split('T')[0];
      }
      const s = String(v).trim().split(/[\n\r]/)[0].trim();
      if(!s||s==='—'||s==='-') return null;
      const su = s.toUpperCase();
      if(su.includes('PRODUÇÃO')||su.includes('PRODUCAO')||su.includes('ANDAMENTO')||su.includes('PRODUC')) return null;

      // YYYY-MM-DD
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if(m){ const [,y,mo,d]=m; if(parseInt(y)>=1950) return `${y}-${mo}-${d}`; }

      // DD/MM/YYYY (formato brasileiro)
      m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if(m){
        const [,a,b,y]=m;
        if(parseInt(y)>=1950){
          // Verificar se é DD/MM ou MM/DD pela validade do mês
          if(parseInt(b)<=12) return `${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
          if(parseInt(a)<=12) return `${y}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`;
        }
      }

      // M/D/YYYY ou M/D/YY (formato americano do Excel/XLSX.js)
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if(m){
        let [,mo,d,y]=m;
        const year = y.length===2 ? (parseInt(y)>=50?'19'+y:'20'+y) : y;
        if(parseInt(year)>=1950 && parseInt(mo)>=1 && parseInt(mo)<=12 && parseInt(d)>=1 && parseInt(d)<=31){
          return `${year}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        // Tentar como DD/MM/YY se mês > 12
        if(parseInt(mo)>12 && parseInt(d)<=12){
          return `${year}-${d.padStart(2,'0')}-${mo.padStart(2,'0')}`;
        }
      }

      // Serial numérico como string (ex: "45667")
      const num = parseInt(s);
      if(!isNaN(num) && num > 25000 && num < 60000){
        const d2 = new Date(Math.round((num - 25569) * 86400 * 1000));
        if(!isNaN(d2.getTime())&&d2.getFullYear()>=1950) return d2.toISOString().split('T')[0];
      }

      return null;
    }
    function pStr(v){
      if(v===null||v===undefined) return null;
      const s = String(v).trim().replace(/\s+/g,' ');
      return s&&s!=='—'&&s!=='-'&&s!=='null'&&s.length>0 ? s : null;
    }
    // Finalidade: aceita "direto"/"própria", "encomenda", "conta e ordem" (livre, case-insensitive)
    function parseFinalidade(v){
      const s = pStr(v);
      if(!s) return null;
      const su = s.toUpperCase();
      if(su.includes('CONTA') && su.includes('ORDEM')) return 'CONTA_E_ORDEM';
      if(su.includes('ENCOMENDA')) return 'ENCOMENDA';
      if(su.includes('DIRET') || su.includes('PRÓPRIA') || su.includes('PROPRIA')) return 'IMPORTACAO_DIRETA';
      return null;
    }

    // Detectar tipo — mais tolerante
    const sheetNames = wb.SheetNames.map(s=>s.trim().toUpperCase());
    const isControle = sheetNames.includes('CONTROLE');
    const isFollowUp = sheetNames.includes('EM ANDAMENTO') || sheetNames.some(s=>s.includes('ANDAMENTO'));

    addLog(`Abas: ${wb.SheetNames.join(', ')}`, '#7dd3fc'); addLog(`isControle: ${isControle} | isFollowUp: ${isFollowUp}`, '#7dd3fc');

    if(!isControle && !isFollowUp){
      showToast('Planilha não reconhecida. Use a planilha Controle ou Follow Up.','err');
      return;
    }

    if(isControle){
      // Encontrar a aba correta (case-insensitive)
      const abaName = wb.SheetNames.find(s=>s.trim().toUpperCase()==='CONTROLE');
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[abaName], {header:1, defval:null, raw:false});
      addLog(`CONTROLE: ${rows.length} linhas | header: ${(rows[0]||[]).slice(0,3).join(', ')}`, '#7dd3fc');

      // Linha 1 = header, dados a partir de linha 2 (índice 1)
      for(let i=1;i<rows.length;i++){
        const r = rows[i];
        if(!r || !r[1]) continue;
        const ref = pStr(r[1]);
        if(!ref) continue;
        if(refs.has(ref)) continue;
        refs.add(ref);

        const prontidao = parseDate(r[11]);
        const embarque  = parseDate(r[12]);
        const chegada   = parseDate(r[13]);
        const presenca  = parseDate(r[14]);
        const retirada  = parseDate(r[19]);
        const dataRic   = parseDate(r[22]);
        const prevPront = parseDate(r[30]);
        const demurVenc = parseDate(r[18]);

        // Finalidade — coluna A do formato Controle
        const finalidade = parseFinalidade(r[0]);

        let fase='PI';
        if(dataRic)             fase='FINALIZADO';
        else if(retirada)       fase='CARREGAMENTO';  // retirada = carregamento já feito
        else if(presenca||chegada) fase='DESEMBARCADO';
        else if(embarque)       fase='EMBARCADO';
        else if(prevPront||prontidao) fase='AGUARDANDO_EMBARQUE';

        processos.push({
          referencia:        ref,
          finalidade,
          cliente:           pStr(r[2]),
          produto:           pStr(r[3]),
          fornecedor:        pStr(r[9]),
          porto_destino:     normalizarPortoDestino(pStr(r[8])),
          pi_data:           parseDate(r[10]),
          data_prontidao:    prontidao,
          previsao_prontidao:prevPront,
          data_embarque:     embarque,
          data_chegada:      chegada,
          data_presenca:     presenca,
          armador:           pStr(r[24]),
          agente:            pStr(r[31]),
          hbl:               pStr(r[32]),
          mbl:               pStr(r[33]),
          ce_master:         pStr(r[34]),
          ce_house:          pStr(r[35]),
          container:         pStr(r[36]),
          navio:             pStr(r[37]),
          numero_di:         pStr(r[38]),
          demurrage_vencimento: demurVenc,
          obs:               pStr(r[5]),
          pendencia_revisao: pStr(r[43]),
          fase,
          created_by:        'importacao_controle',
        });
      }
      addLog(`✓ CONTROLE: ${processos.length} processos mapeados`, '#86efac');
    }

    if(isFollowUp){
      for(const sheetName of wb.SheetNames.filter(s=>['EM ANDAMENTO','FINALIZADOS'].includes(s.trim().toUpperCase()))){
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:null, raw:false});
        addLog(`${sheetName}: ${rows.length} linhas`, '#7dd3fc');

        for(let i=1;i<rows.length;i++){
          const r = rows[i];
          if(!r||!r[0]) continue;
          const ref = pStr(r[0]);
          if(!ref) continue;
          if(refs.has(ref)) continue;
          refs.add(ref);

          const hblMbl = pStr(r[3]);
          const finalidade = parseFinalidade(r[1]);
          const partes = hblMbl ? hblMbl.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          const hbl = partes[0]||null;
          const mbl = partes[1]||null;

          // A célula de chegada tem 2 formatos possíveis (planilha Follow Up):
          //  - Já chegou:  "06/07/26\nNVT\n07/07"       → linha 1 = chegada efetiva, linha 3 = presença
          //  - Ainda não:  "ETA 13/07/26 - 13h\nIOA"     → é só previsão, NÃO é chegada efetiva
          // Antes o código jogava a linha 1 direto em "chegada" nos dois casos —
          // por isso uma previsão virava "já chegou" e pulava a fase pra Desembarcado.
          const chegadaStr = pStr(r[4]);
          const chegadaPartes = chegadaStr ? chegadaStr.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          let chegada = null, etaFollowUp = null;
          if(chegadaPartes[0]){
            if(chegadaPartes[0].toUpperCase().startsWith('ETA')){
              const m = chegadaPartes[0].match(/(\d{2}\/\d{2}\/\d{2,4})/);
              etaFollowUp = m ? parseDate(m[1]) : null;
            } else {
              chegada = parseDate(chegadaPartes[0]);
            }
          }

          const armAg = pStr(r[13]);
          const armadorPartes = armAg ? armAg.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          const armador = armadorPartes[0]||null;
          const agente = armadorPartes[1]||null;

          const ceMasterHouse = pStr(r[7]);
          const cePartes = ceMasterHouse ? ceMasterHouse.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          const ce_master = cePartes[0]||null;
          const ce_house = cePartes[1]||null;

          const di = pStr(r[8]);
          const status = pStr(r[14])||'';

          let fase = 'EMBARCADO';
          if(status.toLowerCase().includes('finaliz')) fase='FINALIZADO';
          else if(di) fase='REGISTRO_DI';
          else if(chegada) fase='DESEMBARCADO';

          processos.push({
            referencia:       ref,
            finalidade,
            fornecedor:       pStr(r[2]),
            hbl, mbl,
            ce_master, ce_house,
            data_chegada:     chegada,
            eta:              etaFollowUp,
            navio:            pStr(r[5]),
            numero_di:        di,
            data_registro_di: parseDate(r[9]),
            container:        pStr(r[11]),
            armador, agente, fase,
            obs:              status.slice(0,200)||null,
            created_by:       'importacao_followup',
          });
        }
      }
      addLog(`✓ FOLLOWUP: ${processos.length} processos mapeados`, '#86efac');
    }

    if(!processos.length){
      addLog('⚠ Nenhum processo novo (todos já existem ou planilha vazia)', '#fcd34d');
      fecharLog(8000);
      showToast('Nenhum processo novo encontrado','warn');
      return;
    }

    addLog(`Enviando ${processos.length} processos ao servidor...`, '#7dd3fc');
    showToast(`Importando ${processos.length} processos...`,'info');

    let total = 0, erros = 0;
    for(let i=0;i<processos.length;i+=50){
      const lote = processos.slice(i,i+50);
      try{
        const resp = await fetch('/api/controle/v2/importar',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({processos:lote})
        });
        const d = await resp.json();
        if(d.ok){ total += d.total||lote.length; addLog(`✓ Lote ${Math.floor(i/50)+1}: ${d.total||lote.length} salvos`, '#86efac'); }
        else { erros++; addLog(`✕ Lote erro: ${d.erro||'?'}`, '#fca5a5'); }
      }catch(e){ erros++; addLog(`✕ Fetch erro: ${e.message}`, '#fca5a5'); }
    }

    if(total > 0){
      addLog(`✅ ${total} processos importados!`, '#86efac');
      fecharLog(6000);
      showToast(`✓ ${total} processos importados${erros>0?' ('+erros+' com erro)':''}`, erros>0?'warn':'ok');
      await carregarProcessos(true);
    } else {
      addLog('✕ Zero processos importados — verifique os erros acima', '#fca5a5');
      fecharLog(10000);
      showToast('Erro ao importar. Veja o log na tela.','err');
    }
  }catch(e){
    if(typeof addLog === 'function') addLog(`✕ ERRO: ${e.message}`, '#fca5a5');
    showToast('Erro: '+e.message,'err');
    if(typeof fecharLog === 'function') fecharLog(10000);
  }
}

// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA DO DESPACHANTE ("Separa Data.xlsx", aba EM ANDAMENTO)
// ════════════════════════════════════════════════════════════════
// Planilha recorrente que o despachante manda com o status dos processos em
// andamento. Ao contrario de importarPlanilha() acima (que so CRIA processos
// novos), aqui o fluxo e o inverso: casa cada linha com um processo JA
// EXISTENTE (por referencia) e atualiza HBL/MBL/data de chegada/porto/navio/
// qtd de containers + acrescenta a "DEMANDA IMPAK" em Observacoes -- pedido da
// Emanuelly, 26/08/2026. O parse acontece no servidor (planilha-import.js:
// importarDespachanteBase), entao aqui so manda o arquivo em base64 e mostra
// o resumo devolvido (mesmo modal de diagnostico do importarPlanilha).
async function importarPlanilhaDespachante(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  let logDiv = document.getElementById('import-log-modal');
  if(!logDiv){
    logDiv = document.createElement('div');
    logDiv.id = 'import-log-modal';
    logDiv.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:#0a2d5e;color:#fff;border-radius:12px;padding:16px 20px;min-width:320px;max-width:420px;font-size:12px;font-family:"DM Mono",monospace;max-height:300px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);';
    document.body.appendChild(logDiv);
  }
  logDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:13px;">📦 Importando planilha do despachante: ${file.name}</div>`;
  const addLog = (msg, cor) => {
    const d = document.createElement('div');
    d.style.cssText = `color:${cor||'#fff'};padding:2px 0;`;
    d.textContent = msg;
    logDiv.appendChild(d);
    logDiv.scrollTop = logDiv.scrollHeight;
  };
  const fecharLog = (delay) => setTimeout(()=>{ if(logDiv) logDiv.remove(); }, delay||8000);

  showToast('Lendo planilha do despachante...','info');
  addLog('Enviando arquivo pro servidor...', '#7dd3fc');

  try{
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const resp = await fetch('/api/controle/v2/importar-despachante', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ arquivo_base64: base64 })
    });
    const data = await resp.json();
    if(!resp.ok || data.erro){
      addLog(`✕ ERRO: ${data.erro||'falha desconhecida'}`, '#fca5a5');
      showToast('Erro: '+(data.erro||'falha desconhecida'),'err');
      fecharLog(10000);
      return;
    }

    addLog(`${data.total_linhas} linha(s) na planilha`, '#7dd3fc');
    addLog(`✓ ${data.total_atualizados} processo(s) atualizado(s)`, '#86efac');
    if(data.total_sem_mudancas) addLog(`• ${data.total_sem_mudancas} sem mudanca (ja estavam com esses dados)`, '#93c5fd');
    if(data.total_nao_encontrados){
      addLog(`⚠ ${data.total_nao_encontrados} referencia(s) nao encontrada(s) no Controle:`, '#fcd34d');
      (data.resumo||[]).filter(r=>r.status==='nao_encontrado').forEach(r => addLog(`   ${r.referencia}`, '#fcd34d'));
    }
    (data.resumo||[]).filter(r=>r.status==='atualizado').forEach(r => addLog(`✓ ${r.referencia}: ${r.campos.join(', ')}`, '#86efac'));

    showToast(`Importacao concluida: ${data.total_atualizados} atualizado(s)`, 'ok');
    fecharLog(15000);
    if(typeof carregarProcessos === 'function') await carregarProcessos();
    if(typeof render === 'function') render();
  }catch(e){
    addLog(`✕ ERRO: ${e.message}`, '#fca5a5');
    showToast('Erro: '+e.message,'err');
    fecharLog(10000);
  }
}

// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA INTERNA (Manu/Emanuelly) — prontidao + booking/ETD
// ════════════════════════════════════════════════════════════════
async function importarPlanilhaManu(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  let logDiv = document.getElementById('import-log-modal');
  if(!logDiv){
    logDiv = document.createElement('div');
    logDiv.id = 'import-log-modal';
    logDiv.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:#0a2d5e;color:#fff;border-radius:12px;padding:16px 20px;min-width:320px;max-width:420px;font-size:12px;font-family:"DM Mono",monospace;max-height:300px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);';
    document.body.appendChild(logDiv);
  }
  logDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:13px;">📋 Importando planilha interna: ${file.name}</div>`;
  const addLog = (msg, cor) => {
    const d = document.createElement('div');
    d.style.cssText = `color:${cor||'#fff'};padding:2px 0;`;
    d.textContent = msg;
    logDiv.appendChild(d);
    logDiv.scrollTop = logDiv.scrollHeight;
  };
  const fecharLog = (delay) => setTimeout(()=>{ if(logDiv) logDiv.remove(); }, delay||8000);

  showToast('Lendo planilha interna...','info');
  addLog('Enviando arquivo pro servidor...', '#7dd3fc');

  try{
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const resp = await fetch('/api/controle/v2/importar-manu', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ arquivo_base64: base64 })
    });
    const data = await resp.json();
    if(!resp.ok || data.erro){
      addLog(`✕ ERRO: ${data.erro||'falha desconhecida'}`, '#fca5a5');
      showToast('Erro: '+(data.erro||'falha desconhecida'),'err');
      fecharLog(10000);
      return;
    }

    addLog(`${data.total_linhas} linha(s) na planilha`, '#7dd3fc');
    addLog(`✓ ${data.total_atualizados} processo(s) atualizado(s)`, '#86efac');
    if(data.total_sem_mudancas) addLog(`• ${data.total_sem_mudancas} sem mudanca (ja estavam com esses dados)`, '#93c5fd');
    if(data.total_nao_encontrados){
      addLog(`⚠ ${data.total_nao_encontrados} referencia(s) nao encontrada(s) no Controle:`, '#fcd34d');
      (data.resumo||[]).filter(r=>r.status==='nao_encontrado').forEach(r => addLog(`   ${r.referencia}`, '#fcd34d'));
    }
    (data.resumo||[]).filter(r=>r.status==='atualizado').forEach(r => addLog(`✓ ${r.referencia}: ${r.campos.join(', ')}`, '#86efac'));

    showToast(`Importacao concluida: ${data.total_atualizados} atualizado(s)`, 'ok');
    fecharLog(15000);
    if(typeof carregarProcessos === 'function') await carregarProcessos();
    if(typeof render === 'function') render();
  }catch(e){
    addLog(`✕ ERRO: ${e.message}`, '#fca5a5');
    showToast('Erro: '+e.message,'err');
    fecharLog(10000);
  }
}


// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA DE FECHAMENTO (aba Custos Reais, por processo)
// ════════════════════════════════════════════════════════════════
// Reaproveita POST /api/controle/importar-fechamento (server-side,
// planilha-import.js/parseFechamento) — mesmo parser já usado e testado
// pro Calculador, só que lendo a aba "Fechamento" do template BASE SP/SC em
// vez de DADOS/MIX. Botão fica dentro do processo (aba Custos Reais) — só
// existia via upload solto antes, sem nenhum gatilho na tela (ver histórico
// de tasks #188/#189: endpoint foi construído mas nunca ligado a um botão).
//
// Preenche só os campos "Pago" (f_cr_<item>) — nunca o "Cobrado" — porque a
// planilha de Fechamento só registra o que foi de fato desembolsado, não o
// preço cobrado do cliente. As datas (Embarque/Chegada/Registro DI) seguem
// a mesma regra "só preenche vazio" da extração por IA — não sobrescreve o
// que já estiver preenchido manualmente.
async function importarFechamentoProcesso(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  showToast('Lendo planilha de Fechamento...','info');

  try{
    const base64 = await new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

    const resp = await fetch('/api/controle/importar-fechamento', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({arquivo_base64: base64})
    });
    const d = await resp.json();
    if(!d.ok) throw new Error(d.erro || 'Erro ao ler a planilha');

    let preenchidos = 0;

    // Datas — Embarque/Chegada/Registro DI (aba Documentos/Logística)
    Object.entries(d.datas||{}).forEach(([campo, valor])=>{
      const el = document.getElementById('f_'+campo);
      if(el && !el.value){ el.value = valor; preenchidos++; }
    });

    // Custos reais — cada chave do real_json vira o campo "Pago" do item
    // correspondente na aba Custos Reais (f_cr_<id>). Só preenche campo
    // vazio, pra não sobrescrever o que o usuário já tiver lançado à mão.
    Object.entries(d.real_json||{}).forEach(([itemId, valor])=>{
      const el = document.getElementById('f_cr_'+itemId);
      if(el && !el.value){
        el.value = valor;
        const selMoeda = document.getElementById('f_cr_moeda_'+itemId);
        if(selMoeda && d.moedas && d.moedas[itemId]) selMoeda.value = d.moedas[itemId];
        el.style.borderColor='var(--ok)'; el.style.background='rgba(22,163,74,.04)';
        setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
        preenchidos++;
      }
    });
    if(typeof atualizarTotalCustosReais === 'function') atualizarTotalCustosReais();

    showToast(`✓ Planilha lida: ${preenchidos} campo${preenchidos===1?'':'s'} preenchido${preenchidos===1?'':'s'}. Revise e clique em Salvar.`, 'ok');
    if(Array.isArray(d.avisos) && d.avisos.length){
      d.avisos.forEach(av => showToast('⚠ '+av, 'warn'));
    }
  }catch(e){
    showToast('Erro ao importar planilha: '+e.message, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// EXTRAÇÃO COM IA
// ════════════════════════════════════════════════════════════════
async function extrairComIA_umArquivo(input){
  const file = input.files[0];
  if(!file) return;
  input.value='';

  const status = document.getElementById('ia-status');
  if(status) status.textContent = '⏳ Analisando documento...';

  try{
    // Converter para base64
    const base64 = await new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result.split(',')[1]);
      r.onerror=rej;
      r.readAsDataURL(file);
    });

    const isImg = file.type.startsWith('image/');
    // A chave da Anthropic é sempre a configurada no servidor (Railway).

    // Prompt de instruções: texto FIXO, idêntico em toda chamada (só muda o
    // documento anexado). Extraído numa constante própria e colocado ANTES do
    // documento no array `content`, marcado com cache_control — a API Anthropic
    // cacheia o PREFIXO da mensagem, então o bloco que não muda precisa vir
    // primeiro. Isso reduz o custo desse bloco (~12 mil tokens) para ~10% do
    // valor normal em chamadas subsequentes dentro da janela de cache (5 min),
    // sem alterar em nada o resultado da extração.
    const promptInstrucoes = `Extraia os dados deste documento de importação e retorne SOMENTE JSON com os campos disponíveis:
{
  "referencia": "",
  "fornecedor": "",  // razão social ou nome comercial da empresa EXPORTADORA/fabricante que vendeu e emitiu a PI/CI (ex: "Sailun Group") — quem efetivamente fatura e embarca a mercadoria, mesmo que o produto seja de uma marca diferente
  "brand": "",  // marca do PRODUTO/pneu impressa na PI/CI/embalagem (ex: "Maxam", "Triangle", "Linglong") — NÃO é o fornecedor. É comum o fornecedor real (quem fatura) ser diferente da marca do pneu (ex: fornecedor "Sailun Group" fabricando/vendendo pneus marca "Maxam") — extraia os dois separadamente, nunca use a marca como se fosse o fornecedor. Deixe "" se o documento não trouxer uma marca de produto distinta do nome do fornecedor.
  "produto": "",  // usar SOMENTE quando o documento tiver um único item/descrição corrida (ex: CI com texto livre) — extrair de: Description of Goods, Cargo Description, Item Description. Se o documento tiver uma TABELA com múltiplos itens (Size/Pattern/Quantity por linha, comum em PI/Sales Contract), deixar "produto" vazio e usar "itens" abaixo.
  "itens": [],  // ARRAY com um objeto por LINHA DE PRODUTO da tabela do documento (comum em PI/Sales Contract com colunas Size, Pattern, L.I./S.R., P.R., Quantity — mas também vale para uma tabela de item único com colunas tipo Description/Brand/NCM/Qty, comum em Proforma Invoice). Cada objeto: {"size":"","pattern":"","li_sr":"","quantidade":0}. Ex. de uma tabela com 3 linhas (600/65R28, 600/70R30, 710/70R42): retornar 3 objetos, um por linha, cada um com sua própria quantidade — NUNCA somar as quantidades num único item. Se a tabela trouxer a descrição do produto já combinada numa única coluna (ex: "215/75R17.5 16PR 135/133L TL TR685"), sem separação clara entre Size/Pattern/L.I. S.R., preencha "size" com o texto COMPLETO dessa descrição e deixe "pattern"/"li_sr" vazios — NUNCA deixe "size" e "pattern" vazios ao mesmo tempo numa linha que tiver quantidade preenchida, senão o item é descartado. Se o documento não tiver tabela de itens (só descrição corrida, sem coluna de quantidade), deixar "itens" como array vazio [] e usar "produto" acima.
  "pi_numero": "",  // extrair APENAS o número principal; ignorar números secundários entre parênteses (ex: "PI-001 (JY-999)" → usar "PI-001")
  "pi_data": "YYYY-MM-DD",
  "pi_valor_usd": 0,
  "pi_incoterm": "",
  "pi_pagamento": "VISTA|PRAZO|ENTRADA_SALDO",
  "etd": "YYYY-MM-DD",
  "eta": "YYYY-MM-DD",
  "armador": "",  // NÃO inferir armador pelo nome do navio (ex: navio MSC XXXX não significa armador MSC — extrair apenas de campos explícitos como Carrier, Shipping Line, Armador) NÃO usar o emissor de um House B/L (agente de carga/NVOCC, ex: nomes com "Logistics", "Forwarding", "Cargo") como armador — o armador real (ocean carrier) deve vir do Master B/L ou Booking Confirmation. Exemplos de armadores reais: MSC, CMA CGM, COSCO, MAERSK, HAPAG-LLOYD, ONE, EVERGREEN, YANG MING, PIL, ZIM, HMM, WAN HAI.
  "navio": "",  // se o documento for um CE Mercante, usar o navio de CHEGADA: em caso de transbordo/baldeação no exterior, o navio de chegada é o navio de conexão/último navio que efetivamente atracou no porto de destino brasileiro — NÃO o navio original de embarque na origem
  "porto_origem": "",
  "porto_destino": "",  // extrair de: POD, Port of Discharge, Port of Destination, Discharge Port. PRIORIDADE DE FONTE: o BL e a DI/Extrato da DI são mais confiáveis que o Sales Contract — o Sales Contract é só a intenção comercial registrada antes do embarque e pode estar desatualizado (ex: prevê "Itajai" mas a carga acabou desembarcando em "Itapoa"). Se o documento atual for um BL ou DI/Extrato da DI, o porto_destino dele deve SOBRESCREVER um valor que tenha vindo de um Sales Contract.
  "hbl": "",
  "mbl": "",
  "containers": [],  // ARRAY com TODOS os containers do documento — um item por container: {"numero":"TCKU7973104","lacre":"2299285"}. IMPORTANTE: BL e CE Mercante frequentemente listam 2 OU MAIS containers na mesma tabela (ex: "3X40HQ CONTAINER FCL/FCL" com 3 linhas de número+lacre). Inclua UM item no array PARA CADA linha de container encontrada — nunca junte vários números numa única string separada por vírgula. Mesmo se houver só 1 container no documento, retorne um array com 1 item.
  "valor_frete": 0,  // valor do frete marítimo — extrair de: BL (campo "Freight", "Ocean Freight", "Freight Charges", geralmente no rodapé/seção de charges do BL — usar o valor "Prepaid" OU "Collect", o que estiver preenchido com valor) ou CE Mercante (campo "Frete"). Se não encontrar um valor de frete explícito no documento, deixar 0.
  "moeda_frete": "",  // moeda em que o valor_frete veio no documento: "USD", "BRL" ou "EUR". Deixar "" se valor_frete for 0.
  "numero_di": "",  // número da Declaração de Importação — ex: "26/0672265-4"
  "data_registro_di": "YYYY-MM-DD",  // "DATA DO REGISTRO" no Comprovante de Importação/Extrato da DI
  "canal": "VERDE|AMARELO|VERMELHO",  // "CANAL DE CONFERENCIA ADUANEIRA" no Comprovante de Importação/Extrato da DI
  "data_liberacao": "YYYY-MM-DD",  // "DATA DO DESEMBARAÇO" no Comprovante de Importação (CI) — é a liberação da carga, não a data de emissão do documento
  "ci_numero": "",  // número da CI (Commercial Invoice/Fatura Comercial) — extrair de rótulos como "Invoice No", "Invoice Number", "INV. NO", "INV NO", "INV. NO:", "CI No", "Commercial Invoice No" (aceitar variações de pontuação/abreviação do rótulo, ex: com ou sem ponto, com ou sem dois-pontos)
  "ci_valor_usd": 0,  // valor total da Commercial Invoice — "Total Amount", "Total Value", "Grand Total", "Total USD"
  "ci_data": "YYYY-MM-DD",  // data de emissão da Commercial Invoice — "Invoice Date", "INV. DATE", "Date"
  "data_chegada": "YYYY-MM-DD",  // preencher SOMENTE quando o documento for a DI/Extrato da DI — é a única fonte que confirma o desembarque efetivo. Para qualquer outro documento (BL, CE Mercante, invoice, etc.), NÃO preencher este campo — a data de chegada/atracação deles é só previsão, então use "eta" em vez disso.
  "ce_master": "",  // número do CE Mercante MASTER (do armador/linha de navegação), se houver
  "ce_house": "",  // número do CE Mercante HOUSE (do agente de carga/consolidador), se houver
  "ce_data_embarque": "YYYY-MM-DD",  // data de embarque conforme o CE Mercante
  "nf_entrada_numero": "",  // número da Nota Fiscal de ENTRADA (nacionalização/entrada da mercadoria no estoque)
  "nf_entrada_data": "YYYY-MM-DD",  // data de emissão da NF de entrada
  "nf_entrada_valor": 0,  // valor da NF de entrada em REAIS (R$) — NF brasileira nunca é emitida em USD
  "nf_saida_numero": "",  // número da Nota Fiscal de SAÍDA (venda ao cliente final)
  "nf_saida_data": "YYYY-MM-DD",  // data de emissão da NF de saída
  "nf_saida_valor": 0,  // valor da NF de saída em REAIS (R$)
  "cliente": "",  // razão social do cliente/destinatário final — extrair do campo "NOME/RAZÃO SOCIAL" do DESTINATÁRIO na NF de SAÍDA (não confundir com o fornecedor/exportador, que é estrangeiro)
  "encomendante_cnpj": "",  // CNPJ do encomendante/adquirente — ver instruções específicas na seção do Comprovante de Importação/Extrato da DI abaixo. Deixar "" se o documento não for esse tipo ou não trouxer esse campo.
  "data_devolucao_vazio": "YYYY-MM-DD",  // data em que o container VAZIO foi devolvido/entregue no depósito/terminal
  "cambio_referencias": [],  // usar SOMENTE para Comprovante de Câmbio — ver instruções específicas abaixo. Array de objetos {"referencia":"", "valor_pago":0, "taxa_cambio":0, "data_pagamento":"YYYY-MM-DD"}. Deixar [] para qualquer outro tipo de documento.
  "free_time": null
}
Se o documento for um EIR (Equipment Interchange Receipt), também chamado de RIC ou "Gate Pass Receipt", emitido por um terminal/depósito de containers (ex: MEDLOG, Santos Brasil, etc.):
- extrair um item no array "containers" com o número do campo "Container No." (RIC costuma ter 1 container por documento, mas se listar mais de um, inclua um item por container).
- data_devolucao_vazio vem do campo "Gate In Date/Time" — esta é a data e hora em que o container vazio deu entrada no depósito, ou seja, a devolução física de fato. O formato no documento costuma ser "YYYY/MM/DD HH:MM" (ex: "2026/05/30 10:54") — converta apenas a parte da data para "YYYY-MM-DD" (ex: "2026-05-30"), descartando a hora.
- se o campo "Gate In Date/Time" estiver vazio mas "Gate Out Date/Time" estiver preenchido, este documento é de SAÍDA do container vazio do depósito (não de devolução) — não preencher data_devolucao_vazio neste caso.
Se o documento for um Comprovante de Importação, Extrato da Declaração de Importação (DI) ou uma DUIMP (Declaração Única de Importação — o novo formato que está substituindo a DI), emitidos pela Receita Federal/Siscomex:
- NUNCA preencha ce_master, ce_house ou ce_data_embarque a partir desse documento, mesmo que ele mencione ou referencie um número de CE Mercante em algum trecho (a DUIMP costuma citar o CE vinculado à carga como parte dos próprios dados da declaração) — esses 3 campos só podem vir de um CE Mercante emitido de verdade, nunca de uma DI/DUIMP. Preenchê-los a partir daqui troca ou apaga o CE Master/House corretos já registrados no processo.
- numero_di vem de "DECLARAÇÃO DE IMPORTAÇÃO Nº" (ex: "26/0672265-4").
- data_registro_di vem de "DATA DO REGISTRO".
- canal vem de "CANAL DE CONFERENCIA ADUANEIRA".
- data_liberacao vem de "DATA DO DESEMBARAÇO" — esta é a data de liberação da carga, diferente da data de emissão do documento.
- se o documento trouxer dados de embarque (navio, data de embarque na origem, baldeação/transbordo, data de chegada no porto brasileiro), extraia também "navio" (use a mesma regra de navio de chegada: em caso de baldeação no exterior, o navio de chegada é o navio de conexão), "etd" (data de embarque na origem) e "data_chegada" (data de chegada efetiva no porto brasileiro).
- extrair "encomendante_cnpj": o CNPJ do ENCOMENDANTE/ADQUIRENTE da operação (campos comuns: "Encomendante", "Adquirente", "Importador por conta e ordem de" — em operações de importação por conta e ordem ou por encomenda) — extrair só os 14 dígitos do CNPJ, sem pontuação. Se o documento não mostrar essa figura (importação direta, sem encomendante/adquirente distinto do importador), deixar "".
Se o documento for uma Nota Fiscal (NF-e brasileira):
- todo valor de NF está em REAIS (R$), nunca em USD — não confundir com pi_valor_usd/ci_valor_usd.
- se a NF for de ENTRADA (compra/nacionalização, destinatário é a própria importadora), preencher apenas os campos nf_entrada_*. O destinatário desta NF é a própria IMPAK — não usar como "cliente".
- se a NF for de SAÍDA (venda, destinatário é o cliente final), preencher os campos nf_saida_* e também extrair "cliente" do nome/razão social do destinatário.
- não preencher os dois grupos ao mesmo tempo a partir do mesmo documento — cada NF enviada é de um tipo só.
Se o documento for um CE Mercante (Conhecimento Eletrônico de Carga, emitido pela Receita Federal/Siscomex):
- extrair ce_master (CE do armador/linha de navegação) e/ou ce_house (CE do agente de carga/consolidador) — um CE Mercante pode ter só um dos dois ou os dois, dependendo se a carga é consolidada. Preencher cada campo apenas se aquele número aparecer no documento.
- extrair também "eta" (data de chegada/atracação no porto brasileiro segundo o CE — isso ainda é só previsão até a DI ser registrada, então usar "eta", NUNCA "data_chegada"), ce_data_embarque (data de embarque na origem) e "armador" (transportador/armador conforme o CE — mesmo campo usado pra BL, o CE Mercante é a fonte mais confiável quando os dois documentos existem).
- o campo "navio" deve refletir o navio de CHEGADA informado no CE — se houver transbordo/baldeação no exterior, use o navio de conexão (o último navio que trouxe a carga até o porto de destino), não o navio do embarque original.
Se o documento for um Comprovante de Câmbio (operação de câmbio bancária — compra de moeda estrangeira para pagamento ao exterior):
- extrair "taxa_cambio" (a taxa/PTAX da operação, em R$ por US$) — normalmente é UMA só para o comprovante inteiro, mesmo que ele cubra várias referências/faturas.
- o comprovante pode listar UMA OU VÁRIAS referências de processo/invoice na mesma operação (ex: numa tabela ou lista de "faturas pagas" dentro do comprovante), cada uma com seu valor. Para CADA referência encontrada, criar um item em "cambio_referencias" com: "referencia" (o número/código da referência ou invoice, exatamente como aparece no documento), "valor_pago" (o valor em REAIS pago especificamente para aquela referência — se o documento já mostrar o rateio/split por referência, use os valores exatos do documento; nunca divida o total igualmente entre as referências por conta própria) e "taxa_cambio" (repetir a mesma taxa da operação em cada item, a menos que o documento mostre taxas diferentes por referência).
- se o comprovante não mencionar nenhuma referência/invoice explicitamente (só o valor total e a taxa), retornar um único item em "cambio_referencias" com "referencia" vazia ("") e o valor total — o sistema vai pedir confirmação manual de qual processo isso pertence.
- extrair também "data_pagamento" (a data em que a operação de câmbio/pagamento foi feita — normalmente "Data da Operação", "Data de Liquidação" ou a data de emissão do comprovante) — repetir a mesma data em cada item de "cambio_referencias", a menos que o documento mostre datas diferentes por referência.
Não preencha free_time — deixe sempre null. Free time só é preenchido manualmente após emissão do BL.
Retorne apenas JSON válido, sem texto adicional. Deixe em branco ("") os campos não encontrados.`;

    const content = [{
      type: 'text',
      text: promptInstrucoes,
      cache_control: { type: 'ephemeral' }
    },{
      type: isImg ? 'image' : 'document',
      source: { type:'base64', media_type: file.type, data: base64 }
    }];

    // Faz a chamada com 1 retry automático: falhas como "Could not process PDF"
    // ou hiccups passageiros do servidor (resposta não-JSON, ex: página de
    // erro HTML do proxy) costumam ser intermitentes — uma segunda tentativa
    // depois de uma pequena espera resolve a maioria dos casos.
    async function chamarAnalise(tentativa){
      const resp = await fetch('/api/analisar',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({content})
      });
      const textoResp = await resp.text();
      let d;
      try{
        d = JSON.parse(textoResp);
      }catch(e){
        // Resposta não é JSON — geralmente página de erro do servidor/proxy
        // (ex: <!DOCTYPE...>), não um problema no documento em si.
        if(tentativa < 2){
          if(status) status.textContent = '⏳ Falha de comunicação, tentando novamente...';
          await new Promise(r=>setTimeout(r, 2000));
          return chamarAnalise(tentativa+1);
        }
        throw new Error('O servidor não respondeu corretamente (pode ter sido uma instabilidade momentânea). Tente novamente em alguns segundos.');
      }
      if(!d.ok || !d.jobId){
        // Erro real na criação do job (ex: falha de validação ou chave não
        // configurada) — também vale a pena tentar de novo uma vez.
        if(tentativa < 2 && /could not process|processar.*pdf/i.test(d.erro||'')){
          if(status) status.textContent = '⏳ Falha ao processar o PDF, tentando novamente...';
          await new Promise(r=>setTimeout(r, 2000));
          return chamarAnalise(tentativa+1);
        }
        throw new Error(d.erro||'Erro na IA');
      }
      // /api/analisar agora só CRIA o job e responde na hora (evita erro 502
      // em análises longas) — o resultado real vem via polling em
      // /api/analisar/job/:id, exatamente como o runAnalysis() da Conferência
      // (processos.html) já faz. Sem isso, extrairComIA() lia "d.data" de uma
      // resposta que só tinha "jobId", travando com "Cannot read properties
      // of undefined (reading 'content')" toda vez que a IA lia um documento.
      const jobId = d.jobId;
      const inicio = Date.now();
      while(true){
        await new Promise(r=>setTimeout(r, 2500));
        const rJob = await fetch('/api/analisar/job/'+jobId);
        const dJob = await rJob.json();
        if(!dJob.ok) throw new Error(dJob.erro||'Erro ao consultar análise');
        if(dJob.status === 'concluido') return { ok:true, data: dJob.resultado };
        if(dJob.status === 'erro'){
          if(tentativa < 2 && /could not process|processar.*pdf/i.test(dJob.erro||'')){
            if(status) status.textContent = '⏳ Falha ao processar o PDF, tentando novamente...';
            return chamarAnalise(tentativa+1);
          }
          throw new Error(dJob.erro||'Erro na IA');
        }
        if(status) status.textContent = '⏳ Analisando documento...';
        if(Date.now()-inicio > 340000) throw new Error('Análise demorou demais. Tente novamente com um documento menor.');
      }
    }

    const d = await chamarAnalise(1);

    const raw = (d.data.content||[]).map(c=>c.text||'').join('');
    let extracted;
    try{
      const clean = raw.replace(/```json/gi,'').replace(/```/gi,'').trim();
      extracted = JSON.parse(clean);
    } catch(e){ throw new Error('Resposta da IA inválida'); }

    // Normalizar valores numéricos e limpar PI antes de preencher
    function normNum(v){
      if(!v && v!==0) return null;
      const s = String(v).replace(/[R$USD\s]/gi,'').trim();
      if(/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g,'').replace(',','.'));
      return parseFloat(s.replace(',','.')) || null;
    }
    if(extracted.pi_valor_usd) extracted.pi_valor_usd = normNum(extracted.pi_valor_usd);
    if(extracted.ci_valor_usd) extracted.ci_valor_usd = normNum(extracted.ci_valor_usd);
    if(extracted.nf_entrada_valor) extracted.nf_entrada_valor = normNum(extracted.nf_entrada_valor);
    if(extracted.nf_saida_valor)   extracted.nf_saida_valor   = normNum(extracted.nf_saida_valor);
    if(extracted.pi_numero)    extracted.pi_numero    = extracted.pi_numero.replace(/\s*\(.*?\)\s*/g,'').trim();
    if(!extracted.free_time)   delete extracted.free_time;

    // Fallback: alguns documentos (principalmente a CI/Commercial Invoice)
    // não trazem uma "referência" interna do processo — só o número da CI.
    // Nesse caso, usa o próprio número da CI como referência, pra não deixar
    // o campo obrigatório em branco. Só entra em ação quando a IA não achou
    // NENHUMA referência no documento.
    if(!extracted.referencia && extracted.ci_numero) extracted.referencia = extracted.ci_numero;

    // CNPJ do encomendante (extraído do Comprovante de Importação/Extrato da
    // DI) — cruza com o cadastro de contatos pra usar o nome OFICIAL já
    // cadastrado em vez de confiar na grafia exata do documento (evita
    // "cliente" divergente por causa de abreviação/acento/razão social
    // desatualizada entre documentos do mesmo cliente real).
    if(extracted.encomendante_cnpj){
      const cnpjDigits = String(extracted.encomendante_cnpj).replace(/\D/g,'');
      if(cnpjDigits.length === 14){
        try{
          const rContato = await fetch('/api/contatos?q='+cnpjDigits+'&limit=5');
          const dContato = await rContato.json();
          const match = (dContato.contatos||[]).find(c => (c.cnpj||'') === cnpjDigits);
          if(match){
            extracted.cliente = match.razao_social;
            showToast(`Encomendante identificado pelo cadastro: ${match.razao_social}`,'ok');
          } else {
            const cnpjFmt = cnpjDigits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
            showToast(`CNPJ do encomendante (${cnpjFmt}) não está cadastrado — cadastre em Cadastros pra reconhecimento automático`,'warn');
          }
        }catch(e){ /* falha na consulta de cadastro não deve travar o resto da extração */ }
      }
      delete extracted.encomendante_cnpj; // não é campo de input direto no formulário
    }

    // Um documento nunca é, ao mesmo tempo, um CE Mercante genuíno E uma
    // DI/DUIMP genuína (são tipos mutuamente exclusivos) — mas a DUIMP
    // referencia o CE Mercante vinculado à carga como parte dos próprios
    // dados da declaração, então a IA às vezes lê esse número mencionado
    // dentro da DUIMP e devolve em ce_master/ce_house. Isso fazia
    // ehCeMercante virar true numa leitura de DUIMP e liberar a sobrescrita
    // de CE Master/House com um valor que não é o CE Mercante de verdade
    // desse processo (bug real reportado: CE Master sendo substituído pelo
    // número do CE House ao incluir uma DUIMP). Por isso, se o documento
    // também tiver dados de DI/DUIMP (numero_di, data_registro_di ou
    // canal), ce_master/ce_house/ce_data_embarque são descartados ANTES de
    // qualquer outra lógica — nunca vêm de um documento desse tipo.
    const pareceDiOuDuimp = !!(extracted.numero_di || extracted.data_registro_di || extracted.canal);
    if(pareceDiOuDuimp){
      delete extracted.ce_master;
      delete extracted.ce_house;
      delete extracted.ce_data_embarque;
    }

    // Quando o documento é um CE Mercante, o navio/armador/etd que ele traz
    // são mais confiáveis que os do BL (refletem o navio de chegada real, já
    // considerando transbordo/baldeação no exterior) — por isso sobrescrevem
    // o que já estiver no formulário em vez de respeitar a regra "só preenche vazio".
    const ehCeMercante = !!(extracted.ce_master || extracted.ce_house);
    // Quando o documento é um BL ou uma DI/Extrato da DI, o porto de destino
    // e o container/navio que eles trazem são mais confiáveis que o Sales
    // Contract (que é só a intenção comercial registrada antes do embarque,
    // podendo estar desatualizada — ex: contrato previa "Itajai" mas a carga
    // foi operacionalmente desembarcada em "Itapoa"). Por isso, se vierem de
    // um BL/DI, esses campos também sobrescrevem o que já estiver preenchido.
    const ehBlOuDi = !!(extracted.hbl || extracted.mbl || extracted.numero_di || extracted.data_registro_di);
    const camposSobrescritosPorCe = ehCeMercante ? ['navio','armador'] : [];
    const camposSobrescritosPorBlDi = ehBlOuDi ? ['porto_destino','container','navio'] : [];
    // Regra de negócio: o processo só pode ser considerado DESEMBARCADO de
    // fato com base na DI/Extrato da DI — qualquer outro documento (CE
    // Mercante, BL, invoice etc.) só traz uma PREVISÃO de chegada. Por isso
    // "data_chegada" (que é o campo que muda a fase pra Desembarcado, ver
    // calcularFase) só é aceito quando o documento atual é mesmo a DI —
    // caso contrário, a data extraída vira "eta" (previsão), nunca chegada
    // efetiva, mesmo que a IA (por engano) tenha devolvido "data_chegada".
    const ehDI = !!(extracted.numero_di || extracted.data_registro_di);

    let preenchidos = 0;
    // Rastreia quais campos esta LEITURA especifica preencheu (diferente de
    // _camposIA, que acumula por toda a sessao de edicao) -- usado so pra
    // registrar no Historico o que essa leitura de documento trouxe.
    const camposLidosNestaLeitura = [];

    // Itens estruturados (Size/Pattern/L.I.S.R./Quantidade por linha da tabela do
    // documento) — populam a LISTA VISUAL de produtos (_produtos), não o campo
    // legado escondido. Sem isso, a extração "preenchia" um campo que o usuário
    // nunca via na tela, e a lista de produtos parecia vazia mesmo após a IA
    // rodar com sucesso.
    if(Array.isArray(extracted.itens) && extracted.itens.length){
      const itensValidos = extracted.itens.filter(it=>it && (it.size||it.pattern||it.quantidade));
      if(itensValidos.length){
        _produtos = itensValidos.map(it=>{
          const partes = [it.size, it.pattern, it.li_sr].filter(Boolean);
          return { descricao: partes.join(' '), quantidade: it.quantidade!=null?it.quantidade:'' };
        });
        renderMultiProdutos();
        preenchidos += _produtos.length;
        camposLidosNestaLeitura.push('itens');
      }
    }
    delete extracted.itens; // não é um campo de input direto — já tratado acima

    // Comprovante de Câmbio — pode cobrir várias referências na mesma
    // operação. Nunca preenche pi_cambio/pi_cambio_entrada/pi_cambio_saldo
    // sozinho: primeiro localiza o item da lista que bate com a referência
    // do processo ABERTO agora, e abre um modal pedindo confirmação manual
    // de qual parcela é (Entrada/Saldo/Único) antes de gravar qualquer coisa.
    let abriuModalCambio = false;
    if(Array.isArray(extracted.cambio_referencias) && extracted.cambio_referencias.length){
      const refAtual = (document.getElementById('f_referencia')?.value||'').trim().toUpperCase();
      const itensCambio = extracted.cambio_referencias.filter(c=>c && c.taxa_cambio);
      let match = itensCambio.find(c=>(c.referencia||'').trim().toUpperCase()===refAtual);
      if(!match && itensCambio.length===1 && !itensCambio[0].referencia) match = itensCambio[0];
      if(match){
        abrirModalConfirmarCambio(match, refAtual);
        abriuModalCambio = true;
      } else if(itensCambio.length){
        const refsEncontradas = itensCambio.map(c=>c.referencia||'(sem referência)').join(', ');
        showToast(`⚠ Comprovante de câmbio não menciona a referência "${refAtual}" — encontradas: ${refsEncontradas}. Abra o processo correto.`,'warn');
      }
    }
    delete extracted.cambio_referencias; // tratado à parte acima, nunca vai pro loop genérico

    // Preencher campos do formulário
    const camposMoedaIA = ['pi_valor_usd','ci_valor_usd','demurrage_valor','nf_entrada_valor','nf_saida_valor','valor_frete'];
    const camposContainerTratadosSeparado = ['container','lacre']; // ver bloco de _containers abaixo
    // camposIA (ver abrirNovo/abrirProcesso) guarda quais campos a última
    // leitura de IA preencheu NESTA sessão — se o campo já tiver um valor mas
    // veio da própria IA (não foi digitado pelo usuário), uma leitura nova
    // pode corrigi-lo. Ex.: documento errado preenche "fornecedor" errado →
    // usuário percebe e sobe o documento certo → agora corrige normalmente,
    // em vez de ficar bloqueado pela regra "só preenche vazio". Se o usuário
    // tiver editado esse campo manualmente nesse meio tempo, o listener de
    // 'input' em fecharModal() já removeu o campo daqui, então ele volta a
    // ficar protegido como sempre foi.
    if(!_editando._camposIA) _editando._camposIA = {};
    const foiPreenchidoPorIA = campo => !!_editando._camposIA[campo];
    const marcarComoIA = campo => { _editando._camposIA[campo] = true; camposLidosNestaLeitura.push(campo); };
    Object.keys(extracted).forEach(campo=>{
      let val = extracted[campo];
      if(!val) return;
      if(camposContainerTratadosSeparado.includes(campo)) return;
      const el = document.getElementById('f_'+campo);
      if(!el) return;
      if(camposMoedaIA.includes(campo)) val = exibirMoeda(val);
      // Campos específicos de um tipo de documento (ex: CE Master/House só
      // existem num CE Mercante) não podem ser sobrescritos por uma leitura de
      // IA de um documento de OUTRO tipo, mesmo que já tenham sido preenchidos
      // pela IA antes nesta sessão — antes, foiPreenchidoPorIA(campo) sozinho
      // liberava a sobrescrita por QUALQUER leitura seguinte, então ler uma
      // DUIMP/DI depois de ler um CE Mercante no mesmo processo podia apagar ou
      // trocar CE Master/House com um valor mal interpretado do documento de DI
      // (que não é CE Mercante e não deveria mexer nesses campos).
      const camposRestritosATipoDoc = ['ce_master','ce_house','ce_data_embarque'];
      const restritoEBloqueado = camposRestritosATipoDoc.includes(campo) && !ehCeMercante;
      const podeSobrescrever = !restritoEBloqueado && (camposSobrescritosPorCe.includes(campo) || camposSobrescritosPorBlDi.includes(campo) || foiPreenchidoPorIA(campo));
      // Porto Destino é <select> agora — não aceita texto livre direto.
      // Normaliza pro código (ITJ/IOA/NVT) e, se não bater com nenhum,
      // reconstrói as opções incluindo o valor extraído como fallback
      // visível (em vez de falhar silenciosamente sem selecionar nada).
      if(campo==='porto_destino'){
        if(!el.value || podeSobrescrever){
          const normalizado = normalizarPortoDestino(val);
          if(!PORTOS_DESTINO.some(p=>p.codigo===normalizado)) el.innerHTML = gerarOptionsPortoDestino(normalizado);
          else el.value = normalizado;
          el.style.borderColor='var(--ok)'; el.style.background='rgba(22,163,74,.04)';
          preenchidos++; marcarComoIA(campo);
          setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
        }
        return;
      }
      if(campo==='porto_origem'){
        if(!el.value || podeSobrescrever){
          const vu = val.trim().toUpperCase();
          const outro = document.getElementById('f_porto_origem_outro');
          if(PORTOS_ORIGEM.includes(vu)){
            el.value = vu;
            if(outro) outro.style.display = 'none';
          } else {
            el.value = 'OUTRO';
            if(outro){ outro.value = val; outro.style.display = 'block'; }
          }
          el.style.borderColor='var(--ok)'; el.style.background='rgba(22,163,74,.04)';
          preenchidos++; marcarComoIA(campo);
          setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
        }
        return;
      }
      if(campo==='data_chegada'){
        if(ehDI){
          if(!el.value || podeSobrescrever){
            el.value = val;
            el.style.borderColor='var(--ok)'; el.style.background='rgba(22,163,74,.04)';
            preenchidos++; marcarComoIA(campo);
            setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
          }
        } else {
          const elEta = document.getElementById('f_eta');
          if(elEta && (!elEta.value || foiPreenchidoPorIA('eta'))){
            elEta.value = val;
            elEta.style.borderColor='var(--ok)'; elEta.style.background='rgba(22,163,74,.04)';
            preenchidos++; marcarComoIA('eta');
            setTimeout(()=>{ elEta.style.borderColor=''; elEta.style.background=''; }, 3000);
          }
        }
        return;
      }
      if(!el.value || podeSobrescrever){
        el.value = val;
        el.style.borderColor='var(--ok)';
        el.style.background='rgba(22,163,74,.04)';
        preenchidos++; marcarComoIA(campo);
        setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
      }
    });

    // O campo "container" (e o novo "lacre") extraídos pela IA precisam ser
    // refletidos na LISTA VISUAL de containers (_containers), não só no
    // input hidden f_container — senão a extração "preenche" um campo que
    // o usuário nunca vê na tela, e o container/lacre parecem não ter sido
    // lidos. Só populamos automaticamente se a lista ainda estiver vazia
    // (1 container sem número), para não sobrescrever o que o usuário já
    // tiver preenchido manualmente — exceto quando vem de BL/DI, que é mais
    // confiável e pode corrigir um container errado de um documento anterior.
    let listaContainersExtraidos = [];
    if(Array.isArray(extracted.containers) && extracted.containers.length){
      listaContainersExtraidos = extracted.containers
        .filter(x => x && x.numero)
        .map(x => ({numero: String(x.numero).trim(), lacre: x.lacre ? String(x.lacre).trim() : ''}));
    } else if(extracted.container){
      // Fallback defensivo pro formato antigo (string única) — caso a IA ainda devolva
      // vários números concatenados numa string só (ex: documento com 2+ containers).
      const numsPart = String(extracted.container).split(/[,;\/]+/).map(s => s.trim()).filter(Boolean);
      const lacresPart = extracted.lacre ? String(extracted.lacre).split(/[,;\/]+/).map(s => s.trim()).filter(Boolean) : [];
      listaContainersExtraidos = numsPart.map((numero, i) => ({numero, lacre: lacresPart[i] || ''}));
    }
    if(listaContainersExtraidos.length){
      listaContainersExtraidos.forEach(item => {
        const numNovo = item.numero.toUpperCase();
        const idxExistente = _containers.findIndex(c => c.numero && c.numero.trim().toUpperCase() === numNovo);
        if(idxExistente !== -1){
          // Mesmo container já estava na lista (re-leitura do mesmo documento, ou
          // outro documento confirmando o mesmo container) — só completa o lacre.
          if(item.lacre && !_containers[idxExistente].lacre) _containers[idxExistente].lacre = item.lacre;
        } else {
          const primeiroVazio = !_containers.length || (!_containers[0].numero);
          if(primeiroVazio){
            if(!_containers.length) _containers.push({numero:'', tipo:'40HC', lacre:''});
            _containers[0].numero = item.numero;
            if(item.lacre) _containers[0].lacre = item.lacre;
          } else {
            // Já existe container diferente cadastrado — em processo multi-container,
            // cada documento novo (ou cada linha da tabela do mesmo documento) pode
            // revelar um container adicional. Adiciona em vez de sobrescrever.
            _containers.push({numero: item.numero, tipo:'40HC', lacre: item.lacre || ''});
          }
        }
      });
      renderMultiContainers();
      preenchidos++; marcarComoIA('container');
    }

    if(status) status.textContent = abriuModalCambio
      ? `💱 Comprovante de câmbio lido — confirme no modal a qual parcela pertence`
      : ehCeMercante
      ? `✓ ${preenchidos} campos preenchidos (CE Mercante — navio de chegada atualizado)`
      : ehBlOuDi ? `✓ ${preenchidos} campos preenchidos (BL/DI — porto e container atualizados)`
      : `✓ ${preenchidos} campos preenchidos`;
    if(!abriuModalCambio) showToast(`IA preencheu ${preenchidos} campos automaticamente`,'ok');

    // Preenchimento programático não dispara onchange/oninput dos campos —
    // por isso a regra de parametrização e o recálculo de fase/demurrage
    // precisam ser chamados manualmente aqui. O mesmo vale pro campo "Forma
    // de Pagamento" (f_pi_pagamento): setar .value direto NÃO dispara seu
    // onchange="renderPagamentoCampos()", então quando a IA lê uma PI e
    // preenche "100% a Prazo" o <select> mostra a opção certa mas o campo
    // "Prazo (dias)" (e Data Pagamento) nunca aparecia — precisa chamar de
    // novo aqui manualmente, senão o formulário fica com dado "invisível".
    aplicarRegraParametrizacaoVerde();
    atualizarFaseEmTempoReal();
    if(extracted.pi_pagamento) renderPagamentoCampos();

    // Atualizar _editando com os valores extraídos
    if(_editando) Object.assign(_editando, extracted);

    // Salva automaticamente no GED do processo o documento que acabou de ser
    // lido pela IA — antes disso, o único jeito de guardar o arquivo era um
    // upload manual separado na aba GED, então o documento usado pra extrair
    // os dados quase nunca ficava de fato anexado ao processo. Reaproveita
    // uploadArquivosGed() (mesma validação/limite/endpoint do upload manual).
    // Só roda se o processo já tiver id (já foi salvo ao menos uma vez) —
    // num processo novo ainda não salvo, o arquivo fica de fora do GED por
    // enquanto (evita um toast de aviso logo após o sucesso da extração);
    // o usuário anexa manualmente depois de salvar, como já era possível.
    // Registra no Histórico do processo qual documento foi lido pela IA e
    // quais campos ela preencheu a partir dele -- fica junto do log de
    // auditoria de alterações normal (mesma tabela controle_log), só com um
    // "campo" especial que o carregarHistorico() sabe renderizar de forma
    // diferente (não é "alterou X: antes → depois", é "leu o documento").
    if(_editando && camposLidosNestaLeitura.length){
      const camposUnicos = [...new Set(camposLidosNestaLeitura)];
      const rotulo = campo => LABELS_CAMPOS_IA[campo] || campo;
      _editando.log = _editando.log || [];
      _editando.log.push({
        campo: LOG_CAMPO_LEITURA_IA,
        valor_antes: file.name,
        valor_depois: camposUnicos.map(rotulo).join(', '),
        usuario: _user.usuario,
        created_at: new Date().toISOString(),
      });
    }

    if(_editando && _editando.id){
      uploadArquivosGed([file]);
    }

  } catch(e){
    if(status) status.textContent = '❌ Erro: '+e.message;
    showToast('Erro na extração: '+e.message,'err');
  }
}

// ════════════════════════════════════════════════════════════════
// EDIÇÃO RÁPIDA INLINE
// ════════════════════════════════════════════════════════════════
function inlineEditData(id, campo, el){
  const proc = _processos.find(p=>p.id===id);
  if(!proc) return;
  const valorAtual = proc[campo]||'';
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'inline-input';
  input.value = valorAtual;
  input.style.width = '130px';
  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  function salvar(){
    const novoValor = input.value;
    if(novoValor !== valorAtual){
      const antes = proc[campo];
      proc[campo] = novoValor||null;
      // Log
      proc.log = proc.log||[];
      proc.log.push({campo, valor_antes:antes||'', valor_depois:novoValor||'', usuario:_user.usuario, created_at:new Date().toISOString()});
      // Edição rápida inline: só este campo mudou de fato — manda só ele
      // (ver nota de concorrência em salvarProcesso/coletarESalvar). "proc"
      // aqui vem do cache local (_processos), que pode estar levemente
      // desatualizado em relação ao servidor; sem isso, salvar essa edição
      // rápida sobrescreveria com esse cache velho qualquer campo que outra
      // pessoa tivesse alterado nesse meio tempo.
      salvarProcesso(proc, [campo]);
    }
    render();
  }
  input.addEventListener('blur', salvar);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){proc[campo]=valorAtual; render();} });
}

function inlineEditFase(id, el){
  const proc = _processos.find(p=>p.id===id);
  if(!proc) return;
  const sel = document.createElement('select');
  sel.className = 'inline-select';
  FASES.forEach(f=>{
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.icon+' '+f.label;
    if(f.id===proc.fase) opt.selected = true;
    sel.appendChild(opt);
  });
  el.innerHTML='';
  el.appendChild(sel);
  sel.focus();
  function salvar(){
    const novaFase = sel.value;
    if(novaFase !== proc.fase){
      proc.log = proc.log||[];
      proc.log.push({campo:'fase', valor_antes:proc.fase, valor_depois:novaFase, usuario:_user.usuario, created_at:new Date().toISOString()});
      proc.fase = novaFase;
      // Override manual de fase — só esse campo. Ver nota em inlineEditData.
      salvarProcesso(proc, ['fase']);
    }
    render();
  }
  sel.addEventListener('change', salvar);
  sel.addEventListener('blur', ()=>render());
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD FINANCEIRO
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// DASHBOARD EXECUTIVO
// ════════════════════════════════════════════════════════════════


// Fila de processamento: processa varios arquivos, um de cada vez, reaproveitando extrairComIA_umArquivo
async function processarFilaIA(arquivos){
  for(const arquivo of arquivos){
    try{
      await extrairComIA_umArquivo({ files: [arquivo], set value(v){} });
    }catch(e){
      console.error('Erro ao processar arquivo via IA:', arquivo && arquivo.name, e);
    }
  }
}

// Ponto de entrada publico (mantem o nome extrairComIA para compatibilidade com onchange="extrairComIA(this)")
async function extrairComIA(inputReal){
  const arquivos = Array.from((inputReal && inputReal.files) || []);
  if(!arquivos.length) return;
  if(inputReal) inputReal.value = '';
  await processarFilaIA(arquivos);
}

function handleDragOverIA(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.6)'; zone.style.background = 'rgba(26,127,212,.10)'; }
}

function handleDragLeaveIA(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.15)'; zone.style.background = 'rgba(26,127,212,.04)'; }
}

async function handleDropIA(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.15)'; zone.style.background = 'rgba(26,127,212,.04)'; }
  const dt = ev.dataTransfer;
  if(!dt || !dt.files || !dt.files.length) return;
  const arquivos = Array.from(dt.files).filter(f => /\.(pdf|png|jpe?g)$/i.test(f.name));
  if(!arquivos.length) return;
  await processarFilaIA(arquivos);
}
