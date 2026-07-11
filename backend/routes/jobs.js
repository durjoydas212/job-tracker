const fs = require("fs");
const path = require("path");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

const {
  uploadJobImagesToDrive,
  uploadCategory,
  getOrCreateSubFolder,
  findFolderByName,
  createFolder,
} = require("../services/googleDrive");

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
        const assignedUsers = data.assignedUsers || [];

        for (const assigned of assignedUsers) {
          await new Promise((resolve) => {
            db.get(
              "SELECT phone,name FROM users WHERE id=?",
              [assigned.id],
              async (err, user) => {
                if (user?.phone) {
                  const jobLink = getJobLink();

                  await sendSms(
                    user.phone,
                    `Hi ${user.name},

You have been assigned a new job.

Job #: ${job_number}

Status: ${status || "Pending"}

Open Job:
${jobLink}`,
                  );
                }

                resolve();
              },
            );
          });
        }
      } catch (e) {
        console.log(e);
      }

      if (data?.uploadToDrive) {
        try {
          await uploadJobImagesToDrive(job_number, {
            beforeImages: data.beforeImages || [],
            afterImages: data.afterImages || [],
            issueImages: data.issueImages || [],
          });

          data.driveUploaded = true;

          await new Promise((resolve, reject) => {
            db.run(
              "UPDATE jobs SET data=? WHERE id=?",
              [JSON.stringify(data), this.lastID],
              (err) => {
                if (err) reject(err);
                else resolve();
              },
            );
          });

          console.log("Drive upload completed");
        } catch (driveErr) {
          console.log("Drive upload error:", driveErr.message);
        }
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
  db.get("SELECT * FROM jobs WHERE id=?", [req.params.id], (err, row) => {
    if (err) return res.status(500).send(err);

    let data = JSON.parse(row.data || "{}");

    if (data.requestedStatus) {
      db.run(
        `
                    UPDATE jobs
                    SET status=?,
                        data=?
                    WHERE id=?
                    `,
        [
          data.requestedStatus,
          JSON.stringify({
            ...data,
            requestedStatus: null,
            statusPending: false,
          }),
          req.params.id,
        ],
        () => {
          res.json({ success: true });
        },
      );
    } else {
      res.json({ success: true });
    }
  });
});

router.put("/:id", (req, res) => {
  const { status, notes, data, requestedStatus } = req.body;
  if (data) {
    delete data.messages;
    delete data.chatImages;
  }
  const id = req.params.id;

  db.get("SELECT * FROM jobs WHERE id=?", [id], (err, row) => {
    if (err) return res.status(500).send(err);
    if (!row) return res.status(404).send("Job not found");

    let oldData = {};
    try {
      oldData = JSON.parse(row.data || "{}");
    } catch {}

    // Always preserve latest messages
    const newData = {
      ...oldData,
      ...(data || {}),

      locked:
        data?.locked !== undefined ? data.locked : oldData.locked || false,

      closed:
        data?.closed !== undefined ? data.closed : oldData.closed || false,

      requestedStatus: requestedStatus ?? oldData.requestedStatus ?? null,

      statusPending:
        requestedStatus != null ? true : oldData.statusPending || false,
    };

    if (oldData.messages) {
      newData.messages = oldData.messages;
    }

    if (oldData.chatImages) {
      newData.chatImages = oldData.chatImages;
    }
    let finalStatus = status;

    if (requestedStatus) {
      finalStatus = row.status;
    } else {
      newData.requestedStatus = null;
      newData.statusPending = false;
    }
    db.run(
      `UPDATE jobs SET 
        status = COALESCE(?, status),
        notes = COALESCE(?, notes),
        data = ?
       WHERE id = ?`,
      [finalStatus, notes, JSON.stringify(newData), id],
      async function (err) {
        if (err) return res.status(500).send(err);

        try {
          const formattedStatus = status.replace(/([a-z])([A-Z])/g, "$1 $2");

          const assignedUsers = newData.assignedUsers || [];

          for (const assigned of assignedUsers) {
            await new Promise((resolve) => {
              db.get(
                "SELECT phone,name FROM users WHERE id=?",
                [assigned.id],
                async (err, user) => {
                  if (user?.phone && status) {
                    const jobLink = getJobLink();

                    await sendSms(
                      user.phone,
                      `Job Status Updated

Job #: ${row.job_number}

New Status: ${formattedStatus}

Open Job:
${jobLink}`,
                    );
                  }

                  resolve();
                },
              );
            });
          }
        } catch (smsErr) {
          console.log("SMS ERROR:", smsErr.message);
        }

        res.send({ success: true });
      },
    );
  });
});

