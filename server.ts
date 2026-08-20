import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createPremiumRouter, PREMIUM_ROUTE } from "./api/_premium";

dotenv.config();

/**
 * The paid route needs CDP credentials and a recipient address. Warn once at
 * startup rather than letting the first payment fail with an opaque 500.
 */
function warnAboutMissingEnv() {
  const missing = [
    "CDP_API_KEY_ID",
    "CDP_API_KEY_SECRET",
    "PAYMENT_RECIPIENT_ADDRESS",
  ].filter((key) => !process.env[key]);

  if (missing.length === 0) return;

  if (!fs.existsSync(path.join(process.cwd(), ".env"))) {
    console.warn(
      "[env] .env bulunamadı. `cp .env.example .env` komutuyla oluşturup değerleri doldurun."
    );
  }
  console.warn(
    `[env] Eksik değişken(ler): ${missing.join(", ")}. ${PREMIUM_ROUTE} isteği 500 dönecektir.`
  );
}

async function startServer() {
  warnAboutMissingEnv();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Same router the Vercel function mounts, so both environments run identical
  // payment logic instead of parallel implementations that drift apart.
  app.use(createPremiumRouter());

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[server] ${PORT} portu kullanımda. Portu boşaltın veya PORT=3001 npm run dev ile farklı bir port verin.`
      );
    } else {
      console.error("[server] Sunucu başlatılamadı:", err.message);
    }
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
