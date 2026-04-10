"use client";

import { RootProvider } from "fumadocs-ui/provider/next";

export function ClientRootProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RootProvider
      theme={{
        scriptProps:
          typeof window === "undefined"
            ? undefined
            : ({ type: "application/json" } as const),
      }}
    >
      {children}
    </RootProvider>
  );
}