router.post("/:id/assigned-users", (req, res) => {
  const jobId = req.params.id;
  const { userId } = req.body;

  db.get("SELECT * FROM jobs WHERE id=?", [jobId], (err, row) => {
    if (err) return res.status(500).send(err);
    if (!row) return res.status(404).send("Job not found");

    let data = {};
    try {
      data = JSON.parse(row.data || "{}");
    } catch {}

    if (!Array.isArray(data.assignedUsers)) data.assignedUsers = [];

    db.get(
      "SELECT id,name,email,phone,role FROM users WHERE id=?",
      [userId],
      (err2, user) => {
        if (err2) return res.status(500).send(err2);

        if (!user) return res.status(404).send("User not found");

        const already = data.assignedUsers.some(
          (u) => Number(u.id) === Number(user.id),
        );

        if (!already) {
          data.assignedUsers.push({
            id: user.id,
            name: user.name,
          });
        }

        db.run(
          "UPDATE jobs SET data=? WHERE id=?",
          [JSON.stringify(data), jobId],
          async (err3) => {
            if (err3) return res.status(500).send(err3);

            try {
              if (!already && user.phone) {
                const jobLink = getJobLink();

                await sendSms(
                  user.phone,
                  `Hi ${user.name},

You have been assigned a new job.

Job #: ${row.job_number}

Status: ${row.status}

Open Job:
${jobLink}`,
                );
              }
            } catch (e) {
              console.log("Assignment SMS:", e.message);
            }

            res.json({
              success: true,
              assignedUsers: data.assignedUsers,
            });
          },
        );
      },
    );
  });
});
router.delete("/:id/assigned-users/:userId", (req, res) => {
  const jobId = req.params.id;
  const userId = Number(req.params.userId);

  db.get("SELECT * FROM jobs WHERE id=?", [jobId], (err, row) => {
    if (err) return res.status(500).send(err);
    if (!row) return res.status(404).send("Job not found");

    let data = {};
    try {
      data = JSON.parse(row.data || "{}");
    } catch {}

    data.assignedUsers = (data.assignedUsers || []).filter(
      (u) => Number(u.id) !== userId,
    );

    db.run(
      "UPDATE jobs SET data=? WHERE id=?",
      [JSON.stringify(data), jobId],
      (err2) => {
        if (err2) return res.status(500).send(err2);

        res.json({
          success: true,
          assignedUsers: data.assignedUsers,
        });
      },
    );
  });
});
// uplode image
router.put("/:id/photos", async (req, res) => {
  const { type, images } = req.body;
  const id = req.params.id;

  db.get("SELECT * FROM jobs WHERE id=?", [id], (err, job) => {
    if (err) return res.status(500).send(err);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const data = JSON.parse(job.data || "{}");
    if (data.locked || data.closed) {
      return res.status(403).json({
        success: false,
        message: "This job is locked.",
      });
    }

    const uploaded = images.map((img) => ({
      path: img,
      user: req.body.user || "Unknown",
      time: new Date().toLocaleString(),
    }));

    if (type === "before") {
      data.beforeImages = [...(data.beforeImages || []), ...uploaded];
    }

    if (type === "after") {
      data.afterImages = [...(data.afterImages || []), ...uploaded];
    }

    if (type === "issue") {
      data.issueImages = [...(data.issueImages || []), ...uploaded];
    }

    db.run(
      "UPDATE jobs SET data=? WHERE id=?",
      [JSON.stringify(data), id],
      async function (err) {
        if (err) return res.status(500).send(err);

        if (data.driveSync) {
          const folder = await findFolderByName(job.job_number);

          const jobFolderId =
            folder?.id || (await createFolder(job.job_number));

          let folderId;

          if (type === "before") {
            folderId = await getOrCreateSubFolder(jobFolderId, "Before");
          }

          if (type === "after") {
            folderId = await getOrCreateSubFolder(jobFolderId, "After");
          }

          if (type === "issue") {
            folderId = await getOrCreateSubFolder(jobFolderId, "Issue");
          }

          await uploadCategory(uploaded, folderId);
        }

        res.json({ success: true });
      },
    );
  });
});

