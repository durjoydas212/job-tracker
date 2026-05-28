const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const db = new sqlite3.Database(
  path.join(__dirname, "..", "..", "database.db"),
);

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

  // ================= RESET ADMIN PASSWORDS =================
  const adminPassword = bcrypt.hashSync("123456", 10);

  db.run(
    "UPDATE users SET password=? WHERE role='admin'",
    [adminPassword],
    function (err) {
      if (err) {
        console.log(err);
      } else {
        console.log("All admin passwords updated");
      }
    },
  );

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
});

module.exports = db;
