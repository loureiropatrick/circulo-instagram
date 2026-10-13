/* Círculo: a single local run, controlled exclusively by the extension dashboard. */
'use strict';

const STATUS_KEY = 'circuloRun';
const CONTROL_KEY = 'circuloControl';
const HOST = 'https://www.instagram.com/';
const DASHBOARD = chrome.runtime.getURL('index.html');
const initialStatus = () => ({
  state: 'idle', current: null, completed: [], skipped: [], total: 0,
  message: 'Abra seu perfil do Instagram e a lista Seguindo para começar.', updatedAt: Date.now()
});

let status;
let control;
let serial = Promise.resolve();

async function save(message) {
  if (message !== undefined) status.message = message;
  status.updatedAt = Date.now();
  await chrome.storage.local.set({ [STATUS_KEY]: publicStatus(), [CONTROL_KEY]: control });
  return publicStatus();
}

function publicStatus(extra = {}) {
  const remainingCount = remaining().length;
  return {
    ...status, completed: [...status.completed], skipped: status.skipped.map(item => ({ ...item })),
    usernames: control ? [...control.queue] : [], owner: control?.owner || null, remainingCount,
    canResume: Boolean(control && validOwner(control.owner) && control.criterion === 'not-following-back' &&
      ['paused', 'stopped'].includes(status.state) && remainingCount > 0),
    ...extra
  };
}

const initialized = (async () => {
  const saved = await chrome.storage.local.get([STATUS_KEY, CONTROL_KEY]);
  status = saved[STATUS_KEY] && Array.isArray(saved[STATUS_KEY].completed) && Array.isArray(saved[STATUS_KEY].skipped)
    ? saved[STATUS_KEY] : initialStatus();
  const savedControl = saved[CONTROL_KEY];
  const queue = normalizedUsernames(savedControl?.queue);
  control = savedControl && queue && typeof savedControl.runId === 'string' ? { ...savedControl, queue } : null;
  if (status.state === 'running') {
    status.state = 'paused';
    await save('O controle foi reiniciado e a fila foi preservada. Abra seu próprio perfil > Seguindo, revise o restante e clique em Retomar.');
  }
})();

function enqueue(operation) {
  const result = serial.then(() => initialized).then(operation);
  serial = result.catch(() => {});
  return result;
}

function normalizedUsernames(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 10000) return null;
  const result = [];
  const seen = new Set();
  for (const entry of input) {
    if (typeof entry !== 'string') return null;
    const username = entry.trim().replace(/^@/, '').toLowerCase();
    if (!/^(?=.{1,30}$)(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]+$/.test(username)) return null;
    if (!seen.has(username)) { seen.add(username); result.push(username); }
  }
  return result;
}

function resolved(username) {
  return status.completed.includes(username) || status.skipped.some(item => item.username === username);
}

function validOwner(owner) {
  return typeof owner === 'string' && normalizedUsernames([owner])?.[0] === owner;
}

function remaining() {
  return control ? control.queue.filter(username => !resolved(username)) : [];
}

async function toTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch { return null; }
}

async function inspect(tabId) {
  return toTab(tabId, { type: 'CIRCULO_INSPECT' });
}

