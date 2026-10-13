import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as dataCore from '../extensao/data-core.js';

// A small DOM adapter executes the real dashboard module. These tests cover
// persistence/import/export semantics; layout and browser automation are separate.
const source = await readFile(new URL('../extensao/app.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const person = (username, followedAt = null, followsYou = false) => ({ username, followedAt, followsYou });
const workspace = overrides => ({ version: 1, demo: false, importedAt: 123, people: [person('alice'), person('bob')], protected: [], selected: [], queue: [], history: [], ...overrides });

function dashboard(saved = null, options = {}) {
  const nodes = new Map();
  const blobs = [];
  const storage = new Map(saved ? [['circulo.workspace.v1', JSON.stringify(saved)]] : []);
  const calls=[];
  const node = selector => {
    if (nodes.has(selector)) return nodes.get(selector);
    const element = {
      textContent: '', innerHTML: '', value: '', hidden: false, open: false, disabled: false, checked: false, isConnected: true,
      dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}, setAttribute() {}, focus() {}, click() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector: selector => node(selector), querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    };
    nodes.set(selector, element);
    return element;
  };
  const document = {
    querySelector: selector => node(selector), querySelectorAll: () => [], addEventListener() {},
    body: node('body'), activeElement: node('active'), createElement: tag => node(`created:${tag}`),
  };
  class TestURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return 'blob:circulo-test'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({
    ...dataCore, document, Blob, URL: TestURL, Intl, Date, location: { protocol: options.extension?'chrome-extension:':'http:' },
    chrome:{runtime:{id:'fixture',sendMessage:async message=>{calls.push(message);return options.respond?.(message);}},storage:{onChanged:{addListener(){}}}},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {}, console,
  });
  const instrumentation = `\nglobalThis.testApp = {
    readState, commitImport, importFiles, getVisible, prepareQueue, eligibleNames, queuePayload, updateRun, refreshRun, pendingQueueNames, canResumeRun,
    getState: () => state, setState: value => { state = value; },
    setSort: value => { sort = value; }, setRun: value => { run = value; },
    setSearch: value => { search = value; }, setPage: value => { page = value; }
    , getRun: () => run, isReady: () => extensionReady
  };`;
  vm.runInContext(source.replace(/^import .*?;\r?\n/, '') + instrumentation, context, { filename: 'app.js' });
  return { app: context.testApp, node, blobs, storage, calls };
}

test('dashboard reload keeps imported data when the saved queue is empty', () => {
  const { app } = dashboard(workspace());
  assert.equal(app.getState().demo, false);
  assert.deepEqual(plain(app.getState().people).map(p => p.username), ['alice', 'bob']);
  assert.deepEqual(plain(app.getState().queue), []);
});

test('dashboard reload retains a nonempty exported queue', () => {
  const { app } = dashboard(workspace({ queue: ['alice', 'bob'] }));
  assert.equal(app.getState().demo, false);
  assert.deepEqual(plain(app.getState().queue), ['alice', 'bob']);
});

test('queue download is valid JSON accepted by the real queue parser', async () => {
  const { app, node, blobs } = dashboard();
  app.setState(workspace({ queue: ['alice', 'bob'] }));
  node('#queue-export').onclick();
  assert.equal(blobs.length, 1);
  assert.deepEqual(dataCore.parseQueue(await blobs[0].text()), ['alice', 'bob']);
});

test('reimport preserves removal history even when an updated snapshot omits the removed account', () => {
  const { app } = dashboard();
  app.setState(workspace({ history: [{ username: 'alice', at: 123 }] }));
  app.commitImport([person('bob')]);
  assert.deepEqual(plain(app.getState().history), [{ username: 'alice', at: 123 }]);
  app.commitImport([person('alice'), person('bob')]);
  assert.deepEqual(plain(app.getVisible()).map(p => p.username), ['bob']);
});

test('reload preserves removal history for usernames absent from the current snapshot', () => {
  const { app } = dashboard(workspace({ people: [person('bob')], history: [{ username: 'alice', at: 123 }] }));
  assert.deepEqual(plain(app.getState().history), [{ username: 'alice', at: 123 }]);
});

test('queue import adds missing usernames, excludes protected/completed accounts, and resets selection', async () => {
  const { app } = dashboard();
  app.setState(workspace({ protected: ['alice'], history: [{ username: 'bob', at: 1 }], selected: ['old_user'] }));
  const queueText = JSON.stringify({...dataCore.exportQueue(['alice','bob','carol']),criterion:'not-following-back',comparison:{accounts:['alice','bob','carol'].map(username=>({username,followsYou:false}))}});
  await app.importFiles([{ name: 'circulo-fila.json', size: queueText.length, text: async () => queueText }]);
  assert.deepEqual(plain(app.getState().queue), ['carol']);
  assert.deepEqual(plain(app.getState().selected), ['carol']);
  assert.equal(app.getState().demo, false);
  assert.ok(app.getState().people.some(p => p.username === 'carol' && p.followsYou === false));
});

test('a corrupt import preserves the existing workspace instead of replacing it', async () => {
  const { app, node } = dashboard();
  const before = workspace({ protected: ['alice'] });
  app.setState(before);
  await app.importFiles([{ name: 'following.json', size: 1, text: async () => '{' }]);
  assert.deepEqual(plain(app.getState()), before);
  assert.match(node('#import-message').textContent, /JSON inválido/);
});

test('date sorting keeps unknown dates last for oldest and newest orders', () => {
  const { app } = dashboard();
  app.setState(workspace({ people: [person('unknown'), person('newer', 3000), person('older', 1000)] }));
  app.setSort('oldest');
  assert.deepEqual(plain(app.getVisible()).map(p => p.username), ['older', 'newer', 'unknown']);
  app.setSort('newest');
  assert.deepEqual(plain(app.getVisible()).map(p => p.username), ['newer', 'older', 'unknown']);
});

test('only nonfollowers are eligible; mutual, unknown, protected and completed accounts stay out', () => {
  const { app } = dashboard(workspace({people:[person('mutual',null,true),person('unknown',null,null),person('nonfollower'),person('protected'),person('completed')],protected:['protected'],history:[{username:'completed',at:1}]}));
  assert.deepEqual(plain(app.eligibleNames(['mutual','unknown','nonfollower','protected','completed'])),['nonfollower']);
});

test('queue export includes comparison and never exports mutual or unknown accounts', () => {
  const { app } = dashboard(workspace({people:[person('mutual',null,true),person('unknown',null,null),person('nonfollower')]}));
  const payload=plain(app.queuePayload(['mutual','unknown','nonfollower']));
  assert.equal(payload.criterion,'not-following-back');
  assert.deepEqual(payload.usernames,['nonfollower']);
  assert.equal(payload.comparison.accounts[0].followsYou,false);
});

test('an old queue without comparison cannot replace the workspace or authorize actions', async () => {
  const { app, node } = dashboard(workspace());
  const before=plain(app.getState());
  const text=JSON.stringify(dataCore.exportQueue(['carol']));
  await app.importFiles([{name:'fila.json',size:text.length,text:async()=>text}]);
  assert.deepEqual(plain(app.getState()),before);
  assert.match(node('#import-message').textContent,/não contém a comparação/);
});

test('followers imported later compare the existing following list and unlock only nonfollowers', async () => {
  const { app } = dashboard(workspace({people:[person('alice',null,null),person('bob',null,null)]}));
  const text=JSON.stringify([{string_list_data:[{value:'alice',timestamp:1700000000}]}]);
  await app.importFiles([{name:'followers_1.json',size:text.length,text:async()=>text}]);
  assert.deepEqual(plain(app.getState().people).map(p=>[p.username,p.followsYou]),[['alice',true],['bob',false]]);
  assert.deepEqual(plain(app.eligibleNames(['alice','bob'])),['bob']);
});

test('select all includes nonfollowers across pages despite search and excludes mutual, protected and completed accounts', () => {
  const people=Array.from({length:23},(_,i)=>person(`person${i}`));
  people.push(person('mutual',null,true),person('unknown',null,null));
  const {app,node,storage}=dashboard(workspace({people,protected:['person4'],history:[{username:'person9',at:1}]}));
  app.setSearch('person1');
  app.setPage(2);
  node('#select-all-nonfollowers').onclick();
  const selected=plain(app.getState().selected);
  assert.equal(selected.length,21);
  assert.ok(selected.includes('person0'));
  assert.ok(selected.includes('person22'));
  for(const excluded of ['person4','person9','mutual','unknown'])assert.ok(!selected.includes(excluded));
  assert.equal(JSON.parse(storage.get('circulo.workspace.v1')).selected.length,21);
  assert.match(node('#select-all-nonfollowers').textContent,/Todos os 21 estão selecionados/);
  app.prepareQueue();
  assert.ok(node('#modal-content').innerHTML.includes('@person22'));
});

test('select all preserves the selection while a run is paused', () => {
  const {app,node}=dashboard(workspace({people:[person('alice'),person('bob')],selected:['alice']}));
  app.setRun({state:'paused',completed:[],skipped:[]});
  node('#select-all-nonfollowers').onclick();
  assert.deepEqual(plain(app.getState().selected),['alice']);
});

test('reopened extension surfaces a saved paused run and reviews only unfinished eligible accounts', async () => {
  const savedRun={state:'paused',owner:'owner',usernames:['alice','bob','carol'],completed:['alice'],skipped:[{username:'bob',reason:'Resultado incerto'}],total:3,canResume:true,remainingCount:1,updatedAt:123};
  const {app,node,calls}=dashboard(workspace({people:[person('alice'),person('bob'),person('carol')],queue:['alice','bob','carol'],selected:['carol']}),{extension:true,respond:message=>({...savedRun,state:message.type==='CIRCULO_RESUME'?'running':'paused'})});
  await app.refreshRun();
  assert.equal(node('#recovery-banner').hidden,false);
  assert.equal(node('#recovery-resume').hidden,false);
  assert.equal(node('#prepare-queue').hidden,true);
  assert.deepEqual(plain(app.pendingQueueNames()),['carol']);
  assert.equal(calls.some(m=>m.type==='CIRCULO_RESUME'||m.type==='CIRCULO_START'),false);
  node('#recovery-resume').onclick();
  const review=node('#modal-content').innerHTML;
  assert.ok(review.includes('@carol'));
  assert.ok(!review.includes('@alice')&&!review.includes('@bob'));
  node('#confirm-ownership').checked=true;
  node('#confirm-ownership').onchange({target:node('#confirm-ownership')});
  await node('#review-confirm').onclick();
  const resume=calls.find(m=>m.type==='CIRCULO_RESUME');
  assert.deepEqual(plain(resume.usernames),['carol']);
  assert.equal(resume.confirmed,true);
  assert.equal(resume.criterion,'not-following-back');
});

test('connection loss preserves progress, blocks editing and can reconnect without executing', async () => {
  let fail=false;
  const savedRun={state:'paused',owner:'owner',usernames:['alice','bob'],completed:['alice'],skipped:[],total:2,canResume:true,remainingCount:1};
  const {app,node,calls}=dashboard(workspace({people:[person('alice'),person('bob')],queue:['alice','bob']}),{extension:true,respond:()=>{if(fail)throw Error('disconnected');return savedRun;}});
  await app.refreshRun();
  fail=true;
  await app.refreshRun();
  assert.equal(app.isReady(),false);
  assert.deepEqual(plain(app.getRun().completed),['alice']);
  assert.ok(app.getState().history.some(h=>h.username==='alice'));
  assert.equal(node('#select-all-nonfollowers').disabled,true);
  assert.equal(node('#recovery-banner').hidden,false);
  fail=false;
  await node('#recovery-refresh').onclick();
  assert.equal(app.isReady(),true);
  assert.equal(node('#recovery-resume').hidden,false);
  assert.ok(calls.every(m=>m.type==='CIRCULO_STATUS'));
});

test('a stopped run resumes only reviewed names and respects protections added after stopping', async () => {
  const savedRun={state:'stopped',owner:'owner',usernames:['alice','bob'],completed:[],skipped:[],total:2,canResume:true,remainingCount:2};
  const {app,node,calls}=dashboard(workspace({people:[person('alice'),person('bob')],queue:['alice','bob'],protected:['bob']}),{extension:true,respond:()=>savedRun});
  await app.refreshRun();
  node('#recovery-resume').onclick();
  node('#confirm-ownership').checked=true;
  await node('#review-confirm').onclick();
  assert.deepEqual(plain(calls.find(m=>m.type==='CIRCULO_RESUME').usernames),['alice']);
});

test('progress report separates completed, uncertain and pending accounts', async () => {
  const {app,node,blobs}=dashboard(workspace({people:[person('alice'),person('bob'),person('carol')],queue:['alice','bob','carol']}));
  app.updateRun({state:'paused',owner:'owner',completed:['alice'],skipped:[{username:'bob',reason:'Resultado incerto'}]});
  node('#queue-report').onclick();
  const report=JSON.parse(await blobs[0].text());
  assert.equal(report.format,'circulo-progress');
  assert.deepEqual(report.completed,['alice']);
  assert.equal(report.skipped[0].username,'bob');
  assert.deepEqual(report.pending,['carol']);
});
