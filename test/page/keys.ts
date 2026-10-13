// Shared by the browser tests and the stand-ins on the page.
export const sessionKey = "askme-test-session";
export const askedForKey = "askme-test-asked-for";
export const emailKey = "askme-test-email";
// A property of the page's window, not a storage key.
export const spokenKey = "askme-test-spoken";
// As Clerk tells a tab when another tab signs in or out.
export const sessionChangedEvent = "askme-test-session-changed";
// Set, sign-in stays loading, as when Clerk's script cannot be fetched.
export const signInStuckKey = "askme-test-sign-in-stuck";
// Set, the stand-in throws while rendering.
export const brokenKey = "askme-test-broken";
