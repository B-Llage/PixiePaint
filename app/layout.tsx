import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixie Paint",
  description: "A pixel art editor built with Next.js and React.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      >
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-XYQMKJD78G"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-XYQMKJD78G');
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
