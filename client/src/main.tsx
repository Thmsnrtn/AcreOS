import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initClientSentry } from "./lib/sentry";

// Initialize Sentry before rendering (no-op if VITE_SENTRY_DSN is unset)
initClientSentry();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