router.post("/message/:id", async (req, res) => {
  const { text, image, images, sender, uploadToDrive } = req.body;
  const id = req.params.id;

  db.get("SELECT * FROM jobs WHERE id=?", [id], (err, row) => {
    if (err) return res.status(500).send(err);
    if (!row) return res.status(404).send("Job not found");

    let data = {};
    try {
      data = JSON.parse(row.data || "{}");
    } catch {}
    if (data.locked || data.closed) {
      return res.status(403).json({
        success: false,
        message: "This job is locked.",
      });
    }

    const oldMessages = Array.isArray(data.messages) ? data.messages : [];

    const newMessage = {
      sender,
      senderName: req.body.senderName,
      text,
      images: images || (image ? [image] : []),
      time: new Date().toLocaleString(),
      driveUploaded: false,
    };

    const updatedData = {
      ...data,
      messages: [...oldMessages, newMessage],
    };
    if (uploadToDrive && images?.length) {
      updatedData.chatImages = [...(data.chatImages || []), ...images];
    }

    db.run(
      "UPDATE jobs SET data=? WHERE id=?",
      [JSON.stringify(updatedData), id],
      async function (err) {
        if (err) return res.status(500).send(err);

        try {
          // SMS
          const userPhone = data.userPhone;

          if (false && userPhone && sender === "admin") {
            const jobLink = getJobLink();

            await sendSms(
              userPhone,
              `New message for Job #${row.job_number}

${text || "Image sent"}

Open Job:
${jobLink}`,
            );
          }

          // Google Drive

          if (updatedData.driveSync && image) {
            const folder = await findFolderByName(row.job_number);

            const jobFolderId =
              folder?.id || (await createFolder(row.job_number));

            const chatFolderId = await getOrCreateSubFolder(
              jobFolderId,
              "Chat",
            );

            await uploadCategory(
              [
                {
                  path: image,
                  user: sender,
                  time: new Date().toLocaleString(),
                },
              ],
              chatFolderId,
            );
          }
        } catch (e) {
          console.log(e);
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

      const result = await uploadJobImagesToDrive(row.job_number, {
        beforeImages: data.beforeImages || [],
        afterImages: data.afterImages || [],
        issueImages: data.issueImages || [],
        chatImages: data.chatImages || [],
      });
      data.driveUploaded = true;
      data.driveSync = true;

      db.run("UPDATE jobs SET data=? WHERE id=?", [
        JSON.stringify(data),
        jobId,
      ]);

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

router.post("/upload-message-drive/:id", async (req, res) => {
  try {
    const jobId = req.params.id;

    db.get("SELECT * FROM jobs WHERE id=?", [jobId], async (err, row) => {
      if (err) return res.status(500).send(err);
      if (!row) return res.status(404).send("Job not found");

      const data = JSON.parse(row.data || "{}");

      const messages = data.messages || [];

      const jobFolder = await findFolderByName(row.job_number);

      const jobFolderId = jobFolder?.id || (await createFolder(row.job_number));

      const chatFolderId = await getOrCreateSubFolder(jobFolderId, "Chat");

      for (const msg of messages) {
        if (!msg.images?.length) continue;

        if (msg.driveUploaded) continue;

        await uploadCategory(msg.images, chatFolderId);

        msg.driveUploaded = true;
      }

      db.run("UPDATE jobs SET data=? WHERE id=?", [
        JSON.stringify(data),
        jobId,
      ]);

      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.put("/:id/lock", (req, res) => {
  db.get("SELECT * FROM jobs WHERE id=?", [req.params.id], (err, row) => {
    if (err) return res.status(500).send(err);

    let data = JSON.parse(row.data || "{}");

    data.locked = true;

    db.run(
      "UPDATE jobs SET data=? WHERE id=?",
      [JSON.stringify(data), req.params.id],
      () => {
        res.json({ success: true });
      },
    );
  });
});
router.put("/:id/close", (req, res) => {
  db.get("SELECT * FROM jobs WHERE id=?", [req.params.id], (err, row) => {
    if (err) return res.status(500).send(err);

    let data = JSON.parse(row.data || "{}");

    data.closed = true;

    db.run(
      "UPDATE jobs SET data=? WHERE id=?",
      [JSON.stringify(data), req.params.id],
      () => {
        res.json({ success: true });
      },
    );
  });
});
module.exports = router;
