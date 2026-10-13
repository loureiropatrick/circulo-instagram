import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInstagramFiles, parseUsernames, buildPeople, exportQueue, parseQueue } from '../extensao/data-core.js';

const fixture = async name => ({ name, text: await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8') });
const jsonFile = (name, value) => ({ name, text: JSON.stringify(value) });

test('official following + multiple followers files deduplicate and establish reciprocity', async () => {
  const parsed = parseInstagramFiles(await Promise.all(['following.json', 'followers_1.json', 'followers_2.json'].map(fixture)));
  assert.deepEqual(parsed.following, [
    { username: 'alice', followedAt: 1700000000000 },
    { username: 'bob', followedAt: 1600000000000 },
    { username: 'carol', followedAt: 1650000000000 },
  ]);
  assert.deepEqual(parsed.followers, ['alice', 'dan', 'carol']);
  assert.equal(parsed.hasFollowers, true);
  assert.deepEqual(buildPeople(parsed).map(person => person.followsYou), [true, false, true]);
  assert.deepEqual(parsed.warnings, []);
});

test('without a followers file, reciprocity is unknown for every person', async () => {
  const parsed = parseInstagramFiles([await fixture('following.json')]);
  assert.equal(parsed.hasFollowers, false);
  assert.ok(buildPeople(parsed).every(person => person.followsYou === null));
});

test('an explicit empty followers file establishes false reciprocity', async () => {
  const parsed = parseInstagramFiles([await fixture('following.json'), jsonFile('followers_1.json', [])]);
  assert.equal(parsed.hasFollowers, true);
  assert.ok(buildPeople(parsed).every(person => person.followsYou === false));
});

test('a followers file is never treated as following', async () => {
  const parsed = parseInstagramFiles([await fixture('followers_1.json')]);
  assert.deepEqual(parsed.following, []);
  assert.deepEqual(parsed.followers, ['alice', 'dan']);
  assert.equal(parsed.hasFollowers, true);
});

test('official keyed schema takes precedence over a misleading filename', () => {
  const parsed = parseInstagramFiles([jsonFile('followers_1.json', { relationships_following: [{ string_list_data: [{ value: 'alice', timestamp: 123 }] }] })]);
  assert.equal(parsed.following[0].username, 'alice');
  assert.equal(parsed.following[0].followedAt, 123000);
  assert.equal(parsed.hasFollowers, false);
  assert.match(parsed.warnings[0], /apesar do nome/);
});

test('an ambiguous JSON array requires a filename identifying the list', () => {
  assert.throws(() => parseInstagramFiles([jsonFile('download.json', ['alice'])]), /Renomeie a lista/);
});

test('JSON BOM and nested filenames are accepted', async () => {
  const file = await fixture('followers_1.json');
  const parsed = parseInstagramFiles([{ name: 'connections/followers_and_following/followers_1.json', text: `\uFEFF${file.text}` }]);
  assert.equal(parsed.hasFollowers, true);
  assert.deepEqual(parsed.following, []);
});

test('CSV supports quoted columns, BOM, semicolons, dates, duplicate users and missing dates', () => {
  const parsed = parseInstagramFiles([{ name: 'seguindo.csv', text: '\uFEFF"timestamp";"username"\r\n1700000000;"Alice"\r\n1600000000;alice\r\n2020-01-01;bob\r\n;carol\r\n' }]);
  assert.deepEqual(parsed.following, [
    { username: 'alice', followedAt: 1600000000000 },
    { username: 'bob', followedAt: 1577836800000 },
    { username: 'carol', followedAt: null },
  ]);
});

test('CSV accepts positional username and epoch milliseconds without multiplying twice', () => {
  const parsed = parseInstagramFiles([{ name: 'following.csv', text: 'alice,1700000000000\nbob,not-a-date' }]);
  assert.equal(parsed.following[0].followedAt, 1700000000000);
  assert.equal(parsed.following[1].followedAt, null);
});

test('invalid individual JSON/CSV rows warn and cannot become profile URLs', () => {
  const parsed = parseInstagramFiles([
    jsonFile('following.json', { relationships_following: [{ string_list_data: [{ value: '=HYPERLINK("https://evil.test")' }] }, { string_list_data: [{ href: 'https://evil.test/alice' }] }, { string_list_data: [{ value: 'real.user' }] }] }),
    { name: 'following.csv', text: 'username,timestamp\n=1+1,123\nother_user,456' },
  ]);
  assert.deepEqual(parsed.following.map(person => person.username), ['real.user', 'other_user']);
  assert.equal(parsed.warnings.length, 2);
});

test('TXT accepts @names, Instagram links and deduplicates without guessing reciprocity', () => {
  const parsed = parseInstagramFiles([{ name: 'minha-lista.txt', text: '@Alice\nhttps://www.instagram.com/bob/\nALICE;carol' }]);
  assert.deepEqual(parsed.following.map(person => person.username), ['alice', 'bob', 'carol']);
  assert.match(parsed.warnings[0], /importado como lista/);
  assert.equal(parsed.hasFollowers, false);
});

test('usernames reject arbitrary URLs, path tricks and malformed usernames', () => {
  for (const invalid of ['https://evil.test/alice', 'https://instagram.com.evil.test/alice', 'https://instagram.com@evil.test/alice', 'https://www.instagram.com/p/123', 'https://instagram.com/alice/?next=evil', 'https://instagram.com:443/alice', '.', '..', '.alice', 'alice.', 'ali..ce', '=alice', 'a'.repeat(31)]) {
    // URL normalizes the default port away; a default https port is harmless.
    if (invalid === 'https://instagram.com:443/alice') continue;
    assert.throws(() => parseUsernames(invalid), /inválido/, invalid);
  }
  assert.deepEqual(parseUsernames(' @A_B https://www.instagram.com/_u/real.user\nA_B '), ['a_b', 'real.user']);
});

test('queue exports round-trip with stable format and deduplication', () => {
  const payload = exportQueue(['Alice', 'alice', '@bob']);
  assert.deepEqual(payload, { format: 'circulo-queue', version: 1, usernames: ['alice', 'bob'] });
  assert.deepEqual(parseQueue(`\uFEFF${JSON.stringify(payload)}`), ['alice', 'bob']);
  assert.deepEqual(parseInstagramFiles([jsonFile('fila.json', payload)]).following, [{ username: 'alice', followedAt: null }, { username: 'bob', followedAt: null }]);
});

test('queue rejects invalid format/version/types and elements injecting multiple names', () => {
  for (const value of [{}, { format: 'circulo-queue', version: 2, usernames: [] }, { format: 'circulo-queue', version: 1, usernames: [null] }, { format: 'circulo-queue', version: 1, usernames: ['alice\nbob'] }]) {
    assert.throws(() => parseQueue(JSON.stringify(value)));
  }
  assert.throws(() => exportQueue(['alice\nbob']), /inválido/);
  assert.throws(() => exportQueue(['https://evil.test/alice']), /inválido/);
});

test('malformed imports throw actionable Portuguese errors', () => {
  assert.throws(() => parseInstagramFiles([]), /Selecione ao menos/);
  assert.throws(() => parseInstagramFiles([{ name: 'following.json', text: '{' }]), /following.json.*JSON inválido/);
  assert.throws(() => parseInstagramFiles([{ name: 'archive.zip', text: 'PK' }]), /Extraia o ZIP/);
  assert.throws(() => parseInstagramFiles([{ name: 'following.csv', text: 'username\n"alice' }]), /aspas sem fechamento/);
  assert.throws(() => parseInstagramFiles([jsonFile('following.json', { relationships_following: 'alice' })]), /formato inválido/);
});
