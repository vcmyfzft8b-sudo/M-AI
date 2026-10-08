import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demo",
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * `/ugc` holds screens made only for comedy UGC videos, such as the oral quiz.
 *
 * It is kept apart from the creator demo on purpose: `/creator` is what creators making ordinary
 * study content use, and nothing there links here. These pages are reached only by their own
 * link. They need no account, no demo store and no app chrome — only the app's tokens, which the
 * `.memo` class brings.
 */
export default function UgcLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="memo">
      <main>{children}</main>
    </div>
  );
}
