import { allocate, newSave, validDate, validNote, validateBackup } from './core.js';
const DB_NAME = 'abyss-cat-allocator-v1';
let connection;
const req = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
function finished(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('儲存未完成，請重試。')); tx.onerror = () => {}; }); }
export async function openDB() {
  if (connection) return connection;
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('saves', { keyPath: 'id' });
    const rounds = db.createObjectStore('rounds', { keyPath: ['saveId', 'seq'] });
    rounds.createIndex('byDate', ['saveId', 'date', 'seq']);
    db.createObjectStore('days', { keyPath: ['saveId', 'date'] });
  };
  connection = await req(request);
  connection.onversionchange = () => { connection.close(); connection = null; };
  return connection;
}
async function transaction(stores, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(stores, mode);
  const done = finished(tx);
  try { const result = await fn(tx); await done; return result; }
  catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
}
export const listSaves = () => transaction(['saves'], 'readonly', tx => req(tx.objectStore('saves').getAll()));
export const getSave = id => transaction(['saves'], 'readonly', tx => req(tx.objectStore('saves').get(id)));
export async function createSave(input) {
  const save = newSave({ ...input, id: crypto.randomUUID() });
  await transaction(['saves'], 'readwrite', tx => req(tx.objectStore('saves').add(save)));
  return save;
}
function checkVersion(save, version) {
  if (!save) throw new Error('找不到這份存檔。');
  if (save.version !== version) throw new Error('這份存檔已在另一個分頁更新。已重新載入，請確認分配預覽後再送出。');
}
export async function addRound(id, version, date, qty, note = '') {
  validDate(date);
  note = validNote(note);
  return transaction(['saves', 'rounds', 'days'], 'readwrite', async tx => {
    const saves = tx.objectStore('saves'), rounds = tx.objectStore('rounds'), days = tx.objectStore('days');
    const save = await req(saves.get(id));
    checkVersion(save, version);
    const result = allocate(save, qty);
    const at = new Date().toISOString();
    const round = { saveId: id, seq: save.lastSeq + 1, date, at, qty: [...qty], note, before: result.before, allocations: result.allocations };
    const day = await req(days.get([id, date])) || { saveId: id, date, count: 0, qty: [0, 0, 0, 0] };
    day.count++; day.qty = day.qty.map((n, i) => n + qty[i]);
    round.dayRound = day.count;
    Object.assign(save, { totals: result.totals, next: result.next, lastSeq: round.seq, count: save.count + 1, version: save.version + 1, updatedAt: at });
    rounds.add(round); days.put(day); saves.put(save);
    return { save, round };
  });
}
const saveRange = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
// Older records have no dayRound. Count index keys up to this entry; never load old history in full.
async function withDayRound(store, round) {
  if (!round) return null;
  if (Number.isSafeInteger(round.dayRound) && round.dayRound > 0) return round;
  const dayRound = await req(store.index('byDate').count(IDBKeyRange.bound([round.saveId, round.date, 0], [round.saveId, round.date, round.seq])));
  return { ...round, dayRound };
}
export const latestRound = id => transaction(['rounds'], 'readonly', async tx => {
  const store = tx.objectStore('rounds');
  const round = (await req(store.openCursor(saveRange(id), 'prev')))?.value || null;
  return withDayRound(store, round);
});
export async function undoRound(id, version) {
  return transaction(['saves', 'rounds', 'days'], 'readwrite', async tx => {
    const saves = tx.objectStore('saves'), rounds = tx.objectStore('rounds'), days = tx.objectStore('days');
    const save = await req(saves.get(id)); checkVersion(save, version);
    const cursor = await req(rounds.openCursor(saveRange(id), 'prev'));
    if (!cursor) throw new Error('沒有可以撤回的紀錄。');
    const round = cursor.value;
    const day = await req(days.get([id, round.date]));
    day.count--; day.qty = day.qty.map((n, i) => n - round.qty[i]);
    if (day.count) days.put(day); else days.delete([id, round.date]);
    save.totals = save.totals.map((row, i) => row.map((n, p) => n - round.allocations[i][p]));
    save.next = round.before; save.count--; save.version++; save.updatedAt = new Date().toISOString();
    rounds.delete(cursor.primaryKey); saves.put(save);
    return save;
  });
}
function page(source, range, limit = 30) {
  return new Promise((resolve, reject) => {
    const rows = [], request = source.openCursor(range, 'prev');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve({ rows, more: false });
      if (rows.length === limit) return resolve({ rows, more: true });
      rows.push(cursor.value); cursor.continue();
    };
  });
}
export async function queryHistory(id, from, to, before = null) {
  validDate(from); validDate(to);
  if (from > to) throw new Error('起始日期不能晚於結束日期。');
  return transaction(['rounds'], 'readonly', async tx => {
    const store = tx.objectStore('rounds');
    const result = await page(store.index('byDate'), IDBKeyRange.bound([id, from, 0], before ? [id, before.date, before.seq] : [id, to, Number.MAX_SAFE_INTEGER], false, !!before));
    result.rows = await Promise.all(result.rows.map(round => withDayRound(store, round)));
    return result;
  });
}
export async function queryDays(id, from, to, before = null) {
  validDate(from); validDate(to);
  if (from > to) throw new Error('起始日期不能晚於結束日期。');
  return transaction(['days'], 'readonly', tx => page(tx.objectStore('days'), IDBKeyRange.bound([id, from], [id, before || to], false, !!before)));
}
export async function exportSave(id) {
  return transaction(['saves', 'rounds'], 'readonly', async tx => {
    const save = await req(tx.objectStore('saves').get(id));
    const rounds = await req(tx.objectStore('rounds').getAll(saveRange(id)));
    return { format: 'abyss-cat-backup', schema: 1, exportedAt: new Date().toISOString(), save, rounds };
  });
}
export async function importSave(data) {
  const { save, rounds, days } = validateBackup(data, crypto.randomUUID());
  await transaction(['saves', 'rounds', 'days'], 'readwrite', tx => {
    tx.objectStore('saves').add(save);
    for (const round of rounds) tx.objectStore('rounds').add(round);
    for (const day of days) tx.objectStore('days').add(day);
  });
  return save;
}
