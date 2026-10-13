import { parseInstagramFiles, parseUsernames, buildPeople, exportQueue, parseQueue } from './data-core.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  layers:'<path d="m12 3 10 6-10 6L2 9l10-6Z"/><path d="m3 14 9 5 9-5M3 18l9 5 9-5"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 3.8 2.1c-1.1.6-1.4 1-1.4 2.4M12 17h.01"/>',
  puzzle:'<path d="M9 3H4v6a3 3 0 1 1 0 6v6h6a3 3 0 1 1 6 0h5v-6a3 3 0 1 1 0-6V3h-6a3 3 0 1 1-6 0Z"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  flask:'<path d="M9 3h6m-5 0v7L4 20h16l-6-10V3M8 15h8"/>',
  users:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-3-5"/>',
  'arrow-out':'<path d="M6 18 18 6M7 6h11v11"/>',
  'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.help}</svg>`;
function renderIcons(root = document) { $$('[data-icon]',root).forEach(el => el.innerHTML = icon(el.dataset.icon)); }

const storageKey = 'circulo.workspace.v1';
const isExtension = location.protocol === 'chrome-extension:' && !!globalThis.chrome?.runtime?.id;
const demoEntries = [
  ['ana.caminhos','Ana · caminhos'],['studio.novafase','Studio Nova Fase'],['cafe.de.domingo','Café de Domingo'],['pedro.pelasruas','Pedro · pelas ruas'],['maria.fazarte','Maria Faz Arte'],['viajante.de.janela','Viajante de Janela'],['julia.em.foco','Julia em Foco'],['casaflor.atelie','Casa Flor Ateliê'],['leo.entrelinhas','Leo · entrelinhas'],['brisa.fotografia','Brisa Fotografia'],['nina.no.jardim','Nina no Jardim'],['tempo.de.pausa','Tempo de Pausa'],['marcos.desenha','Marcos Desenha'],['luz.de.outono','Luz de Outono'],['bela.coisas','Bela · coisas'],['joao.de.bicicleta','João de Bicicleta'],['feito.com.tempo','Feito com Tempo'],['clara.nas.nuvens','Clara nas Nuvens'],['dias.de.sol','Dias de Sol'],['livros.na.mesa','Livros na Mesa'],['sofia.aquarela','Sofia Aquarela'],['quintal.criativo','Quintal Criativo'],['tardes.leves','Tardes Leves'],['mapa.de.afetos','Mapa de Afetos']
];
function demoState() {
  return { version:1, demo:true, importedAt:null, people:demoEntries.map(([username,displayName],i)=>({username,displayName,followedAt:Date.UTC(2017+Math.floor(i/4),i%12,5+i),followsYou:i%5===0||i%5===3})), protected:['maria.fazarte','brisa.fotografia','clara.nas.nuvens','mapa.de.afetos'],selected:[],queue:[],history:[] };
}
function readState() {
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if(saved?.version!==1||!Array.isArray(saved.people)) return demoState();
    const valid = parseUsernames(saved.people.map(p=>p.username).join('\n'));
    const set=new Set(valid);
    const people=saved.people.filter(p=>set.has(p.username)).map(p=>({username:p.username,displayName:typeof p.displayName==='string'?p.displayName:'',followedAt:Number.isFinite(p.followedAt)?p.followedAt:null,followsYou:[true,false].includes(p.followsYou)?p.followsYou:null}));
    return {...saved,people,protected:(saved.protected||[]).filter(x=>set.has(x)),selected:(saved.selected||[]).filter(x=>set.has(x)),queue:exportQueue(saved.queue||[]).usernames,history:Array.isArray(saved.history)?saved.history:[]};
  } catch { return demoState(); }
}
let state=readState();
let view='lista', filter='notback', search='', sort='oldest', page=1, lastFocus=null, toastTimer=null;
let run={state:'idle',completed:[],skipped:[],total:0,current:null,message:''};
let extensionReady=!isExtension;
const pageSize=8;
const number = n => new Intl.NumberFormat('pt-BR').format(n);
const date = ms => ms?new Intl.DateTimeFormat('pt-BR',{month:'short',year:'numeric'}).format(ms).replace(' de ',' '):'Não informado';
const running = () => run.state==='running';
const locked = () => !extensionReady||['running','paused'].includes(run.state);
const removed = () => new Set(state.history.map(h=>h.username));
function eligibleNames(names) {
  const eligible=new Set(state.people.filter(p=>p.followsYou===false).map(p=>p.username));
  const done=removed();
  const excluded=new Set([...(run.completed||[]),...(run.skipped||[]).map(p=>p.username)]);
  return [...new Set(names)].filter(u=>eligible.has(u)&&!state.protected.includes(u)&&!done.has(u)&&!excluded.has(u));
}
function pendingQueueNames() { return eligibleNames(state.queue); }
function canResumeRun() { return isExtension&&extensionReady&&['paused','stopped'].includes(run.state)&&run.canResume===true&&pendingQueueNames().length>0; }
function queuePayload(names) {
  const usernames=eligibleNames(names);
  return {...exportQueue(usernames),criterion:'not-following-back',comparison:{preparedAt:Date.now(),importedAt:state.importedAt,accounts:usernames.map(username=>({username,followsYou:false,followedAt:state.people.find(p=>p.username===username)?.followedAt??null}))}};
}
function save() {
  try { localStorage.setItem(storageKey,JSON.stringify(state)); }
  catch { toast('O navegador não conseguiu salvar os dados. Exporte sua fila para preservá-la.'); }
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').hidden=false; toastTimer=setTimeout(()=>$('#toast').hidden=true,6500); }
function getVisible() {
  const done=removed();
  return state.people.filter(p=>!done.has(p.username))
    .filter(p=>view!=='protected'||state.protected.includes(p.username))
    .filter(p=>filter==='all'||(filter==='notback'&&p.followsYou===false)||(filter==='mutual'&&p.followsYou===true))
    .filter(p=>!search||p.username.toLowerCase().includes(search)||p.displayName?.toLowerCase().includes(search))
    .sort((a,b)=>sort==='az'?a.username.localeCompare(b.username):(a.followedAt===null)-(b.followedAt===null)||(sort==='newest'?(b.followedAt||0)-(a.followedAt||0):(a.followedAt||0)-(b.followedAt||0))||a.username.localeCompare(b.username));
}
function render() {
  const done=removed();
  state.selected=eligibleNames(state.selected);
  const people=state.people.filter(p=>!done.has(p.username));
  const known=people.some(p=>p.followsYou!==null);
  $('#nav-count').textContent=number(people.length);
  $('#stat-following').textContent=number(people.length);
  $('#stat-notback').textContent=known?number(people.filter(p=>p.followsYou===false).length):'—';
  $('#notback-note').textContent=known?'Conforme os arquivos importados':'Importe também seus seguidores';
  $('#stat-protected').textContent=number(people.filter(p=>state.protected.includes(p.username)).length);
  $('#stat-selected').textContent=number(state.selected.length);
  $('#all-count').textContent=number(people.length);
  $('#demo-banner').hidden=!state.demo;
  $('#environment-label').textContent=isExtension?'Extensão local · navegador':state.demo?'Demonstração · local':'Dados importados · local';
  $('#list-view').hidden=view==='queue'; $('#queue-view').hidden=view!=='queue';
  const titles={lista:'Minha lista',protected:'Protegidos',queue:'Fila de limpeza'};
  $('#breadcrumb-view').textContent=titles[view];
  $('#list-title').textContent=view==='protected'?'Suas conexões protegidas':filter==='notback'?'Quem não segue de volta':'Quem você segue';
  $('#list-description').textContent=view==='protected'?'Essas contas ficam fora de qualquer seleção.':'Conexões mútuas são mantidas. Só quem não segue de volta pode entrar na fila.';
  $$('.nav-item[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');});
  $$('.filter-tab').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-selected',String(b.dataset.filter===filter));});
  const visible=getVisible();
  const pages=Math.max(1,Math.ceil(visible.length/pageSize)); page=Math.min(page,pages);
  const rows=visible.slice((page-1)*pageSize,page*pageSize);
  $('#people-body').innerHTML=rows.map(p=>{
    const protectedAccount=state.protected.includes(p.username),selected=state.selected.includes(p.username);
    const selectable=p.followsYou===false;
    const index=state.people.indexOf(p),initials=p.username.split(/[._]/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
    return `<tr class="${selected?'selected ':''}${protectedAccount?'protected':''}"><td class="checkbox-cell"><input type="checkbox" data-select="${escape(p.username)}" aria-label="Selecionar @${escape(p.username)}" title="${selectable?'Não segue você nos arquivos importados':p.followsYou===true?'Conexão mútua: será mantida':'Importe os seguidores para comparar'}" ${selected?'checked':''} ${!selectable||protectedAccount||locked()?'disabled':''}></td><td><div class="person"><span class="person-avatar tone-${index%5}">${escape(initials)}</span><div><a href="https://www.instagram.com/${encodeURIComponent(p.username)}/" target="_blank" rel="noopener noreferrer">@${escape(p.username)}</a><small>${escape(state.demo?p.displayName:protectedAccount?'Conexão protegida':'Perfil do Instagram')}</small></div></div></td><td><span class="badge ${p.followsYou===true?'mutual':p.followsYou===null?'unknown':''}">${p.followsYou===true?'Segue você':p.followsYou===false?'Não segue de volta':'Não comparado'}</span></td><td>${date(p.followedAt)}</td><td class="protect-cell"><button class="protect-button ${protectedAccount?'on':''}" data-protect="${escape(p.username)}" aria-label="${protectedAccount?'Desproteger':'Proteger'} @${escape(p.username)}" aria-pressed="${protectedAccount}" ${locked()?'disabled':''}>${icon('heart')}</button></td></tr>`;
  }).join('');
  $('#empty-state').hidden=visible.length!==0;
  const needsComparison=people.length>0&&people.every(p=>p.followsYou===null);
  $('#empty-state h3').textContent=needsComparison?'Falta comparar seus seguidores':'Nenhuma conta por aqui';
  $('#empty-state p').textContent=needsComparison?'Importe todos os followers_*.json para identificar quem não segue você de volta.':'Experimente outro filtro ou importe sua lista.';
  $('#empty-state button').dataset.action=needsComparison?'import':'reset-filters';
  $('#empty-state button').textContent=needsComparison?'Importar seguidores':'Limpar filtros';
  const eligible=rows.filter(p=>p.followsYou===false&&!state.protected.includes(p.username));
  $('#select-visible').checked=eligible.length>0&&eligible.every(p=>state.selected.includes(p.username));
  $('#select-visible').indeterminate=eligible.some(p=>state.selected.includes(p.username))&&!$('#select-visible').checked;
  $('#select-visible').disabled=!eligible.length||locked();
  const allEligible=eligibleNames(state.people.map(p=>p.username));
  const allSelected=allEligible.length>0&&allEligible.every(u=>state.selected.includes(u));
  $('#select-all-nonfollowers').disabled=!allEligible.length||locked();
  $('.bulk-tools').hidden=view!=='lista';
  $('#select-all-nonfollowers').textContent=allSelected?`✓ Todos os ${number(allEligible.length)} estão selecionados`:`Selecionar todos que não me seguem (${number(allEligible.length)})`;
  $('#page-info').textContent=visible.length?`${number((page-1)*pageSize+1)}–${number(Math.min(page*pageSize,visible.length))} de ${number(visible.length)} contas${state.demo?' · demonstração':''}`:'0 contas neste filtro';
  $('#page-number').textContent=`${page} / ${pages}`;
  $('#prev-page').disabled=page<=1; $('#next-page').disabled=page>=pages;
  $('#selection-bar').hidden=!state.selected.length||view==='queue';
  document.body.classList.toggle('has-selection',state.selected.length>0&&view!=='queue');
  $('#selection-number').textContent=number(state.selected.length);
  $('#prepare-queue').disabled=locked();
  $('#prepare-queue').hidden=locked();
  $('#selection-recover').hidden=!locked();
  $('#clear-selection').disabled=locked();
  renderRecovery();
  renderQueue();
}
function renderRecovery() {
  const visible=isExtension&&(!extensionReady||(['running','paused','stopped'].includes(run.state)&&state.queue.length>0));
  $('#recovery-banner').hidden=!visible;
  $('#recovery-title').textContent=!extensionReady?'Conectando ao controle da extensão':running()?'Execução em andamento':canResumeRun()?'Sua fila está salva. Continue de onde parou.':'Sua fila e seu progresso continuam salvos';
  $('#recovery-message').textContent=run.message||(!extensionReady?'Se este painel ficou aberto durante uma atualização, reabra-o pelo ícone do Círculo.':'Abra o Instagram na mesma conta, entre no seu perfil e clique em Seguindo. Depois, revise e retome.');
  $('#recovery-saved').textContent=run.updatedAt?`Último registro: ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(run.updatedAt)} · ${number((run.completed||[]).length)} concluídas · ${number(pendingQueueNames().length)} pendentes`:'';
  $('#recovery-resume').hidden=!canResumeRun();
  $('#recovery-stop').hidden=!extensionReady||!['running','paused'].includes(run.state);
  $('#recovery-refresh').hidden=running()&&extensionReady;
}
function renderQueue() {
  const queue=state.queue, complete=new Set(run.completed||[]), skipped=new Map((run.skipped||[]).map(x=>[x.username,x.reason]));
  const labels={idle:'Aguardando',running:'Em andamento',paused:'Pausada',stopped:'Encerrada',completed:'Concluída',error:'Atenção'};
  $('#run-badge').textContent=labels[run.state]||'Aguardando';
  $('#run-title').textContent=running()?`Revisando @${run.current||'…'}`:queue.length?`${number(queue.length)} contas na sua fila`:'Sua próxima seleção começa aqui';
  $('#run-message').textContent=run.message||(queue.length?(state.demo?'Fila de demonstração. Importe seus dados reais para executar.':isExtension?'Abra seu próprio perfil no Instagram e a lista “Seguindo”. Depois, revise e inicie.':'Exporte a fila e importe na extensão local para executar no Instagram.'):'Selecione contas na sua lista e clique em “Preparar fila”.');
  $('#run-progress').max=run.total||queue.length||1; $('#run-progress').value=complete.size+skipped.size;
  $('#run-counts').textContent=queue.length?`${number(complete.size)} concluídas · ${number(skipped.size)} não executadas · ${number(Math.max(0,queue.length-complete.size-skipped.size))} pendentes`:'';
  $('#queue-start').hidden=!queue.length||running()||run.state==='completed';
  $('#queue-start').textContent=canResumeRun()?'Revisar e retomar':'Revisar e iniciar';
  $('#queue-start').disabled=state.demo||!extensionReady||(run.state==='paused'&&!canResumeRun())||!pendingQueueNames().length;
  $('#queue-pause').hidden=!running();
  $('#queue-stop').hidden=!['running','paused'].includes(run.state);
  $('#queue-export').hidden=!queue.length;
  $('#queue-export').disabled=!pendingQueueNames().length;
  $('#queue-report').hidden=!queue.length;
  $('#queue-list').innerHTML=queue.map(u=>`<div class="queue-item"><span>@${escape(u)}</span><small>${escape(complete.has(u)?'✓ Deixou de seguir':skipped.has(u)?skipped.get(u):run.current===u&&running()?'Em andamento…':'Aguardando')}</small></div>`).join('');
}
function setView(next) { view=next;filter=next==='lista'?'notback':'all';page=1;search='';$('#search').value='';render(); }
function showModal(content,eyebrow='SEU CÍRCULO') { lastFocus=document.activeElement;$('#modal-eyebrow').textContent=eyebrow;$('#modal-content').innerHTML=content;renderIcons($('#modal'));if(!$('#modal').open)$('#modal').showModal(); }
function closeModal() { $('#modal').close();lastFocus?.focus(); }

