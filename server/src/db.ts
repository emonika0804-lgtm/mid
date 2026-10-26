import { pool, query, initPgDatabase } from './pgdb';

/**
 * Prepares an SQL query for PostgreSQL execution, handling both:
 * 1. Named parameters: @paramName with object argument
 * 2. Positional parameters: ? with rest arguments or array
 */
export function prepareQuery(sql: string, params: any[]): { text: string; values: any[] } {
  // Case 1: Named parameters with an object (e.g. stmt.run(newClaim))
  if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
    const obj = params[0];
    const values: any[] = [];
    let paramIndex = 1;
    const text = sql.replace(/@([a-zA-Z0-9_]+)/g, (_, name) => {
      values.push(obj[name] !== undefined ? obj[name] : null);
      return `$${paramIndex++}`;
    });
    return { text, values };
  }

  // Case 2: Positional parameters with ?
  const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  let paramIndex = 1;
  const text = sql.replace(/\?/g, () => `$${paramIndex++}`);
  return { text, values: flatParams };
}

export interface DbStatement {
  get<T = any>(...params: any[]): Promise<T | undefined>;
  all<T = any>(...params: any[]): Promise<T[]>;
  run(...params: any[]): Promise<{ changes: number }>;
}

export const db = {
  prepare(sql: string): DbStatement {
    return {
      async get<T = any>(...params: any[]): Promise<T | undefined> {
        const { text, values } = prepareQuery(sql, params);
        const res = await pool.query(text, values);
        return res.rows[0] as T | undefined;
      },
      async all<T = any>(...params: any[]): Promise<T[]> {
        const { text, values } = prepareQuery(sql, params);
        const res = await pool.query(text, values);
        return res.rows as T[];
      },
      async run(...params: any[]): Promise<{ changes: number }> {
        const { text, values } = prepareQuery(sql, params);
        const res = await pool.query(text, values);
        return { changes: res.rowCount || 0 };
      },
    };
  },
  async exec(sql: string): Promise<void> {
    await pool.query(sql);
  },
  async query(sql: string, params?: any[]) {
    return pool.query(sql, params);
  },
};

export async function initDatabase() {
  await initPgDatabase();
  console.log('[Database] PostgreSQL backend database initialized.');
}

export { pool, query };
export default db;
