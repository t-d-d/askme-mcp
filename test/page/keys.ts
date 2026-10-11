// Where the browser tests and the stand-in for Clerk leave word for each
// other in the page's storage.
export const sessionKey = "askme-test-session";
export const askedForKey = "askme-test-asked-for";
// The event that tells the stand-in for Clerk the session in local storage
// changed, as Clerk tells a tab when another tab signs in or out.
export const sessionChangedEvent = "askme-test-session-changed";
