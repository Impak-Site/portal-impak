// Testes da revisão de 17/10/2026: datas impossíveis, edição simultânea do
// mesmo processo e tradução de mensagens de erro. Cada caso reproduz um
// problema encontrado nos dados/código antes da correção.
// Rodar: node testes_revisao.js
const VD = require('./validacao-datas.js');
const CP = require('./concorrencia-processo.js');

let total = 0, passaram = 0;
function teste(nome, fn) {
  total++;
  try { fn(); passaram++; console.log('  ✓ ' + nome); }
  catch (e) { console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'falhou'); }
function iguais(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg ? msg + ' — ' : '') + `esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }
const HOJE = '2026-10-17';

console.log('\n── Datas impossíveis (validacao-datas.js) ──');
teste('Chegada antes do embarque é erro', () => {
  const r = VD.validar({ data_embarque: '2026-08-07', data_chegada: '2026-07-28' }, { hoje: HOJE });
  ok(VD.erros(r).length === 1, JSON.stringify(r));
  ok(/Data de Chegada \(28\/07\/2026\) está antes de Data de Embarque \(07\/08\/2026\)/.test(VD.erros(r)[0].msg), VD.erros(r)[0].msg);
});
teste('Embarque = chegada (padrão encontrado na base) gera aviso de trânsito curto', () => {
  const r = VD.validar({ data_embarque: '2026-08-07', data_chegada: '2026-08-07' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0);
  ok(VD.avisos(r).some(a => /0 dia\(s\) entre o Embarque/.test(a.msg)), JSON.stringify(r));
});
teste('Devolução do vazio antes da chegada (padrão encontrado na base) é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09' }, { hoje: HOJE });
  ok(VD.erros(r).some(e => e.campos.includes('data_devolucao_vazio')), JSON.stringify(r));
});
teste('Carga LCL não tem devolução de vazio — regra não se aplica', () => {
  const r = VD.validar({ tipo_container: 'LCL', data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0, JSON.stringify(r));
});
teste('Carregamento antes da chegada é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-10', data_carregamento: '2026-08-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Devolução antes do carregamento é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-01', data_carregamento: '2026-08-12', data_devolucao_vazio: '2026-08-10' }, { hoje: HOJE });
  ok(VD.erros(r).some(e => e.campos.join() === 'data_carregamento,data_devolucao_vazio'), JSON.stringify(r));
});
teste('ETA antes do ETD é erro', () => {
  const r = VD.validar({ etd: '2026-11-10', eta: '2026-11-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Ano digitado pela metade (0026-07-22, visto no histórico) é erro', () => {
  const r = VD.validar({ eta: '0026-07-22' }, { hoje: HOJE });
  ok(VD.erros(r).length >= 1 && /ano 0026/.test(VD.erros(r)[0].msg), JSON.stringify(r));
});
teste('Ano muito no futuro (2099) é erro', () => {
  const r = VD.validar({ pi_data_saldo: '2099-01-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Data real no futuro vira aviso (não erro)', () => {
  const r = VD.validar({ data_chegada: '2026-11-30' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0); ok(VD.avisos(r).length === 1);
});
teste('Sequência normal não gera nada', () => {
  const r = VD.validar({ etd: '2026-06-01', eta: '2026-07-28', data_embarque: '2026-06-03', data_chegada: '2026-07-30', data_presenca: '2026-07-31', data_carregamento: '2026-08-05', data_devolucao_vazio: '2026-08-12' }, { hoje: HOJE });
  iguais(r, []);
});
teste('Só valida regras dos campos alterados (processo antigo com erro não trava outra edição)', () => {
  const p = { data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09', obs: 'x' };
  iguais(VD.validar(p, { hoje: HOJE, campos: ['obs'] }), []);
  ok(VD.erros(VD.validar(p, { hoje: HOJE, campos: ['data_chegada'] })).length === 1);
});

// ── 18/10/2026: DI x Liberação/NF e devolução de cada container ──
teste('Liberação antes do registro da DI: aviso ao digitar (não trava)', () => {
  const r = VD.validar({ data_registro_di: '2026-03-12', data_liberacao: '2026-03-11' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0, JSON.stringify(r));
  ok(VD.avisos(r).some(a => /Data de Liberação \(11\/03\/2026\) está antes de Registro da DI\/DUIMP \(12\/03\/2026\)/.test(a.msg)), JSON.stringify(r));
});
teste('NF de entrada antes do registro da DI: aviso ao digitar (não trava)', () => {
  const r = VD.validar({ data_registro_di: '2026-03-12', nf_entrada_data: '2026-03-04' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0); ok(VD.avisos(r).some(a => /NF de Entrada/.test(a.msg)), JSON.stringify(r));
});
const DOIS_CONT = devs => JSON.stringify(devs.map((d, i) => ({ numero: 'TSTU000000' + (i + 1), tipo: '40HC', devolucao: d })));
teste('Devolução de um container antes da chegada é erro (2+ containers)', () => {
  const r = VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-28', '2026-04-02']) }, { hoje: HOJE, campos: ['containers_json'] });
  iguais(VD.erros(r).length, 1, JSON.stringify(r));
  ok(/TSTU0000002 \(02\/04\/2026\) está antes de Data de Chegada \(20\/04\/2026\)/.test(VD.erros(r)[0].msg), VD.erros(r)[0].msg);
});
teste('Container: mudar a chegada para depois de uma devolução também trava', () => {
  const r = VD.validar({ data_chegada: '2026-04-30', containers_json: DOIS_CONT(['2026-04-28', '']) }, { hoje: HOJE, campos: ['data_chegada'] });
  iguais(VD.erros(r).length, 1, JSON.stringify(r));
});
teste('Container: com 1 só vale a devolução do processo (o container guardado não trava)', () => {
  iguais(VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-02']) }, { hoje: HOJE, campos: ['containers_json'] }), []);
});
teste('Container: carga LCL não tem devolução', () => {
  iguais(VD.validar({ tipo_container: 'LCL', data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-02', '2026-04-03']) }, { hoje: HOJE, campos: ['containers_json'] }), []);
});
teste('Container: editar outro campo não confere as devoluções antigas', () => {
  iguais(VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-02', '']), obs: 'x' }, { hoje: HOJE, campos: ['obs'] }), []);
});
teste('Container: devolução no futuro vira aviso; ano pela metade é erro', () => {
  const r = VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-12-01', '0026-05-02']) }, { hoje: HOJE, campos: ['containers_json'] });
  ok(VD.avisos(r).some(a => /TSTU0000001 \(01\/12\/2026\) está no futuro/.test(a.msg)), JSON.stringify(r));
  ok(VD.erros(r).some(e => /TSTU0000002 com ano 0026/.test(e.msg)), JSON.stringify(r));
});

console.log('\n── Datas lidas pela IA com dia e mês trocados (conferirDatasLidas) ──');
const LER = (lidas, processo) => VD.conferirDatasLidas(lidas, processo, { hoje: HOJE });
teste('trocarDiaMes/dataExiste: só troca quando o dia serve de mês', () => {
  iguais(VD.trocarDiaMes('2026-03-04'), '2026-04-03');
  iguais(VD.trocarDiaMes('2026-03-13'), null, 'dia 13 não vira mês');
  iguais(VD.trocarDiaMes('2026-05-05'), null, 'dia = mês: a troca não muda nada');
  iguais(VD.trocarDiaMes('2026-02-30'), null, '30/02 trocado também não existe');
  iguais(VD.trocarDiaMes('2026-25-04'), '2026-04-25', 'mês 25 trocado vira 25/04');
  ok(!VD.dataExiste('2026-02-30') && !VD.dataExiste('2026-13-05') && VD.dataExiste('2028-02-29') && VD.dataExiste('0026-07-22'));
});
teste('RIC lido com dia e mês trocados (devolução antes da chegada): usa a trocada e avisa', () => {
  const r = LER({ data_devolucao_vazio: '2026-02-04' }, { data_chegada: '2026-03-20', data_carregamento: '2026-03-27' });
  iguais(r.datas, { data_devolucao_vazio: '2026-04-02' });
  iguais(r.trocadas.map(t => [t.campo, t.lida, t.usada]), [['data_devolucao_vazio', '2026-02-04', '2026-04-02']]);
  ok(/Devolução do Vazio lida como 04\/02\/2026 não fecha: .*antes de Data de Chegada \(20\/03\/2026\)\. Usei 02\/04\/2026 \(dia e mês trocados\)/.test(r.avisos[0]), r.avisos[0]);
});
teste('NF de entrada lida antes do registro da DI: usa a trocada', () => {
  const r = LER({ nf_entrada_data: '2026-02-04' }, { data_registro_di: '2026-03-30' });
  iguais(r.datas.nf_entrada_data, '2026-04-02'); iguais(r.trocadas.length, 1);
  ok(/Data da NF de Entrada \(04\/02\/2026\) está antes de Registro da DI\/DUIMP \(30\/03\/2026\)/.test(r.trocadas[0].motivo), r.trocadas[0].motivo);
});
teste('Data que já fecha não é trocada, mesmo quando a troca também fecharia', () => {
  const r = LER({ nf_entrada_data: '2026-04-03' }, { data_registro_di: '2026-03-01' });
  iguais(r.datas.nf_entrada_data, '2026-04-03'); iguais(r.avisos, []);
});
teste('Leitura da própria DI com o registro trocado (liberação e chegada certas): troca só o registro', () => {
  const r = LER({ data_registro_di: '2026-05-04', data_liberacao: '2026-04-16', data_chegada: '2026-04-03' }, { data_embarque: '2026-02-20' });
  iguais(r.datas, { data_registro_di: '2026-04-05', data_liberacao: '2026-04-16', data_chegada: '2026-04-03' });
  iguais(r.trocadas.map(t => t.campo), ['data_registro_di']);
  ok(/Data de Liberação \(16\/04\/2026\) está antes de Registro da DI\/DUIMP \(04\/05\/2026\)/.test(r.trocadas[0].motivo), r.trocadas[0].motivo);
});
teste('DI em que trocar o registro OU a liberação fecharia: não preenche nenhum dos dois', () => {
  // registro 04/05 x liberação 06/04: tanto 05/04 x 06/04 quanto 04/05 x 04/06 fecham
  const r = LER({ data_registro_di: '2026-05-04', data_liberacao: '2026-04-06', data_chegada: '2026-04-03' }, { data_embarque: '2026-02-20' });
  iguais(r.datas, { data_chegada: '2026-04-03' });
  iguais(r.descartadas.map(d => [d.campo, d.tipo]), [['data_registro_di', 'ambigua'], ['data_liberacao', 'ambigua']]);
});
teste('Data no futuro: troca quando a trocada fecha', () => {
  const r = LER({ data_devolucao_vazio: '2026-12-03' }, { data_chegada: '2026-02-20' });
  iguais(r.datas.data_devolucao_vazio, '2026-03-12');
  ok(/está no futuro/.test(r.trocadas[0].motivo), r.trocadas[0].motivo);
});
teste('Nenhuma das duas fecha: não usa e avisa (com a troca que também não serve)', () => {
  const r = LER({ data_devolucao_vazio: '2026-01-02' }, { data_chegada: '2026-03-08' });
  iguais(r.datas, {}); iguais(r.trocadas.length, 0); iguais(r.descartadas[0].tipo, 'ordem');
  ok(/Devolução do Vazio lida como 02\/01\/2026 não foi preenchida: .*antes de Data de Chegada \(08\/03\/2026\)\. Com dia e mês trocados \(01\/02\/2026\) também não fecha\. Confira no documento/.test(r.avisos[0]), r.avisos[0]);
});
teste('Dia acima de 12 (sem troca possível) e impossível: não usa e avisa', () => {
  const r = LER({ data_devolucao_vazio: '2026-03-15' }, { data_chegada: '2026-03-18' });
  iguais(r.datas, {}); iguais(r.trocadas.length, 0);
  ok(/Devolução do Vazio lida como 15\/03\/2026 não foi preenchida: .*antes de Data de Chegada \(18\/03\/2026\)\. Confira no documento/.test(r.avisos[0]), r.avisos[0]);
});
teste('Data que não existe (mês 25): usa a trocada', () => {
  const r = LER({ data_devolucao_vazio: '2026-25-04' }, { data_chegada: '2026-04-10' });
  iguais(r.datas.data_devolucao_vazio, '2026-04-25'); ok(/não existe no calendário/.test(r.avisos[0]), r.avisos[0]);
});
teste('Ambígua (trocar o ETD ou o ETA fecha igual): não usa nenhuma', () => {
  // ETA 08/06 antes do ETD 05/07: ETD 07/05 ou ETA 06/08 dão os dois 32 dias de viagem
  const r = LER({ etd: '2026-07-05', eta: '2026-06-08' }, {});
  iguais(r.datas, {}); iguais(r.descartadas.map(d => d.tipo), ['ambigua', 'ambigua']);
  ok(/Não dá para saber qual das datas deste documento está errada/.test(r.avisos[0]), r.avisos[0]);
});
teste('Data só improvável (trânsito curto) não é trocada — o aviso aparece ao salvar', () => {
  const r = LER({ data_chegada: '2026-03-08' }, { data_embarque: '2026-03-05' });
  iguais(r.datas.data_chegada, '2026-03-08'); iguais(r.avisos, []);
});
teste('Trocada que daria trânsito curto (ou longo) demais não é usada', () => {
  // chegada lida 08/03 é antes do embarque (28/07); a trocada, 03/08, daria 6 dias de viagem
  const r = LER({ data_chegada: '2026-03-08' }, { data_embarque: '2026-07-28' });
  iguais(r.datas, {}); iguais(r.trocadas.length, 0);
  // chegada lida 05/02 é antes do embarque (10/03); a trocada, 02/05, daria 53 dias — vale (até 90)
  iguais(LER({ data_chegada: '2026-02-05' }, { data_embarque: '2026-03-10' }).datas.data_chegada, '2026-05-02');
  // chegada lida 06/01 é antes do embarque (05/02); a trocada, 01/06, daria 116 dias — acima de 90, não usa
  iguais(LER({ data_chegada: '2026-01-06' }, { data_embarque: '2026-02-05' }).datas, {});
  // com embarque em 05/01 a trocada de uma chegada 2026-12-06 (06/12) daria 158 dias: não usa
  iguais(LER({ data_chegada: '2026-12-06' }, { data_embarque: '2026-01-05' }).datas, {});
});
teste('Datas certas passam sem aviso (PI/CI não são conferidas contra o processo)', () => {
  const r = LER({ data_registro_di: '2026-04-05', data_liberacao: '2026-04-06', data_chegada: '2026-04-03', ci_data: '2026-01-15', pi_data: '2026-01-02' }, { data_embarque: '2026-02-20', etd: '2026-02-18' });
  iguais(r.trocadas.length + r.descartadas.length, 0); iguais(r.datas.ci_data, '2026-01-15');
});
teste('Carga LCL: devolução não é conferida contra a chegada', () => {
  const r = LER({ data_devolucao_vazio: '2026-02-04' }, { data_chegada: '2026-03-20', tipo_container: 'LCL' });
  iguais(r.datas.data_devolucao_vazio, '2026-02-04'); iguais(r.avisos, []);
});
teste('Chegada lida depois da devolução de um container (2+ containers): não usa', () => {
  const r = LER({ data_chegada: '2026-04-21' }, { data_embarque: '2026-02-20', containers_json: DOIS_CONT(['2026-04-15', '']) });
  iguais(r.datas, {}); ok(/TSTU0000001 \(15\/04\/2026\) está antes de Data de Chegada \(21\/04\/2026\)/.test(r.avisos[0]), r.avisos[0]);
});
teste('Ano pela metade: não usa e não sugere troca', () => {
  const r = LER({ nf_entrada_data: '0026-04-05' }, {});
  iguais(r.datas, {}); ok(/ano 0026/.test(r.avisos[0]) && !/Com dia e mês trocados/.test(r.avisos[0]), r.avisos[0]);
});
teste('Formato que não é AAAA-MM-DD passa como veio; data com hora é lida só pela data', () => {
  iguais(LER({ nf_entrada_data: '05/04/2026' }, {}).datas, { nf_entrada_data: '05/04/2026' });
  iguais(LER({ data_devolucao_vazio: '2026-04-02T10:54' }, { data_chegada: '2026-03-20' }).datas, { data_devolucao_vazio: '2026-04-02' });
});
teste('noFuturo: mais de 1 dia à frente', () => {
  ok(VD.noFuturo('2026-10-19', HOJE) && !VD.noFuturo('2026-10-18', HOJE) && !VD.noFuturo('', HOJE));
});

console.log('\n── Travas de datas, 2ª parte: sequências, previsão e viagem longa ──');
const AVISOS = (p, campos) => VD.avisos(VD.validar(p, { hoje: HOJE, campos })).map(a => a.msg);
teste('Chegada mais de 30 dias longe do ETA: aviso (pega dia/mês trocados que cabem na sequência)', () => {
  const r = VD.validar({ eta: '2026-05-02', data_chegada: '2026-06-10' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0);
  ok(r.some(a => a.tipo === 'previsao' && /Data de Chegada \(10\/06\/2026\) está 39 dias depois do ETA \(02\/05\/2026\)/.test(a.msg)), JSON.stringify(r));
});
teste('Embarque mais de 30 dias antes do ETD: aviso; até 30 dias, nada', () => {
  ok(AVISOS({ etd: '2026-06-20', data_embarque: '2026-05-15' }).some(m => /36 dias antes do ETD/.test(m)));
  iguais(AVISOS({ etd: '2026-06-20', data_embarque: '2026-07-15' }), []);
});
teste('Carregamento antes da liberação: aviso (não trava)', () => {
  const r = VD.validar({ data_chegada: '2026-04-01', data_liberacao: '2026-04-10', data_carregamento: '2026-04-05' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0);
  ok(VD.avisos(r).some(a => /Data de Carregamento \(05\/04\/2026\) está antes de Data de Liberação \(10\/04\/2026\)/.test(a.msg)), JSON.stringify(r));
});
teste('NF de entrada depois do carregamento: aviso', () => {
  ok(AVISOS({ data_chegada: '2026-04-01', nf_entrada_data: '2026-04-12', data_carregamento: '2026-04-08' })
    .some(m => /Data de Carregamento \(08\/04\/2026\) está antes de Data da NF de Entrada \(12\/04\/2026\)/.test(m)));
});
teste('Prontidão na fábrica depois do embarque: aviso', () => {
  ok(AVISOS({ data_prontidao: '2026-03-10', data_embarque: '2026-03-01' })
    .some(m => /Data de Embarque \(01\/03\/2026\) está antes de Prontidão na Fábrica \(10\/03\/2026\)/.test(m)));
});
teste('Viagem com mais de 90 dias: aviso', () => {
  ok(AVISOS({ data_embarque: '2026-01-05', data_chegada: '2026-04-20' }).some(m => /105 dias entre o Embarque/.test(m)));
  iguais(AVISOS({ data_embarque: '2026-01-05', data_chegada: '2026-03-20' }), []);
});
teste('Regras novas também só valem para os campos alterados', () => {
  iguais(AVISOS({ data_embarque: '2026-01-05', data_chegada: '2026-04-20', obs: 'x' }, ['obs']), []);
});

console.log('\n── A data como está impressa no documento (lerDataTexto) ──');
const TXT = (t, o) => VD.lerDataTexto(t, o);
teste('Ano na frente, com hora ou sem: sem ambiguidade', () => {
  iguais(TXT('2026/05/30 10:54'), { data: '2026-05-30', ambigua: false });
  iguais(TXT('2026-09-08T10:54:00'), { data: '2026-09-08', ambigua: false });
  iguais(TXT('2026年5月30日'), { data: '2026-05-30', ambigua: false });
});
teste('Mês por extenso (inglês e português): sem ambiguidade', () => {
  iguais(TXT('30-MAY-2026').data, '2026-05-30');
  iguais(TXT('SEP. 05, 2026').data, '2026-09-05');
  iguais(TXT('Sep 5th 2026').data, '2026-09-05');
  iguais(TXT('5 de setembro de 2026').data, '2026-09-05');
  iguais(TXT('05-SET-26').data, '2026-09-05');
});
teste('Dia/mês numérico: dia acima de 12 decide; até 12 depende do documento', () => {
  iguais(TXT('15/09/2026'), { data: '2026-09-15', ambigua: false });
  iguais(TXT('09/15/2026'), { data: '2026-09-15', ambigua: false });
  iguais(TXT('08/09/2026'), { data: null, ambigua: true }, 'sem saber o padrão do documento');
  iguais(TXT('08/09/2026 10:54', { diaPrimeiro: true }), { data: '2026-09-08', ambigua: true }, 'documento brasileiro');
  iguais(TXT('08/09/2026', { diaPrimeiro: false }).data, '2026-08-09');
  iguais(TXT('Emissão: 05.10.2026 14:22', { diaPrimeiro: true }).data, '2026-10-05');
});
teste('Texto com rótulo antes da data não confunde o mês', () => {
  iguais(TXT('gate out 28/05/2026').data, '2026-05-28');
});
teste('Data que não existe ou texto sem data', () => {
  iguais(TXT('31/02/2026'), { data: null, ambigua: false });
  iguais(TXT('sem data'), null); iguais(TXT(''), null); iguais(TXT(null), null);
});
teste('Data confirmada pelo texto (semTroca) não é trocada: se não fecha, não é usada', () => {
  const r = VD.conferirDatasLidas({ data_devolucao_vazio: '2026-02-04' }, { data_chegada: '2026-03-20' }, { hoje: HOJE, semTroca: ['data_devolucao_vazio'] });
  iguais(r.datas, {}); iguais(r.trocadas.length, 0);
  ok(!/Com dia e mês trocados/.test(r.avisos[0]), r.avisos[0]);
  // sem a confirmação do texto, a mesma leitura é trocada
  iguais(LER({ data_devolucao_vazio: '2026-02-04' }, { data_chegada: '2026-03-20' }).datas.data_devolucao_vazio, '2026-04-02');
});

console.log('\n── Importações e auditoria (separarDatasImpossiveis / auditarProcessos) ──');
teste('Importação: data impossível sai do que vai ser gravado, com o motivo; o resto entra', () => {
  const r = VD.separarDatasImpossiveis({ data_embarque: '2026-03-10', etd: '2026-03-08' }, { data_chegada: '2026-03-01', eta: '2026-04-15', navio: 'NAVIO TESTE' }, { hoje: HOJE });
  iguais(r.patch, { eta: '2026-04-15', navio: 'NAVIO TESTE' });
  iguais(r.recusadas.map(x => [x.campo, x.valor]), [['data_chegada', '2026-03-01']]);
  ok(/Data de Chegada \(01\/03\/2026\) está antes de Data de Embarque \(10\/03\/2026\)/.test(r.recusadas[0].motivo), r.recusadas[0].motivo);
});
teste('Importação: as duas datas do erro vindas juntas não entram (não dá para saber qual está errada)', () => {
  const r = VD.separarDatasImpossiveis({}, { etd: '2026-05-10', eta: '2026-05-01' }, { hoje: HOJE });
  iguais(r.patch, {}); iguais(r.recusadas.map(x => x.campo).sort(), ['eta', 'etd']);
});
teste('Importação: data só improvável entra e volta como aviso', () => {
  const r = VD.separarDatasImpossiveis({ eta: '2026-04-20', data_embarque: '2026-03-10' }, { data_chegada: '2026-05-30' }, { hoje: HOJE });
  iguais(r.patch, { data_chegada: '2026-05-30' }); iguais(r.recusadas, []);
  ok(r.avisos.some(m => /40 dias depois do ETA/.test(m)), JSON.stringify(r.avisos));
});
teste('Importação: chegada depois da devolução de um container já gravado (2+ containers) não entra', () => {
  const r = VD.separarDatasImpossiveis({ containers_json: DOIS_CONT(['2026-04-15', '']) }, { data_chegada: '2026-04-21' }, { hoje: HOJE });
  iguais(r.patch, {}); iguais(r.recusadas[0].campo, 'data_chegada');
});
teste('Auditoria: só processos com problema, sem os cancelados, e DI/NF no futuro também contam', () => {
  const lista = [
    { id: 1, referencia: 'TESTE-1', data_embarque: '2026-03-10', data_chegada: '2026-03-01' },
    { id: 2, referencia: 'TESTE-2', data_embarque: '2026-03-10', data_chegada: '2026-04-05' },
    { id: 3, referencia: 'TESTE-3', cancelado: true, data_embarque: '2026-03-10', data_chegada: '2026-03-01' },
    { id: 4, referencia: 'TESTE-4', data_liberacao: '2026-12-20' },
  ];
  const a = VD.auditarProcessos(lista, { hoje: HOJE });
  iguais(a.map(x => x.processo.referencia), ['TESTE-1', 'TESTE-4']);
  iguais(a[0].problemas[0].nivel, 'erro');
  ok(/Data de Liberação \(20\/12\/2026\) está no futuro/.test(a[1].problemas[0].msg), a[1].problemas[0].msg);
});

// ── 19/10/2026 (auditoria dos FECHADOS): NF de venda da aba Vendas com dia e
// mês trocados — 11/08 gravada como 08/11, no futuro. Valores fictícios.
console.log('\n── NFs da aba Vendas (vendas_json) ──');
const procVendas = (vendas, extra) => ({ nf_entrada_data: '2026-08-10', vendas_json: JSON.stringify(vendas), ...(extra || {}) });
teste('NF de venda com data no futuro gera aviso e sugere a data com dia/mês trocados', () => {
  const r = VD.validar(procVendas([{ nf_saida_numero: '9001', nf_saida_data: '2026-11-08' }]), { hoje: HOJE });
  iguais(VD.erros(r).length, 0, JSON.stringify(r));
  const a = VD.avisos(r);
  iguais(a.length, 1, JSON.stringify(r));
  iguais(a[0].tipo, 'futuro'); iguais(a[0].campos, ['vendas_json']);
  ok(/NF 9001.*08\/11\/2026\) está no futuro/.test(a[0].msg), a[0].msg);
  ok(/trocados ficaria 11\/08\/2026/.test(a[0].msg), a[0].msg);
});
teste('NF de venda antes da NF de entrada gera aviso; venda sem número (planejada) com data futura não', () => {
  const r = VD.validar(procVendas([
    { nf_saida_numero: '9002', nf_saida_data: '2026-07-08' },
    { nf_saida_numero: '', nf_saida_data: '2026-12-15' },
    { nf_saida_numero: '9003', nf_saida_data: '2026-08-12' },
  ]), { hoje: HOJE });
  const a = VD.avisos(r);
  iguais(a.length, 1, JSON.stringify(r));
  iguais(a[0].tipo, 'ordem');
  ok(/NF 9002.*antes da Data da NF de Entrada \(10\/08\/2026\)/.test(a[0].msg), a[0].msg);
});
teste('NF de venda com ano incompleto é erro; vendas_json inválido não quebra', () => {
  const r = VD.validar(procVendas([{ nf_saida_numero: '9004', nf_saida_data: '0026-08-12' }]), { hoje: HOJE });
  iguais(VD.erros(r).length, 1, JSON.stringify(r));
  iguais(VD.validar({ vendas_json: '{quebrado' }, { hoje: HOJE }).length, 0);
});
teste('Salvar sem mexer em Vendas não repete o aviso das NFs (campos alterados)', () => {
  const r = VD.validar(procVendas([{ nf_saida_numero: '9001', nf_saida_data: '2026-11-08' }]), { hoje: HOJE, campos: ['data_chegada'] });
  iguais(r.length, 0, JSON.stringify(r));
});
teste('Auditoria semanal pega a NF de venda no futuro', () => {
  const a = VD.auditarProcessos([{ id: 5, referencia: 'TESTE-5', ...procVendas([{ nf_saida_numero: '9001', nf_saida_data: '2026-11-08' }]) }], { hoje: HOJE });
  iguais(a.length, 1);
  ok(/está no futuro/.test(a[0].problemas[0].msg), a[0].problemas[0].msg);
});

// ── 19/10/2026: planilha de fora traz a referência sem o "IMPAK-" (ou com) ──
// Antes a importação só achava a referência idêntica e dava "não encontrada"
// para processos cadastrados com o prefixo. Referências fictícias.
console.log('\n── Referência com ou sem o prefixo IMPAK- (referencia-processo.js) ──');
const RP = require('./referencia-processo.js');
const PROCS_REF = [
  { id: 1, referencia: 'IMPAK-TST2601A-1' }, { id: 2, referencia: 'IMPAK-TST2601A-2' },
  { id: 3, referencia: 'QWE2602-9' },
  { id: 4, referencia: 'IMPAK-XYZ2603-CLIENTE' }, { id: 5, referencia: 'IMPAK-XYZ2603-CLIENTE-2' },
  { id: 6, referencia: 'TO-55' },
];
teste('Planilha sem o prefixo acha o processo cadastrado com "IMPAK-"', () => {
  const r = RP.encontrar(RP.criarIndice(PROCS_REF), 'TST2601A-1');
  iguais([r.processo && r.processo.id, r.como], [1, 'sem_prefixo']);
});
teste('Planilha com o prefixo acha o processo cadastrado sem ele', () => {
  const r = RP.encontrar(RP.criarIndice(PROCS_REF), 'IMPAK-QWE2602-9');
  iguais([r.processo && r.processo.id, r.como], [3, 'sem_prefixo']);
});
teste('Referência igual continua exata (maiúscula e espaço nas pontas não importam)', () => {
  const r = RP.encontrar(RP.criarIndice(PROCS_REF), '  impak-tst2601a-2 ');
  iguais([r.processo && r.processo.id, r.como], [2, 'exato']);
});
teste('Dois processos que só diferem pelo prefixo: a igual vence; sem igual, não escolhe nenhum', () => {
  const idx = RP.criarIndice([{ id: 'a', referencia: 'IMPAK-DUP1-1' }, { id: 'b', referencia: 'DUP1-1' }]);
  iguais(RP.encontrar(idx, 'DUP1-1').processo.id, 'b');
  iguais(RP.encontrar(idx, 'IMPAK-DUP1-1').processo.id, 'a');
  const r = RP.encontrar(idx, 'IMPAK DUP1-1');
  iguais([r.processo, r.como, r.candidatos.sort()], [null, 'ambiguo', ['DUP1-1', 'IMPAK-DUP1-1']]);
});
teste('Prefixo colado no resto não é cortado ("IMPAKTO-55" não vira "TO-55")', () => {
  iguais(RP.semPrefixo('IMPAKTO-55'), 'IMPAKTO-55');
  iguais(RP.encontrar(RP.criarIndice(PROCS_REF), 'IMPAKTO-55').processo, null);
});
teste('Não encontrada volta com as parecidas do Controle (mesmo começo)', () => {
  const r = RP.encontrar(RP.criarIndice(PROCS_REF), 'XYZ2603');
  iguais([r.processo, r.sugestoes], [null, ['IMPAK-XYZ2603-CLIENTE', 'IMPAK-XYZ2603-CLIENTE-2']]);
  iguais(RP.encontrar(RP.criarIndice(PROCS_REF), 'ZZZ9999').sugestoes, []);
});
teste('Criação em lote: não cria de novo o que já existe com/sem o prefixo nem repete no mesmo lote', () => {
  const s = RP.separarNovos(PROCS_REF, [{ referencia: 'TST2601A-1' }, { referencia: 'NOVO2604-1' }, { referencia: 'IMPAK-NOVO2604-1' }, { referencia: '' }]);
  iguais(s.novos.map(p => p.referencia), ['NOVO2604-1']);
  iguais(s.equivalentes, [{ referencia: 'TST2601A-1', existente: 'IMPAK-TST2601A-1' }]);
  iguais(s.repetidos, ['IMPAK-NOVO2604-1']);
});

console.log('\n── Edição simultânea (concorrencia-processo.js) ──');
const original = { id: 'p1', referencia: 'UD26-900', fase: 'EMBARCADO', obs: 'a', navio: 'MSC X', data_chegada: null, vendas_json: '[]', updated_at: '2026-10-17T10:00:00.000+00:00' };
const atual = { ...original, fase: 'CHEGOU', data_chegada: '2026-10-16', navio: 'MSC Y', updated_at: '2026-10-17T10:05:00.000+00:00', updated_by: 'fulano' };
teste('Detecta o que a outra pessoa mudou (sem contar campos calculados)', () => {
  iguais(CP.alteradosPorOutros(original, atual), ['data_chegada', 'navio']);
});
teste('Campos diferentes: junta sem perguntar e mantém fase/chegada da outra pessoa', () => {
  const meu = { ...original, obs: 'b' };
  iguais(CP.camposEmConflito(original, atual, meu, ['obs']), []);
  const m = CP.mesclar(atual, meu, ['obs']);
  iguais([m.obs, m.data_chegada, m.fase, m.navio], ['b', '2026-10-16', 'CHEGOU', 'MSC Y']);
});
teste('Mesmo campo com valores diferentes: conflito', () => {
  const meu = { ...original, navio: 'MSC Z' };
  const c = CP.camposEmConflito(original, atual, meu, ['navio']);
  iguais(c.map(x => x.campo), ['navio']); iguais(c[0].deles, 'MSC Y');
});
teste('Mesmo campo com o MESMO valor: não é conflito', () => {
  const meu = { ...original, navio: 'MSC Y' };
  iguais(CP.camposEmConflito(original, atual, meu, ['navio']), []);
});
teste('Usuário escolhe manter o valor da outra pessoa num campo', () => {
  const meu = { ...original, navio: 'MSC Z', obs: 'b' };
  const m = CP.mesclar(atual, meu, ['navio', 'obs'], ['navio']);
  iguais([m.navio, m.obs], ['MSC Y', 'b']);
});
teste('Campo calculado (fase) mandado pelo painel nunca vira conflito nem sobrescreve', () => {
  const meu = { ...original, fase: 'EMBARCADO', obs: 'c' };
  iguais(CP.camposEmConflito(original, atual, meu, ['fase', 'obs']), []);
  iguais(CP.mesclar(atual, meu, ['fase', 'obs']).fase, 'CHEGOU');
});
teste('JSON com chaves em outra ordem não conta como diferente', () => {
  ok(!CP.diferente('[{"a":1,"b":2}]', [{ b: 2, a: 1 }]));
  ok(!CP.diferente('5.10', 5.1));
  ok(!CP.diferente(null, ''));
});
teste('real_json: vínculo com fatura gravado pelo servidor é mantido e não é conflito', () => {
  const o = { ...original, real_json: { frete: { valor: 100, moeda: 'USD' } } };
  const a = { ...o, real_json: { frete: { valor: 100, moeda: 'USD' }, _meta: { frete: { fatura_id: 'f1', pago_em: '2026-10-16' } } } };
  const meu = { ...o, real_json: { frete: { valor: 120, moeda: 'USD' } } };
  iguais(CP.camposEmConflito(o, a, meu, ['real_json']), []);
  const m = CP.mesclar(a, meu, ['real_json']);
  iguais(m.real_json.frete.valor, 120); iguais(m.real_json._meta.frete.fatura_id, 'f1');
});
teste('real_json: dois mudando o mesmo custo é conflito', () => {
  const o = { ...original, real_json: { frete: { valor: 100 } } };
  const a = { ...o, real_json: { frete: { valor: 110 } } };
  const meu = { ...o, real_json: { frete: { valor: 120 } } };
  iguais(CP.camposEmConflito(o, a, meu, ['real_json']).map(x => x.campo), ['real_json']);
});

console.log('\n── Mistura de moedas nos totais (faturas-core.js / fin-core.js) ──');
const FAT = require('./faturas-core.js');
const FIN = require('./fin-core.js');
const HOJE_F = '2026-10-17';
// Sem a cotação do dia, a tela passa { USD: null } (cambioParaTotais) — antes passava 1.
const SEM_COTACAO = { BRL: 1, USD: null, EUR: null };
teste('Fatura em US$ sem câmbio fica FORA do total (antes contava US$ como R$) e é contada', () => {
  const lista = [
    { tipo: 'pagar', status: 'aberta', moeda: 'BRL', valor: 1000, vencimento: '2026-11-01' },
    { tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 1000, cambio: null, vencimento: '2026-11-01' },
  ];
  const r = FAT.resumoFaturas(lista, HOJE_F, SEM_COTACAO);
  iguais(r.pagar_aberto, 1000); iguais(r.sem_cambio, 1);
});
teste('Fatura em US$ usa o câmbio da própria fatura (igual à linha da lista)', () => {
  const lista = [{ tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 1000, cambio: 5.25, vencimento: '2026-11-01' }];
  iguais(FAT.resumoFaturas(lista, HOJE_F, SEM_COTACAO).pagar_aberto, 5250);
  iguais(FAT.resumoFaturas(lista, HOJE_F, { USD: 5.6 }).pagar_aberto, 5250, 'câmbio da fatura vem antes do câmbio do dia');
  iguais(FAT.fatorBRL({ moeda: 'USD', cambio: null }, { USD: 5.6 }), 5.6, 'sem câmbio na fatura, usa o do dia');
  iguais(FAT.fatorBRL({ moeda: 'BRL' }, {}), 1);
});
teste('Fluxo de caixa conta as faturas sem câmbio', () => {
  const fl = FAT.fluxoMensalFaturas([{ tipo: 'pagar', status: 'aberta', moeda: 'EUR', valor: 300, vencimento: '2026-11-10' }], ['2026-10', '2026-11'], HOJE_F, SEM_COTACAO);
  iguais(fl.semCambio.qtd, 1); iguais(fl.meses['2026-11'].pagar_previsto, 0);
});
teste('Baixa de fatura em US$ sem câmbio nenhum é recusada (entraria como R$ 0 no caixa)', () => {
  const f = { valor: 1000, status: 'aberta', moeda: 'USD', cambio: null };
  const v = FAT.validarPagamento({ data: '2026-10-10', valor: 1000 }, f);
  ok(!v.ok && /sem câmbio/.test(v.erro), JSON.stringify(v));
  ok(FAT.validarPagamento({ data: '2026-10-10', valor: 1000, cambio_efetivo: '5,30' }, f).ok, 'com câmbio efetivo passa');
  ok(FAT.validarPagamento({ data: '2026-10-10', valor: 1000 }, { ...f, cambio: 5.2 }).ok, 'com câmbio na fatura passa (só avisa)');
});
const CONTAS_F = FIN.PLANO_PADRAO.map(([codigo, nome, grupo]) => ({ id: 'c' + codigo, codigo, nome, grupo }));
teste('DRE (competência): fatura em US$ sem câmbio fica fora e é contada', () => {
  const d = FIN.dreEmpresa([{ tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 500, emissao: '2026-10-05' }], CONTAS_F, { de: '2026-10-01', ate: '2026-10-31', regime: 'competencia', cambio: SEM_COTACAO });
  iguais(d.sem_cambio, 1); iguais(d.resultadoLiquido, 0);
});
teste('DRE (caixa): sem câmbio na fatura, o pagamento sai pelo câmbio efetivo da baixa', () => {
  const f = { tipo: 'pagar', status: 'paga', moeda: 'USD', valor: 100, cambio: null, pagamentos: [{ data: '2026-10-08', valor: 100, cambio_efetivo: 5.5, pago_brl: 550 }] };
  const d = FIN.dreEmpresa([f], CONTAS_F, { de: '2026-10-01', ate: '2026-10-31', regime: 'caixa', cambio: SEM_COTACAO });
  iguais(d.sem_cambio, 0); iguais(d.resultadoLiquido, -550);
});
teste('Contador: transferência US$ → R$ usa o valor creditado em R$', () => {
  const bancos = [{ id: 'b1', nome: 'Conta US$', moeda: 'USD' }, { id: 'b2', nome: 'Conta R$', moeda: 'BRL' }];
  const l = FIN.lancamentosContabeis([], CONTAS_F, bancos, { de: '2026-10-01', ate: '2026-10-31', transferencias: [{ data: '2026-10-09', de_banco_id: 'b1', para_banco_id: 'b2', valor: 1000, valor_destino: 5400 }] });
  iguais(l.length, 1); iguais(l[0].valor, 5400);
  const l2 = FIN.lancamentosContabeis([], CONTAS_F, [{ id: 'b1', nome: 'A', moeda: 'USD' }, { id: 'b3', nome: 'B', moeda: 'EUR' }], { transferencias: [{ data: '2026-10-09', de_banco_id: 'b1', para_banco_id: 'b3', valor: 100 }] });
  ok(/\[valor em USD\]/.test(l2[0].historico), 'sem lado em R$, marca a moeda no histórico');
});

// ── Rede (chat.js): erro que não veio do sistema vira mensagem útil ──
// Durante uma atualização o Railway responde 502 com uma página HTML; a tela
// fazia r.json() e mostrava "Unexpected token '<'". Roda o trecho de rede do
// chat.js de verdade, num sandbox, com um fetch falso por baixo.
const fs = require('fs'), vm = require('vm'), path = require('path');
async function testeAsync(nome, fn) {
  total++;
  try { await fn(); passaram++; console.log('  ✓ ' + nome); }
  catch (e) { console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}
function redeDoChatJs(fetchFalso) {
  const src = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
  const ini = src.indexOf('(function instalarRedeImpak(){');
  const fim = src.indexOf('\n})();', ini);
  if (ini < 0 || fim < 0) throw new Error('trecho instalarRedeImpak não encontrado no chat.js');
  const janela = { fetch: fetchFalso };
  const ctx = { window: janela, location: { pathname: '/controle', search: '' }, Response, Map, Date, Math, JSON, String, Error, setTimeout, encodeURIComponent,
    document: { getElementById: () => null, body: null } };
  vm.runInNewContext(src.slice(ini, fim + '\n})();'.length), ctx);
  return janela.fetch;
}
const resposta = (status, corpo, tipo) => Promise.resolve(new Response(corpo, { status, headers: { 'Content-Type': tipo } }));

// ── Leitura por IA de verdade (controle-import-ia.js / controle-nf-import.js) ──
// Monta os módulos do Controle num sandbox com tela e fetch falsos: o "fetch"
// devolve o JSON que a IA teria lido e o teste confere o que foi parar nos
// campos depois da trava de dia/mês trocados (18/10/2026).
const MODULOS_LEITURA = ['taxas-catalogo.js', 'listas-padrao.js', 'validacao-datas.js', 'concorrencia-processo.js', 'referencia-processo.js', 'controle-core.js',
  'controle-modal.js', 'controle-campos.js', 'controle-export.js', 'controle-contatos.js', 'controle-import-ia.js', 'controle-nf-import.js', 'controle-dashboards.js'];
let _jsLeitura = null;
function telaComIA(respostaIA) {
  _jsLeitura = _jsLeitura || MODULOS_LEITURA.map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  const els = {}, toasts = [];
  const novoEl = id => ({ id, value: '', innerHTML: '', style: {}, textContent: '', dataset: {}, checked: false, options: [], selectedIndex: 0, tagName: 'INPUT',
    classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild(c) { (this.filhos = this.filhos || []).push(c); },
    querySelector() { return null; }, querySelectorAll() { return []; }, dispatchEvent() { return true; }, setAttribute() {}, removeAttribute() {}, remove() {} });
  const json = d => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) });
  const ctx = {
    document: { getElementById: id => els[id] || (els[id] = novoEl(id)), querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
      createElement: t => novoEl('novo-' + t), body: { appendChild() {}, classList: { add() {}, remove() {} } }, head: { appendChild() {} } },
    fetch: async url => String(url) === '/api/analisar' ? json({ ok: true, jobId: 'j1' })
      : String(url).startsWith('/api/analisar/job/') ? json({ ok: true, status: 'concluido', resultado: { content: [{ text: JSON.stringify(respostaIA) }] } })
      : json({ ok: true, contatos: [], empresas: [] }),
    FileReader: class { readAsDataURL() { this.result = 'data:application/pdf;base64,AAAA'; setImmediate(() => this.onload && this.onload()); } },
    setTimeout: fn => setImmediate(fn), clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { origin: 'http://localhost', href: 'http://localhost/controle', pathname: '/controle', search: '' }, navigator: { clipboard: { writeText() {} } },
    console, Date, Math, JSON, Promise, URL, Event: class {}, addEventListener() {}, confirm: () => true, alert() {}, __toasts: toasts,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(_jsLeitura, ctx, { filename: 'modulos-controle.js' });
  vm.runInContext(`showToast = (m, t) => { __toasts.push([t, m]); };
    _user = { usuario: 'teste', role: 'gerente' }; _editando = { id: null, _camposIA: {}, log: [] }; _containers = [{ numero: '', tipo: '40HC', lacre: '' }];`, ctx);
  const tela = (id, v) => { ctx.document.getElementById(id).value = v; };
  const ler = () => vm.runInContext(`extrairComIA_umArquivo({ files: [{ name: 'doc-teste.pdf', type: 'application/pdf' }], value: 'x' })`, ctx);
  return { ctx, els, toasts, tela, ler, rodar: code => vm.runInContext(code, ctx) };
}

(async () => {
  console.log('\n── Leitura por IA: trava de dia/mês trocados nos campos (controle-import-ia.js) ──');
  await testeAsync('RIC (1 container) lido com dia e mês trocados: devolução corrigida, avisada e anotada no Histórico', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000001', lacre: '' }], data_devolucao_vazio: '2026-02-04', depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20'); t.tela('f_data_carregamento', '2026-03-27'); t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.els.f_data_devolucao_vazio.value, '2026-04-02');
    ok(t.toasts.some(x => x[0] === 'warn' && /1 data\(s\) conferida/.test(x[1])), JSON.stringify(t.toasts));
    ok((t.els['ia-status'].filhos || []).some(f => /Datas conferidas/.test(f.innerHTML) && /Usei 02\/04\/2026/.test(f.innerHTML)), 'caixa de aviso na tela');
    ok(t.rodar('_editando.log').some(l => /, Datas conferidas: .* lida 04\/02\/2026 → usada 02\/04\/2026 \(dia e mês trocados\)$/.test(l.valor_depois)), JSON.stringify(t.rodar('_editando.log')));
  });
  await testeAsync('Leitura por IA: se o processo é trocado enquanto a IA lê, nada é preenchido no processo novo (24/10/2026)', async () => {
    const t = telaComIA({ nf_entrada_numero: '999', nf_entrada_data: '2026-03-02', nf_entrada_valor: 1000, fornecedor: 'FORNECEDOR TESTE' });
    const leitura = t.ler();
    t.rodar(`definirProcessoNoPainel({ id: 'teste-outro', referencia: 'TESTE-OUTRO', log: [] });`); // abriu outro no meio da leitura
    await leitura;
    iguais([t.els.f_nf_entrada_numero ? t.els.f_nf_entrada_numero.value : '', t.els.f_fornecedor ? t.els.f_fornecedor.value : ''], ['', '']);
    ok(t.toasts.some(x => x[0] === 'warn' && /fechado ou trocado/.test(x[1])), JSON.stringify(t.toasts));
    iguais(t.rodar('(_editando.log || []).length'), 0, 'nada no Histórico do outro processo');
  });
  await testeAsync('Leitura por IA: painel fechado durante a leitura também descarta o resultado', async () => {
    const t = telaComIA({ nf_entrada_numero: '998', nf_entrada_data: '2026-03-02', nf_entrada_valor: 1000 });
    const leitura = t.ler();
    t.rodar('limparProcessoDoPainel();');
    await leitura;
    iguais(t.els.f_nf_entrada_numero ? t.els.f_nf_entrada_numero.value : '', '');
    ok(t.toasts.some(x => /fechado ou trocado/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Leitura por IA: sem troca de processo, o mesmo documento preenche normalmente', async () => {
    const t = telaComIA({ nf_entrada_numero: '997', nf_entrada_data: '2026-03-02', nf_entrada_valor: 1000 });
    await t.ler();
    iguais(t.els.f_nf_entrada_numero.value, '997');
    ok(!t.toasts.some(x => /fechado ou trocado/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Fila de documentos: para quando o processo é trocado no meio', async () => {
    const t = telaComIA({ nf_entrada_numero: '996', nf_entrada_data: '2026-03-02', nf_entrada_valor: 1000 });
    t.rodar(`_editando.referencia = 'TESTE-FILA'; window.__lidos = 0; const _orig = extrairComIA_umArquivo;
      extrairComIA_umArquivo = async (inp) => { window.__lidos++; if(window.__lidos === 1) definirProcessoNoPainel({ id: 'teste-outro-2', referencia: 'TESTE-OUTRO-2' }); };`);
    await t.rodar(`processarFilaIA([{ name: 'a.pdf' }, { name: 'b.pdf' }, { name: 'c.pdf' }])`);
    iguais(t.rodar('window.__lidos'), 1);
    ok(t.toasts.some(x => /restantes da fila não foram lidos/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('RIC (2 containers): a data trocada vai para o container certo', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000002', lacre: '' }], data_devolucao_vazio: '2026-02-04', depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20');
    t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }, { numero: 'TSTU0000002', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.rodar('_containers.map(c => c.devolucao || "")'), ['', '2026-04-02']);
  });
  await testeAsync('RIC (2 containers) impossível nos dois sentidos: não grava a data (o depot sim)', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000002', lacre: '' }], data_devolucao_vazio: '2026-03-15', depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20');
    t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }, { numero: 'TSTU0000002', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.rodar('_containers.map(c => [c.devolucao || "", c.depot || ""])'), [['', ''], ['', 'DEPOT TESTE']]);
    ok(t.toasts.some(x => /data\(s\) conferida/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('DI registrada antes da atracação (chegada no futuro): a chegada vai para o ETA, sem troca', async () => {
    const daqui40 = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10); // sempre no futuro
    const t = telaComIA({ numero_di: '26BR0000000001-0', data_registro_di: '2026-10-10', data_chegada: daqui40, canal: 'VERDE' });
    t.tela('f_data_embarque', '2026-09-01');
    await t.ler();
    iguais([t.els.f_data_chegada.value, t.els.f_eta.value, t.els.f_data_registro_di.value], ['', daqui40, '2026-10-10']);
    ok(t.toasts.some(x => /data\(s\) conferida/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('NF de entrada (leitura geral) antes do registro da DI: data trocada', async () => {
    const t = telaComIA({ nf_entrada_numero: '123', nf_entrada_data: '2026-02-04', nf_entrada_valor: 1000 });
    t.tela('f_data_registro_di', '2026-03-30');
    await t.ler();
    iguais(t.els.f_nf_entrada_data.value, '2026-04-02');
  });
  await testeAsync('CE Mercante: chegada lida fora da DI continua indo para o ETA e é conferida como ETA', async () => {
    // ETA lido 08/03 antes do ETD (20/05); trocado, 03/08, dá 75 dias de viagem
    const t = telaComIA({ ce_master: '123456789012345', data_chegada: '2026-03-08', etd: '2026-05-20' });
    await t.ler();
    iguais([t.els.f_eta.value, t.els.f_data_chegada.value], ['2026-08-03', '']);
  });
  await testeAsync('CE Mercante com o mesmo número em Master e House: fica só o House, o Master não é preenchido e a tela avisa', async () => {
    const t = telaComIA({ ce_master: '182600000000001', ce_house: '182600000000001' });
    await t.ler();
    const campo = id => t.ctx.document.getElementById(id).value; // o campo do Master nem é tocado
    iguais([campo('f_ce_master'), campo('f_ce_house')], ['', '182600000000001']);
    ok(t.toasts.some(x => x[0] === 'warn' && /CE Master não preenchido/.test(x[1])), JSON.stringify(t.toasts));
    ok((t.els['ia-status'].filhos || []).some(f => /mesmo número do CE House/.test(f.innerHTML)), 'caixa de aviso na tela');
    ok(t.rodar('_editando.log').some(l => /CE Master não usado \(igual ao CE House\)/.test(l.valor_depois)), JSON.stringify(t.rodar('_editando.log')));
  });
  await testeAsync('CE Mercante com Master e House diferentes: preenche os dois, sem aviso', async () => {
    const t = telaComIA({ ce_master: '182600000000002', ce_house: '182600000000003' });
    await t.ler();
    iguais([t.els.f_ce_master.value, t.els.f_ce_house.value], ['182600000000002', '182600000000003']);
    ok(!t.toasts.some(x => /CE Master não preenchido/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('BL com o mesmo número em HBL e MBL: fica só o HBL, o MBL não é preenchido e a tela avisa', async () => {
    const t = telaComIA({ hbl: 'HCMS000001', mbl: 'HCMS000001' });
    await t.ler();
    const campo = id => t.ctx.document.getElementById(id).value;
    iguais([campo('f_hbl'), campo('f_mbl')], ['HCMS000001', '']);
    ok(t.toasts.some(x => x[0] === 'warn' && /MBL não preenchido/.test(x[1])), JSON.stringify(t.toasts));
    ok((t.els['ia-status'].filhos || []).some(f => /mesmo número do HBL/.test(f.innerHTML)), 'caixa de aviso na tela');
    ok(t.rodar('_editando.log').some(l => /MBL não usado \(igual ao HBL\)/.test(l.valor_depois)), JSON.stringify(t.rodar('_editando.log')));
  });
  await testeAsync('BL com HBL e MBL diferentes: preenche os dois, sem aviso', async () => {
    const t = telaComIA({ hbl: 'HCMS000002', mbl: 'SGN000000002' });
    await t.ler();
    iguais([t.els.f_hbl.value, t.els.f_mbl.value], ['HCMS000002', 'SGN000000002']);
    ok(!t.toasts.some(x => /MBL não preenchido/.test(x[1])), JSON.stringify(t.toasts));
  });
  // TVN2511A (20/10/2026): a Data EFETIVA de embarque só vem de BL, CE Mercante
  // ou DI/DUIMP; em PI/CI (ou no futuro) é previsão e vai para o ETD. Valores fictícios.
  await testeAsync('BL com data de embarque: preenche a Data de Embarque efetiva (não o ETD)', async () => {
    const t = telaComIA({ hbl: 'HCMS000004', data_embarque: '2026-01-19' });
    await t.ler();
    iguais([t.els.f_data_embarque.value, t.els.f_etd.value], ['2026-01-19', '']);
  });
  await testeAsync('DI com o embarque nas informações complementares: preenche a Data de Embarque efetiva', async () => {
    const t = telaComIA({ numero_di: '26/0000003-0', data_registro_di: '2026-04-10', data_chegada: '2026-04-08', data_embarque: '2026-01-19' });
    await t.ler();
    iguais([t.els.f_data_embarque.value, t.els.f_data_chegada.value, t.els.f_etd.value], ['2026-01-19', '2026-04-08', '']);
  });
  await testeAsync('CE Mercante: o embarque vai para a Data de Embarque efetiva e para a do CE', async () => {
    const t = telaComIA({ ce_master: '182600000000004', ce_house: '182600000000005', ce_data_embarque: '2026-01-19', data_embarque: '2026-01-19' });
    await t.ler();
    iguais([t.els.f_data_embarque.value, t.els.f_ce_data_embarque.value], ['2026-01-19', '2026-01-19']);
  });
  // 22/10/2026 (Emanuelly): leitura do CE que devolve só uma das duas datas.
  await testeAsync('CE Mercante só com a Data de Embarque: preenche também a Data Embarque (CE)', async () => {
    const t = telaComIA({ ce_master: '182600000000006', ce_house: '182600000000007', data_embarque: '2026-01-21' });
    await t.ler();
    iguais([t.els.f_data_embarque.value, t.els.f_ce_data_embarque.value], ['2026-01-21', '2026-01-21']);
  });
  await testeAsync('CE Mercante só com a Data Embarque (CE): preenche também a Data de Embarque efetiva', async () => {
    const t = telaComIA({ ce_master: '182600000000008', ce_house: '182600000000009', ce_data_embarque: '2026-01-22' });
    await t.ler();
    iguais([t.els.f_data_embarque.value, t.els.f_ce_data_embarque.value], ['2026-01-22', '2026-01-22']);
  });
  await testeAsync('PI com data de embarque: é previsão — vai para o ETD e a efetiva fica vazia', async () => {
    const t = telaComIA({ pi_numero: 'PI-TESTE-1', pi_data: '2026-01-02', data_embarque: '2026-02-10' });
    await t.ler();
    iguais([t.els.f_data_embarque.value, t.els.f_etd.value], ['', '2026-02-10']);
  });
  await testeAsync('BL com embarque ainda no futuro: vai para o ETD', async () => {
    const daqui20 = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10); // sempre no futuro
    const t = telaComIA({ hbl: 'HCMS000005', data_embarque: daqui20 });
    await t.ler();
    iguais([t.els.f_data_embarque.value, t.els.f_etd.value], ['', daqui20]);
  });
  await testeAsync('Prompt da leitura: pede a data de embarque efetiva e o desembaraço da consulta Siscomex', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'controle-import-ia.js'), 'utf8');
    ok(src.includes('"data_embarque": "YYYY-MM-DD"'), 'campo data_embarque no JSON da IA');
    ok(src.includes('NÃO preencha "etd" a partir da DI'), 'DI manda o embarque para a data efetiva');
    ok(/Situação Atual[^\n]*DESEMBARAÇADA/.test(src), 'desembaraço na consulta do Portal Siscomex');
  });
  await testeAsync('Documento com datas certas: nada muda e não há aviso de datas', async () => {
    const t = telaComIA({ numero_di: '26/0000001-0', data_registro_di: '2026-04-05', data_liberacao: '2026-04-06', data_chegada: '2026-04-03' });
    t.tela('f_data_embarque', '2026-02-20');
    await t.ler();
    iguais([t.els.f_data_registro_di.value, t.els.f_data_liberacao.value, t.els.f_data_chegada.value], ['2026-04-05', '2026-04-06', '2026-04-03']);
    ok(!t.toasts.some(x => /conferida/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Extrator de NF (PDF lido pela IA): NF de entrada antes da DI tem a data trocada e avisada', async () => {
    const t = telaComIA({ tipo: 'ENTRADA', nf_numero: '555', nf_data: '2026-02-04', nf_valor: 100, cfop: '3102', itens: [] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };`); t.tela('f_data_registro_di', '2026-03-30');
    await t.rodar(`importarNFSaidaProcessoArquivo({ name: 'nf-teste.pdf', type: 'application/pdf' })`);
    iguais(t.els.f_nf_entrada_data.value, '2026-04-02');
    ok(t.toasts.some(x => /Usei 02\/04\/2026/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Extrator de NF: processo trocado durante a leitura — a NF não entra no outro processo', async () => {
    const t = telaComIA({ tipo: 'ENTRADA', nf_numero: '556', nf_data: '2026-04-04', nf_valor: 100, cfop: '3102', itens: [] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };`);
    const leitura = t.rodar(`importarNFSaidaProcessoArquivo({ name: 'nf-teste.pdf', type: 'application/pdf' })`);
    t.rodar(`definirProcessoNoPainel({ id: 'p-outro', referencia: 'TESTE-OUTRO' });`);
    const r = await leitura;
    iguais([r.ok, t.els.f_nf_entrada_numero ? t.els.f_nf_entrada_numero.value : ''], [false, '']);
    ok(/fechado ou trocado/.test(r.mensagem), r.mensagem);
  });
  await testeAsync('Extrator de NF com XML: a data do XML é exata e não passa pela troca', async () => {
    const t = telaComIA({});
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };`); t.tela('f_data_registro_di', '2026-03-30');
    t.rodar(`parseNFeXml = async () => ({ tipo: 'ENTRADA', cliente: '', nf_numero: '556', nf_data: '2026-02-04', nf_valor: 100, cfop: '3102', itens: [] });`);
    await t.rodar(`importarNFSaidaProcessoArquivo({ name: 'nf-teste.xml', type: 'text/xml' })`);
    iguais(t.els.f_nf_entrada_data.value, '2026-02-04');
  });

  console.log('\n── Leitura por IA: a data como está impressa (datas_texto) ──');
  await testeAsync('RIC: o texto impresso (dia/mês/ano) corrige a data que a IA inverteu, mesmo quando as duas fecham', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000001', lacre: '' }], data_devolucao_vazio: '2026-04-05',
      datas_texto: { data_devolucao_vazio: 'ENTRADA: 04/05/2026 10:54' }, depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20'); t.tela('f_data_carregamento', '2026-03-27'); t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.els.f_data_devolucao_vazio.value, '2026-05-04');
    ok((t.els['ia-status'].filhos || []).some(f => /o documento traz .*04\/05\/2026 10:54.* usei 04\/05\/2026, não 05\/04\/2026/.test(f.innerHTML)), 'caixa de aviso na tela');
    ok(t.rodar('_editando.log').some(l => /lida 05\/04\/2026 → 04\/05\/2026 pelo texto impresso/.test(l.valor_depois)), JSON.stringify(t.rodar('_editando.log')));
  });
  await testeAsync('RIC: texto sem ambiguidade (ano na frente) protege a data — impossível, não é trocada nem usada', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000001', lacre: '' }], data_devolucao_vazio: '2026-02-04',
      datas_texto: { data_devolucao_vazio: '2026/02/04 10:54' }, depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20'); t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.els.f_data_devolucao_vazio.value, '');
    ok(t.toasts.some(x => /data\(s\) conferida/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Documento do exterior com dia/mês ambíguo no texto: fica a leitura da IA', async () => {
    const t = telaComIA({ hbl: 'HBLTESTE1', etd: '2026-05-08', datas_texto: { etd: '05/08/2026' } });
    await t.ler();
    iguais(t.els.f_etd.value, '2026-05-08');
  });
  await testeAsync('Texto que não bate com a data lida: fica a data lida, com aviso para conferir', async () => {
    const t = telaComIA({ hbl: 'HBLTESTE2', etd: '2026-05-08', datas_texto: { etd: 'MAY 20, 2026' } });
    await t.ler();
    iguais(t.els.f_etd.value, '2026-05-08');
    ok((t.els['ia-status'].filhos || []).some(f => /ETD.* lida como 08\/05\/2026, mas o texto copiado do documento é/.test(f.innerHTML)), 'caixa de aviso na tela');
  });
  await testeAsync('Extrator de NF: a data impressa na nota (dia/mês/ano) corrige a leitura invertida', async () => {
    const t = telaComIA({ tipo: 'ENTRADA', nf_numero: '557', nf_data: '2026-04-05', nf_data_texto: '04/05/2026', nf_valor: 100, cfop: '3102', itens: [] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };`); t.tela('f_data_registro_di', '2026-03-30');
    await t.rodar(`importarNFSaidaProcessoArquivo({ name: 'nf-teste.pdf', type: 'application/pdf' })`);
    iguais(t.els.f_nf_entrada_data.value, '2026-05-04');
    ok(t.toasts.some(x => /a nota traz "04\/05\/2026" — usei 04\/05\/2026, não 05\/04\/2026/.test(x[1])), JSON.stringify(t.toasts));
  });

  console.log('\n── NF de saída na Extração com IA: remessa × venda e o CFOP junto da nota (20/10/2026) ──');
  // Números de NF fictícios. A mesma resposta serve para a leitura geral e
  // para a releitura pelo extrator de NF (o "fetch" falso devolve sempre ela).
  const nfVendaLida = { nf_saida_numero: '90001', nf_saida_data: '2026-10-05', nf_saida_valor: 1000, nf_cfop: '5102', cliente: 'CLIENTE TESTE',
    tipo: 'SAIDA', nf_numero: '90001', nf_data: '2026-10-05', nf_valor: 1000, cfop: '5102',
    itens: [{ descricao: 'PNEU 205/55R16 TESTE', quantidade: 4, valor_total: 1000 }] };
  await testeAsync('Leitura geral: NF de venda com a remessa na aba Documentos vai para a aba Vendas (com o CFOP) e a remessa fica', async () => {
    const t = telaComIA(nfVendaLida);
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [];`);
    t.tela('f_nf_saida_numero', '90000'); t.tela('f_nf_saida_cfop', '5905');
    await t.ler();
    iguais([t.els.f_nf_saida_numero.value, t.els.f_nf_saida_cfop.value], ['90000', '5905'], 'a remessa continua na aba Documentos');
    iguais(t.rodar('JSON.stringify(_vendas.map(v => [v.nf_saida_numero, v.nf_saida_cfop, v.cliente, v.itens.length]))'), JSON.stringify([['90001', '5102', 'CLIENTE TESTE', 1]]));
    ok(t.rodar('_editando.log').some(l => /Vendas: NF 90001 \(venda, CFOP 5102\)/.test(l.valor_depois)), JSON.stringify(t.rodar('_editando.log')));
    ok(t.toasts.some(x => /registrada na aba Vendas/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Leitura geral: NF de venda sem NF no processo preenche a aba Documentos com o CFOP', async () => {
    const t = telaComIA(nfVendaLida);
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [];`);
    await t.ler();
    iguais([t.els.f_nf_saida_numero.value, t.els.f_nf_saida_cfop.value, t.els.f_nf_saida_data.value], ['90001', '5102', '2026-10-05']);
    iguais(t.rodar('_vendas.length'), 0);
    iguais(t.els.f_cliente.value, '', 'a NF de saída não mexe em outros campos do processo');
  });
  // UD26-047 (20/10/2026): a NF já estava na venda, mas SEM valor — ler a NF
  // de novo dizia "nada foi alterado" e o Fechamento ficava sem receita. Agora
  // não duplica e completa o que falta; o que já está lançado não é trocado.
  await testeAsync('Leitura geral: a mesma NF que já está na aba Vendas não entra de novo, mas completa o que falta nela', async () => {
    const t = telaComIA(nfVendaLida);
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [Object.assign(vendaVazia(), { nf_saida_numero: '90001', nf_saida_cfop: '5102' })];`);
    t.tela('f_nf_saida_numero', '90000'); t.tela('f_nf_saida_cfop', '5905');
    await t.ler();
    iguais(t.rodar('_vendas.length'), 1);
    iguais(t.rodar('JSON.stringify([_vendas[0].nf_saida_valor, _vendas[0].nf_saida_data, _vendas[0].cliente, _vendas[0].itens.length])'), JSON.stringify([1000, '2026-10-05', 'CLIENTE TESTE', 1]));
    ok(t.toasts.some(x => /já estava na Venda 1 — completei o que faltava: valor R\$ 1\.000,00/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Leitura geral: NF já cadastrada e completa — nada muda; valor diferente vira aviso (não troca)', async () => {
    const t = telaComIA(nfVendaLida);
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [Object.assign(vendaVazia(), { cliente: 'CLIENTE TESTE', nf_saida_numero: '90001', nf_saida_cfop: '5102', nf_saida_data: '2026-10-05', nf_saida_valor: 900, itens: [{ descricao: 'PNEU 205/55R16 TESTE', quantidade: '4', valor_total: '900' }] })];`);
    await t.ler();
    iguais(t.rodar('[_vendas.length, _vendas[0].nf_saida_valor].join("|")'), '1|900');
    ok(t.toasts.some(x => /já está cadastrada .* nada a alterar.*valor na venda R\$ 900,00 e na NF R\$ 1\.000,00/.test(x[1])), JSON.stringify(t.toasts));
  });
  // UD26-047: a NF lida de novo no botão "Importar NF" da PRÓPRIA venda dela
  // (o nº também está na NF de Saída da aba Documentos) contava como "já
  // cadastrada" e nada era alterado. Agora completa essa venda.
  await testeAsync('Importar NF na própria venda (nº já nela e na aba Documentos): completa o valor e os itens, sem duplicar', async () => {
    const t = telaComIA(nfVendaLida);
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [Object.assign(vendaVazia(), { cliente: 'CLIENTE TESTE', nf_saida_numero: '90001', nf_saida_cfop: '5102', nf_saida_data: '2026-10-05', itens: [{ descricao: 'PNEU 205/55R16 TESTE', quantidade: '4', valor_total: '' }] })];`);
    t.tela('f_nf_saida_numero', '90001'); t.tela('f_nf_saida_cfop', '5102');
    await t.rodar(`importarNFVenda(0, { files: [{ name: 'nf-teste.pdf', type: 'application/pdf' }], value: 'x' })`);
    iguais(t.rodar('JSON.stringify([_vendas.length, Number(_vendas[0].nf_saida_valor), _vendas[0].itens.length, Number(_vendas[0].itens[0].valor_total)])'), JSON.stringify([1, 1000, 1, 1000]));
    ok(t.toasts.some(x => /A NF 90001 já estava nesta venda — completei o que faltava: valor R\$ 1\.000,00, valor de 1 item/.test(x[1])), JSON.stringify(t.toasts));
    await t.rodar(`importarNFVenda(0, { files: [{ name: 'nf-teste.pdf', type: 'application/pdf' }], value: 'x' })`);
    ok(t.toasts.some(x => /já está nesta venda e completa — nada a alterar/.test(x[1])), JSON.stringify(t.toasts));
  });
  // UD26-047: depois de importar a planilha e salvar, a aba Fechamento seguia
  // com o quadro montado na abertura do processo ("sem resultado").
  await testeAsync('Aba Fechamento: ao entrar, o quadro é remontado com o que está na tela (Vendas/Custos Reais), sem reabrir o processo', async () => {
    const t = telaComIA({});
    t.rodar(`_editando = { id: 'p-teste', referencia: 'TESTE-1', _camposIA: {}, log: [], nf_entrada_valor: 1000, vendas_json: '[]', real_json: {} };
      _vendas = [];`);
    t.rodar(`trocarAba('fechamento')`);
    ok(!/1\.500,00/.test(t.els['fechamento-info-wrap'].innerHTML), 'antes da venda não há R$ 1.500,00');
    t.rodar(`_vendas = [Object.assign(vendaVazia(), { cliente: 'CLIENTE TESTE', nf_saida_numero: '90040', nf_saida_valor: 1500 })];`);
    t.rodar(`trocarAba('fechamento')`);
    ok(/NF Sa[ií]da[^]*1\.500,00/.test(t.els['fechamento-info-wrap'].innerHTML), t.els['fechamento-info-wrap'].innerHTML.replace(/<[^>]+>/g, ' ').slice(0, 300));
  });
  await testeAsync('Notas da planilha de Fechamento: nota sem número completa a única venda (valor/data), sem trocar o que existe', async () => {
    const t = telaComIA({});
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [Object.assign(vendaVazia(), { nf_saida_numero: '90010', nf_saida_cfop: '6102' })];`);
    const r = t.rodar(`aplicarNotasDaPlanilha([{ numero: null, valor: 1234.5, cliente: 'X', data: '2026-10-01' }])`);
    iguais(t.rodar('JSON.stringify([_vendas[0].nf_saida_valor, _vendas[0].nf_saida_data, _vendas[0].nf_saida_numero])'), JSON.stringify([1234.5, '2026-10-01', '90010']));
    ok(r.preenchidos.length === 2 && !r.avisos.length, JSON.stringify(r));
    const r2 = t.rodar(`aplicarNotasDaPlanilha([{ numero: '90010', valor: 2000 }])`);
    iguais(t.rodar('_vendas[0].nf_saida_valor'), 1234.5);
    ok(r2.avisos.some(a => /a venda tem R\$ 1\.234,50 e a planilha R\$ 2\.000,00/.test(a)), JSON.stringify(r2));
  });
  await testeAsync('Planilha de Fechamento: pacote e itens do mesmo grupo nunca ficam juntos na grade (crResolverPacotesImportados)', async () => {
    const t = telaComIA({});
    // 1) itens chegando, pacote de importação anterior da planilha na grade → o pacote sai
    t.tela('f_cr_adiantamento_porto', '23.400,00');
    t.rodar(`_crConf = { adiantamento_porto: { origem: 'planilha' } };`);
    let rj = { ii: 10000, ipi: 1000 };
    let r = t.rodar(`crResolverPacotesImportados(${JSON.stringify(rj)}, { adiantamento: { nome: 'Adiantamento Porto', valor: 11000, modo: 'itens', partes: {} } })`);
    iguais(t.els.f_cr_adiantamento_porto.value, '');
    ok(!r.avisos.length && r.infos.some(i => /entrou item a item/.test(i)), JSON.stringify(r));
    // 2) valor único chegando e II já lançado pela DUIMP → o valor único não entra
    t.tela('f_cr_ii', '10.000,00'); t.tela('f_cr_adiantamento_porto', '');
    t.rodar(`_crConf = { ii: { origem: 'DUIMP' } }; window.__rj = { adiantamento_porto: 23400 };`);
    r = t.rodar(`crResolverPacotesImportados(window.__rj, { adiantamento: { nome: 'Adiantamento Porto', valor: 23400, modo: 'pacote' } })`);
    ok(!('adiantamento_porto' in t.rodar('window.__rj')), 'o valor único foi tirado do que vai para a grade');
    ok(r.avisos.some(a => /Adiantamento Porto: o processo já tem II lançado/.test(a)), JSON.stringify(r));
    // 3) itens chegando e o valor único digitado à mão → mantém o valor único, itens não entram
    t.tela('f_cr_ii', ''); t.tela('f_cr_agente_frete', '9.000,00');
    t.rodar(`_crConf = { agente_frete: { origem: 'digitado' } }; window.__rj = { frete: 5000, capatazia: 1100 };`);
    r = t.rodar(`crResolverPacotesImportados(window.__rj, { agente: { nome: 'Agente Frete', valor: 6100, modo: 'itens', partes: {} } })`);
    iguais(t.rodar('JSON.stringify(window.__rj)'), '{}');
    iguais(t.els.f_cr_agente_frete.value, '9.000,00');
    ok(r.avisos.some(a => /Agente Frete: o valor único já está lançado \(R\$ 9\.000,00\)/.test(a)), JSON.stringify(r));
  });
  await testeAsync('Notas da planilha de Fechamento: sem aba Vendas preenche a NF de Saída do processo; remessa (5905) não recebe a venda', async () => {
    const t = telaComIA({});
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [];`);
    t.tela('f_nf_saida_numero', ''); t.tela('f_nf_saida_valor', ''); t.tela('f_nf_saida_cfop', '');
    const r = t.rodar(`aplicarNotasDaPlanilha([{ numero: '90020', valor: 5000.25, data: '2026-10-02' }])`);
    iguais([t.els.f_nf_saida_numero.value, t.els.f_nf_saida_valor.value, t.els.f_nf_saida_data.value], ['90020', '5.000,25', '2026-10-02']);
    ok(r.preenchidos.length === 3, JSON.stringify(r));
    const t2 = telaComIA({});
    t2.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [];`);
    t2.tela('f_nf_saida_numero', '90021'); t2.tela('f_nf_saida_cfop', '5905'); t2.tela('f_nf_saida_valor', '');
    const r2 = t2.rodar(`aplicarNotasDaPlanilha([{ numero: null, valor: 5000 }])`);
    iguais(t2.els.f_nf_saida_valor.value, '');
    ok(r2.avisos.some(a => /remessa \(CFOP 5905\)/.test(a)), JSON.stringify(r2));
  });
  await testeAsync('Extrator de NF: retorno da remessa (CFOP 1907) vai para a aba Vendas e não vira NF de Entrada', async () => {
    const t = telaComIA({ tipo: 'ENTRADA', nf_numero: '90003', nf_data: '2026-10-06', nf_valor: 500, cfop: '1907', itens: [] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _vendas = [];`);
    const r = await t.rodar(`importarNFSaidaProcessoArquivo({ name: 'nf-teste.pdf', type: 'application/pdf' })`);
    iguais(t.ctx.document.getElementById('f_nf_entrada_numero').value, '', 'NF de Entrada não foi tocada');
    iguais(t.rodar('JSON.stringify(_vendas.map(v => [v.nf_saida_numero, v.nf_saida_cfop]))'), JSON.stringify([['90003', '1907']]));
    iguais([r.ok, r.destino], [true, 'vendas']);
  });
  await testeAsync('Trocar a NF de saída sem CFOP lido limpa o CFOP antigo (o 5905 não fica na venda)', async () => {
    const t = telaComIA({});
    t.tela('f_nf_saida_numero', '90000'); t.tela('f_nf_saida_cfop', '5905');
    t.rodar(`aplicarDadosNFSaidaNoProcesso({ nf_numero: '90002', nf_data: '', nf_valor: 0, cfop: '' })`);
    iguais([t.els.f_nf_saida_numero.value, t.els.f_nf_saida_cfop.value], ['90002', '']);
    t.rodar(`aplicarDadosNFSaidaNoProcesso({ nf_numero: '90002', nf_data: '2026-10-07', nf_valor: 0, cfop: '' })`);
    t.tela('f_nf_saida_cfop', '5102');
    t.rodar(`aplicarDadosNFSaidaNoProcesso({ nf_numero: '90002', nf_data: '2026-10-07', nf_valor: 0, cfop: '' })`);
    iguais(t.els.f_nf_saida_cfop.value, '5102', 'mesma NF: o CFOP digitado fica');
  });
  await testeAsync('nfSaidaNaLeituraGeral: venda, remessa e retorno sim; NF de entrada (3102) e documento sem NF não', async () => {
    const t = telaComIA({});
    const f = ex => t.rodar(`nfSaidaNaLeituraGeral(${JSON.stringify(ex)})`);
    iguais([f({ nf_cfop: '5102' }), f({ nf_cfop: '5905' }), f({ nf_cfop: '1907', nf_entrada_numero: '1' }), f({ nf_saida_numero: '123' })], [true, true, true, true]);
    iguais([f({ nf_cfop: '3102', nf_entrada_numero: '9' }), f({ hbl: 'X' }), f({ nf_saida_data: 'YYYY-MM-DD' }), f({ nf_cfop: '5102', nf_entrada_numero: '9' })], [false, false, false, false]);
  });

  console.log('\n── Produtos: US$/un da CI/PI (fob_usd) para o Mix do Calculador ──');
  await testeAsync('Leitura da CI traz o US$/un de cada medida para os Produtos', async () => {
    const t = telaComIA({ ci_numero: 'CI-TESTE-1', itens: [{ size: '205/55R16', pattern: 'TESTE', quantidade: 20, preco_unit_usd: 50 },
      { size: '185/65R15', pattern: 'TESTE', quantidade: 10, preco_unit_usd: 'US$ 42,50' }] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] }; _produtos = [{ descricao: '', quantidade: '' }];`);
    await t.ler();
    iguais(t.rodar('JSON.stringify(_produtos.map(p => [p.descricao, p.quantidade, p.fob_usd]))'), JSON.stringify([['205/55R16 TESTE', 20, 50], ['185/65R15 TESTE', 10, 42.5]]));
  });
  await testeAsync('Mesmo pedido lido de novo: só completa o US$/un que faltava (não troca o que já tem)', async () => {
    const t = telaComIA({ itens: [{ size: '205/55R16', pattern: 'MARCA TESTE', quantidade: 20, preco_unit_usd: 51 },
      { size: '185/65R15', pattern: 'MARCA TESTE', quantidade: 10, preco_unit_usd: 43 }] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };
      _produtos = [{ descricao: '205/55R16 TESTE', quantidade: 20, tipo: 'PCR' }, { descricao: '185/65R15 TESTE', quantidade: 10, fob_usd: 42.5 }];`);
    await t.ler();
    iguais(t.rodar('JSON.stringify(_produtos.map(p => [p.descricao, p.fob_usd, p.tipo || ""]))'), JSON.stringify([['205/55R16 TESTE', 51, 'PCR'], ['185/65R15 TESTE', 42.5, '']]));
  });
  await testeAsync('CI sem preço substituindo os itens: o US$/un e o tipo já preenchidos na mesma medida não se perdem', async () => {
    const t = telaComIA({ ci_numero: 'CI-TESTE-2', itens: [{ size: '205/55R16', pattern: 'NOVO', quantidade: 20 }, { size: '215/60R17', pattern: 'NOVO', quantidade: 8 }] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };
      _produtos = [{ descricao: '205/55R16 VELHO', quantidade: 20, fob_usd: 50, tipo: 'PCR' }, { descricao: '215/60R17 VELHO', quantidade: 10, fob_usd: 60 }];`);
    await t.ler();
    iguais(t.rodar('JSON.stringify(_produtos.map(p => [p.descricao, p.quantidade, p.fob_usd || null, p.tipo || ""]))'),
      JSON.stringify([['205/55R16 NOVO', 20, 50, 'PCR'], ['215/60R17 NOVO', 8, null, '']]), 'só herda na mesma medida E quantidade');
  });

  console.log('\n── Importação de planilha: referência com/sem o prefixo IMPAK- no log da tela ──');
  // O "fetch" devolve o resumo que o servidor mandaria; o teste lê as linhas do log.
  async function importarComResumo(funcao, rota, resposta) {
    const t = telaComIA({});
    t.ctx.btoa = s => Buffer.from(s, 'binary').toString('base64');
    let enviado = null;
    t.ctx.fetch = async (url, opts) => {
      if (String(url) === rota) { enviado = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => resposta }; }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    t.rodar(`carregarProcessos = async () => {}; render = () => {};`);
    await t.rodar(`${funcao}({ files: [{ name: 'planilha-teste.xlsx', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }], value: 'x' })`);
    return { enviado, linhas: (t.els['import-log-modal'].filhos || []).map(d => d.textContent), toasts: t.toasts };
  }
  await testeAsync('Despachante: mostra as achadas sem o prefixo e, na não encontrada, as parecidas do Controle', async () => {
    const r = await importarComResumo('importarPlanilhaDespachante', '/api/controle/v2/importar-despachante', { ok: true, total_linhas: 3, total_atualizados: 1, total_sem_mudancas: 1, total_nao_encontrados: 1, total_travados: 0, resumo: [
      { referencia: 'IMPAK-TST2601A-1', referencia_planilha: 'TST2601A-1', status: 'atualizado', campos: ['navio'] },
      { referencia: 'IMPAK-TST2601A-2', referencia_planilha: 'TST2601A-2', status: 'sem_mudancas' },
      { referencia: 'XYZ2603', status: 'nao_encontrado', sugestoes: ['IMPAK-XYZ2603-CLIENTE', 'IMPAK-XYZ2603-CLIENTE-2'] },
    ] });
    iguais(r.enviado && r.enviado.arquivo_base64, 'AQID', 'arquivo vai em base64');
    const log = r.linhas.join(' | ');
    ok(r.linhas.some(l => l === '↔ 2 referência(s) achada(s) com/sem o prefixo IMPAK-: TST2601A-1 → IMPAK-TST2601A-1, TST2601A-2 → IMPAK-TST2601A-2'), log);
    ok(r.linhas.some(l => /XYZ2603 \(no Controle tem: IMPAK-XYZ2603-CLIENTE, IMPAK-XYZ2603-CLIENTE-2\)/.test(l)), log);
    ok(r.linhas.some(l => /✓ IMPAK-TST2601A-1: Navio/.test(l)), log);
  });
  await testeAsync('Despachante: DATA CI que entrou como Data de Liberação aparece no log; a ilegível/no futuro aparece como não importada', async () => {
    const r = await importarComResumo('importarPlanilhaDespachante', '/api/controle/v2/importar-despachante', { ok: true, total_linhas: 3, total_atualizados: 1, total_sem_mudancas: 2, total_nao_encontrados: 0, total_travados: 0, resumo: [
      { referencia: 'TST2602-1', status: 'atualizado', campos: ['data_liberacao', 'navio'] },
      { referencia: 'TST2602-2', status: 'sem_mudancas', datas_recusadas: [{ campo: 'data_liberacao', valor: '2099-01-05', motivo: 'DATA CI no futuro — a CI só sai no desembaraço' }] },
      { referencia: 'TST2602-3', status: 'sem_mudancas', datas_recusadas: [{ campo: 'data_liberacao', valor: 'AGUARDANDO', motivo: 'DATA CI não é uma data válida' }] },
    ] });
    const log = r.linhas.join(' | ');
    ok(r.linhas.some(l => l === '✓ TST2602-1: Data de Liberação (DATA CI), Navio'), log);
    ok(r.linhas.some(l => /1 processo\(s\) com a Data de Liberação preenchida pela DATA CI/.test(l)), log);
    ok(r.linhas.some(l => /TST2602-2: Data de Liberação \(DATA CI\) 05\/01\/2099 não importada — DATA CI no futuro/.test(l)), log);
    ok(r.linhas.some(l => /TST2602-3: Data de Liberação \(DATA CI\) AGUARDANDO não importada — DATA CI não é uma data válida/.test(l)), log);
  });
  await testeAsync('Planilha interna: referência em dúvida (dois processos) aparece com os dois nomes', async () => {
    const r = await importarComResumo('importarPlanilhaManu', '/api/controle/v2/importar-manu', { ok: true, total_linhas: 1, total_atualizados: 0, total_sem_mudancas: 0, total_nao_encontrados: 1, total_travados: 0, resumo: [
      { referencia: 'IMPAK DUP1-1', status: 'nao_encontrado', ambiguo: ['DUP1-1', 'IMPAK-DUP1-1'] },
    ] });
    ok(r.linhas.some(l => /IMPAK DUP1-1 \(mais de um processo: DUP1-1, IMPAK-DUP1-1\)/.test(l)), r.linhas.join(' | '));
    ok(!r.linhas.some(l => /Tudo certo/.test(l)), 'não diz "tudo certo" com pendência');
  });

  console.log('\n── Edição rápida de data na tabela (inlineEditData) ──');
  // Campo de data falso que guarda os listeners (blur/keydown) para o teste disparar.
  function tabelaInline(processos) {
    const t = telaComIA({});
    t.rodar(`__salvos = []; salvarProcesso = (p, campos) => { __salvos.push([p.id, campos.join(','), p[campos[0]]]); return Promise.resolve(true); };
      render = () => {}; _processos = ${JSON.stringify(processos)};
      document.createElement = tag => { const ouv = {}; const el = { tagName: String(tag).toUpperCase(), value: '', style: {}, className: '',
        addEventListener(ev, fn){ (ouv[ev] = ouv[ev] || []).push(fn); }, focus(){},
        disparar(ev, arg){ (ouv[ev] || []).forEach(fn => fn(arg || {})); } }; __campo = el; return el; };`);
    const editar = (id, campo, valor) => {
      t.rodar(`inlineEditData(${JSON.stringify(id)}, ${JSON.stringify(campo)}, { innerHTML: '', appendChild(){} }); __campo.value = ${JSON.stringify(valor)};`);
      t.rodar(`__campo.disparar('blur'); __campo.disparar('blur');`); // o 2º blur (render/confirm) não pode gravar de novo
    };
    return { t, editar, salvos: () => t.rodar('__salvos') };
  }
  await testeAsync('Data impossível (ETA antes do ETD) não é gravada e avisa', async () => {
    const x = tabelaInline([{ id: 'p1', referencia: 'TESTE-INLINE', etd: '2026-05-10', eta: '2026-06-20' }]);
    x.editar('p1', 'eta', '2026-05-01');
    iguais(x.salvos(), []); iguais(x.t.rodar('_processos[0].eta'), '2026-06-20');
    ok(x.t.toasts.some(y => y[0] === 'err' && /Data impossível — nada foi salvo: .*ETA.*01\/05\/2026.* está antes de ETD/.test(y[1])), JSON.stringify(x.t.toasts));
  });
  await testeAsync('Data improvável pede confirmação: "Cancelar" não grava; "OK" grava uma vez só', async () => {
    const procs = [{ id: 'p2', referencia: 'TESTE-INLINE2', etd: '2026-05-10', eta: '2026-06-20', data_chegada: '2026-06-22' }];
    const x = tabelaInline(procs);
    x.t.rodar(`__perguntas = []; confirm = m => { __perguntas.push(m); return false; };`);
    x.editar('p2', 'eta', '2026-08-01'); // chegada 40 dias antes do ETA
    iguais(x.salvos(), []); ok(/Confira as datas antes de salvar:[\s\S]*40 dias antes do ETA/.test(x.t.rodar('__perguntas[0]')), x.t.rodar('__perguntas[0]'));
    x.t.rodar(`confirm = () => true;`);
    x.editar('p2', 'eta', '2026-08-01');
    iguais(x.salvos(), [['p2', 'eta', '2026-08-01']]);
  });
  await testeAsync('Data sem problema grava só o campo editado; Esc desiste sem gravar', async () => {
    const x = tabelaInline([{ id: 'p3', referencia: 'TESTE-INLINE3', etd: '2026-05-10', eta: '2026-06-20' }]);
    x.t.rodar(`inlineEditData('p3', 'eta', { innerHTML: '', appendChild(){} }); __campo.value = '2026-06-25'; __campo.disparar('keydown', { key: 'Escape' }); __campo.disparar('blur');`);
    iguais(x.salvos(), []); iguais(x.t.rodar('_processos[0].eta'), '2026-06-20');
    x.editar('p3', 'eta', '2026-06-25');
    iguais(x.salvos(), [['p3', 'eta', '2026-06-25']]);
  });

  console.log('\n── Rede: erro que não veio do sistema (chat.js) ──');
  await testeAsync('502 com página HTML (atualização no ar) vira { ok:false, erro } que diz o que fazer', async () => {
    const f = redeDoChatJs(() => resposta(502, '<html><body>Bad Gateway</body></html>', 'text/html'));
    const r = await f('/api/controle/v2/processos', { method: 'POST', body: '{"a":1}' });
    iguais(r.status, 502);
    const d = await r.json();
    iguais(d.ok, false); ok(/reiniciando/.test(d.erro) && /Nada foi salvo/.test(d.erro), d.erro);
  });
  await testeAsync('413 do proxy (sem JSON) explica o limite de tamanho', async () => {
    const f = redeDoChatJs(() => resposta(413, 'Request Entity Too Large', 'text/plain'));
    const d = await (await f('/api/controle/v2/arquivos', { method: 'POST', body: 'x' })).json();
    ok(/15 MB/.test(d.erro), d.erro);
  });
  await testeAsync('erro JSON do próprio sistema passa intacto', async () => {
    const f = redeDoChatJs(() => resposta(409, JSON.stringify({ ok: false, erro: 'Outra pessoa salvou antes.' }), 'application/json'));
    const d = await (await f('/api/controle/v2/processos/1', { method: 'PUT', body: '{}' })).json();
    iguais(d.erro, 'Outra pessoa salvou antes.');
  });
  await testeAsync('arquivo comum (fora de /api) não é mexido', async () => {
    const f = redeDoChatJs(() => resposta(404, 'not found', 'text/plain'));
    const r = await f('/assets/inexistente.png');
    iguais(await r.text(), 'not found');
  });
  await testeAsync('sem internet: "Failed to fetch" vira mensagem que diz o que fazer', async () => {
    const f = redeDoChatJs(() => Promise.reject(new TypeError('Failed to fetch')));
    let msg = '';
    try { await f('/api/fin/bancos'); } catch (e) { msg = e.message; }
    ok(/Sem conexão com o servidor/.test(msg), msg);
  });

  console.log('\n── Mensagens de erro do servidor (lib/erros-amigaveis.js) ──');
  const { traduzirErro } = require('./lib/erros-amigaveis');
  teste('arquivo acima do limite do armazenamento → limite + o que fazer', () => {
    ok(/15 MB/.test(traduzirErro('The object exceeded the maximum allowed size').msg));
  });
  teste('erro de programação (TypeError) não aparece em inglês pra pessoa', () => {
    const t = traduzirErro("Cannot read properties of undefined (reading 'id')");
    iguais(t.traduzido, true); ok(/avise o suporte/.test(t.msg), t.msg);
  });
  teste('mensagem em português do sistema continua igual', () => {
    iguais(traduzirErro('"nota.pdf" tem 18,2 MB — o limite do GED é 15 MB por arquivo.').traduzido, false);
  });

  console.log('\n── ID no Conexos nunca repetido (conexos-id.js) ──');
  const CXI = require('./conexos-id.js');
  teste('compara sem espaços, sem zeros à esquerda e sem diferença de maiúscula', () => {
    iguais(CXI.chave(' 04321 '), '4321'); iguais(CXI.chave('4321'), '4321'); iguais(CXI.chave('43 21'), '4321');
    iguais(CXI.chave('ab-12'), 'AB-12'); iguais(CXI.chave('000'), '0');
    iguais(CXI.chave(''), ''); iguais(CXI.chave(null), ''); iguais(CXI.chave('   '), '');
  });
  const lista = [
    { id: 'p1', referencia: 'TESTE-CX-1', conexos_id: '04321' },
    { id: 'p2', referencia: 'TESTE-CX-2', conexos_id: '4322', cancelado: true },
    { id: 'p3', referencia: 'TESTE-CX-3', conexos_id: null },
  ];
  teste('acha o outro processo com o mesmo número (nunca o próprio)', () => {
    iguais(CXI.processoComMesmoId(lista, '4321', 'p9').referencia, 'TESTE-CX-1');
    iguais(CXI.processoComMesmoId(lista, '4321', 'p1'), null, 'o próprio processo não conta');
    iguais(CXI.processoComMesmoId(lista, '4323', 'p9'), null);
    iguais(CXI.processoComMesmoId(lista, '', 'p9'), null, 'vazio não confere');
    iguais(CXI.processoComMesmoId(lista, '4322', undefined).referencia, 'TESTE-CX-2', 'processo novo (sem id) também confere; cancelado conta');
  });
  teste('mensagem diz o processo (e se está cancelado) e como resolver', () => {
    const m = CXI.mensagemRepetido(' 4322 ', lista[1]);
    ok(/^O ID no Conexos 4322 já está no processo TESTE-CX-2 \(cancelado\)\./.test(m), m);
    ok(/apague o ID no TESTE-CX-2 primeiro/.test(m), m);
  });
  teste('repetidos() agrupa os processos com o mesmo número', () => {
    const r = CXI.repetidos(lista.concat([{ id: 'p4', referencia: 'TESTE-CX-4', conexos_id: '4321' }]));
    iguais(r.length, 1); iguais(r[0].chave, '4321'); iguais(r[0].processos.map(p => p.id).join(','), 'p1,p4');
  });

  console.log(`\nTotal: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
  if (passaram !== total) process.exit(1);
})();
