// db.js
// Postgres connection (works with Supabase's free Postgres, or any other
// Postgres-compatible host) using the standard `pg` driver.
//
// Set DATABASE_URL in your environment (Render dashboard -> Environment)
// to the connection string from your Supabase project:
//   Project Settings -> Database -> Connection string -> URI
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    '[db.js] DATABASE_URL is not set. Set it to your Postgres/Supabase connection string.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase (and most hosted Postgres) requires SSL. This relaxed setting
  // is the standard way to connect from Node without needing to install a
  // custom CA certificate.
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, init };
