import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../client';

async function main() {
  const handle = createDatabase(undefined, 1);
  try {
    await migrate(handle.db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
    console.log('✓ migrations applied');
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
