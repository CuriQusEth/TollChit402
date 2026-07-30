import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import https from "https";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // We need to parse raw body for proxying POSTs, but wait, it's just a proxy.
  // Actually, a simpler way is to just use http.request to proxy it manually.
  app.use("/api/proxy-search", (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "X-Requested-With,content-type,X-PAYMENT,PAYMENT-SIGNATURE,X-402-Payment,PAYMENT-REQUIRED"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE,PAYMENT-REQUIRED,X-402-Payment"
    );

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    const targetUrl = new URL("https://x402.direct/api/search?q=test");

    // Sadece gerekli header'lari ilet (host ve x-forwarded-* gonderme)
    const headers: Record<string, string | string[] | undefined> = {
      host: targetUrl.hostname,
      accept: req.headers.accept || "*/*",
      "user-agent": req.headers["user-agent"] || "x402-proxy",
    };

    // x402 odeme header'larini koru
    const paymentHeaders = [
      "x-payment",
      "payment-signature",
      "x-402-payment",
      "payment-required",
    ];
    for (const h of paymentHeaders) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
    
    // Translate V2 to V1 on request
    if (req.headers["payment-signature"]) {
      headers["x-payment"] = req.headers["payment-signature"];
    }

    const options = {
      hostname: targetUrl.hostname,
      port: 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode || 500);

      for (const key in proxyRes.headers) {
        if (Object.prototype.hasOwnProperty.call(proxyRes.headers, key)) {
          let val = proxyRes.headers[key] as string;
          res.setHeader(key, val);
          // Translate V1 to V2 on response headers
          if (key.toLowerCase() === 'x-payment-response') {
            res.setHeader('payment-response', val);
          }
        }
      }

      // CORS'u tekrar uygula
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Expose-Headers",
        "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE,PAYMENT-REQUIRED,X-402-Payment,PAYMENT-SIGNATURE,X-PAYMENT"
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
            try {
              const parsed = JSON.parse(bodyStr);
              if (parsed.x402Version === 1) {
                const v2Payload = {
                  x402Version: 2,
                  error: parsed.error || "Payment required",
                  resource: {
                     url: parsed.accepts?.[0]?.resource || "https://x402.direct/api/search",
                     description: parsed.accepts?.[0]?.description || "Search",
                     mimeType: parsed.accepts?.[0]?.mimeType || "application/json"
                  },
                  accepts: parsed.accepts?.map((a: any) => ({
                     scheme: a.scheme,
                     network: a.network === "base" ? "eip155:8453" : a.network,
                     amount: a.maxAmountRequired || a.amount,
                     asset: a.asset,
                     payTo: a.payTo ? a.payTo.trim() : a.payTo,
                     maxTimeoutSeconds: a.maxTimeoutSeconds,
                     extra: a.extra
                  }))
                };
                base64Body = Buffer.from(JSON.stringify(v2Payload)).toString('base64');
              }
            } catch (jsonErr) {}
            res.setHeader('payment-required', base64Body);
            res.end(bodyData);
          } catch (e) {
            res.end(bodyData);
          }
        });
      } else {
        proxyRes.pipe(res);
      }
    });

    proxyReq.on("error", (e) => {
      console.error("Proxy error:", e);
      res.status(500).send("Proxy error: " + e.message);
    });

    if (req.method !== "GET" && req.method !== "HEAD") {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });

  // Vite middleware for development
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
