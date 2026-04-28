/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mirror the production design tokens so picker chrome feels native
        ink: 'rgb(41, 38, 27)',
        'ink-2': 'rgba(41, 38, 27, 0.72)',
        'ink-3': 'rgba(41, 38, 27, 0.5)',
        bg: 'rgb(250, 249, 247)',
        'bg-raised': '#ffffff',
        surface: 'rgba(255, 255, 255, 0.6)',
        line: 'rgba(0, 0, 0, 0.08)',
        brand: '#D97757',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
