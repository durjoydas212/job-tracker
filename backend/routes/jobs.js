const fs = require("fs");
const path = require("path");
const { uploadJobImagesToDrive } = require("../services/googleDrive");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

async function sendSms(to, body) {
  if (!to) return;

  try {
    const msg = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body,
    });

    console.log("SMS SENT:", msg.sid);

    return msg;
  } catch (err) {
    console.log("SMS ERROR:", err.message);
  }
}

const getJobLink = () =>
  process.env.FRONTEND_URL ||
  "https://job-tracker-production-47e1.up.railway.app/index.html";

const multer = require("multer");
const express = require("express");
const router = express.Router();
const db = require("../models/db");

// ================= STORAGE =================
const storage = multer.diskStorage({
  destination: "uploads/", // must match server.js
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// ================= UPLOAD IMAGE =================
router.post("/upload", upload.single("image"), (req, res) => {
  console.log("UPLOAD ROUTE HIT");

  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  res.send({
    filePath: `/uploads/${req.file.filename}`,
  });
});

// ================= CREATE JOB =================
router.post("/", async (req, res) => {
  const { job_number, status, notes, data } = req.body;

  if (!job_number) {
    return res.status(400).send("Job number required");
  }

  db.run(
    `INSERT INTO jobs (job_number, status, notes, data)
     VALUES (?, ?, ?, ?)`,
    [job_number, status, notes, JSON.stringify(data)],
    async function (err) {
      if (err) return res.status(500).send(err);

      try {
        const userPhone = data?.userPhone;

        if (userPhone) {
          const jobLink = getJobLink();

          await sendSms(
            userPhone,
            `New Job Submitted

          Job Number: #${job_number}

          Status: ${status || "Pending"}

          Open Job:
          ${jobLink}`,
          );
        }
      } catch (smsErr) {
        console.log("SMS ERROR:", smsErr.message);
      }

      res.send({ id: this.lastID });
    },
  );
});

// ================= GET JOB =================
router.get("/:job_number", (req, res) => {
  db.all(
    `SELECT * FROM jobs WHERE job_number=? ORDER BY created_at DESC`,
    [req.params.job_number],
    (err, rows) => {
      if (err) return res.status(500).send(err);

      const parsed = rows.map((row) => ({
        ...row,
        data: JSON.parse(row.data || "{}"),
      }));

      res.send(parsed);
    },
  );
});

// GET ALL JOBS (ADMIN)

router.get("/", (req, res) => {
  db.all(
    `
    SELECT * FROM jobs 
    WHERE id IN (
      SELECT MAX(id) FROM jobs GROUP BY job_number
    )
    ORDER BY created_at DESC
  `,
    [],
    (err, rows) => {
      if (err) return res.status(500).send(err);

      const parsed = rows.map((row) => ({
        ...row,
        data: JSON.parse(row.data || "{}"),
      }));

      res.send(parsed);
    },
  );
});

router.post("/approve/:id", (req, res) => {
  db.run(
    `UPDATE jobs SET status='Approved' WHERE id=?`,
    [req.params.id],
    function (err) {
      if (err) return res.status(500).send(err);
      res.send({ success: true });
    },
  );
});

router.put("/:id", (req, res) => {
  const { status, notes, data } = req.body;
  const id = req.params.id;

  db.get("SELECT * FROM jobs WHERE id=?", [id], (err, row) => {
    if (err) return res.status(500).send(err);
    if (!row) return res.status(404).send("Job not found");

    let oldData = {};
    try {
      oldData = JSON.parse(row.data || "{}");
    } catch {}

    const newData = {
      ...oldData,
      ...data,
    };

    db.run(
      `UPDATE jobs SET 
        status = COALESCE(?, status),
        notes = COALESCE(?, notes),
        data = ?
       WHERE id = ?`,
      [status, notes, JSON.stringify(newData), id],
      async function (err) {
        if (err) return res.status(500).send(err);

        try {
          const userPhone = oldData.userPhone || newData.userPhone;

          if (userPhone && status) {
            const jobLink = getJobLink();

            const formattedStatus = status.replace(/([a-z])([A-Z])/g, "$1 $2");

            await sendSms(
              userPhone,
              `Job #${row.job_number} updated to ${formattedStatus}

Open Job:
${jobLink}`,
            );
          }
        } catch (smsErr) {
          console.log("SMS ERROR:", smsErr.message);
        }

        res.send({ success: true });
      },
    );
  });
});
router.post("/message/:id", async (req, res) => {
  const { text, image, images, sender } = req.body;
  const id = req.params.id;

  db.get("SELECT * FROM jobs WHERE id=?", [id], (err, row) => {
    if (err) return res.status(500).send(err);
    if (!row) return res.status(404).send("Job not found");

    let data = {};
    try {
      data = JSON.parse(row.data || "{}");
    } catch {}

    const oldMessages = Array.isArray(data.messages) ? data.messages : [];

    const newMessage = {
      sender,
      text,
      images: images || (image ? [image] : []),
      time: new Date().toLocaleString(),
    };

    const updatedData = {
      ...data,
      messages: [...oldMessages, newMessage],
    };

    db.run(
      "UPDATE jobs SET data=? WHERE id=?",
      [JSON.stringify(updatedData), id],
      async function (err) {
        if (err) return res.status(500).send(err);

        try {
          const userPhone = data.userPhone;

          if (userPhone && sender === "admin") {
            const jobLink = getJobLink();
            await sendSms(
              userPhone,
              `New message for Job #${row.job_number}

${text || "Image sent"}

Open Job:
${jobLink}`,
            );
          }
        } catch (smsErr) {
          console.log("SMS ERROR:", smsErr.message);
        }

        res.send({ success: true });
      },
    );
  });
});

router.delete("/delete-job/:job_number", (req, res) => {
  const jobNumber = req.params.job_number;

  db.all("SELECT * FROM jobs WHERE job_number=?", [jobNumber], (err, rows) => {
    if (err) return res.status(500).send(err);
    if (!rows || !rows.length) {
      return res.status(404).send("Job not found");
    }

    const filesToDelete = new Set();

    rows.forEach((row) => {
      let data = {};
      try {
        data = JSON.parse(row.data || "{}");
      } catch {}

      const mainImages = Array.isArray(data.images) ? data.images : [];
      mainImages.forEach((img) => filesToDelete.add(img));

      const messages = Array.isArray(data.messages) ? data.messages : [];
      messages.forEach((msg) => {
        const msgImages = Array.isArray(msg.images) ? msg.images : [];
        msgImages.forEach((img) => filesToDelete.add(img));
      });
    });

    for (const imgPath of filesToDelete) {
      const cleanPath = String(imgPath)
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/^\/+/, "");

      const filePath = path.join(__dirname, "..", cleanPath);

      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.log("Delete file error:", e.message);
        }
      }
    }

    db.run(
      "DELETE FROM jobs WHERE job_number=?",
      [jobNumber],
      function (deleteErr) {
        if (deleteErr) return res.status(500).send(deleteErr);

        res.send({ success: true });
      },
    );
  });
});

// google drive upload for job images
router.post("/upload-drive/:id", async (req, res) => {
  try {
    const jobId = req.params.id;

    db.get("SELECT * FROM jobs WHERE id=?", [jobId], async (err, row) => {
      if (err) return res.status(500).send(err);

      if (!row) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }

      const data = JSON.parse(row.data || "{}");

      const result = await uploadJobImagesToDrive(
        row.job_number,
        data.images || [],
      );

      res.json({
        success: true,
        result,
      });
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