function showImport() {
  if(locked()) return toast('Encerre a fila antes de importar outra lista.');
  showModal(`<h2 class="modal-title">Traga suas conexões.</h2><p class="modal-description">Selecione <strong>following.json</strong> e todos os arquivos <strong>followers_*.json</strong>. A comparação das duas listas é obrigatória. Extraia o ZIP do Instagram antes de importar.</p><label class="dropzone" id="dropzone"><span data-icon="upload"></span><strong>Clique para escolher ou arraste os arquivos</strong><small>JSON, CSV ou TXT · até 50 MB no total<br>${isExtension?'Aceita também uma fila exportada pelo Círculo.':'Seus arquivos são processados apenas neste navegador.'}</small><input id="file-input" type="file" accept=".json,.csv,.txt" multiple></label><p id="import-message" class="form-help" role="status"></p><div class="form-divider">ou cole os nomes de usuário</div><textarea id="paste-usernames" aria-label="Nomes de usuário" placeholder="@primeiro.usuario&#10;@outro.usuario"></textarea><p class="form-help">Um nome por linha. Depois de colar, importe os followers_*.json para comparar e liberar a seleção.</p><div class="modal-actions"><button class="button secondary" id="import-guide">Onde encontro meus arquivos?</button><button class="button primary" id="import-paste">Importar nomes</button></div>`,'COMECE PELA SUA LISTA');
  $('#file-input').addEventListener('change',e=>importFiles([...e.target.files]));
  const zone=$('#dropzone');
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover');importFiles([...e.dataTransfer.files]);});
  $('#import-guide').onclick=showGuide;
  $('#import-paste').onclick=async()=>{
    try { const usernames=parseUsernames($('#paste-usernames').value);if(!usernames.length)throw Error('Cole pelo menos um nome de usuário.');await prepareImportWorker();commitImport(usernames.map(username=>({username,followedAt:null,followsYou:null})),[]); }
    catch(e){$('#import-message').textContent=e.message;}
  };
}
async function importFiles(files) {
  const message=$('#import-message');
  if(!files.length) return;
  try {
    if(files.reduce((n,f)=>n+f.size,0)>50*1024*1024) throw Error('Selecione arquivos que somem até 50 MB.');
    message.textContent='Lendo seus arquivos localmente…';
    const records=await Promise.all(files.map(async f=>({name:f.name,text:await f.text()})));
    if(records.length===1&&records[0].text.replace(/^\uFEFF/,'').trim().startsWith('{')) {
      let parsed;try{parsed=JSON.parse(records[0].text.replace(/^\uFEFF/,''));}catch{}
      if(parsed?.format==='circulo-queue') {
        const queue=parseQueue(records[0].text);
        if(!queue.length) throw Error('A fila importada está vazia.');
        const accounts=parsed.comparison?.accounts;
        if(parsed.criterion!=='not-following-back'||!Array.isArray(accounts)||!queue.every(u=>accounts.some(p=>p.username===u&&p.followsYou===false)))throw Error('Esta fila não contém a comparação de seguidores. Importe following.json e todos os followers_*.json, ou exporte uma nova fila do Círculo.');
        await prepareImportWorker();
        if(state.demo)commitImport(queue.map(username=>({username,followedAt:Number.isFinite(accounts.find(p=>p.username===username)?.followedAt)?accounts.find(p=>p.username===username).followedAt:null,followsYou:false})),[],{close:false});
        else { for(const username of queue){const existing=state.people.find(p=>p.username===username);if(!existing)state.people.push({username,followedAt:null,followsYou:false});else if(existing.followsYou===null)existing.followsYou=false;} }
        state.queue=eligibleNames(queue);state.selected=[...state.queue];run={state:'idle',completed:[],skipped:[],message:''};save();closeModal();setView('queue');toast('Fila comparada importada. Conexões mútuas e protegidos ficam de fora.');return;
      }
    }
    const parsed=parseInstagramFiles(records);
    if(!parsed.following.length&&parsed.hasFollowers&&!state.demo&&state.people.length)parsed.following=state.people.map(({username,followedAt})=>({username,followedAt}));
    const people=buildPeople(parsed);
    if(!people.length) throw Error('Nenhuma conta seguida foi encontrada. Inclua following.json ou uma lista de nomes.');
    await prepareImportWorker();
    commitImport(people,parsed.warnings);
  } catch(e) { if(message?.isConnected)message.textContent=e.message||'Não foi possível ler os arquivos.';else toast(e.message); }
}
async function prepareImportWorker() {
  if(!isExtension)return;
  const result=await send({type:'CIRCULO_RESET'});
  if(result.reset!==true)throw Error(result.message||'Encerre a fila antes de importar outra lista.');
  updateRun(result);
}
function commitImport(people,warnings=[],options={}) {
  const names=new Set(people.map(p=>p.username));
  state={version:1,demo:false,people,importedAt:Date.now(),protected:state.demo?[]:state.protected.filter(u=>names.has(u)),selected:[],queue:[],history:state.demo?[]:state.history};
  run={state:'idle',completed:[],skipped:[],message:''};save();
  if(options.close!==false){closeModal();setView('lista');toast(`${number(people.length)} contas importadas.${warnings.length?' '+warnings.slice(0,2).join(' '):people.every(p=>p.followsYou===null)?' Importe também os seguidores para liberar a seleção.':' Apenas quem não segue de volta pode entrar na fila.'}`);}
}
function showGuide() {
  showModal(`<h2 class="modal-title">Um feed mais leve,<br>em três passos.</h2><p class="modal-description">Comece com os dados da sua própria conta.</p><ol class="guide-list"><li><strong>Exporte suas informações no Instagram</strong>Na Central de Contas, procure “Suas informações e permissões” e “Exportar” ou “Baixar suas informações”. Escolha seu perfil, seguidores e seguindo, todo o período e formato <b>JSON</b>. Os nomes dos menus podem variar.</li><li><strong>Importe, compare e proteja</strong>Extraia o ZIP recebido. Importe <b>following.json</b> e todos os <b>followers_*.json</b>. Use o coração para proteger contas e as caixas para selecionar quem deseja remover.</li><li><strong>Revise e execute no seu navegador</strong>Instale a extensão local. Abra seu próprio perfil do Instagram e clique em <b>Seguindo</b>. Com essa lista aberta, confirme a fila na extensão. Você pode pausar ou encerrar.</li></ol><div class="info-box">A comparação retrata a data da exportação. O Instagram pode restringir ações automatizadas; o projeto não oferece um limite garantido. Mudanças na interface podem exigir ajustes na extensão.</div><p class="form-help"><a href="https://help.instagram.com/181231772500920/" target="_blank" rel="noopener noreferrer">Ajuda oficial sobre exportação ↗</a> · <a href="https://about.fb.com/news/2023/10/manage-your-information-across-apps/" target="_blank" rel="noopener noreferrer">Informações da Meta ↗</a></p><div class="modal-actions"><button class="button secondary" id="guide-install">Instalar extensão</button><button class="button primary" id="guide-import">Importar minha lista</button></div>`,'COMO FUNCIONA');
  $('#guide-import').onclick=showImport;$('#guide-install').onclick=showInstall;
}
function showInstall() {
  showModal(`<h2 class="modal-title">Seu navegador faz<br>a ponte.</h2><p class="modal-description">A extensão Círculo executa a fila na sua sessão aberta do Instagram. Funciona no Chrome e no Edge para computador.</p><ol class="guide-list"><li><strong>Baixe e extraia o projeto</strong>Extraia o arquivo ZIP em uma pasta permanente do seu computador.</li><li><strong>Carregue a extensão local</strong>Digite <b>chrome://extensions</b> no Chrome ou <b>edge://extensions</b> no Edge. Ative o <b>Modo do desenvolvedor</b>, clique em <b>Carregar sem compactação</b> e escolha a pasta <b>extensao</b>, que contém manifest.json.</li><li><strong>Abra o Círculo pela extensão</strong>Clique no ícone da extensão. Importe seus arquivos ou a fila exportada deste painel. No Instagram, abra seu próprio perfil → <b>Seguindo</b>. Revise e confirme a execução no Círculo.</li></ol><div class="info-box">A extensão precisa de acesso somente a <b>www.instagram.com</b>. Ela não solicita senha e não utiliza endpoints privados. Ações são feitas pela interface e podem sofrer restrições do Instagram.</div><div class="modal-actions">${isExtension?'<button class="button primary" id="install-done">Já estou na extensão ✓</button>':'<a class="button primary" href="circulo-projeto.zip" download><span data-icon="download"></span>Baixar projeto e extensão</a>'}</div>`,'EXTENSÃO LOCAL');
  if(isExtension)$('#install-done').onclick=closeModal;
}
function showPrivacy() {
  showModal(`<h2 class="modal-title">Seus dados,<br>no seu navegador.</h2><p class="modal-description">Os arquivos importados, protegidos, seleções e histórico ficam no armazenamento local deste navegador. Nenhuma lista é enviada ao servidor do Círculo.</p><ol class="guide-list"><li><strong>Você controla a lista</strong>O painel permite exportar sua seleção e limpar os dados locais a qualquer momento. Cada navegador e a extensão têm seu próprio armazenamento.</li><li><strong>A sessão fica no Instagram</strong>A extensão opera a interface da aba que você abriu. Não lê senhas, cookies ou tokens de acesso.</li><li><strong>Dados de demonstração são fictícios</strong>Números iniciais servem apenas para conhecer o painel. Nenhuma ação é executada usando a demonstração.</li></ol><div class="info-box">A exportação pode ficar desatualizada. Uma conta privada pode exigir nova aprovação se você voltar a segui-la depois. O painel não é afiliado ao Instagram ou à Meta.</div><div class="modal-actions"><button class="button secondary" id="privacy-clear">Limpar dados locais</button></div>`,'PRIVACIDADE');$('#privacy-clear').onclick=showClear;
}
function showClear() {
  if(['running','paused'].includes(run.state))return toast('Encerre a fila da extensão antes de limpar os dados locais.');
  showModal(`<h2 class="modal-title">Recomeçar sua lista?</h2><p class="modal-description">Isso apaga os dados importados, protegidos, seleção e histórico deste painel. As contas do Instagram não são alteradas.</p><div class="modal-actions"><button class="button secondary" id="cancel-clear">Cancelar</button><button class="button primary" id="confirm-clear">Apagar dados locais</button></div>`,'LIMPAR DADOS');
  $('#cancel-clear').onclick=closeModal;$('#confirm-clear').onclick=async()=>{if(isExtension){const result=await send({type:'CIRCULO_RESET'});if(result.reset!==true)return toast(result.message||'Aguarde o encerramento da fila.');}state={version:1,demo:false,people:[],protected:[],selected:[],queue:[],history:[],importedAt:null};run={state:'idle',completed:[],skipped:[],message:''};save();closeModal();setView('lista');toast('Dados locais apagados.');};
}
function prepareQueue(existing=false) {
  const resuming=existing&&canResumeRun();
  const names=existing?pendingQueueNames():eligibleNames(state.selected);
  if(!names.length)return toast('Só contas que não seguem você de volta podem entrar na fila. Importe as duas listas para comparar.');
  if(isExtension&&!extensionReady)return toast('Reabra o painel pelo ícone do Círculo ou clique em Verificar conexão.');
  if(running()||(locked()&&!resuming)){setView('queue');return toast('Sua execução está salva. Use Revisar e retomar ou encerre a fila sem apagar os resultados.');}
  showModal(`<h2 class="modal-title">${resuming?'Retome os pendentes.':'Revise antes de seguir.'}</h2><p class="modal-description">Você selecionou <strong>${number(names.length)} contas</strong> para deixar de seguir. ${state.demo?'Esta é uma simulação; importe sua lista real para executar.':isExtension?'Abra seu próprio perfil no Instagram e deixe o diálogo “Seguindo” aberto.':'Exporte esta fila para executá-la pela extensão local.'}</p>${resuming?`<p class="form-help">Fila da conta <strong>@${escape(run.owner)}</strong>. Apenas pendentes são revisados; concluídos e itens para revisão manual ficam fora.</p>`:''}<div class="review-list">${names.map(u=>`<div class="review-row"><span>@${escape(u)}</span><span>Deixar de seguir</span></div>`).join('')}</div><div class="info-box">Essa ação altera sua conta. Para voltar a seguir uma conta privada, pode ser necessária nova aprovação. O Instagram pode restringir ações automatizadas; nenhum intervalo garante ausência de bloqueio.</div>${isExtension&&!state.demo?'<label class="confirmation"><input type="checkbox" id="confirm-ownership">Confirmei a lista, sou o titular da conta aberta no Instagram e quero deixar de seguir essas pessoas.</label>':''}<div class="modal-actions"><button class="button secondary" id="review-back">Voltar</button><button class="button primary" id="review-confirm" ${isExtension&&!state.demo?'disabled':''}>${state.demo?'Ver fila de demonstração':isExtension?(resuming?'Confirmar e retomar':'Confirmar e iniciar'):'Exportar fila'}</button></div>`,'REVISÃO DA FILA');
  $('#review-back').onclick=closeModal;
  if($('#confirm-ownership'))$('#confirm-ownership').onchange=e=>$('#review-confirm').disabled=!e.target.checked;
  $('#review-confirm').onclick=async()=>{
    if(!resuming)state.queue=names;save();closeModal();setView('queue');
    if(state.demo){toast('Demonstração pronta. Importe seus dados para executar no Instagram.');return;}
    if(!isExtension){download('circulo-fila.json',queuePayload(names),'application/json');toast('Fila exportada. Importe-a no painel da extensão.');showInstall();return;}
    const result=await send({type:resuming?'CIRCULO_RESUME':'CIRCULO_START',usernames:names,confirmed:true,criterion:'not-following-back'});
    updateRun(result);if(result.state==='error')toast(result.message);
  };
}
async function send(message) {
  let timer;
  try {
    const result=await Promise.race([chrome.runtime.sendMessage(message),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),8000);})]);
    if(!result||typeof result.state!=='string')throw new Error('invalid response');
    return result;
  } catch { return {...run,transportError:true,message:'Não foi possível falar com a extensão. Seus dados continuam salvos. Reabra o painel pelo ícone do Círculo e clique em Verificar conexão.'}; }
  finally { clearTimeout(timer); }
}
async function refreshRun() { if(isExtension)updateRun(await send({type:'CIRCULO_STATUS'})); }
function updateRun(next) {
  if(!next?.state)return;
  if(next.transportError){extensionReady=false;run={...run,message:next.message};render();return;}
  extensionReady=true;
  run={...run,...next,completed:next.completed??run.completed??[],skipped:next.skipped??run.skipped??[]};
  if(Array.isArray(next.usernames)&&next.usernames.length){
    if(state.demo)state={version:1,demo:false,people:next.usernames.map(username=>({username,followedAt:null,followsYou:null})),protected:[],selected:[],queue:[],history:[],importedAt:null};
    state.queue=[...next.usernames];
  }
  if(!state.demo){for(const username of run.completed)if(!state.history.some(h=>h.username===username))state.history.push({username,at:Date.now()});state.selected=state.selected.filter(u=>!run.completed.includes(u));save();}
  render();
}
function download(filename,content,type) { const body=typeof content==='object'?JSON.stringify(content,null,2):content;const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function exportCsv() {
  const safe=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const csv=['username,seguindo_desde,segue_voce,protegido',...getVisible().map(p=>[p.username,p.followedAt?new Date(p.followedAt).toISOString().slice(0,10):'',p.followsYou===null?'desconhecido':p.followsYou?'sim':'nao',state.protected.includes(p.username)?'sim':'nao'].map(safe).join(','))].join('\r\n');download('circulo-lista.csv','\uFEFF'+csv,'text/csv;charset=utf-8');toast('Lista deste filtro exportada em CSV.');
}

renderIcons();
document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-view]');if(nav)setView(nav.dataset.view);
  const action=e.target.closest('[data-action]')?.dataset.action;
  if(action==='import')showImport();if(action==='guide')showGuide();if(action==='install')showInstall();if(action==='privacy')showPrivacy();if(action==='clear')showClear();if(action==='export-all')exportCsv();if(action==='reset-filters'){filter='notback';search='';page=1;$('#search').value='';render();}
  const tab=e.target.closest('[data-filter]');if(tab){filter=tab.dataset.filter;page=1;render();}
  const protect=e.target.closest('[data-protect]');if(protect&&!locked()){
    const u=protect.dataset.protect;state.protected=state.protected.includes(u)?state.protected.filter(x=>x!==u):[...state.protected,u];state.selected=state.selected.filter(x=>!state.protected.includes(x));state.queue=state.queue.filter(x=>!state.protected.includes(x));save();render();
  }
});
$('#people-body').addEventListener('change',e=>{const u=e.target.dataset.select;if(!u||locked()||!eligibleNames([u]).length)return;state.selected=e.target.checked?[...new Set([...state.selected,u])]:state.selected.filter(x=>x!==u);save();render();});
$('#select-visible').onchange=e=>{if(locked())return;const names=eligibleNames(getVisible().slice((page-1)*pageSize,page*pageSize).map(p=>p.username));state.selected=e.target.checked?[...new Set([...state.selected,...names])]:state.selected.filter(x=>!names.includes(x));save();render();};
$('#select-all-nonfollowers').onclick=()=>{
  if(locked())return;
  const names=eligibleNames(state.people.map(p=>p.username));
  if(names.length>10000)return toast('A extensão aceita até 10.000 contas por fila. Selecione um grupo menor pelas páginas.');
  state.selected=names;
  save();render();
  toast(`${number(names.length)} contas selecionadas em todas as páginas. Clique em “Preparar fila” para revisar.`);
};
$('#search').oninput=e=>{search=e.target.value.trim().replace(/^@/,'').toLowerCase();page=1;render();};
$('#sort').onchange=e=>{sort=e.target.value;page=1;render();};
$('#prev-page').onclick=()=>{page--;render();};$('#next-page').onclick=()=>{page++;render();};
$('#clear-selection').onclick=()=>{if(locked())return;state.selected=[];save();render();};
$('#prepare-queue').onclick=()=>prepareQueue();$('#queue-start').onclick=()=>prepareQueue(true);
$('#selection-recover').onclick=()=>setView('queue');
$('#recovery-open').onclick=()=>setView('queue');
$('#recovery-resume').onclick=()=>prepareQueue(true);
$('#recovery-refresh').onclick=refreshRun;
$('#recovery-stop').onclick=async()=>updateRun(await send({type:'CIRCULO_STOP'}));
$('#queue-pause').onclick=async()=>updateRun(await send({type:'CIRCULO_PAUSE'}));
$('#queue-stop').onclick=async()=>updateRun(await send({type:'CIRCULO_STOP'}));
$('#queue-export').onclick=()=>{download('circulo-fila.json',queuePayload(state.queue),'application/json');toast('Fila com comparação exportada.');};
$('#queue-report').onclick=()=>{download('circulo-progresso.json',{format:'circulo-progress',version:1,exportedAt:Date.now(),owner:run.owner||null,state:run.state,completed:run.completed||[],skipped:run.skipped||[],pending:pendingQueueNames(),history:state.history},'application/json');toast('Relatório de progresso exportado. Guarde este arquivo localmente.');};
$('#close-modal').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
if(isExtension){
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.circuloRun?.newValue)updateRun(changes.circuloRun.newValue);});
  void refreshRun();
  window.addEventListener('focus',()=>void refreshRun());
}
window.addEventListener('storage',e=>{if(e.key===storageKey&&!locked()){state=readState();render();}});
render();


