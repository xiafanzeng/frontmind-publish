/** Runtime knobs injected by the private host; provider code is module-owned, credentials stay on the server. */
export interface PublisherRuntimeConfig {
  providerEnabled: boolean;
  workerId: string;
  mode: "mock" | "test" | "live";
  realEnabled: boolean;
  publishEnabled: boolean;
  imageEnabled: boolean;
  publicOrigin: string;
  submissionIntervalMs: number;
}
