import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Tailor",
  description: "Generate tailored content and export to DOCX",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
