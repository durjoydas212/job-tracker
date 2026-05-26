require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");

// DB INIT
require("./models/db");

const app = express();

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

// ================= ROUTES =================
const jobRoutes = require("./routes/jobs");
const authRoutes = require("./routes/auth");

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= STATIC =================
app.use("/uploads", express.static("uploads"));

// ================= UPLOAD ROUTE (IMPORTANT) =================
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  res.json({
    filePath: `/uploads/${req.file.filename}`,
  });
});

// ================= API ROUTES =================
app.use("/jobs", jobRoutes);
app.use("/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("API running...");
});

app.listen(5000, () => console.log("Server running on port 5000"));


