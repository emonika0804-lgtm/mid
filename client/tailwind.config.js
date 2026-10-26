/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pil: {
          blue: '#002B49',
          red: '#ED1C24',
          accent: '#0284c7',
        }
      }
    },
  },
  plugins: [],
}
