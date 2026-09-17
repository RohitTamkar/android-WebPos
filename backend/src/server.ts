import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Web POS API is running",
  });
});

app.listen(PORT, () => {
  console.log(`Web POS API running on http://localhost:${PORT}`);
});