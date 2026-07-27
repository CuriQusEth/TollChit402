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
  app.use("/api/x402", (req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,X-PAYMENT,PAYMENT-SIGNATURE');
      res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE');
      return res.status(200).end();
    }
    
    // Proxy the request to https://x402.direct
    const targetUrl = new URL(req.originalUrl.replace(/^\/api\/x402/, ""), "https://x402.direct");
    
    const options = {
      hostname: targetUrl.hostname,
      port: 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.hostname,
      },
    };

    // Remove headers that could cause issues
    delete options.headers['origin'];
    delete options.headers['referer'];
    delete options.headers['connection'];
    delete options.headers['accept-encoding'];

    const proxyReq = https.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode || 500);
      
      // Add CORS headers so the frontend can read the response and X-PAYMENT-RESPONSE
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,X-PAYMENT');
      res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE');
      
      // Forward headers from target
      for (const key in proxyRes.headers) {
        if (proxyRes.headers.hasOwnProperty(key)) {
          res.setHeader(key, proxyRes.headers[key] as string);
        }
      }

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      console.error("Proxy error:", e);
      res.status(500).send("Proxy error: " + e.message);
    });

    req.pipe(proxyReq);
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
