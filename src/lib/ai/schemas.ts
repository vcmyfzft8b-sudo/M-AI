import { z } from "zod";

export const citationSchema = z.object({
  idx: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  quote: z.string().min(3),
});

export const chatAnswerSchema = z.object({
  answer: z.string().min(10),
  citations: z.array(citationSchema).max(4),
});
