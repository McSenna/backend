require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { seedAdmin } = require("./services/seedAdmin");

const app = express();

app.use(cors());
app.use(express.json());

const organizationRoutes = require("./routes/organizationRoutes");
const authRoutes = require("./routes/authRoutes");

app.use("/api", organizationRoutes);
app.use("/api", authRoutes);

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
