/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mirror the production --acr-* light-theme palette so picker chrome
        // shares the platform's design language (warm cream + terracotta + ink).
        ink:        '#241607',  // --acr-ink
        'ink-2':    '#5A4424',  // --acr-ink-2
        'ink-3':    '#8F7A52',  // --acr-ink-3
        'ink-4':    '#BAAA85',  // --acr-ink-4
        bg:         '#FAF4E8',  // --acr-bg
        'bg-sunken':'#F1E9D6',  // --acr-bg-sunken
        'bg-raised':'#FFFBF1',  // --acr-bg-raised
        surface:    '#FFFBF1',  // --acr-surface
        'surface-2':'#F3EAD4',  // --acr-surface-2
        sidebar:    '#F1E7D0',  // --acr-sidebar-bg
        line:       'rgba(80, 40, 15, 0.14)',  // --acr-line
        'line-soft':'rgba(80, 40, 15, 0.07)',  // --acr-line-soft
        brand:      '#C2531C',  // --acr-brand (production value)
        'brand-ink':'#FFFBF1',  // --acr-brand-ink
        'brand-soft':'rgba(194, 83, 28, 0.14)', // --acr-brand-soft
        accent:     '#4C7B80',  // --acr-accent (teal)
        pos:        '#3B7C2E',
        'pos-soft': 'rgba(59, 124, 46, 0.14)',
        warn:       '#C48A1E',
        neg:        '#B33419',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      boxShadow: {
        'acr-1': '0 1px 2px rgba(60, 30, 8, 0.06)',
        'acr-2': '0 1px 2px rgba(60, 30, 8, 0.06), 0 8px 22px -6px rgba(60, 30, 8, 0.16)',
      },
    },
  },
  plugins: [],
};
