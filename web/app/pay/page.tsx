import type { Metadata } from "next";
import { PayClient } from "./pay-client";

export const metadata: Metadata = {
  title: "Pay from another chain",
  description: "Send USDC or USDT from Base, Solana, Ethereum and more straight into a Plote unit's own NEAR account, through NEAR Intents.",
};

export default function PayPage() {
  return <PayClient />;
}
