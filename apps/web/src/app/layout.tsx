import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ragforge",
  description: "Multi-tenant document Q&A with retrieval-augmented generation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
