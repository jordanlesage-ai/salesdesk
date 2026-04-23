import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

/* ─── Load Clerk ─── */
let clerkInstance = null;
async function getClerk() {
  if (clerkInstance) return clerkInstance;
  const publishableKey = "pk_test_cG9zc2libGUtcGVhY29jay04LmNsZXJrLmFjY291bnRzLmRldiQ";
  const frontendApiUrl = "https://possible-peacock-8.clerk.accounts.dev";
  await new Promise((resolve, reject) => {
    if (window.Clerk) return resolve();
    const script = document.createElement("script");
    script.setAttribute("data-clerk-publishable-key", publishableKey);
    script.src = `${frontendApiUrl}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  // Frontend API script pre-initializes window.Clerk as an instance, just call load()
  await window.Clerk.load({ routing: 'hash' });
  clerkInstance = window.Clerk;
  return clerkInstance;
}
