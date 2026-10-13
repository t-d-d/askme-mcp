// Cursor's one-click install link carries the server's config as base64 JSON.
export function cursorInstallLink(mcpUrl: string): string {
  const params = new URLSearchParams({
    name: "askme",
    config: btoa(JSON.stringify({ url: mcpUrl })),
  });
  return `https://cursor.com/en/install-mcp?${params.toString()}`;
}
