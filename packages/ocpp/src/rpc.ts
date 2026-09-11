import { randomUUID } from 'node:crypto';

/**
 * OCPP-J RPC framing. Every message is a JSON array:
 *   CALL        [2, uniqueId, action, payload]
 *   CALLRESULT  [3, uniqueId, payload]
 *   CALLERROR   [4, uniqueId, errorCode, errorDescription, errorDetails]
 * A charge point may only have one outgoing CALL in flight, so calls are queued per connection.
 */

export const MESSAGE_TYPE = { CALL: 2, CALL_RESULT: 3, CALL_ERROR: 4 } as const;

export const OCPP_ERROR_CODES = [
  'NotImplemented',
  'NotSupported',
  'InternalError',
  'ProtocolError',
  'SecurityError',
  'FormationViolation',
  'PropertyConstraintViolation',
  'OccurenceConstraintViolation',
  'TypeConstraintViolation',
  'GenericError',
] as const;
export type OcppErrorCode = (typeof OCPP_ERROR_CODES)[number];

export type Payload = Record<string, unknown>;

/** A CALLERROR received from the peer, or a failure to get any answer at all. */
export class OcppCallError extends Error {
  override readonly name = 'OcppCallError';
  readonly errorCode: string;
  readonly details: unknown;

  constructor(errorCode: string, message: string, details: unknown = {}) {
    super(message);
    this.errorCode = errorCode;
    this.details = details;
  }
}

/** A frame that is not valid OCPP-J at all. */
export class OcppFramingError extends Error {
  override readonly name = 'OcppFramingError';
}

export type OcppFrame =
  | { readonly kind: 'call'; readonly id: string; readonly action: string; readonly payload: Payload }
  | { readonly kind: 'result'; readonly id: string; readonly payload: Payload }
  | {
      readonly kind: 'error';
      readonly id: string;
      readonly errorCode: string;
      readonly description: string;
      readonly details: unknown;
    };

const isPayload = (value: unknown): value is Payload =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseFrame(raw: string): OcppFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OcppFramingError('message is not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw new OcppFramingError('message must be a JSON array of at least 3 elements');
  }
  const [messageTypeId, id] = parsed;
  if (typeof id !== 'string' || id.length === 0 || id.length > 36) {
    throw new OcppFramingError('uniqueId must be a string of 1..36 characters');
  }

  if (messageTypeId === MESSAGE_TYPE.CALL) {
    const [, , action, payload] = parsed;
    if (typeof action !== 'string' || action.length === 0) throw new OcppFramingError('CALL needs an action name');
    if (!isPayload(payload)) throw new OcppFramingError('CALL payload must be an object');
    return { kind: 'call', id, action, payload };
  }
  if (messageTypeId === MESSAGE_TYPE.CALL_RESULT) {
    const [, , payload] = parsed;
    if (!isPayload(payload)) throw new OcppFramingError('CALLRESULT payload must be an object');
    return { kind: 'result', id, payload };
  }
  if (messageTypeId === MESSAGE_TYPE.CALL_ERROR) {
    const [, , errorCode, description, details] = parsed;
    if (typeof errorCode !== 'string') throw new OcppFramingError('CALLERROR needs an errorCode');
    return {
      kind: 'error',
      id,
      errorCode,
      description: typeof description === 'string' ? description : '',
      details: details ?? {},
    };
  }
  throw new OcppFramingError(`unknown messageTypeId ${String(messageTypeId)}`);
}

export const serialiseCall = (id: string, action: string, payload: Payload): string =>
  JSON.stringify([MESSAGE_TYPE.CALL, id, action, payload]);

export const serialiseResult = (id: string, payload: Payload): string =>
  JSON.stringify([MESSAGE_TYPE.CALL_RESULT, id, payload]);

export const serialiseError = (id: string, errorCode: OcppErrorCode, description: string, details: unknown = {}): string =>
  JSON.stringify([MESSAGE_TYPE.CALL_ERROR, id, errorCode, description, details]);

export type IncomingCallHandler = (action: string, payload: Payload) => Promise<Payload> | Payload;

export interface OcppRpcOptions {
  /** Real milliseconds to wait for a CALLRESULT before giving up. */
  readonly callTimeoutMs?: number;
  readonly generateId?: () => string;
  /** Reports framing problems and unmatched replies; never throws into the socket. */
  readonly onWarning?: (message: string, detail?: unknown) => void;
}

