const express = require("express");
const router = express.Router();
const db = require("../models/db");
const bcrypt = require("bcrypt");

// ---------- helpers ----------
function getRequesterId(req) {
  return req.get("x-user-id") || req.body.requesterId || req.query.requesterId;
}

function getAdminId(req) {
  return req.get("x-admin-id") || req.body.adminId || req.query.adminId;
}

function requireAdmin(req, res, next) {
  const adminId = getAdminId(req);

  if (!adminId) {
    return res.status(401).json({ message: "Admin login required" });
  }

  db.get(
    "SELECT id, role FROM users WHERE id=?",
    [adminId],
    (err, adminUser) => {
      if (err) {
        console.log("ADMIN CHECK ERROR:", err);
        return res.status(500).json({ message: "Server error" });
      }

      if (!adminUser || adminUser.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }

      req.adminUser = adminUser;
      next();
    },
  );
}

function requireSelfOrAdmin(req, res, next) {
  const userId = req.params.id;
  const requesterId = getRequesterId(req);
  const adminId = getAdminId(req);

  if (!requesterId && !adminId) {
    return res.status(401).json({ message: "Login required" });
  }

  db.get(
    "SELECT id, role FROM users WHERE id=?",
    [requesterId || adminId],
    (err, requester) => {
      if (err) {
        console.log("REQUESTER CHECK ERROR:", err);
        return res.status(500).json({ message: "Server error" });
      }

      if (!requester) {
        return res.status(401).json({ message: "Login required" });
      }

      if (
        requester.role === "admin" ||
        String(requester.id) === String(userId)
      ) {
        req.requester = requester;
        return next();
      }

      return res.status(403).json({ message: "Access denied" });
    },
  );
}

// ================= TEST =================
router.get("/test", (req, res) => {
  db.all("SELECT * FROM users", [], (err, rows) => {
    if (err) return res.status(500).send(err);
    res.send(rows);
  });
});

// ================= LOGIN (ADMIN + USER) =================
router.post("/login", (req, res) => {
  const { email, phone, password } = req.body;
  const identifier = email || phone;

  if (!identifier || !password) {
    return res
      .status(400)
      .json({ message: "Email/phone and password required" });
  }

  db.get(
    `SELECT * FROM users WHERE email=? OR phone=?`,
    [identifier, identifier],
    async (err, user) => {
      if (err) {
        console.log("DB ERROR:", err);
        return res.status(500).json({ message: "Server error" });
      }

      if (!user) {
        return res.status(401).json({ message: "Invalid login" });
      }

      try {
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
          return res.status(401).json({ message: "Invalid login" });
        }

        delete user.password;
        res.json(user);
      } catch (error) {
        console.log("BCRYPT ERROR:", error);
        return res.status(500).json({ message: "Server error" });
      }
    },
  );
});

// ================= GET ALL USERS =================
router.get("/users", requireAdmin, (req, res) => {
  db.all(
    "SELECT id, name, email, phone, role FROM users ORDER BY id DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).send(err);
      res.send(rows);
    },
  );
});

// ================= ADD USER (ADMIN ONLY) =================
router.post("/add-user", requireAdmin, async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: "Phone and password required" });
  }

  try {
    db.get(
      "SELECT * FROM users WHERE phone=? OR email=?",
      [phone, email || ""],
      async (err, existing) => {
        if (err) {
          console.log("CHECK ERROR:", err);
          return res.status(500).json({ message: "Server error" });
        }

        if (existing) {
          return res.status(400).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
          "INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, 'user')",
          [name || "User", email || null, phone, hashedPassword],
          function (err) {
            if (err) {
              console.log("ADD USER ERROR:", err);
              return res.status(500).json({ message: "Server error" });
            }

            res.json({ success: true, id: this.lastID });
          },
        );
      },
    );
  } catch (err) {
    console.log("HASH ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ================= DELETE USER (ADMIN ONLY) =================
router.delete("/user/:id", requireAdmin, (req, res) => {
  const userId = req.params.id;

  db.get("SELECT role FROM users WHERE id=?", [userId], (err, user) => {
    if (err) return res.status(500).send(err);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "admin") {
      return res
        .status(400)
        .json({ message: "Admin account cannot be deleted" });
    }

    db.run("DELETE FROM users WHERE id=?", [userId], function (err) {
      if (err) return res.status(500).send(err);
      res.send({ success: true });
    });
  });
});

// ================= CHANGE PASSWORD =================
router.put("/change-password/:id", requireSelfOrAdmin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.params.id;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: "All fields required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Min 6 characters" });
  }

  db.get("SELECT * FROM users WHERE id=?", [userId], async (err, user) => {
    if (err) return res.status(500).send(err);
    if (!user) return res.status(404).json({ message: "User not found" });

    try {
      const match = await bcrypt.compare(oldPassword, user.password);

      if (!match) {
        return res.status(400).json({ message: "Old password incorrect" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      db.run(
        "UPDATE users SET password=? WHERE id=?",
        [hashedPassword, userId],
        function (err) {
          if (err) return res.status(500).send(err);
          res.json({ success: true });
        },
      );
    } catch (error) {
      console.log("PASSWORD CHANGE ERROR:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
});

// ================= REMOVE THIS ROUTE IF NOT NEEDED =================
// Better not keep a public password reset route in real use.
router.get("/fix-all-passwords", requireAdmin, async (req, res) => {
  try {
    const hash = await bcrypt.hash("123456", 10);

    db.run("UPDATE users SET password=?", [hash], function (err) {
      if (err) return res.status(500).send(err);

      res.send("All passwords reset to 123456");
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("Error");
  }
});

module.exports = router;
