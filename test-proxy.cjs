const http = require('http');

http.get('http://localhost:3000/api/proxy-search', (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log("No query:", res.statusCode, body);
  });
});

http.get('http://localhost:3000/api/proxy-search?q=test', (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log("With query:", res.statusCode, body);
  });
});
