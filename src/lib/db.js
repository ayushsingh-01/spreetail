// better-sqlite3 is a native binary — do NOT import it at the top level.
// Vercel (serverless/Postgres) must never touch it. We use createRequire to
// lazy-load it only when DATABASE_URL is absent (local SQLite mode).
import pg from 'pg';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

// Singleton pattern to prevent multiple open connections during Next.js hot-reloading in development
let dbInstance = global.dbInstance || null;
const txStorage = new AsyncLocalStorage();

function translateQuery(sql, dialect) {
  if (dialect !== 'postgres') return sql;
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

class StatementWrapper {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  async all(...params) {
    if (this.db.dialect === 'postgres') {
      const client = txStorage.getStore() || this.db.pool;
      const pgSql = translateQuery(this.sql, 'postgres');
      const res = await client.query(pgSql, params);
      return res.rows;
    } else {
      return this.db.sqliteDb.prepare(this.sql).all(...params);
    }
  }

  async get(...params) {
    if (this.db.dialect === 'postgres') {
      const client = txStorage.getStore() || this.db.pool;
      const pgSql = translateQuery(this.sql, 'postgres');
      const res = await client.query(pgSql, params);
      return res.rows[0];
    } else {
      return this.db.sqliteDb.prepare(this.sql).get(...params);
    }
  }

  async run(...params) {
    if (this.db.dialect === 'postgres') {
      const client = txStorage.getStore() || this.db.pool;
      let pgSql = translateQuery(this.sql, 'postgres');
      const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
      if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
        pgSql = pgSql.trim() + ' RETURNING id';
      }
      const res = await client.query(pgSql, params);
      const lastInsertRowid = res.rows[0] ? res.rows[0].id : null;
      return {
        lastInsertRowid,
        changes: res.rowCount
      };
    } else {
      const res = this.db.sqliteDb.prepare(this.sql).run(...params);
      return {
        lastInsertRowid: res.lastInsertRowid,
        changes: res.changes
      };
    }
  }
}

class UnifiedDb {
  constructor(dialect, pool, sqliteDb) {
    this.dialect = dialect;
    this.pool = pool;
    this.sqliteDb = sqliteDb;
  }

  prepare(sql) {
    return new StatementWrapper(this, sql);
  }

