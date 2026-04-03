require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { seedAdmin } = require("./services/seedAdmin");

const app = express();

app.use(cors());
// Increase JSON/urlencoded body size limits to support base64 images
const BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || "10mb";
app.use(express.json({ limit: BODY_LIMIT }));
app.use(
  express.urlencoded({
    limit: BODY_LIMIT,
    extended: true,
  })
);

const organizationRoutes = require("./routes/organizationRoutes");
const authRoutes = require("./routes/authRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");

app.use("/api", organizationRoutes);
app.use("/api", authRoutes);
app.use("/api", appointmentRoutes);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    await seedAdmin();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
