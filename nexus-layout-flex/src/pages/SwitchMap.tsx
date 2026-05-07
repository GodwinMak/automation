import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import L from "leaflet";
import {
  LayersControl,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { PRODUCTION_URL } from "@/utils/Api";

type Device = {
  id: string;
  ip: string;
  name: string;
  lat: number | string | null;
  long: number | string | null;
};

type MapPoint = {
  id: string;
  ip: string;
  name: string;
  lat: number;
  long: number;
};

const DEFAULT_CENTER: [number, number] = [-6.8, 39.2];
const DEFAULT_ZOOM = 6;
const SWITCH_ICON = L.icon({
  iconUrl: "/marker-pin.svg",
  iconSize: [34, 34],
  iconAnchor: [17, 32],
  popupAnchor: [0, -28],
});

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;

    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.long]));
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, points]);

  return null;
}

function MapReady({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();

  useEffect(() => {
    onReady(map);
  }, [map, onReady]);

  return null;
}

export default function SwitchMap() {
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Record<string, L.Marker>>({});
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  useEffect(() => {
    const fetchDevices = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/devices?page=1&pageSize=10000&search=`
        );
        const devices: Device[] = res.data.devices || [];

        const normalized = devices
          .map((device) => {
            const lat = Number.parseFloat(String(device.lat));
            const long = Number.parseFloat(String(device.long));

            if (Number.isNaN(lat) || Number.isNaN(long)) return null;

            return {
              id: device.id,
              ip: device.ip,
              name: device.name,
              lat,
              long,
            } as MapPoint;
          })
          .filter(Boolean) as MapPoint[];

        setPoints(normalized);
      } catch (fetchError) {
        setError("Failed to load switch locations.");
        console.error(fetchError);
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
  }, []);

  const stats = useMemo(() => {
    const total = points.length;
    return { total };
  }, [points]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    return points.filter(
      (point) =>
        point.name.toLowerCase().includes(needle) ||
        point.ip.toLowerCase().includes(needle)
    );
  }, [points, query]);

  const moveToPoint = (point: MapPoint) => {
    const map = mapInstance || mapRef.current;
    if (!map) return;

    const targetZoom = Math.max(map.getZoom(), 15);
    map.flyTo([point.lat, point.long], targetZoom, {
      duration: 0.8,
      easeLinearity: 0.25,
    });
    const marker = markerRefs.current[point.id];
    if (marker) {
      window.setTimeout(() => marker.openPopup(), 600);
    }
    setSearchFeedback(`${point.name} (${point.ip})`);
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (matches.length === 0) {
      setSearchFeedback("No switches matched that search.");
      return;
    }

    moveToPoint(matches[0]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Switch Map</h1>
          <p className="text-sm text-muted-foreground">
            Live view of switch locations across the network.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-sm shadow-sm">
            <span className="text-muted-foreground">Markers</span>
            <span className="font-semibold text-foreground">{stats.total}</span>
          </div>
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-sm"
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or IP"
              className="h-9 w-56 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              Go
            </button>
          </form>
        </div>
      </div>

      {(query.length > 0 || searchFeedback) && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {query.length > 0
                ? `${matches.length} match${matches.length === 1 ? "" : "es"}`
                : "Search ready"}
            </span>
            {searchFeedback && (
              <span className="text-xs font-medium text-primary">{searchFeedback}</span>
            )}
          </div>
          {matches.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {matches.slice(0, 6).map((point) => (
                <button
                  key={point.id}
                  type="button"
                  onClick={() => moveToPoint(point)}
                  className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground transition hover:border-primary hover:text-primary"
                >
                  {point.name} · {point.ip}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {loading && (
          <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
            Loading map data...
          </div>
        )}
        {!loading && error && (
          <div className="flex h-[70vh] items-center justify-center text-sm text-destructive">
            {error}
          </div>
        )}
        {!loading && !error && (
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            className="h-[70vh] w-full"
            scrollWheelZoom
          >
            <MapReady
              onReady={(map) => {
                mapRef.current = map;
                setMapInstance(map);
              }}
            />
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name="Day View">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Night View">
                <TileLayer
                  attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite">
                <TileLayer
                  attribution='Tiles &copy; <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                />
              </LayersControl.BaseLayer>
            </LayersControl>
            {points.map((point) => (
              <Marker
                key={point.id}
                position={[point.lat, point.long]}
                icon={SWITCH_ICON}
                ref={(marker) => {
                  if (marker) {
                    markerRefs.current[point.id] = marker;
                  }
                }}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold text-black">{point.name}</div>
                    <div className="text-muted-foreground">{point.ip}</div>
                  </div>
                </Popup>
              </Marker>
            ))}
            <FitBounds points={points} />
          </MapContainer>
        )}
      </div>
    </div>
  );
}
