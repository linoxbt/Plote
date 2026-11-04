"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WalletProvider } from "./wallet";
import { ToastProvider } from "./toast";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 } },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <WalletProvider>
        <ToastProvider>{children}</ToastProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}
