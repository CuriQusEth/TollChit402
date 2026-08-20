import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import https from "https";
import dotenv from "dotenv";
import { copyResponseHeaders } from "./api/_proxy";

dotenv.config();

/**
 * Both proxies attach CAMBRIAN_API_KEY as `x-api-key` when it is set. Upstream
 * rejects unauthenticated calls, so warn once at startup rather than letting
 * every request fail with an opaque 4xx.
 */
function warnAboutMissingEnv() {
  if (process.env.CAMBRIAN_API_KEY) return;

  if (!fs.existsSync(path.join(process.cwd(), ".env"))) {
    console.warn(
      "[env] .env bulunamadı. `cp .env.example .env` komutuyla oluşturup CAMBRIAN_API_KEY değerini doldurun."
    );
  } else {
    console.warn(
      "[env] CAMBRIAN_API_KEY tanımlı değil. Cambrian istekleri API anahtarı olmadan gönderilecek."
    );
  }
}

async function startServer() {
  warnAboutMissingEnv();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use("/api/cambrian", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, X-PAYMENT, x-api-key"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE"
    );

    if (req.method === "OPTIONS") return res.status(200).end();

    const incomingUrl = new URL(req.url || '/', 'http://localhost');
    const target = new URL(`https://x402.cambrian.org${incomingUrl.pathname}`);
    target.search = incomingUrl.search;

    const headers: Record<string, string> = {
      host: "x402.cambrian.org",
      accept: "application/json",
      "user-agent": "x402-pay-proxy/1.0",
    };

    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase().startsWith('payment-') || key.toLowerCase().startsWith('x-payment')) {
        headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : (value as string);
      }
    }
    
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (process.env.CAMBRIAN_API_KEY) {
      headers['x-api-key'] = process.env.CAMBRIAN_API_KEY;
    }

    const proxyReq = https.request(
      {
        hostname: "x402.cambrian.org",
        port: 443,
        path: target.pathname + target.search,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode || 502);
        copyResponseHeaders(proxyRes.headers, (k, v) => res.setHeader(k, v));
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE"
        );

        if (proxyRes.statusCode && proxyRes.statusCode >= 400 && proxyRes.statusCode !== 402) {
          console.error(
            `[proxy] upstream x402.cambrian.org returned ${proxyRes.statusCode} for ${target.pathname}${target.search}`
          );
        }

        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (e) => {
      console.error(e);
      res.status(502).json({ error: "proxy_failed", message: e.message });
    });

    if (req.method !== "GET" && req.method !== "HEAD") req.pipe(proxyReq);
    else proxyReq.end();
  });

  app.use("/api/data", (req, res) => {
    const incomingUrl = new URL(req.url || '/', 'http://localhost');
    const target = new URL(`https://api.cambrian.org${incomingUrl.pathname}`);
    target.search = incomingUrl.search;

    const headers: Record<string, string> = {
      host: "api.cambrian.org",
      accept: "application/json",
      "user-agent": "x402-pay-proxy/1.0",
    };

    if (process.env.CAMBRIAN_API_KEY) {
      headers['x-api-key'] = process.env.CAMBRIAN_API_KEY;
    }

    const proxyReq = https.request(
      {
        hostname: "api.cambrian.org",
        port: 443,
        path: target.pathname + target.search,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode || 502);
        copyResponseHeaders(proxyRes.headers, (k, v) => res.setHeader(k, v));
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (e) => {
      console.error(e);
      res.status(502).json({ error: "proxy_failed", message: e.message });
    });

    if (req.method !== "GET" && req.method !== "HEAD") req.pipe(proxyReq);
    else proxyReq.end();
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
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
