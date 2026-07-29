import type { IncomingMessage, ServerResponse } from "node:http";

import { handleMobileRequest } from "../../src/handler.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleMobileRequest(req, res);
}
