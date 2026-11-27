const STORAGE_KEY = 'downhillRecords';

export function recordKey(trackId) {
  return `record:${trackId}`;
}

export function loadRecords(storage = globalThis.localStorage) {
  try {
    if (!storage) return {};
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) =>
      key.startsWith('record:v1:') && Number.isFinite(value) && value > 0,
    ));
  } catch {
    return {};
  }
}

export function saveRecord(storage = globalThis.localStorage, key, milliseconds) {
  if (!storage || !key?.startsWith('record:v1:') || !Number.isFinite(milliseconds) || milliseconds <= 0) return false;
  try {
    const records = loadRecords(storage);
    const previous = records[key];
    if (previous && previous <= milliseconds) return false;
    records[key] = Math.round(milliseconds);
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}
