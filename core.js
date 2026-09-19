export const DEFAULT_ITEMS = ['證明', '結晶(100)', '結晶(300)', '結晶(500)'];
export const MAX_QUANTITY = 1000000;
export function names(value, label) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => typeof n !== 'string' || !n.trim() || n.trim().length > 30)) throw new Error(`${label}需要四個名稱，每個 1～30 字。`);
  const result = value.map(n => n.trim());
  if (new Set(result.map(n => n.toLocaleLowerCase())).size !== 4) throw new Error(`${label}名稱不能重複。`);
  return result;
}
export function quantities(value) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => !Number.isSafeInteger(n) || n < 0 || n > MAX_QUANTITY)) throw new Error(`數量請輸入 0～${MAX_QUANTITY.toLocaleString()} 的整數。`);
  return value;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('請選擇有效日期。');
  return value;
}
export const emptyTotals = () => Array.from({ length: 4 }, () => [0, 0, 0, 0]);
export function validNote(note = '') {
  if (typeof note !== 'string' || note.length > 2000) throw new Error('註解最多 2,000 字。');
  return note.trim();
}
export function newSave({ id, name, members, items, now = new Date().toISOString() }) {
  const people = names(members, '隊員');
  if (typeof name !== 'string' || name.trim().length > 60) throw new Error('存檔名稱最多 60 字。');
  return { id, name: name.trim() || people.join('・'), members: people, items: names(items, '道具'), totals: emptyTotals(), next: [0, 0, 0, 0], count: 0, lastSeq: 0, version: 0, createdAt: now, updatedAt: now };
}
// Each item has its own rotating queue. O(4 × 4), independent of quantity.
export function allocate(save, input) {
  const qty = quantities(input);
  const allocations = qty.map((n, item) => {
    const row = [0, 0, 0, 0].map(() => Math.floor(n / 4));
    for (let i = 0; i < n % 4; i++) row[(save.next[item] + i) % 4]++;
    return row;
  });
  const totals = save.totals.map((row, item) => row.map((n, person) => {
    const sum = n + allocations[item][person];
    if (!Number.isSafeInteger(sum)) throw new Error('累計數量超過可精確計算範圍，請備份後建立新存檔。');
    return sum;
  }));
  return { allocations, totals, before: [...save.next], next: save.next.map((n, i) => (n + qty[i]) % 4) };
}
export function sequenceText(members, start, quantity) {
  if (!quantity) return '本輪 0 個，順序不變';
  const cycle = Array.from({ length: 4 }, (_, i) => members[(start + i) % 4]);
  const whole = Math.floor(quantity / 4), rest = quantity % 4;
  if (!whole) return cycle.slice(0, rest).join(' → ');
  return `${cycle.join(' → ')}${whole > 1 ? `（${whole.toLocaleString()} 輪）` : ''}${rest ? ` → ${cycle.slice(0, rest).join(' → ')}` : ''}`;
}
export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
// Backups are untrusted: rebuild all derived values instead of trusting totals/pointers.
export function validateBackup(data, id) {
  if (!data || data.format !== 'abyss-cat-backup' || data.schema !== 1 || !data.save || !Array.isArray(data.rounds)) throw new Error('不是支援的 深淵貓本備份檔。');
  const save = newSave({ ...data.save, id, name: `${data.save.name || '匯入存檔'}`.slice(0, 60) });
  const days = new Map(), rounds = [];
  let previousSeq = 0;
  for (const raw of data.rounds) {
    if (!Number.isSafeInteger(raw.seq) || raw.seq <= previousSeq) throw new Error('備份的輪次順序不正確。');
    validDate(raw.date);
    if (typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))) throw new Error('備份含有無效的時間。');
    const result = allocate(save, raw.qty);
    const round = { saveId: id, seq: raw.seq, date: raw.date, at: raw.at, qty: [...raw.qty], note: validNote(raw.note), before: result.before, allocations: result.allocations };
    rounds.push(round);
    Object.assign(save, { totals: result.totals, next: result.next, count: save.count + 1, lastSeq: raw.seq });
    const day = days.get(raw.date) || { saveId: id, date: raw.date, count: 0, qty: [0, 0, 0, 0] };
    day.count++;
    day.qty = day.qty.map((n, i) => n + raw.qty[i]);
    days.set(raw.date, day);
    previousSeq = raw.seq;
  }
  return { save, rounds, days: [...days.values()] };
}