interface QueuedCall {
  readonly action: string;
  readonly payload: Payload;
  readonly resolve: (value: never) => void;
  readonly reject: (error: Error) => void;
}

interface PendingCall {
  readonly action: string;
  readonly resolve: (value: never) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout> | null;
}

export const DEFAULT_CALL_TIMEOUT_MS = 10_000;

export class OcppRpc {
  private readonly pending = new Map<string, PendingCall>();
  private readonly queue: QueuedCall[] = [];
  private inFlight = false;
  private closed = false;

  constructor(
    private readonly send: (data: string) => void,
    private readonly handleCall: IncomingCallHandler,
    private readonly options: OcppRpcOptions = {},
  ) {}

  get pendingCount(): number {
    return this.pending.size + this.queue.length;
  }

  /** Send a CALL and resolve with the peer's CALLRESULT payload. */
  async call<TResponse>(action: string, payload: Payload = {}): Promise<TResponse> {
    if (this.closed) throw new OcppCallError('GenericError', `connection closed, cannot send ${action}`);
    return new Promise<TResponse>((resolve, reject) => {
      this.queue.push({ action, payload, resolve: resolve as (value: never) => void, reject });
      this.pump();
    });
  }

  /** Feed one received frame. Never throws: protocol problems answer with CALLERROR or a warning. */
  async receive(raw: string): Promise<void> {
    let frame: OcppFrame;
    try {
      frame = parseFrame(raw);
    } catch (error) {
      this.warn(`dropped malformed frame: ${(error as Error).message}`, raw);
      return;
    }

    if (frame.kind === 'result') {
      this.settle(frame.id, (entry) => entry.resolve(frame.payload as never));
      return;
    }
    if (frame.kind === 'error') {
      this.settle(frame.id, (entry) =>
        entry.reject(new OcppCallError(frame.errorCode, `${entry.action}: ${frame.description}`, frame.details)),
      );
      return;
    }

    try {
      const response = await this.handleCall(frame.action, frame.payload);
      this.send(serialiseResult(frame.id, response ?? {}));
    } catch (error) {
      const code: OcppErrorCode =
        error instanceof OcppCallError && (OCPP_ERROR_CODES as readonly string[]).includes(error.errorCode)
          ? (error.errorCode as OcppErrorCode)
          : 'InternalError';
      this.send(serialiseError(frame.id, code, (error as Error).message ?? 'handler failed'));
    }
  }

  /** Reject everything outstanding; used when the socket drops. */
  close(reason = 'connection closed'): void {
    this.closed = true;
    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(new OcppCallError('GenericError', `${entry.action}: ${reason}`));
    }
    while (this.queue.length > 0) {
      const queued = this.queue.shift();
      queued?.reject(new OcppCallError('GenericError', `${queued.action}: ${reason}`));
    }
    this.inFlight = false;
  }

  private pump(): void {
    if (this.inFlight || this.closed) return;
    const next = this.queue.shift();
    if (!next) return;
    this.inFlight = true;
    this.dispatch(next);
  }

  private dispatch(queued: QueuedCall): void {
    const id = this.options.generateId?.() ?? randomUUID();
    const timeoutMs = this.options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const timer = setTimeout(() => {
      this.settle(id, (entry) =>
        entry.reject(new OcppCallError('GenericError', `${entry.action} timed out after ${timeoutMs} ms`)),
      );
    }, timeoutMs);
    timer.unref?.();
    this.pending.set(id, { action: queued.action, resolve: queued.resolve, reject: queued.reject, timer });
    try {
      this.send(serialiseCall(id, queued.action, queued.payload));
    } catch (error) {
      this.settle(id, (entry) => entry.reject(error as Error));
    }
  }

  private settle(id: string, finish: (entry: PendingCall) => void): void {
    const entry = this.pending.get(id);
    if (!entry) {
      this.warn(`reply for unknown call id ${id}`);
      return;
    }
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(id);
    this.inFlight = false;
    finish(entry);
    this.pump();
  }

  private warn(message: string, detail?: unknown): void {
    this.options.onWarning?.(message, detail);
  }
}
