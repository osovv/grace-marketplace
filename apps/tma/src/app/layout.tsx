import type { ReactNode } from "react";
import "./globals.css";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
