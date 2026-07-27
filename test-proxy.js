const https = require('https');
const targetUrl = new URL("https://x402.direct/api/search?q=test");
const options = {
  hostname: targetUrl.hostname,
  port: 443,
  path: targetUrl.pathname + targetUrl.search,
  method: 'GET',
  headers: {
    host: targetUrl.hostname
  }
};
const req = https.request(options, (res) => {
  console.log(res.statusCode);
  res.pipe(process.stdout);
});
req.end();