function trustedDashboard(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.split(/[?#]/, 1)[0] === DASHBOARD;
}

function trustedContent(sender, message) {
  return sender.id === chrome.runtime.id && sender.frameId === 0 &&
    sender.tab?.id === control?.tabId && typeof sender.url === 'string' &&
    sender.url.startsWith(HOST) && message.runId === control?.runId;
}

async function recoverPending(reason) {
  if (control?.pending) {
    const username = control.pending.username;
    if (control.pending.phase === 'armed' && !resolved(username)) {
      status.skipped.push({ username, reason: reason || 'A página mudou durante uma ação. Resultado não confirmado; revise esta conta manualmente.' });
    }
    control.pending = null;
    status.current = null;
  }
}

async function stopExistingRunner(mode) {
  if (!control) return null;
  return toTab(control.tabId, { type: 'CIRCULO_WORKER_CONTROL', runId: control.runId, state: mode });
}

// Status checks never start a worker. A tab may have disappeared while Chrome was closed,
// or a content script may have ended without delivering its final message.
async function refreshStatus() {
  if (!control) {
    if (['running', 'paused'].includes(status.state)) {
      status.state = 'stopped';
      return save('A fila salva não pôde ser recuperada. Revise suas listas e prepare uma nova seleção.');
    }
    return publicStatus();
  }
  if (!remaining().length && ['running', 'paused', 'stopped'].includes(status.state)) {
    await recoverPending();
    status.state = 'completed';
    return save('Revisão concluída. Confira os resultados antes de preparar outra seleção.');
  }
  if (status.state !== 'running' && !control.pending) return publicStatus();
  const info = await inspect(control.tabId);
  const ownActiveRunner = info?.runner?.active && info.runner.runId === control.runId;
  if (status.state === 'running' && ownActiveRunner && info.ready && info.owner === control.owner &&
      !['paused', 'stopped'].includes(info.runner.state)) return publicStatus();
  if (!ownActiveRunner) await recoverPending();
  if (status.state !== 'running') {
    if (!remaining().length) status.state = 'completed';
    return save();
  }
  status.state = 'paused';
  if (ownActiveRunner) await stopExistingRunner('paused');
  return save(info?.owner && info.owner !== control.owner
    ? `A conta aberta mudou. Esta fila pertence a @${control.owner}; abra Seguindo nessa conta e revise o restante antes de retomar.`
    : info?.runner?.active && !ownActiveRunner
      ? 'Outra execução ocupa a aba. A fila foi preservada; encerre a outra execução antes de retomar.'
      : 'A execução foi interrompida e a fila foi preservada. Abra seu próprio perfil > Seguindo, revise o restante e clique em Retomar.');
}

async function start(message) {
  if (status.state === 'running') return save('Já existe uma execução em andamento.');
  if (message.confirmed !== true || message.criterion !== 'not-following-back') {
    status.state = 'error';
    return save('Compare seguidores e seguindo e confirme a seleção de quem não segue de volta antes de iniciar.');
  }
  const usernames = normalizedUsernames(message.usernames);
  if (!usernames) {
    status.state = 'error';
    return save('Selecione uma lista válida de nomes de usuário (até 10.000 nomes).');
  }
  if (control) {
    const previous = await inspect(control.tabId);
    if (previous?.runner?.active) {
      return save('Aguarde a ação em andamento terminar antes de iniciar outra seleção.');
    }
  }
  const tabs = await chrome.tabs.query({ url: `${HOST}*` });
  const results = await Promise.all(tabs.map(async tab => ({ tab, info: await inspect(tab.id) })));
  const ready = results.filter(result => result.info?.ready);
  if (ready.length !== 1) {
    status.state = 'error';
    const detail = results.find(result => result.info?.reason)?.info.reason;
    return save(ready.length > 1
      ? 'Há mais de uma lista Seguindo aberta. Deixe aberta apenas a lista da conta que deseja revisar.'
      : detail || 'Abra instagram.com, entre na sua conta e abra seu próprio perfil > Seguindo. Se a aba já estava aberta ao instalar a extensão, recarregue-a.');
  }
  const { tab, info } = ready[0];
  if (!validOwner(info.owner)) {
    status.state = 'error';
    return save('Não foi possível identificar a conta conectada. Abra seu próprio perfil > Seguindo antes de iniciar.');
  }
  if (usernames.includes(info.owner)) {
    status.state = 'error';
    return save('A seleção inclui a própria conta conectada. Remova esse nome antes de iniciar.');
  }
  control = { runId: crypto.randomUUID(), tabId: tab.id, owner: info.owner, queue: usernames, criterion: message.criterion, pending: null, lastActionAt: control?.lastActionAt || 0 };
  status = { ...initialStatus(), state: 'running', total: usernames.length };
  await save('Revisando os perfis selecionados na lista Seguindo.');
  const response = await toTab(tab.id, {
    type: 'CIRCULO_WORKER_RUN', runId: control.runId, owner: control.owner, usernames
  });
  if (!response?.accepted) {
    status.state = 'paused';
    await save(response?.reason || 'A aba não respondeu. Confira a lista Seguindo e clique em Retomar.');
  }
  return publicStatus();
}

async function resume(message) {
  if (!control || !['paused', 'stopped'].includes(status.state)) return publicStatus();
  if (!remaining().length) {
    await recoverPending();
    status.state = 'completed';
    return save('Revisão concluída. Confira os resultados antes de preparar outra seleção.');
  }
  if (message.confirmed !== true || message.criterion !== 'not-following-back') {
    return save('Revise as contas restantes e confirme quem não segue de volta antes de retomar.');
  }
  if (control.criterion !== 'not-following-back') {
    status.state = 'stopped';
    await stopExistingRunner('stopped');
    return save('Esta fila antiga não contém comparação. Importe seguidores e seguindo e prepare uma nova seleção.');
  }
  if (!validOwner(control.owner)) {
    return save('Esta fila não identifica a conta original. Revise suas listas e prepare uma nova seleção.');
  }
  const reviewed = normalizedUsernames(message.usernames);
  const pendingNames = new Set(remaining());
  if (!reviewed || reviewed.some(username => !pendingNames.has(username))) {
    return save('A seleção da retomada precisa conter apenas contas restantes desta fila. Revise novamente antes de retomar.');
  }
  const previousInfo = await inspect(control.tabId);
  const tabs = await chrome.tabs.query({ url: `${HOST}*` });
  const results = await Promise.all(tabs.map(async tab => ({
    tab, info: tab.id === control.tabId ? previousInfo : await inspect(tab.id)
  })));
  const ready = results.filter(result => result.info?.ready);
  if (ready.length !== 1) {
    const detail = results.find(result => result.info?.reason)?.info.reason;
    return save(ready.length > 1
      ? `Há mais de uma lista Seguindo aberta. Deixe aberta apenas a lista de @${control.owner} para retomar.`
      : detail || `Abra o próprio perfil de @${control.owner} > Seguindo em uma aba do Instagram para retomar.`);
  }
  const { tab, info } = ready[0];
  if (info.owner !== control.owner) {
    return save(`Esta fila pertence a @${control.owner}. A lista aberta é de outra conta; abra Seguindo em @${control.owner} antes de retomar.`);
  }
  if ((previousInfo?.runner?.active && previousInfo.runner.runId !== control.runId) ||
      (info.runner?.active && info.runner.runId !== control.runId)) {
    return save('Outra execução ocupa esta aba. Interrompa-a antes de retomar.');
  }
  if (previousInfo?.runner?.active && tab.id !== control.tabId) {
    return save('Aguarde a verificação da última ação terminar na aba anterior antes de retomar em outra aba.');
  }
  if (info.runner?.active && info.runner.state === 'stopped') {
    return save('Aguarde a verificação da última ação terminar antes de retomar a fila encerrada.');
  }
  // A running content script retains its original set. Stop it first if the dashboard
  // removed accounts during review, then retry once its in-flight action is settled.
  const approved = new Set(reviewed);
  const excluded = remaining().filter(username => !approved.has(username));
  if (info.runner?.active && excluded.length) {
    await stopExistingRunner('stopped');
    return save('A seleção foi alterada. Aguarde a verificação da última ação terminar e confirme a retomada novamente.');
  }
  if (!info.runner?.active) await recoverPending();
  for (const username of excluded) {
    if (!resolved(username)) status.skipped.push({ username, reason: 'Excluída da seleção na revisão da retomada. Conexão mantida.' });
  }
  if (remaining().length === 0) {
    status.state = 'completed';
    return save('Revisão concluída. Confira os resultados antes de preparar outra seleção.');
  }
  // Identity is established before changing the tab. Old-tab messages become untrusted.
  control.tabId = tab.id;
  status.state = 'running';
  await save('Execução retomada com as contas restantes. Resultados anteriores foram preservados.');
  const response = await toTab(control.tabId, {
    type: 'CIRCULO_WORKER_RUN', runId: control.runId, owner: control.owner, usernames: remaining()
  });
  if (!response?.accepted) {
    status.state = 'paused';
    await save(response?.reason || 'A aba não respondeu. Confira a lista Seguindo.');
  }
  return publicStatus();
}

async function contentMessage(message, sender) {
  if (!trustedContent(sender, message)) return { allowed: false };
  const username = typeof message.username === 'string' ? message.username.toLowerCase() : '';
  const validItem = control.queue.includes(username) && !resolved(username);
  switch (message.type) {
    case 'CIRCULO_CHECK_CONTROL':
      return { allowed: status.state === 'running', state: status.state };
    case 'CIRCULO_ITEM_BEGIN':
      if (!validItem || status.state !== 'running' || (control.pending && control.pending.username !== username)) return { allowed: false };
      control.pending = { username, phase: 'prepared' };
      status.current = username;
      await save(`Localizado @${username}.`);
      return { allowed: true, waitMs: Math.max(0, 5000 - (Date.now() - (control.lastActionAt || 0))) };
    case 'CIRCULO_ITEM_ARM':
      if (!validItem || status.state !== 'running' || control.pending?.username !== username) return { allowed: false };
      control.pending.phase = 'armed';
      await save(`Processando @${username}.`);
      return { allowed: true };
    case 'CIRCULO_ITEM_CANCEL':
      if (control.pending?.username === username) {
        control.pending = null;
        status.current = null;
        await save();
      }
      return { accepted: true };
    case 'CIRCULO_ITEM_RESULT': {
      if (!validItem || !['completed', 'skipped'].includes(message.outcome)) return { accepted: false };
      if (message.outcome === 'completed' && control.pending?.username !== username) return { accepted: false };
      if (message.outcome === 'completed') {
        status.completed.push(username);
        control.lastActionAt = Date.now();
      }
      else status.skipped.push({ username, reason: String(message.reason || 'Perfil não localizado na lista aberta.').slice(0, 350) });
      if (control.pending?.username === username) control.pending = null;
      status.current = null;
      if (message.pause && status.state !== 'stopped') status.state = 'paused';
      if (!remaining().length) status.state = 'completed';
      await save(status.state === 'completed'
        ? 'Revisão concluída. Confira os resultados.'
        : message.pause ? 'Execução pausada porque uma ação precisa de revisão manual.' : undefined);
      return { accepted: true, state: status.state };
    }
    case 'CIRCULO_WORKER_HALTED':
      if (status.state === 'running') status.state = 'paused';
      if (control.pending?.phase === 'prepared') { control.pending = null; status.current = null; }
      await save(message.reason ? String(message.reason).slice(0, 350) : undefined);
      return { accepted: true };
    case 'CIRCULO_WORKER_DONE':
      if (!remaining().length) status.state = 'completed';
      else if (status.state === 'running') status.state = 'paused';
      status.current = null;
      await save(status.state === 'completed' ? 'Revisão concluída. Confira os resultados.' : undefined);
      return { accepted: true };
    default:
      return { allowed: false };
  }
}

async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') return null;
  if (!trustedDashboard(sender)) return contentMessage(message, sender);
  switch (message.type) {
    case 'CIRCULO_STATUS': return refreshStatus();
    case 'CIRCULO_START': return start(message);
    case 'CIRCULO_PAUSE':
      if (status.state === 'running') {
        status.state = 'paused';
        await save('Pausado. Uma confirmação já enviada pode terminar de ser verificada.');
        await stopExistingRunner('paused');
      }
      return publicStatus();
    case 'CIRCULO_RESUME': return resume(message);
    case 'CIRCULO_STOP':
      if (control && ['running', 'paused'].includes(status.state)) {
        status.state = 'stopped';
        await save('Você encerrou a execução. A fila foi preservada e pode ser revisada para retomar o restante. Uma confirmação já enviada pode terminar de ser verificada.');
        await stopExistingRunner('stopped');
      }
      return publicStatus();
    case 'CIRCULO_RESET': {
      if (['running', 'paused'].includes(status.state)) return publicStatus({ reset: false, message: 'Encerre a fila antes de apagar os dados da extensão.' });
      const info = control && await inspect(control.tabId);
      if (info?.runner?.active) return publicStatus({ reset: false, message: 'Aguarde a verificação da última ação terminar antes de apagar os dados.' });
      control = null;
      status = initialStatus();
      await save();
      return publicStatus({ reset: true });
    }
    default: return publicStatus();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  enqueue(() => handle(message, sender)).then(sendResponse).catch(async () => {
    if (status) {
      status.state = 'paused';
      await save('O controle encontrou um erro. Confira a aba do Instagram antes de retomar.').catch(() => {});
      sendResponse(publicStatus());
    } else sendResponse(initialStatus());
  });
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: DASHBOARD });
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading') return;
  enqueue(async () => {
    if (control?.tabId !== tabId || !['running', 'paused'].includes(status.state)) return;
    status.state = 'paused';
    await recoverPending();
    await save('A aba foi recarregada ou mudou de página. A fila foi preservada; reabra seu próprio perfil > Seguindo, revise o restante e clique em Retomar.');
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  enqueue(async () => {
    if (control?.tabId !== tabId || !['running', 'paused', 'stopped'].includes(status.state)) return;
    status.state = 'stopped';
    await recoverPending();
    if (!remaining().length) status.state = 'completed';
    await save(status.state === 'completed'
      ? 'Revisão concluída. Confira os resultados.'
      : `A aba do Instagram foi fechada e a fila foi preservada. Abra @${control.owner} > Seguindo em uma nova aba, revise o restante e clique em Retomar.`);
  }).catch(() => {});
});
