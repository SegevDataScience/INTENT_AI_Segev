// Version of the privacy notice the end user agrees to in the widget.
// Bump it whenever the notice text in public/widget.js or public/privacy.html changes;
// feedback submitted under an older version is rejected until the user re-consents.
export const CONSENT_VERSION = '2026-11-06.2';

// Default retention for feedback and recordings (compliance ENG-003: 90 days).
export const DEFAULT_RETENTION_DAYS = 90;

export function isValidConsent(consent) {
  return !!consent && typeof consent === 'object' && consent.given === true && consent.version === CONSENT_VERSION;
}
