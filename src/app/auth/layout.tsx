import type { Metadata } from "next";

/**
 * Sign-in, sign-up and the provider callbacks. None of it is a destination —
 * a search result landing someone on a magic-link page is a dead end — so the
 * whole tree is kept out of the index.
 *
 * robots.txt disallows /auth/ as well, but that only stops the crawl. A URL
 * shared publicly can still be indexed without being fetched, and this is the
 * tag that answers it.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
