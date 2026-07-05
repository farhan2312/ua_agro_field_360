"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { MapLayerKey } from "@/lib/map-layers";
import { initials } from "@/lib/format";
import type { MapFarmer, MapStore } from "./types";
import { colorFor } from "./layer-util";
import { HeatLayer, type HeatPoint } from "./HeatLayer";

// Center on Uttar Pradesh (covers Barabanki / Amethi / Raebareli / Lakhimpur Kheri).
const UP_CENTER: [number, number] = [27.3, 81.3];
const UP_ZOOM = 7;

function farmerIcon(f: MapFarmer, color: string, selected: boolean, dimmed: boolean): L.DivIcon {
  const size = selected ? 40 : 30;
  const border = selected ? 3.5 : 2.5;
  const shadow = selected ? "0 4px 12px rgba(0,0,0,0.35)" : "0 2px 5px rgba(0,0,0,0.25)";
  const font = selected ? 12 : 10;
  const html = `
    <div style="transform:translate(-50%,-100%);opacity:${dimmed ? 0.18 : 1};">
      <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border}px solid #fff;box-shadow:${shadow};display:flex;align-items:center;justify-content:center;">
        <span style="font-size:${font}px;font-weight:700;color:#fff;line-height:1;">${initials(f.name)}</span>
      </div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid ${color};margin:0 auto;opacity:0.9;"></div>
    </div>`;
  return L.divIcon({ html, className: "ua-pin", iconSize: [size, size], iconAnchor: [0, 0] });
}

function storeIcon(s: MapStore, selected: boolean, dimmed: boolean): L.DivIcon {
  const bg = dimmed ? "#9E9E9E" : s.color;
  const scale = selected ? 1.08 : dimmed ? 0.9 : 1;
  const opacity = dimmed ? 0.55 : 1;
  const ring = selected ? `0 0 0 3px ${s.color}66, ` : "";
  // Auto-sizing pill: the marker shrinks to fit its content (icon + code), so
  // the store code can never overflow the pin. `iconSize:undefined` lets the
  // element shrink-wrap; the inner translate(-50%,-100%) anchors the tail tip.
  const html = `
    <div style="display:inline-block;text-align:center;transform:translate(-50%,-100%) scale(${scale});opacity:${opacity};transition:opacity .2s;">
      <div style="display:inline-flex;align-items:center;gap:4px;height:21px;padding:0 8px 0 6px;border-radius:11px;background:${bg};border:2px solid #fff;box-shadow:${ring}0 2px 6px rgba(0,0,0,0.28);white-space:nowrap;">
        <svg width="10" height="10" viewBox="0 0 14 14" fill="#fff"><path d="M1 5.5l1-3h10l1 3v1H1V5.5z" opacity="0.95"></path><rect x="2" y="6.5" width="10" height="6" rx="0.5"></rect><rect x="5" y="8.5" width="4" height="4" rx="0.5" fill="${bg}"></rect></svg>
        <span style="font-size:9.5px;font-weight:800;color:#fff;line-height:1;letter-spacing:0.2px;">${s.code}</span>
      </div>
      <div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:6px solid ${bg};margin:0 auto;"></div>
    </div>`;
  return L.divIcon({ html, className: "ua-store-pin", iconSize: undefined, iconAnchor: [0, 0] });
}

/** Pans/zooms the map to fit the selected stores (or all when none) when `fitNonce` changes. */
function MapController({
  stores,
  selectedStoreIds,
  fitNonce,
}: {
  stores: MapStore[];
  selectedStoreIds: number[];
  fitNonce: number;
}) {
  const map = useMap();

  useEffect(() => {
    const focus =
      selectedStoreIds.length > 0
        ? stores.filter((s) => selectedStoreIds.includes(s.id))
        : stores;
    if (focus.length === 0) {
      map.flyTo(UP_CENTER, UP_ZOOM, { duration: 0.6 });
      return;
    }
    if (focus.length === 1) {
      map.flyTo([focus[0].lat, focus[0].lng], 13, { duration: 0.8 });
      return;
    }
    const bounds = L.latLngBounds(focus.map((s) => [s.lat, s.lng] as [number, number]));
    map.flyToBounds(bounds, {
      padding: [60, 60],
      maxZoom: selectedStoreIds.length > 0 ? 12 : 9,
      duration: 0.7,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  return null;
}

export interface LeafletMapProps {
  farmers: MapFarmer[];
  stores: MapStore[];
  layer: MapLayerKey;
  selectedStoreIds: number[];
  showStorePins: boolean;
  showHeat: boolean;
  selectedFarmerId: number | null;
  fitNonce: number;
  onSelectFarmer: (f: MapFarmer) => void;
  onToggleStore: (id: number) => void;
}

export default function LeafletMap({
  farmers,
  stores,
  layer,
  selectedStoreIds,
  fitNonce,
  showStorePins,
  showHeat,
  selectedFarmerId,
  onSelectFarmer,
  onToggleStore,
}: LeafletMapProps) {
  const hasSelection = selectedStoreIds.length > 0;
  const selSet = useMemo(() => new Set(selectedStoreIds), [selectedStoreIds]);

  // Farmer-density heat points: sqrt-scaled so a few very large stores don't
  // wash out the rest (counts range ~0–6.5k, median ~560).
  const heatPoints = useMemo<HeatPoint[]>(
    () =>
      stores
        .filter((s) => s.farmerCount > 0)
        .map((s) => ({ lat: s.lat, lng: s.lng, weight: Math.sqrt(s.farmerCount) })),
    [stores],
  );
  const heatMax = useMemo(
    () => heatPoints.reduce((m, p) => Math.max(m, p.weight), 0),
    [heatPoints],
  );

  const farmerMarkers = useMemo(
    () =>
      farmers.map((f) => {
        const inFilter = !hasSelection || (f.storeId != null && selSet.has(f.storeId));
        const selected = f.id === selectedFarmerId;
        const color = colorFor(layer, f);
        return (
          <Marker
            key={`f-${f.id}`}
            position={[f.lat, f.lng]}
            icon={farmerIcon(f, color, selected, !inFilter)}
            zIndexOffset={selected ? 1000 : 0}
            opacity={inFilter ? 1 : 0.18}
            eventHandlers={{ click: () => inFilter && onSelectFarmer(f) }}
          />
        );
      }),
    [farmers, layer, hasSelection, selSet, selectedFarmerId, onSelectFarmer],
  );

  // Always render every store; selected are highlighted, the rest dimmed (not hidden).
  const storeMarkers = useMemo(
    () =>
      stores.map((s) => {
        const selected = selSet.has(s.id);
        return (
          <Marker
            key={`s-${s.id}`}
            position={[s.lat, s.lng]}
            icon={storeIcon(s, selected, hasSelection && !selected)}
            zIndexOffset={selected ? 600 : 400}
            eventHandlers={{ click: () => onToggleStore(s.id) }}
          >
            <Tooltip direction="top" offset={[0, -40]} opacity={1}>
              {s.name}
              {selected ? " ✓" : ""}
            </Tooltip>
          </Marker>
        );
      }),
    [stores, hasSelection, selSet, onToggleStore],
  );

  return (
    <MapContainer center={UP_CENTER} zoom={UP_ZOOM} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController stores={stores} selectedStoreIds={selectedStoreIds} fitNonce={fitNonce} />
      <HeatLayer points={heatPoints} max={heatMax} show={showHeat} />
      {farmerMarkers}
      {showStorePins && storeMarkers}
    </MapContainer>
  );
}
