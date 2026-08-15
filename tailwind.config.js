/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1280px' } },
    extend: {
      // Every colour reads a CSS variable. Components must use
      // `text-[var(--text-primary)]` style tokens rather than Tailwind's
      // palette — a hardcoded `text-gray-400` bypasses the token layer and
      // is the one thing that makes this design system drift.
      colors: {
        border: 'var(--border-color)',
        background: 'var(--background)',
        foreground: 'var(--text-primary)',
        card: 'var(--card-bg)',
        muted: { DEFAULT: 'var(--muted-bg)', foreground: 'var(--text-tertiary)' },
        primary: { DEFAULT: 'var(--accent-primary)', foreground: 'var(--accent-on-primary)' },
        destructive: { DEFAULT: 'var(--accent-loss)', foreground: '#fff' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
        numeric: ['var(--font-mono-numeric)', 'ui-monospace', 'monospace'],
      },
      borderRadius: { lg: 'var(--radius)', md: '6px', sm: '4px' },
      maxWidth: { shell: 'var(--shell-content-max)' },
    },
  },
  plugins: [],
}
