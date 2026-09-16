/** Public runtime knobs injected by the private worker assembly. Secrets and provider clients stay private. */
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
