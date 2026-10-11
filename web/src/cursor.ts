// Cursor's one-click link for adding a remote MCP server. Its page opens
// Cursor and offers to add the server, which it reads from base64 JSON.
export function cursorInstallLink(mcpUrl: string): string {
  const params = new URLSearchParams({
    name: "askme",
    config: btoa(JSON.stringify({ url: mcpUrl })),
  });
  return `https://cursor.com/en/install-mcp?${params.toString()}`;
}
