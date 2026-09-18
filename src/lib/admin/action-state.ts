/**
 * Shared result shape for the admin server actions.
 *
 * This lives outside the `"use server"` module on purpose: such a file may only
 * export async functions, so the constant below cannot be declared there.
 */

export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
  /**
   * Set when the action handed slow work to the background — a TikTok
   * profile scrape, a re-check of every video — and the page should refresh
   * itself again after roughly this long to pick up the result.
   */
  refreshAfterMs?: number;
};

export const IDLE_STATE: ActionState = { status: "idle", message: "" };
