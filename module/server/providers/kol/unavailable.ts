import type { KolProviderPort } from "./types.js";

/** No provider client, credentials, mock catalog or network in local article mode. */
export function unavailablePublishingProvider(mode: KolProviderPort["mode"]): KolProviderPort {
  const unavailable = async (): Promise<never> => {
    throw new Error("Media publishing provider is not configured");
  };
  return { mode, listResources: unavailable, createOrder: unavailable,
    listOrders: unavailable, getOrderByOrderId: unavailable };
}
