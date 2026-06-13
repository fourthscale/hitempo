/**
 * Typed error hierarchy for the geocoding subsystem. Mirrors the
 * project convention (`AuthError`, `LlmError`, `GmailError`) so call
 * sites can `instanceof` to handle specific cases.
 */

export abstract class GeocodingError extends Error {
  public readonly name = this.constructor.name;
}

/** The address was empty / not enough material to geocode. */
export class GeocodingEmptyAddressError extends GeocodingError {
  constructor() {
    super("Address is empty — cannot geocode");
  }
}

/** The provider answered but didn't find a match for the address. */
export class GeocodingNotFoundError extends GeocodingError {
  constructor(public readonly query: string) {
    super(`No geocoding result for: ${query}`);
  }
}

/** HTTP / network failure talking to the provider. Retryable. */
export class GeocodingHttpError extends GeocodingError {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}
