"use client";

import { createContext, useContext, type ReactNode } from "react";

const NativeContext = createContext(false);
export function NativeProvider({ native, children }: { native: boolean; children: ReactNode }) {
  return <NativeContext.Provider value={native}>{children}</NativeContext.Provider>;
}
export function useNativeIOS() { return useContext(NativeContext); }
