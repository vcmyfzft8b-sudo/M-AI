import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "eu.memoai.app",
  appName: "Memo AI",
  webDir: "www",
  appendUserAgent: "MemoAIiOS/1.0",
  server: {
    url: process.env.MEMO_IOS_SERVER_URL ?? "https://memoai.eu",
    cleartext: false,
    errorPath: "index.html",
  },
  ios: {
    scheme: "MemoAI",
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
  },
};

export default config;
