'use strict';
// Local browser fixtures only. This test never contacts Instagram.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const test = require('node:test');
const directory = path.join(__dirname, '..', 'extensao');

async function backgroundFixture(saved = {}) {
  let listener;
  let updated;
  let removed;
  let database = structuredClone(saved);
  const tabs = new Map([[11, { ready: true, owner: 'ana', runner: null }]]);
  const commands = [];
  const chrome = {
    runtime: { id: 'fixture', getURL: file => `chrome-extension://fixture/${file}`, onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: {
      get: async () => structuredClone(database),
      set: async values => { database = { ...database, ...structuredClone(values) }; }
    } },
    action: { onClicked: { addListener() {} } },
    tabs: {
      query: async () => [...tabs].map(([id, info]) => ({ id, url: `https://www.instagram.com/${info?.owner || 'ana'}/following/` })),
      create: async () => {},
      sendMessage: async (id, message) => {
        commands.push({ ...message, tabId: id });
        const info = tabs.get(id);
        if (!info) throw new Error('Fixture tab closed');
        if (message.type === 'CIRCULO_INSPECT') return structuredClone(info);
        if (message.type === 'CIRCULO_WORKER_RUN') info.runner = { active: true, runId: message.runId, state: 'running' };
        if (message.type === 'CIRCULO_WORKER_CONTROL' && info.runner?.runId === message.runId) info.runner.state = message.state;
        return { accepted: true };
      },
      onUpdated: { addListener: fn => { updated = fn; } },
      onRemoved: { addListener: fn => { removed = fn; } }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'background.js'), 'utf8'), { chrome, crypto: webcrypto, Date, Promise, console });
  const dashboard = { id: 'fixture', url: 'chrome-extension://fixture/index.html' };
  const content = { id: 'fixture', frameId: 0, tab: { id: 11 }, url: 'https://www.instagram.com/ana/following/' };
  const message = (payload, sender = dashboard) => new Promise(resolve => listener(payload, sender, resolve));
  return {
    message, content, commands, data: () => database,
    update: (id, change) => { if (tabs.has(id)) tabs.get(id).runner = null; updated(id, change); },
    remove: id => { tabs.delete(id); removed(id); },
    setInfo: (value, id = 11) => { tabs.set(id, value); },
    removeQuietly: id => tabs.delete(id)
  };
}

const confirmedResume = usernames => ({ type: 'CIRCULO_RESUME', confirmed: true, criterion: 'not-following-back', usernames });
const savedRun = (state = 'stopped', extraControl = {}, extraStatus = {}) => ({
  circuloRun: { state, current: null, completed: ['alice'], skipped: [{ username: 'uncertain', reason: 'Resultado não confirmado' }], total: 4, message: '', updatedAt: 0, ...extraStatus },
  circuloControl: { runId: 'previous', criterion: 'not-following-back', tabId: 11, owner: 'ana', queue: ['alice', 'uncertain', 'bob', 'carol'], pending: null, ...extraControl }
});