  async exec(sql) {
    if (this.dialect === 'postgres') {
      const client = txStorage.getStore() || this.pool;
      let pgSql = sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
        .replace(/REAL/gi, 'DOUBLE PRECISION')
        .replace(/TEXT CHECK/gi, 'VARCHAR CHECK')
        .replace(/TEXT DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      await client.query(pgSql);
    } else {
      this.sqliteDb.exec(sql);
    }
  }

  transaction(fn) {
    return async (...args) => {
      if (this.dialect === 'postgres') {
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
          const result = await txStorage.run(client, async () => {
            return await fn(...args);
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } else {
        const connection = this.sqliteDb;
        try {
          connection.exec('BEGIN TRANSACTION');
          const result = await fn(...args);
          connection.exec('COMMIT');
          return result;
        } catch (error) {
          connection.exec('ROLLBACK');
          throw error;
        }
      }
    };
  }
}

async function initDatabase(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS group_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at TEXT NOT NULL, -- YYYY-MM-DD
      left_at TEXT, -- YYYY-MM-DD (NULL if active)
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      converted_amount_inr REAL NOT NULL,
      paid_by_user_id INTEGER NOT NULL,
      split_type TEXT CHECK(split_type IN ('equal', 'unequal', 'percentage', 'share')) NOT NULL,
      expense_date TEXT NOT NULL, -- YYYY-MM-DD
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      raw_split_value REAL NOT NULL, -- percentage, share, or amount
      calculated_amount_inr REAL NOT NULL,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      payer_id INTEGER NOT NULL,
      payee_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      converted_amount_inr REAL NOT NULL,
      settlement_date TEXT NOT NULL, -- YYYY-MM-DD
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (payee_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Seed default users if table is empty
  const countRow = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  const count = parseInt(countRow.count, 10);
  if (count === 0) {
    const seedTx = db.transaction(async () => {
      const insertUser = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
      const defaultUsers = ['Aisha', 'Rohan', 'Priya', 'Meera'];
      for (const name of defaultUsers) {
        await insertUser.run(name, `${name.toLowerCase()}@example.com`);
      }

      // Seed default groups
      const insertGroup = db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)');
      const flatGroupId = (await insertGroup.run('Flatmates 4B', 'Our shared flat expenses')).lastInsertRowid;
      const goaGroupId = (await insertGroup.run('Goa Trip 2026', 'Vacation spending')).lastInsertRowid;

      // Seed memberships
      const insertMembership = db.prepare(`
        INSERT INTO group_memberships (group_id, user_id, joined_at, left_at)
        VALUES (?, ?, ?, ?)
      `);

      // Get user IDs
      const users = await db.prepare('SELECT id, name FROM users').all();
      const userMap = {};
      users.forEach(u => { userMap[u.name] = u.id; });

      // Flatmates memberships:
      // Aisha, Rohan, Priya: Feb 1, 2026 onwards
      // Meera: Feb 1, 2026 to Mar 31, 2026
      await insertMembership.run(flatGroupId, userMap['Aisha'], '2026-02-01', null);
      await insertMembership.run(flatGroupId, userMap['Rohan'], '2026-02-01', null);
      await insertMembership.run(flatGroupId, userMap['Priya'], '2026-02-01', null);
      await insertMembership.run(flatGroupId, userMap['Meera'], '2026-02-01', '2026-03-31');

      // Goa Trip memberships:
      // Aisha, Rohan, Priya: March 8, 2026 onwards
      await insertMembership.run(goaGroupId, userMap['Aisha'], '2026-03-08', '2026-03-14');
      await insertMembership.run(goaGroupId, userMap['Rohan'], '2026-03-08', '2026-03-14');
      await insertMembership.run(goaGroupId, userMap['Priya'], '2026-03-08', '2026-03-14');
    });

    await seedTx();
  }
}

export function getDb() {
  if (dbInstance) return dbInstance;

  const dbUrl = process.env.DATABASE_URL;
  const isPostgres = dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'));

  if (isPostgres) {
    const pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
    dbInstance = new UnifiedDb('postgres', pool, null);
  } else {
    // Synchronous lazy-require so Vercel's bundler never statically touches better-sqlite3
    const Database = _require('better-sqlite3');
    const dbPath = path.resolve(process.cwd(), 'database.sqlite');
    const sqliteDb = new Database(dbPath);
    sqliteDb.pragma('foreign_keys = ON');
    dbInstance = new UnifiedDb('sqlite', null, sqliteDb);
  }

  dbInstance.initPromise = initDatabase(dbInstance);

  if (process.env.NODE_ENV !== 'production') {
    global.dbInstance = dbInstance;
  }
  return dbInstance;
}

// Helper to reset database completely
export async function resetDatabase() {
  const db = getDb();
  await db.initPromise;
  
  if (db.dialect === 'postgres') {
    await db.exec(`
      DROP TABLE IF EXISTS expense_splits;
      DROP TABLE IF EXISTS expenses;
      DROP TABLE IF EXISTS settlements;
      DROP TABLE IF EXISTS group_memberships;
      DROP TABLE IF EXISTS groups;
      DROP TABLE IF EXISTS users;
    `);
  } else {
    db.sqliteDb.exec(`
      DROP TABLE IF EXISTS expense_splits;
      DROP TABLE IF EXISTS expenses;
      DROP TABLE IF EXISTS settlements;
      DROP TABLE IF EXISTS group_memberships;
      DROP TABLE IF EXISTS groups;
      DROP TABLE IF EXISTS users;
    `);
  }
  
  dbInstance = null;
  global.dbInstance = null;
  const newDb = getDb();
  await newDb.initPromise;
  return newDb;
}
