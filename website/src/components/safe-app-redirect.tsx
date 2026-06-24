'use client';

import { useEffect } from 'react';
import { appRoute } from '@/lib/shared';

/**
 * The Safe App is registered at the domain root, but the root now serves the
 * Fumadocs landing. When Safe loads us inside its iframe, send the iframe to the
 * Vite Safe App under /safe-app so the apps-SDK handshake can run. Top-level
 * visitors (a normal browser tab) never match and just see the landing.
 */
export function SafeAppRedirect() {
  useEffect(() => {
    if (window.top !== window.self) {
      window.location.replace(appRoute);
    }
  }, []);
  return null;
}
