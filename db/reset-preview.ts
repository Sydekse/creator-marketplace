import postgres from 'postgres';

async function main() {
  if (process.env.VERCEL_ENV !== 'preview') {
    console.log("Skipping DB reset: not a preview environment.");
    return;
  }
  
  if (!process.env.DATABASE_URL) {
    console.log("Skipping DB reset: missing DATABASE_URL.");
    return;
  }

  console.log("Wiping preview database schema to fix migration drift...");
  const sql = postgres(process.env.DATABASE_URL);
  try {
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    await sql`GRANT ALL ON SCHEMA public TO public`;
    console.log("✅ Database schema reset successfully.");
  } catch (error) {
    console.error("Failed to reset database:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
