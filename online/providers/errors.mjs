/** Provider failure with a stable machine code, safe to show and to store (never contains credentials or response bodies). */
export class ProviderError extends Error {
  constructor(code, message, { retryable = false, status } = {}) {
    super(message); this.name = 'ProviderError'; this.code = code; this.retryable = retryable; this.status = status;
  }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable, ...(this.status ? { status: this.status } : {}) }; }
}
export const asProviderError = (e) => e instanceof ProviderError ? e
  : e?.name === 'AbortError' || e?.code === 'cancelled' ? new ProviderError('cancelled', 'The request was cancelled.')
  : e?.name === 'TimeoutError' ? new ProviderError('timeout', 'The provider did not answer in time.', { retryable: true })
  : new ProviderError(typeof e?.code === 'string' && /^[a-z_0-9]{2,60}$/.test(e.code) ? e.code : 'provider_failed', 'The provider request failed.', { retryable: false });
