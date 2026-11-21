import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nightfall — Digital Storyteller",
  description: "A private, phone-first companion for tabletop social deduction games."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
