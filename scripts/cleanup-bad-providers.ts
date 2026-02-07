/**
 * Cleanup bad provider records that have feature descriptions as names
 */

import { Client } from "pg";
import { env } from "../src/lib/env";

const DB_CONFIG = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: "postgres",
  user: "postgres",
  password: env.DB_PASSWORD,
};

async function cleanup() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log('Connected to PostgreSQL\n');

    // Find and show bad provider records
    const badRecordsQuery = `
      SELECT id, slug, name
      FROM proxyfaqs.providers
      WHERE name LIKE '%.%'
         OR name LIKE '%;%'
         OR LENGTH(name) > 50
         OR name ~ '^[0-9]+[MK]?\\\\+'
      ORDER BY name
    `;

    const result = await client.query(badRecordsQuery);
    console.log(`Found ${result.rows.length} potentially bad records:\n`);

    for (const row of result.rows) {
      const displayName = row.name.length > 60 ? row.name.slice(0, 60) + '...' : row.name;
      console.log(`  - [${row.slug}] ${displayName}`);
    }

    if (result.rows.length > 0) {
      // Delete bad records
      const deleteQuery = `
        DELETE FROM proxyfaqs.providers
        WHERE name LIKE '%.%'
           OR name LIKE '%;%'
           OR LENGTH(name) > 50
           OR name ~ '^[0-9]+[MK]?\\\\+'
      `;

      const deleteResult = await client.query(deleteQuery);
      console.log(`\nDeleted ${deleteResult.rowCount} bad records`);
    }

    // Show remaining count
    const countResult = await client.query('SELECT COUNT(*) FROM proxyfaqs.providers');
    console.log(`\nRemaining providers: ${countResult.rows[0].count}`);
  } finally {
    await client.end();
  }
}

cleanup()
  .then(() => console.log('\nCleanup complete!'))
  .catch((err) => console.error('Error:', err));
