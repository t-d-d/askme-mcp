// The settings an AWS client of the service starts from. In production the
// client finds its region and credentials in Lambda's environment, so it
// needs none. In the integration tier it points at a stand-in on this
// machine, which accepts any credentials (ADR 9).
export function awsClientConfig(endpoint: string | undefined) {
  return endpoint === undefined
    ? {}
    : {
        endpoint,
        region: "us-east-1",
        credentials: { accessKeyId: "local", secretAccessKey: "local" },
      };
}