async function testBackground() {
  const fixture = await backgroundFixture();
  assert.equal((await fixture.message({ type: 'CIRCULO_STATUS' })).state, 'idle');
  assert.equal((await fixture.message({ type: 'CIRCULO_STATUS' }, { id: 'fixture', url: 'chrome-extension://fixture/index.html#lista' })).state, 'idle');
  assert.equal((await fixture.message({ type: 'CIRCULO_START', usernames: ['a'] })).state, 'error');
  let run = await fixture.message({ type: 'CIRCULO_START', usernames: [' @Alice ', 'alice', 'bob'], confirmed: true, criterion: 'not-following-back' });
  assert.equal(run.state, 'running');
  assert.equal(run.total, 2);
  assert.deepEqual(Array.from(run.usernames), ['alice', 'bob']);
  assert.equal((await fixture.message({ type: 'CIRCULO_RESET' })).reset, false);
  const runId = fixture.data().circuloControl.runId;
  const progress = (type, extra = {}, sender = fixture.content) => fixture.message({ type, runId, ...extra }, sender);
  assert.equal((await progress('CIRCULO_ITEM_BEGIN', { username: 'alice' }, { ...fixture.content, tab: { id: 99 } })).allowed, false);
  assert.equal((await progress('CIRCULO_ITEM_BEGIN', { username: 'stranger' })).allowed, false);
  assert.equal((await progress('CIRCULO_ITEM_BEGIN', { username: 'alice' })).allowed, true);
  assert.equal((await progress('CIRCULO_ITEM_ARM', { username: 'alice' })).allowed, true);
  assert.equal((await progress('CIRCULO_ITEM_RESULT', { username: 'alice', outcome: 'completed' })).accepted, true);
  assert.equal((await progress('CIRCULO_ITEM_RESULT', { username: 'alice', outcome: 'completed' })).accepted, false);
  await fixture.message({ type: 'CIRCULO_PAUSE' });
  assert.equal((await progress('CIRCULO_ITEM_BEGIN', { username: 'bob' })).allowed, false);
  assert.equal((await fixture.message(confirmedResume(['bob']))).state, 'running');
  await progress('CIRCULO_ITEM_BEGIN', { username: 'bob' });
  await progress('CIRCULO_ITEM_ARM', { username: 'bob' });
  fixture.update(11, { status: 'loading' });
  run = await fixture.message({ type: 'CIRCULO_STATUS' });
  assert.equal(run.state, 'completed');
  assert.deepEqual(Array.from(run.completed), ['alice']);
  assert.equal(run.skipped[0].username, 'bob');
  assert.equal((await fixture.message(confirmedResume(['bob']))).state, 'completed');
  assert.equal(fixture.data().circuloRun.state, 'completed');
  fixture.setInfo({ ready: true, owner: 'ana', runner: null });
  const cleared = await fixture.message({ type: 'CIRCULO_RESET' });
  assert.equal(cleared.reset, true);
  assert.equal(cleared.state, 'idle');
  assert.deepEqual(Array.from(cleared.usernames), []);
  assert.equal((await fixture.message({ type: 'CIRCULO_START', confirmed: true, criterion: 'not-following-back', usernames: ['x'] }, { id: 'other', url: 'https://bad.example/' })).allowed, false);

  const interrupted = await backgroundFixture({
    circuloRun: { state: 'running', current: 'x', completed: [], skipped: [], total: 1, message: '', updatedAt: 0 },
    circuloControl: { runId: 'previous', criterion: 'not-following-back', tabId: 11, owner: 'ana', queue: ['x'], pending: { username: 'x', phase: 'armed' } }
  });
  assert.equal((await interrupted.message({ type: 'CIRCULO_STATUS' })).state, 'completed');
  const recovered = await interrupted.message(confirmedResume(['x']));
  assert.equal(recovered.state, 'completed');
  assert.equal(recovered.skipped[0].username, 'x');
  assert.equal(interrupted.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
  console.log('PASS background: authorization, exact queue, deduplication, pause, reload uncertainty, restart recovery');
}


 test('Background: autorização, fila, pausa e recuperação', testBackground);

test('Reabrir o navegador preserva os resultados e exige revisar a retomada', async () => {
  const fixture = await backgroundFixture(savedRun('running'));
  const run = await fixture.message({ type: 'CIRCULO_STATUS' });
  assert.equal(run.state, 'paused');
  assert.equal(run.canResume, true);
  assert.equal(run.remainingCount, 2);
  assert.equal(run.owner, 'ana');
  assert.deepEqual(Array.from(run.usernames), ['alice', 'uncertain', 'bob', 'carol']);
  assert.equal(fixture.data().circuloRun.remainingCount, 2);
  assert.equal(fixture.data().circuloRun.canResume, true);
  await fixture.message({ type: 'CIRCULO_RESUME' });
  await fixture.message({ type: 'CIRCULO_RESUME', confirmed: true, criterion: 'not-following-back' });
  assert.equal(fixture.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
  const resumed = await fixture.message(confirmedResume(['bob', 'carol']));
  assert.equal(resumed.state, 'running');
  assert.deepEqual(Array.from(resumed.completed), ['alice']);
  assert.deepEqual(Array.from(fixture.commands.find(command => command.type === 'CIRCULO_WORKER_RUN').usernames), ['bob', 'carol']);
});

test('Aba fechada permite retomar em uma nova aba da mesma conta', async () => {
  const fixture = await backgroundFixture();
  await fixture.message({ type: 'CIRCULO_START', usernames: ['bob', 'carol'], confirmed: true, criterion: 'not-following-back' });
  const runId = fixture.data().circuloControl.runId;
  fixture.remove(11);
  const stopped = await fixture.message({ type: 'CIRCULO_STATUS' });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.canResume, true);
  assert.match(stopped.message, /fechada.*preservada/);
  fixture.setInfo({ ready: true, owner: 'ana', runner: null }, 22);
  const resumed = await fixture.message(confirmedResume(['bob', 'carol']));
  assert.equal(resumed.state, 'running');
  assert.equal(fixture.data().circuloControl.tabId, 22);
  assert.equal(fixture.data().circuloControl.runId, runId);
  assert.equal((await fixture.message({ type: 'CIRCULO_ITEM_BEGIN', runId, username: 'bob' }, fixture.content)).allowed, false);
  assert.equal((await fixture.message({ type: 'CIRCULO_ITEM_BEGIN', runId, username: 'bob' }, { ...fixture.content, tab: { id: 22 } })).allowed, true);
});

test('Retomada recusa conta errada, múltiplas listas e identidade original ausente', async () => {
  const fixture = await backgroundFixture(savedRun());
  fixture.removeQuietly(11);
  fixture.setInfo({ ready: true, owner: 'outra', runner: null }, 22);
  assert.match((await fixture.message(confirmedResume(['bob', 'carol']))).message, /pertence a @ana/);
  assert.equal(fixture.data().circuloControl.tabId, 11);
  fixture.setInfo({ ready: true, owner: 'ana', runner: null }, 33);
  assert.match((await fixture.message(confirmedResume(['bob', 'carol']))).message, /mais de uma lista/);
  assert.equal(fixture.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
  const noOwner = await backgroundFixture(savedRun('stopped', { owner: undefined }));
  assert.equal((await noOwner.message({ type: 'CIRCULO_STATUS' })).canResume, false);
  assert.match((await noOwner.message(confirmedResume(['bob', 'carol']))).message, /conta original/);
  assert.equal(noOwner.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
});

test('Retomada não substitui outro runner nem transfere uma ação ainda ativa', async () => {
  const fixture = await backgroundFixture(savedRun());
  fixture.setInfo({ ready: true, owner: 'ana', runner: { active: true, runId: 'different', state: 'running' } });
  assert.match((await fixture.message(confirmedResume(['bob', 'carol']))).message, /Outra execução/);
  assert.equal(fixture.data().circuloControl.runId, 'previous');
  fixture.setInfo({ ready: false, owner: 'ana', runner: { active: true, runId: 'previous', state: 'paused' } });
  fixture.setInfo({ ready: true, owner: 'ana', runner: null }, 22);
  assert.match((await fixture.message(confirmedResume(['bob', 'carol']))).message, /aba anterior/);
  assert.equal(fixture.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
});

test('Consultar status detecta runner inativo sem executar ações', async () => {
  const fixture = await backgroundFixture();
  await fixture.message({ type: 'CIRCULO_START', usernames: ['bob', 'carol'], confirmed: true, criterion: 'not-following-back' });
  fixture.setInfo({ ready: true, owner: 'ana', runner: null });
  const before = fixture.commands.filter(command => command.type === 'CIRCULO_WORKER_RUN').length;
  const run = await fixture.message({ type: 'CIRCULO_STATUS' });
  assert.equal(run.state, 'paused');
  assert.equal(run.canResume, true);
  assert.equal(run.remainingCount, 2);
  assert.equal(fixture.commands.filter(command => command.type === 'CIRCULO_WORKER_RUN').length, before);
});

test('Consultar status pausa runner quando a conta aberta muda', async () => {
  const fixture = await backgroundFixture();
  await fixture.message({ type: 'CIRCULO_START', usernames: ['bob', 'carol'], confirmed: true, criterion: 'not-following-back' });
  const runId = fixture.data().circuloControl.runId;
  fixture.setInfo({ ready: true, owner: 'outra', runner: { active: true, runId, state: 'running' } });
  const run = await fixture.message({ type: 'CIRCULO_STATUS' });
  assert.equal(run.state, 'paused');
  assert.match(run.message, /pertence a @ana/);
  assert.equal(fixture.commands.at(-1).type, 'CIRCULO_WORKER_CONTROL');
  assert.equal(fixture.commands.at(-1).state, 'paused');
});

test('Resultado incerto é separado antes de trocar de aba e nunca é repetido', async () => {
  const fixture = await backgroundFixture(savedRun('stopped', { pending: { username: 'bob', phase: 'armed' } }));
  fixture.removeQuietly(11);
  fixture.setInfo({ ready: true, owner: 'ana', runner: null }, 22);
  const resumed = await fixture.message(confirmedResume(['bob', 'carol']));
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.skipped.find(item => item.username === 'bob').reason.includes('não confirmado'), true);
  assert.deepEqual(Array.from(fixture.commands.find(command => command.type === 'CIRCULO_WORKER_RUN').usernames), ['carol']);
  assert.deepEqual(Array.from(resumed.completed), ['alice']);
});

test('Encerrar preserva a fila; retomar respeita exclusões da revisão', async () => {
  const fixture = await backgroundFixture();
  await fixture.message({ type: 'CIRCULO_START', usernames: ['bob', 'carol'], confirmed: true, criterion: 'not-following-back' });
  const stopped = await fixture.message({ type: 'CIRCULO_STOP' });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.canResume, true);
  assert.match(stopped.message, /Você encerrou.*preservada/);
  fixture.setInfo({ ready: true, owner: 'ana', runner: null });
  const resumed = await fixture.message(confirmedResume(['carol']));
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.remainingCount, 1);
  assert.equal(resumed.skipped.find(item => item.username === 'bob').reason.includes('Excluída da seleção'), true);
  assert.deepEqual(Array.from(fixture.commands.filter(command => command.type === 'CIRCULO_WORKER_RUN').at(-1).usernames), ['carol']);
});

test('Revisão alterada aguarda runner ativo parar antes de retomar', async () => {
  const fixture = await backgroundFixture(savedRun('paused'));
  fixture.setInfo({ ready: true, owner: 'ana', runner: { active: true, runId: 'previous', state: 'paused' } });
  const response = await fixture.message(confirmedResume(['carol']));
  assert.equal(response.state, 'paused');
  assert.match(response.message, /seleção foi alterada/);
  assert.equal(fixture.commands.at(-1).type, 'CIRCULO_WORKER_CONTROL');
  assert.equal(fixture.commands.at(-1).state, 'stopped');
  assert.equal(fixture.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
  fixture.setInfo({ ready: true, owner: 'ana', runner: null });
  assert.equal((await fixture.message(confirmedResume(['carol']))).state, 'running');
  assert.deepEqual(Array.from(fixture.commands.find(command => command.type === 'CIRCULO_WORKER_RUN').usernames), ['carol']);
});

test('Retomada rejeita contas concluídas, ignoradas ou externas à fila', async () => {
  const fixture = await backgroundFixture(savedRun());
  for (const usernames of [['alice'], ['uncertain'], ['stranger'], ['bob', 'stranger']]) {
    assert.match((await fixture.message(confirmedResume(usernames))).message, /apenas contas restantes/);
  }
  assert.equal(fixture.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
});

test('Fila sem pendências libera nova revisão e fila concluída não é retomada', async () => {
  const fixture = await backgroundFixture(savedRun('stopped', { queue: ['alice', 'uncertain'] }));
  const status = await fixture.message({ type: 'CIRCULO_STATUS' });
  assert.equal(status.state, 'completed');
  assert.equal(status.canResume, false);
  assert.equal(status.remainingCount, 0);
  assert.equal((await fixture.message(confirmedResume(['alice']))).state, 'completed');
  assert.equal(fixture.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
  assert.equal((await fixture.message({ type: 'CIRCULO_RESET' })).reset, true);
});

test('Nova execução exige que a aba pronta identifique a conta conectada', async () => {
  const fixture = await backgroundFixture();
  fixture.setInfo({ ready: true, owner: null, runner: null });
  const run = await fixture.message({ type: 'CIRCULO_START', usernames: ['bob'], confirmed: true, criterion: 'not-following-back' });
  assert.equal(run.state, 'error');
  assert.match(run.message, /identificar a conta conectada/);
  assert.equal(fixture.commands.some(command => command.type === 'CIRCULO_WORKER_RUN'), false);
  assert.equal(fixture.data().circuloControl, null);
});


