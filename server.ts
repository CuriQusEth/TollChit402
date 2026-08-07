import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import https from "https";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

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

    const v = req.headers['x-payment'];
    if (v) headers['x-payment'] = Array.isArray(v) ? v[0] : (v as string);
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
        res.status(proxyRes.statusCode || 500);
        for (const [k, val] of Object.entries(proxyRes.headers)) {
          if (val !== undefined) res.setHeader(k, val as string);
        }
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
  
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
