/**
 * __mocks__/@op-engineering/op-sqlite.js
 *
 * In-memory mock for @op-engineering/op-sqlite used in Jest.
 *
 * Design: each `open({ name })` call returns a fresh DB instance whose
 * `execute` method processes a small subset of SQL:
 *   - CREATE TABLE IF NOT EXISTS  → creates an in-memory table object
 *   - INSERT INTO … VALUES        → appends a row, tracks insertId
 *   - INSERT … ON CONFLICT … DO UPDATE SET … → upsert
 *   - SELECT … FROM … WHERE … LIMIT  → linear scan with basic = matching
 *   - DELETE FROM … WHERE …          → removes matching rows
 *   - DELETE FROM …                  → clears all rows
 *
 * This is intentionally minimal — just enough for auth.ts and db.ts tests.
 * Add more SQL features here if future tests require them.
 */

class MockDB {
  constructor() {
    /** @type {Map<string, {rows: any[], nextId: number}>} */
    this._tables = new Map();
  }

  /** Ensure a table slot exists. */
  _ensureTable(name) {
    if (!this._tables.has(name)) {
      this._tables.set(name, { rows: [], nextId: 1 });
    }
    return this._tables.get(name);
  }

  /**
   * Execute a SQL string with positional parameters.
   * Returns { rows: { _array: [] }, insertId: undefined }.
   */
  async execute(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // ── CREATE TABLE IF NOT EXISTS <name> (…)
    const createMatch = s.match(/^CREATE TABLE IF NOT EXISTS (\w+)\s*\(/i);
    if (createMatch) {
      this._ensureTable(createMatch[1].toLowerCase());
      return { rows: { _array: [] }, insertId: undefined };
    }

    // ── INSERT INTO <name> (cols…) VALUES (?) [ON CONFLICT(col) DO UPDATE SET …]
    const insertMatch = s.match(/^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const tableName = insertMatch[1].toLowerCase();
      const cols = insertMatch[2].split(',').map(c => c.trim());
      const table = this._ensureTable(tableName);

      const isUpsert = /ON CONFLICT\s*\(\s*(\w+)\s*\)\s*DO UPDATE SET/i.test(s);
      if (isUpsert) {
        const conflictColMatch = s.match(/ON CONFLICT\s*\(\s*(\w+)\s*\)/i);
        const conflictCol = conflictColMatch ? conflictColMatch[1].toLowerCase() : cols[0];
        const conflictValue = params[cols.indexOf(conflictCol)];
        const existingIndex = table.rows.findIndex(
          r => String(r[conflictCol]) === String(conflictValue),
        );
        if (existingIndex >= 0) {
          // Update: extract SET assignments from the SQL
          const setMatch = s.match(/DO UPDATE SET\s+(.+)$/i);
          if (setMatch) {
            const assignments = setMatch[1].split(',').map(a => a.trim());
            assignments.forEach(assign => {
              const [col] = assign.split('=').map(p => p.trim());
              const cleanCol = col.replace(/excluded\./i, '').toLowerCase();
              const srcCol = (assign.match(/excluded\.(\w+)/i) || [])[1]?.toLowerCase() ?? cleanCol;
              table.rows[existingIndex][cleanCol] = params[cols.indexOf(srcCol)];
            });
          }
          return { rows: { _array: [] }, insertId: table.rows[existingIndex].id };
        }
      }

      // Regular insert
      const row = { id: table.nextId++ };
      cols.forEach((col, i) => { row[col.toLowerCase()] = params[i]; });
      table.rows.push(row);
      return { rows: { _array: [] }, insertId: row.id };
    }

    // ── SELECT … FROM <name> [WHERE col = ?] [LIMIT n]
    const selectMatch = s.match(/^SELECT .+ FROM (\w+)/i);
    if (selectMatch) {
      const tableName = selectMatch[1].toLowerCase();
      const table = this._ensureTable(tableName);
      let rows = [...table.rows];

      const whereMatch = s.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereMatch) {
        const col = whereMatch[1].toLowerCase();
        rows = rows.filter(r => String(r[col]) === String(params[0]));
      }

      const limitMatch = s.match(/LIMIT\s+(\d+)/i);
      if (limitMatch) {
        rows = rows.slice(0, parseInt(limitMatch[1], 10));
      }

      return { rows: { _array: rows }, insertId: undefined };
    }

    // ── DELETE FROM <name> [WHERE col = ?]
    const deleteMatch = s.match(/^DELETE FROM (\w+)/i);
    if (deleteMatch) {
      const tableName = deleteMatch[1].toLowerCase();
      const table = this._ensureTable(tableName);
      const whereMatch = s.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereMatch) {
        const col = whereMatch[1].toLowerCase();
        table.rows = table.rows.filter(r => String(r[col]) !== String(params[0]));
      } else {
        table.rows = [];
      }
      return { rows: { _array: [] }, insertId: undefined };
    }

    // Unknown SQL — silently no-op so future migrations don't break tests.
    return { rows: { _array: [] }, insertId: undefined };
  }
}

function open(_options) {
  return new MockDB();
}

module.exports = { open };
