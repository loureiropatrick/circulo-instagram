/** Local import helpers. All returned followedAt values are Unix milliseconds. */
const USERNAME = /^(?=.{1,30}$)(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]+$/i;
const USER_HEADERS = new Set(['username', 'user', 'usuario', 'nome_de_usuario', 'profile', 'profile_url', 'perfil']);
const TIME_HEADERS = new Set(['timestamp', 'followedat', 'followed_at', 'date', 'data', 'since', 'seguindo_desde']);

function cleanText(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function normalizeUsername(value) {
  let name = cleanText(value);
  if (/^https?:\/\//i.test(name)) {
    let url;
    try { url = new URL(name); } catch { return null; }
    if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.port || url.search || url.hash) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === '_u') parts.shift();
    if (parts.length !== 1) return null;
    name = parts[0];
  }
  name = name.replace(/^@/, '').toLowerCase();
  return USERNAME.test(name) ? name : null;
}

function invalidNamesMessage(values) {
  const sample = values.slice(0, 3).map(value => `“${String(value).slice(0, 60)}”`).join(', ');
  return `Nome de usuário inválido: ${sample}. Use nomes do Instagram com até 30 letras, números, pontos ou sublinhados, ou links de perfil instagram.com.`;
}

/** Accepts @names and Instagram profile URLs, separated by whitespace, commas or semicolons. */
export function parseUsernames(text) {
  if (typeof text !== 'string') throw new Error('A lista de usuários precisa ser um texto.');
  const tokens = cleanText(text).split(/[\s,;]+/).filter(Boolean);
  const names = new Set();
  const invalid = [];
  for (const token of tokens) {
    const username = normalizeUsername(token);
    if (username) names.add(username);
    else invalid.push(token);
  }
  if (invalid.length) throw new Error(invalidNamesMessage(invalid));
  return [...names];
}

function timestampMs(value) {
  if (value === null || value === undefined || cleanText(value) === '') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    // CSV may contain an ISO date. Avoid locale-dependent date interpretation.
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value.trim())) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  // Official exports use epoch seconds; also tolerate epoch milliseconds.
  const result = number < 1e11 ? number * 1000 : number;
  return result <= 8640000000000000 ? Math.trunc(result) : null;
}

function filenameKind(name) {
  const filename = String(name).split(/[\\/]/).pop().toLowerCase();
  if (/(?:^|[^a-z])(?:followers?)(?:[^a-z]|$)|seguidores/.test(filename)) return 'followers';
  if (/(?:^|[^a-z])(?:following)(?:[^a-z]|$)|seguindo/.test(filename)) return 'following';
  return null;
}

function recordsFromEntries(entries) {
  const records = [];
  let invalid = 0;
  for (const entry of entries) {
    const values = Array.isArray(entry?.string_list_data) ? entry.string_list_data : [entry];
    for (const value of values) {
      const raw = typeof value === 'string' ? value : value?.value ?? value?.username ?? value?.href;
      const username = normalizeUsername(raw);
      if (!username) { invalid += 1; continue; }
      records.push({ username, followedAt: timestampMs(value?.timestamp ?? value?.followedAt ?? value?.followed_at) });
    }
  }
  return { records, invalid };
}

function readJson(text, name) {
  try { return JSON.parse(cleanText(text)); }
  catch { throw new Error(`Não foi possível ler “${name}”: JSON inválido. Importe o arquivo original extraído da exportação do Instagram.`); }
}

function jsonLists(data, name, warnings) {
  const lists = [];
  const inferredKind = filenameKind(name);
  const add = (kind, entries) => {
    if (!Array.isArray(entries)) throw new Error(`A lista ${kind === 'followers' ? 'de seguidores' : 'seguindo'} em “${name}” tem um formato inválido.`);
    lists.push({ kind, ...recordsFromEntries(entries) });
  };
  if (data && !Array.isArray(data) && typeof data === 'object') {
    if (data.format === 'circulo-queue') {
      lists.push({ kind: 'following', records: parseQueue(JSON.stringify(data)).map(username => ({ username, followedAt: null })), invalid: 0 });
      return lists;
    }
    if (Object.hasOwn(data, 'relationships_following')) add('following', data.relationships_following);
    if (Object.hasOwn(data, 'relationships_followers')) add('followers', data.relationships_followers);
    if (Object.hasOwn(data, 'following')) add('following', data.following);
    if (Object.hasOwn(data, 'followers')) add('followers', data.followers);
    if (!lists.length) throw new Error(`O arquivo “${name}” não contém uma lista reconhecida. Procure following.json ou followers_1.json na exportação do Instagram.`);
    if (lists.length === 1 && inferredKind && inferredKind !== lists[0].kind) {
      warnings.push(`“${name}”: o conteúdo foi reconhecido como ${lists[0].kind === 'followers' ? 'seguidores' : 'seguindo'}, apesar do nome do arquivo.`);
    }
    return lists;
  }
  if (Array.isArray(data)) {
    // The current official followers export is an array with no enclosing key.
    // An unknown filename cannot establish whether this array means followers or following.
    if (!inferredKind) throw new Error(`Não foi possível identificar “${name}”. Renomeie a lista para following.json (seguindo) ou followers_1.json (seguidores) conforme seu conteúdo.`);
    add(inferredKind, data);
    return lists;
  }
  throw new Error(`O arquivo “${name}” não contém uma lista do Instagram.`);
}

