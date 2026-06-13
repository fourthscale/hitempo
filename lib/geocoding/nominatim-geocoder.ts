import "server-only";

import {
  GeocodingEmptyAddressError,
  GeocodingHttpError,
  GeocodingNotFoundError,
} from "./geocoding-errors";
import {
  composeAddressQuery,
  type GeocodingInput,
  type GeocodingResult,
  type GeocodingStrategy,
} from "./geocoding-strategy";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

type NominatimResult = {
  lat?: string;
  lon?: string;
  osm_id?: number | string;
  importance?: number;
};

/**
 * Nominatim — the OpenStreetMap-backed geocoding API. Free, worldwide,
 * no key required. The public instance enforces a "1 request / second
 * absolute maximum" usage policy + requires a meaningful User-Agent
 * header identifying the application. We honor both at this layer :
 * - User-Agent header set on every request.
 * - Optional per-instance rate limit baked into the constructor
 *   (`minIntervalMs`) ; the caller defaults to 1100 ms to stay safely
 *   under the 1 r/s ceiling. A single `lastRequestAt` timestamp is
 *   tracked per instance ; concurrent calls serialize automatically
 *   thanks to the await on a sleep promise.
 *
 * Bulk users (> a few thousand addresses / day) should self-host a
 * Nominatim mirror or move to a paid provider — that's a backlog item
 * if hitempo ever lands a big foreign customer.
 */
export class NominatimGeocoder implements GeocodingStrategy {
  public readonly providerName = "nominatim";
  private lastRequestAt = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly minIntervalMs: number = 1100,
    private readonly userAgent: string = "hitempo (https://hitempo.app)",
  ) {}

  public async geocode(input: GeocodingInput): Promise<GeocodingResult> {
    const query = composeAddressQuery(input);
    if (query.length === 0) throw new GeocodingEmptyAddressError();

    await this.waitForSlot();

    const url = `${NOMINATIM_SEARCH_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { "user-agent": this.userAgent, accept: "application/json" },
      });
    } catch (err) {
      throw new GeocodingHttpError(
        `Nominatim network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new GeocodingHttpError(
        `Nominatim returned ${response.status} for: ${query}`,
        response.status,
      );
    }

    const json = (await response.json()) as NominatimResult[];
    const first = json[0];
    if (
      !first ||
      typeof first.lat !== "string" ||
      typeof first.lon !== "string"
    ) {
      throw new GeocodingNotFoundError(query);
    }
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new GeocodingNotFoundError(query);
    }
    return {
      lat,
      lng,
      providerId: first.osm_id != null ? String(first.osm_id) : null,
      confidence:
        typeof first.importance === "number" ? first.importance : null,
    };
  }

  /** Per-instance rate-limit gate. Concurrent calls serialize on the
   *  shared `lastRequestAt` field. */
  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      const wait = this.minIntervalMs - elapsed;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }
}
