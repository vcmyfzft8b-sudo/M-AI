/**
 * Shared result shape for the admin server actions.
 *
 * This lives outside the `"use server"` module on purpose: such a file may only
 * export async functions, so the constant below cannot be declared there.
 */

export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const IDLE_STATE: ActionState = { status: "idle", message: "" };
