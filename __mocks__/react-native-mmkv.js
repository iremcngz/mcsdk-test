/**
 * In-memory mock for react-native-mmkv used in Jest tests.
 * Behaves like MMKV but stores values in a plain JS Map.
 */

class MMKVMock {
  constructor(_options) {
    this._store = new Map();
  }

  set(key, value) {
    this._store.set(key, value);
  }

  getString(key) {
    const v = this._store.get(key);
    return typeof v === 'string' ? v : undefined;
  }

  getNumber(key) {
    const v = this._store.get(key);
    return typeof v === 'number' ? v : undefined;
  }

  getBoolean(key) {
    const v = this._store.get(key);
    return typeof v === 'boolean' ? v : undefined;
  }

  delete(key) {
    this._store.delete(key);
  }

  contains(key) {
    return this._store.has(key);
  }

  clearAll() {
    this._store.clear();
  }

  getAllKeys() {
    return Array.from(this._store.keys());
  }
}

module.exports = { MMKV: MMKVMock };
