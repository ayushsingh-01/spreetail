import Database from 'better-sqlite3';
import path from 'path';

// Singleton pattern to prevent multiple open connections during Next.js hot-reloading in development
let dbInstance = global.dbInstance || null;

export function getDb() {
  if (dbInstance) return dbInstance;

  // Save the database file in the root directory of the project
  const dbPath = path.resolve(process.cwd(), 'database.sqlite');
  const db = new Database(dbPath);

  // Enable foreign key support
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
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
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (count === 0) {
    const insertUser = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
    const defaultUsers = ['Aisha', 'Rohan', 'Priya', 'Meera'];
    for (const name of defaultUsers) {
      insertUser.run(name, `${name.toLowerCase()}@example.com`);
    }

    // Seed default groups
    const insertGroup = db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)');
    const flatGroupId = insertGroup.run('Flatmates 4B', 'Our shared flat expenses').lastInsertRowid;
    const goaGroupId = insertGroup.run('Goa Trip 2026', 'Vacation spending').lastInsertRowid;

    // Seed memberships
    const insertMembership = db.prepare(`
      INSERT INTO group_memberships (group_id, user_id, joined_at, left_at)
      VALUES (?, ?, ?, ?)
    `);

    // Get user IDs
    const users = db.prepare('SELECT id, name FROM users').all();
    const userMap = {};
    users.forEach(u => { userMap[u.name] = u.id; });

    // Flatmates memberships:
    // Aisha, Rohan, Priya: Feb 1, 2026 onwards
    // Meera: Feb 1, 2026 to Mar 31, 2026
    insertMembership.run(flatGroupId, userMap['Aisha'], '2026-02-01', null);
    insertMembership.run(flatGroupId, userMap['Rohan'], '2026-02-01', null);
    insertMembership.run(flatGroupId, userMap['Priya'], '2026-02-01', null);
    insertMembership.run(flatGroupId, userMap['Meera'], '2026-02-01', '2026-03-31');

    // Goa Trip memberships:
    // Aisha, Rohan, Priya: March 8, 2026 onwards
    insertMembership.run(goaGroupId, userMap['Aisha'], '2026-03-08', '2026-03-14');
    insertMembership.run(goaGroupId, userMap['Rohan'], '2026-03-08', '2026-03-14');
    insertMembership.run(goaGroupId, userMap['Priya'], '2026-03-08', '2026-03-14');
  }

  dbInstance = db;
  if (process.env.NODE_ENV !== 'production') {
    global.dbInstance = dbInstance;
  }
  return dbInstance;
}

// Helper to reset database completely
export function resetDatabase() {
  const dbPath = path.resolve(process.cwd(), 'database.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    DROP TABLE IF EXISTS expense_splits;
    DROP TABLE IF EXISTS expenses;
    DROP TABLE IF EXISTS settlements;
    DROP TABLE IF EXISTS group_memberships;
    DROP TABLE IF EXISTS groups;
    DROP TABLE IF EXISTS users;
  `);
  dbInstance = null;
  global.dbInstance = null;
  return getDb();
}
