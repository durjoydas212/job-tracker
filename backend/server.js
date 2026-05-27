require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();

// ================= DB INIT =================
require("./models/db");

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= STATIC UPLOADS =================
app.use("/uploads", express.static("uploads"));

// ================= ROUTES =================
const jobRoutes = require("./routes/jobs");
const authRoutes = require("./routes/auth");

app.use("/jobs", jobRoutes);
app.use("/auth", authRoutes);

// ================= MULTER SETUP =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// ================= IMAGE UPLOAD ROUTE =================
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: "No file uploaded",
    });
  }

  res.json({
    filePath: `/uploads/${req.file.filename}`,
  });
});

// ================= HOME ROUTE =================
app.get("/", (req, res) => {
  res.send("API running...");
});

// ================= SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});