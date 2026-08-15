import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

// Monospace carries every number on the site — scores, probabilities, win
// totals. Tabular figures keep a column from shifting as digits change.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-numeric',
  display: 'swap',
  weight: ['400', '500', '700'],
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://hardwood-predictor.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Hardwood — Calibrated NBA forecasting',
    template: '%s · Hardwood',
  },
  description:
    'Calibrated NBA game and season forecasting, scored against the closing line on 14,600 priced games.',
  openGraph: {
    type: 'website',
    siteName: 'Hardwood',
    title: 'Hardwood — Calibrated NBA forecasting',
    description:
      'Calibrated NBA game and season forecasting, scored against the closing line.',
    url: siteUrl,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#000000',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <style>{`:root { --font-display: var(--font-sans); }`}</style>
      </head>
      <body className="min-h-screen bg-[var(--background)] text-[var(--text-primary)] antialiased font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-[var(--card-bg)] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}
