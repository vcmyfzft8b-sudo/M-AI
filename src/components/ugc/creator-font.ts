import { Inter } from "next/font/google";

/**
 * The creator program's typeface. The program pages follow the campaign-page design
 * creators already know (Inter, tight headings) rather than the app's system stack, and
 * the apply sheet renders in a portal outside the page, so both take this class.
 */
export const creatorFont = Inter({
  subsets: ["latin", "latin-ext"], // latin-ext carries č/š/ž/đ/ć
  display: "swap",
});
