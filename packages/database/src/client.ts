import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabase(url = process.env.DATABASE_URL, max = 10): DatabaseHandle {
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url, max });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