function headerKey(value) {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s-]+/g, '_');
}

function parseCsvRows(text) {
  const firstLine = text.split(/\r?\n/).find(line => line.trim()) ?? '';
  const scores = [',', ';', '\t'].map(delimiter => {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < firstLine.length; i += 1) {
      if (firstLine[i] === '"') {
        if (quoted && firstLine[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (!quoted && firstLine[i] === delimiter) count += 1;
    }
    return { delimiter, count };
  });
  const delimiter = scores.sort((a, b) => b.count - a.count)[0].delimiter;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (!field || quoted) quoted = !quoted;
      else field += char;
    } else if (!quoted && char === delimiter) {
      row.push(field); field = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); if (row.some(value => value.trim())) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('O CSV contém aspas sem fechamento.');
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function textList(text, name, warnings) {
  const kind = filenameKind(name) ?? 'following';
  if (!filenameKind(name)) warnings.push(`“${name}” foi importado como lista de pessoas que você segue. Para importar seguidores, use “followers” ou “seguidores” no nome do arquivo.`);
  if (!/\.csv$/i.test(name)) {
    return { kind, records: parseUsernames(text).map(username => ({ username, followedAt: null })), invalid: 0 };
  }
  const rows = parseCsvRows(cleanText(text));
  const headers = (rows[0] ?? []).map(headerKey);
  const hasHeader = headers.some(header => USER_HEADERS.has(header));
  const userIndex = hasHeader ? headers.findIndex(header => USER_HEADERS.has(header)) : 0;
  const timeIndex = hasHeader ? headers.findIndex(header => TIME_HEADERS.has(header)) : 1;
  const records = [];
  let invalid = 0;
  for (const row of rows.slice(hasHeader ? 1 : 0)) {
    const username = normalizeUsername(row[userIndex]);
    if (!username) { invalid += 1; continue; }
    records.push({ username, followedAt: timestampMs(timeIndex < 0 ? null : row[timeIndex]) });
  }
  return { kind, records, invalid };
}

/**
 * Parses extracted official JSON exports, local CSV/TXT lists and Circulo queues.
 * A malformed file throws an error in Portuguese, keeping callers from silently
 * replacing good data with an incomplete import. Unusable individual rows warn.
 */
export function parseInstagramFiles(fileRecords) {
  if (!Array.isArray(fileRecords) || !fileRecords.length) throw new Error('Selecione ao menos um arquivo JSON, CSV ou TXT.');
  const following = new Map();
  const followers = new Set();
  const warnings = [];
  let hasFollowers = false;
  for (const file of fileRecords) {
    const name = cleanText(file?.name) || 'arquivo';
    if (typeof file?.text !== 'string') throw new Error(`Não foi possível ler “${name}” como texto.`);
    const text = cleanText(file.text);
    let lists;
    if (/\.json$/i.test(name) || /^[\[{]/.test(text)) lists = jsonLists(readJson(text, name), name, warnings);
    else if (/\.(?:txt|csv)$/i.test(name)) lists = [textList(text, name, warnings)];
    else throw new Error(`Formato não reconhecido em “${name}”. Extraia o ZIP do Instagram e importe arquivos JSON, CSV ou TXT.`);
    for (const list of lists) {
      if (list.invalid) warnings.push(`“${name}”: ${list.invalid} registro(s) sem nome de usuário válido foram ignorados.`);
      if (list.kind === 'followers') {
        hasFollowers = true;
        list.records.forEach(record => followers.add(record.username));
      } else {
        for (const record of list.records) {
          const existing = following.get(record.username);
          if (!existing) following.set(record.username, record);
          else if (record.followedAt !== null && (existing.followedAt === null || record.followedAt < existing.followedAt)) existing.followedAt = record.followedAt;
        }
      }
    }
  }
  return { following: [...following.values()], followers: [...followers], hasFollowers, warnings };
}

export function buildPeople(parsed) {
  const followers = new Set(parsed.followers ?? []);
  return (parsed.following ?? []).map(person => ({
    username: person.username,
    followedAt: person.followedAt ?? null,
    followsYou: parsed.hasFollowers ? followers.has(person.username) : null,
  }));
}

export function exportQueue(usernames) {
  if (!Array.isArray(usernames) || usernames.some(username => typeof username !== 'string')) throw new Error('A fila precisa ser uma lista de nomes de usuário.');
  const invalid = usernames.filter(name => !normalizeUsername(name));
  if (invalid.length) throw new Error(invalidNamesMessage(invalid));
  return { format: 'circulo-queue', version: 1, usernames: [...new Set(usernames.map(normalizeUsername))] };
}

export function parseQueue(text) {
  if (typeof text !== 'string') throw new Error('A fila precisa ser um arquivo JSON.');
  let data;
  try { data = JSON.parse(cleanText(text)); }
  catch { throw new Error('Não foi possível ler a fila: JSON inválido.'); }
  if (data?.format !== 'circulo-queue' || data?.version !== 1 || !Array.isArray(data?.usernames) || data.usernames.some(name => typeof name !== 'string')) {
    throw new Error('Fila incompatível. Importe uma fila exportada pelo Círculo (versão 1).');
  }
  // Validate each element separately: an element cannot inject multiple names.
  const invalid = data.usernames.filter(name => !normalizeUsername(name));
  if (invalid.length) throw new Error(invalidNamesMessage(invalid));
  return [...new Set(data.usernames.map(normalizeUsername))];
}
