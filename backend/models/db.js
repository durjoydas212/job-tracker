const path = require("path");
const sqlite3 = require("@libsql/sqlite3").verbose();

const db = new sqlite3.Database(path.join(__dirname, "..", "database.db"));

db.serialize(() => {
  // ================= USERS TABLE =================
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      password TEXT,
      role TEXT
    )
  `);

  // ================= DEFAULT ADMINS =================
  db.run(`
    INSERT OR IGNORE INTO users (name, email, password, role)
    VALUES 
    ('Brian', 'Brianb@allweatherseal.com', '123456', 'admin'),
    ('Dan', 'Danw@allweatherseal.com', '123456', 'admin'),
    ('Taylor', 'Taylorr@allweatherseal.com', '123456', 'admin'),
    ('Miraj', 'Mirajep@allweatherseal.com', '123456', 'admin')
  `);

  // ================= JOBS TABLE =================
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_number TEXT,
      status TEXT,
      notes TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ================= IMAGES TABLE =================
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      image_url TEXT,
      tag TEXT
    )
  `);
  db.run(`
  UPDATE users 
  SET password = '1234566' 
  WHERE email = 'Brianb@allweatherseal.com'
`);
});

module.exports = db;
