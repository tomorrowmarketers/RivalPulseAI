import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: 'RivalPulse — Competitor Intelligence',
  description:
    'Monitor competitor launches, pricing shifts, promotions, and market messaging from one intelligence workspace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased font-sans h-full bg-surface-0 text-text-primary">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
