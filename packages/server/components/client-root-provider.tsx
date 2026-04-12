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
          { type: "application/json" } as const,
      }}
    >
      {children}
    </RootProvider>
  );
}
