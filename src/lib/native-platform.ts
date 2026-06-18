export const IOS_APP_USER_AGENT_TOKEN = "MemoAIiOS";

export function isMemoIosAppUserAgent(userAgent: string | null | undefined) {
  return Boolean(userAgent?.includes(IOS_APP_USER_AGENT_TOKEN));
}
