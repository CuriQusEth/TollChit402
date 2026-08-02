import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import https from "https";
import { transformX402PaymentHeader, transformPaymentRequiredResponse } from "./src/lib/x402-proxy";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use("/api/proxy-search", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, X-PAYMENT, X-402-Payment"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE"
    );

    if (req.method === "OPTIONS") return res.status(200).end();

    const target = new URL("https://x402.direct/api/search");
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    target.search = query;

    const headers: Record<string, string> = {
      host: "x402.direct",
      accept: "application/json",
      "user-agent": "x402-pay-proxy/1.0",
    };

    for (const h of [
      "payment-signature",
      "payment-required",
      "x-payment",
      "x-402-payment",
    ]) {
      const v = req.headers[h];
      if (v) headers[h] = Array.isArray(v) ? v[0] : v;
    }

    if (req.headers['payment-signature'] && !headers['x-payment']) {
      headers['x-payment'] = req.headers['payment-signature'] as string;
    }

    if (headers['x-402-payment'] && !headers['x-payment']) {
      headers['x-payment'] = headers['x-402-payment'];
    }

    if (headers['x-payment']) {
      try {
        const transformed = transformX402PaymentHeader(headers['x-payment']);
        if (transformed) {
          headers['x-payment'] = transformed;
        }
      } catch (e: any) {
        if (e.message.includes('Unsupported network')) {
          return res.status(400).json({ error: e.message });
        }
      }
    }

    delete headers['x-402-payment'];

    const proxyReq = https.request(
      {
        hostname: "x402.direct",
        port: 443,
        path: target.pathname + target.search,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode || 500);
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v !== undefined) res.setHeader(k, v as string);
        }
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "PAYMENT-RESPONSE,PAYMENT-REQUIRED,X-PAYMENT-RESPONSE"
        );

        if (proxyRes.statusCode === 402) {
          let bodyData = Buffer.alloc(0);
          proxyRes.on('data', (chunk) => {
            bodyData = Buffer.concat([bodyData, chunk]);
          });
          proxyRes.on('end', () => {
            try {
              const bodyStr = bodyData.toString('utf8');
              let base64Body = Buffer.from(bodyStr).toString('base64');
              const transformed = transformPaymentRequiredResponse(bodyStr);
              if (transformed) {
                base64Body = transformed;
              }
              res.setHeader('payment-required', base64Body);
              res.end(bodyData);
            } catch (e) {
              res.end(bodyData);
            }
          });
        } else {
          proxyRes.pipe(res);
        }
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
      appType: "spa",    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {      res.sendFile(path.join(distPath, 'index.html'));    });  }  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
