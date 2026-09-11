/** Response envelope used by every REST endpoint. */
export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export type ApiEnvelope<T> =
  | { readonly ok: true; readonly data: T; readonly meta?: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: ApiError };
