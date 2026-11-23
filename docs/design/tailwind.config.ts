import type { Config } from 'tailwindcss'

// Components use bg-surface, text-muted etc. Never raw hex. Values live in tokens.css.
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        'border-input': 'var(--color-border-input)',
        text: 'var(--color-text)',
        muted: 'var(--color-text-muted)',
        accent: 'var(--color-accent)',
        'on-accent': 'var(--color-on-accent)',
        danger: 'var(--color-danger)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        track: 'var(--color-progress-track)',
      },
      fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
      fontSize: {
        xs: ['12px', '16px'],
        sm: ['14px', '20px'],
        base: ['16px', '24px'],
        lg: ['20px', '28px'],
      },
      borderRadius: { sm: '4px', md: '8px', lg: '12px' },
      boxShadow: { card: 'var(--shadow-card)', pop: 'var(--shadow-pop)' },
    },
  },
} satisfies Config
