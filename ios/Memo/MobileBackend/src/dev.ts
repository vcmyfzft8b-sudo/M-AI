import { createServer } from "node:http";

import { handleMobileRequest } from "./handler.js";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.PORT?.trim() || "8787", 10);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT ?? ""}`);
}

const server = createServer((request, response) => {
  void handleMobileRequest(request, response);
});

server.listen(port, host, () => {
  console.log(`Memo iOS native backend listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
