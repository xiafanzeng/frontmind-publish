export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  contentSha256?: string;
  cacheControl?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface StoredObject {
  key: string;
  etag?: string;
  size: number;
  contentType: string;
  contentSha256?: string;
}

export interface ObjectMetadata {
  key: string;
  exists: boolean;
  etag?: string;
  size?: number;
  contentType?: string;
  contentSha256?: string;
}

export interface PrivateObjectStore {
  put(input: PutObjectInput, signal?: AbortSignal): Promise<StoredObject>;
  delete(key: string, signal?: AbortSignal): Promise<void>;
  head(key: string, signal?: AbortSignal): Promise<ObjectMetadata>;
  signedGetUrl(key: string, expiresInSeconds?: number): string;
}

/** Authenticated server-side reads for development-only private storage. */
export interface PrivateObjectReader {
  read(
    key: string,
    signal?: AbortSignal,
    maxBytes?: number,
  ): Promise<Uint8Array | undefined>;
}
