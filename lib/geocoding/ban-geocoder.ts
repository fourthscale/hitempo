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

const BAN_SEARCH_URL = "https://api-adresse.data.gouv.fr/search/";

type BanFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    id?: string;
    score?: number;
  };
};
type BanSearchResponse = {
  features?: BanFeature[];
};

/**
 * BAN — Base Adresse Nationale, the official French government
 * geocoding API. Free, no key, no rate limit (per the docs), high
 * precision on FR addresses.
 *
 * Endpoint contract :
 *   https://api-adresse.data.gouv.fr/search/?q=<query>&limit=1
 *
 * Documented at https://adresse.data.gouv.fr/api-doc/adresse — the
 * response is GeoJSON ; we only need the first feature's coordinates.
 */
export class BanGeocoder implements GeocodingStrategy {
  public readonly providerName = "ban";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  public async geocode(input: GeocodingInput): Promise<GeocodingResult> {
    const query = composeAddressQuery(input);
    if (query.length === 0) throw new GeocodingEmptyAddressError();

    const url = `${BAN_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=1`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw new GeocodingHttpError(
        `BAN network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new GeocodingHttpError(
        `BAN returned ${response.status} for: ${query}`,
        response.status,
      );
    }

    const json = (await response.json()) as BanSearchResponse;
    const feature = json.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (
      !coords ||
      coords.length !== 2 ||
      typeof coords[0] !== "number" ||
      typeof coords[1] !== "number"
    ) {
      throw new GeocodingNotFoundError(query);
    }
    // GeoJSON convention : [lng, lat]. Watch the order.
    const [lng, lat] = coords;
    return {
      lat,
      lng,
      providerId: feature.properties?.id ?? null,
      confidence:
        typeof feature.properties?.score === "number"
          ? feature.properties.score
          : null,
    };
  }
}
