import "server-only";

import { headers } from "next/headers";

export const IOS_WEB_WRAPPER_USER_AGENT_TOKEN = "MemoAI-iOS/";

export function isIOSWebWrapperUserAgent(userAgent: string | null | undefined) {
  return Boolean(userAgent?.includes(IOS_WEB_WRAPPER_USER_AGENT_TOKEN));
}

export async function isIOSWebWrapperRequest() {
  const headerStore = await headers();
  return isIOSWebWrapperUserAgent(headerStore.get("user-agent"));
}
