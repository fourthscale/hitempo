"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Building2, Users } from "lucide-react";
import type { LatLngBoundsLiteral } from "leaflet";

// Sprint 14 — Leaflet only works in the browser (it touches `window` +
// `document` at module top level). Force a client-only render via
// next/dynamic ; the wrapper renders a small placeholder until the
// bundle is fetched.
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false },
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false },
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false },
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false },
);

// Default Leaflet marker icons reference image URLs that break under
// bundlers (the relative paths it uses don't survive webpack). We import
// the marker assets directly and rebind the default icon once on the
// client. This is the standard workaround documented by Leaflet itself.
function useLeafletIconFix() {
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const L = await import("leaflet");
      const iconUrl = (await import("leaflet/dist/images/marker-icon.png")).default;
      const iconRetinaUrl = (await import("leaflet/dist/images/marker-icon-2x.png")).default;
      const shadowUrl = (await import("leaflet/dist/images/marker-shadow.png")).default;
      if (!mounted) return;
      L.Marker.prototype.options.icon = L.icon({
        iconUrl: typeof iconUrl === "string" ? iconUrl : (iconUrl as { src: string }).src,
        iconRetinaUrl:
          typeof iconRetinaUrl === "string"
            ? iconRetinaUrl
            : (iconRetinaUrl as { src: string }).src,
        shadowUrl: typeof shadowUrl === "string" ? shadowUrl : (shadowUrl as { src: string }).src,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });
    })();
    return () => {
      mounted = false;
    };
  }, []);
}

export type FieldMapPin = {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  company: {
    id: string;
    name: string;
    status: string;
    industry: string | null;
    signalType: string | null;
  };
};

/** Fallback view = mainland France when there are no pins to anchor on. */
const FRANCE_CENTER: [number, number] = [46.6, 2.0];
const FRANCE_ZOOM = 6;

export function FieldMap({ pins }: { pins: FieldMapPin[] }) {
  const t = useTranslations("pages.field");
  const tStatus = useTranslations("companyStatus");
  useLeafletIconFix();

  // Auto-fit the viewport to the rendered pins. When we have at least
  // one pin we compute a bounds rectangle and let MapContainer fit it.
  // With 0 pins we show all France.
  const bounds = useMemo<LatLngBoundsLiteral | null>(() => {
    if (pins.length === 0) return null;
    let minLat = pins[0]!.lat;
    let maxLat = pins[0]!.lat;
    let minLng = pins[0]!.lng;
    let maxLng = pins[0]!.lng;
    for (const pin of pins) {
      if (pin.lat < minLat) minLat = pin.lat;
      if (pin.lat > maxLat) maxLat = pin.lat;
      if (pin.lng < minLng) minLng = pin.lng;
      if (pin.lng > maxLng) maxLng = pin.lng;
    }
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }, [pins]);

  // `key` forces MapContainer to remount when the pin set changes
  // (e.g. user applies a filter). Without it, Leaflet keeps the old
  // center/zoom because MapContainer's bounds prop is read once at
  // mount only. We derive the key from a stable fingerprint of the
  // pin set — no state, no useEffect-setState anti-pattern.
  const mountKey = useMemo(
    () => pins.map((p) => p.id).join("|") || "empty",
    [pins],
  );

  return (
    <div className="h-[70vh] rounded-lg border border-border overflow-hidden bg-secondary/30">
      <MapContainer
        key={mountKey}
        center={bounds ? undefined : FRANCE_CENTER}
        zoom={bounds ? undefined : FRANCE_ZOOM}
        bounds={bounds ?? undefined}
        boundsOptions={{ padding: [40, 40] }}
        className="h-full w-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => (
          <Marker key={pin.id} position={[pin.lat, pin.lng]}>
            <Popup>
              <div className="text-xs space-y-1 min-w-[200px]">
                <div className="font-medium text-sm text-foreground">{pin.name}</div>
                <div className="text-muted-foreground">
                  {[pin.addressLine1, pin.postalCode, pin.city].filter(Boolean).join(", ")}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Link
                    href={`/companies/${pin.company.id}`}
                    className="inline-flex items-center gap-1 text-brand-teal hover:underline"
                  >
                    <Building2 className="h-3 w-3" />
                    {pin.company.name}
                  </Link>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                    {tStatus(pin.company.status as Parameters<typeof tStatus>[0])}
                  </span>
                  {pin.company.industry && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      {pin.company.industry}
                    </span>
                  )}
                  {pin.company.signalType && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                      {pin.company.signalType}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 pt-1 border-t border-border mt-2">
                  <Link
                    href={`/companies/${pin.company.id}`}
                    className="text-brand-teal hover:underline"
                  >
                    {t("popup.viewCompany")}
                  </Link>
                  <Link
                    href={`/contacts?companyId=${pin.company.id}`}
                    className="text-brand-teal hover:underline inline-flex items-center gap-1"
                  >
                    <Users className="h-3 w-3" />
                    {t("popup.viewContacts")}
                  </Link>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
