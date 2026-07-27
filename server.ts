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
  app.all("/api/proxy-search", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,X-PAYMENT,PAYMENT-SIGNATURE');
    res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const targetUrl = new URL("https://x402.direct/api/search?q=test");
    
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

    delete options.headers['origin'];
    delete options.headers['referer'];
    delete options.headers['connection'];
    delete options.headers['accept-encoding'];

    const proxyReq = https.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode || 500);
      
      // Forward headers from target
      for (const key in proxyRes.headers) {
        if (proxyRes.headers.hasOwnProperty(key)) {
          res.setHeader(key, proxyRes.headers[key] as string);
        }
      }

      // Re-apply CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,X-PAYMENT,PAYMENT-SIGNATURE');
      res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE');

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
