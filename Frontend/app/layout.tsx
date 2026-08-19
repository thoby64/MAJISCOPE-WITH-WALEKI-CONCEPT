import type { Metadata, Viewport } from "next"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { PALETTE } from "@/lib/palette"

import "./globals.css"

export const metadata: Metadata = {
  title: "Majiscope - Water Leakage Management System",
  description:
    "Government-grade water leakage reporting and management platform for South African municipalities",
  icons: {
    icon: "/favicon.ico",
  },
}

export const viewport: Viewport = {
  themeColor: PALETTE.accent.strong,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
