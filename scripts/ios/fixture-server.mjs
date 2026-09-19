// Synthetic native-shell QA only. No Supabase, Apple or production requests.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const server = createServer((request, response) => {
  if (request.url === "/api/mobile/account") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"canPurchase":true,"userId":"c08c676c-60ab-4e1a-9933-a1b4df3e8ceb"}'); return;
  }
  if (request.url === "/failure") { response.writeHead(503); response.end("Unavailable"); return; }
  if (request.url === "/document") {
    response.writeHead(200, { "content-type": "text/plain", "content-disposition": 'attachment; filename="Memo-test.txt"' });
    response.end("Synthetic Memo export"); return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  const requestedLocale = request.headers.cookie?.match(/(?:^|;\s*)memo-locale=(\w+)/)?.[1];
  const locale = ["sl", "hr", "bs", "sr", "en"].includes(requestedLocale) ? requestedLocale : "en";
  response.end(`<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Memo shell fixture</title><style>body{font:18px system-ui;padding:16px}button,a,input{display:block;margin:16px 0;padding:12px;min-height:44px;box-sizing:border-box}</style></head>
  <body><h1>Memo shell test</h1><p id="bridge">Loading</p>
  <button onclick="window.memoNative.request('products').then(items=>{window.fixtureProducts=items;document.getElementById('offers').textContent=JSON.stringify(items)}).catch(()=>document.getElementById('offers').textContent='Offer lookup failed')">Check Apple offers</button>
  <p id="offers" aria-label="Apple offer results"></p>
  <button onclick="window.memoNative.request('purchase',{productId:'eu.memoai.premium.monthly',quote:'expired-quote'}).then(result=>document.getElementById('result').textContent=result.status).catch(()=>document.getElementById('result').textContent='Purchase error')">Use stale price</button><p id="result"></p>
  <button onclick="location.href='/failure'">Simulate failure</button>
  <a href="/document" download="Memo-test.txt">Export document</a>
  <button onclick="const a=document.createElement('a');a.href=window.URL.createObjectURL(new Blob(['Synthetic blob export'],{type:'text/plain'}));a.download='Memo-blob.txt';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>window.URL.revokeObjectURL(a.href),1000);">Export blob</button>
  <a href="/page-two">Next screen</a><input aria-label="Note title" placeholder="Note title">
  ${["sl", "hr", "bs", "sr", "en"].map(value => `<button onclick="document.cookie='memo-locale=${value};path=/;max-age=3600';document.documentElement.lang='${value}'">Language ${value}</button>`).join("")}
  <script>window.addEventListener('unhandledrejection',e=>document.getElementById('bridge').textContent='Promise error: '+e.reason);window.addEventListener('error',e=>document.getElementById('bridge').textContent='Script error: '+e.message);document.getElementById('bridge').textContent=(window.memoNative?.version??0)>=1?'Native bridge ready':'Missing bridge';</script></body></html>`);
});
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  writeFileSync("ios/build/fixture-port", String(port));
  writeFileSync("ios/MemoAIUITests/fixture-url.txt", `http://127.0.0.1:${port}`);
  console.log(`Fixture listening on 127.0.0.1:${port}`);
});
