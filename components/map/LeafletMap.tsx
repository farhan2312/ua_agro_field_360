"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { MapLayerKey } from "@/lib/map-layers";
import { initials } from "@/lib/format";
import type { MapFarmer, MapStore } from "./types";
import { colorFor } from "./layer-util";

// Center on Uttar Pradesh (covers Barabanki / Amethi / Raebareli / Lakhimpur Kheri).
const UP_CENTER: [number, number] = [27.3, 81.3];
const UP_ZOOM = 7;

function farmerIcon(f: MapFarmer, color: string, selected: boolean, dimmed: boolean): L.DivIcon {
  const size = selected ? 40 : 30;
  const border = selected ? 3.5 : 2.5;
  const shadow = selected
    ? "0 4px 12px rgba(0,0,0,0.35)"
    : "0 2px 5px rgba(0,0,0,0.25)";
  const font = selected ? 12 : 10;
  const html = `
    <div style="transform:translate(-50%,-100%);opacity:${dimmed ? 0.18 : 1};">
      <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border}px solid #fff;box-shadow:${shadow};display:flex;align-items:center;justify-content:center;">
        <span style="font-size:${font}px;font-weight:700;color:#fff;line-height:1;">${initials(f.name)}</span>
      </div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid ${color};margin:0 auto;opacity:0.9;"></div>
    </div>`;
  return L.divIcon({
    html,
    className: "ua-pin",
    iconSize: [size, size],
    iconAnchor: [0, 0],
  });
}

function storeIcon(s: MapStore, selected: boolean): L.DivIcon {
  const border = selected ? 3 : 2;
  const shadow = selected
    ? `0 0 0 4px ${s.color}33, 0 4px 12px rgba(0,0,0,0.3)`
    : "0 3px 8px rgba(0,0,0,0.3)";
  const html = `
    <div style="transform:translate(-50%,-100%);">
      <div style="width:36px;height:36px;border-radius:8px;background:${s.color};border:${border}px solid #fff;box-shadow:${shadow};display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1px;">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M1 5.5l1-3h10l1 3v1H1V5.5z" opacity="0.9"></path><rect x="2" y="6.5" width="10" height="6" rx="0.5" fill="#fff"></rect><rect x="5" y="8.5" width="4" height="4" rx="0.5" fill="${s.color}"></rect></svg>
        <span style="font-size:7px;font-weight:800;color:#fff;line-height:1;letter-spacing:0.3px;">${s.code}</span>
      </div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${s.color};margin:0 auto;"></div>
    </div>`;
  return L.divIcon({
    html,
    className: "ua-store-pin",
    iconSize: [36, 36],
    iconAnchor: [0, 0],
  });
}

export interface LeafletMapProps {
  farmers: MapFarmer[];
  stores: MapStore[];
  layer: MapLayerKey;
  storeFilter: number | null;
  showStorePins: boolean;
  selectedFarmerId: number | null;
  onSelectFarmer: (f: MapFarmer) => void;
  onToggleStore: (id: number) => void;
}

export default function LeafletMap({
  farmers,
  stores,
  layer,
  storeFilter,
  showStorePins,
  selectedFarmerId,
  onSelectFarmer,
  onToggleStore,
}: LeafletMapProps) {
  const farmerMarkers = useMemo(
    () =>
      farmers.map((f) => {
        const inFilter = storeFilter === null || f.storeId === storeFilter;
        const selected = f.id === selectedFarmerId;
        const color = colorFor(layer, f);
        return (
          <Marker
            key={`f-${f.id}`}
            position={[f.lat, f.lng]}
            icon={farmerIcon(f, color, selected, !inFilter)}
            zIndexOffset={selected ? 1000 : 0}
            opacity={inFilter ? 1 : 0.18}
            eventHandlers={{
              click: () => {
                if (inFilter) onSelectFarmer(f);
              },
            }}
          />
        );
      }),
    [farmers, layer, storeFilter, selectedFarmerId, onSelectFarmer],
  );

  const storeMarkers = useMemo(
    () =>
      stores.map((s) => (
        <Marker
          key={`s-${s.id}`}
          position={[s.lat, s.lng]}
          icon={storeIcon(s, s.id === storeFilter)}
          zIndexOffset={500}
          eventHandlers={{ click: () => onToggleStore(s.id) }}
        >
          <Tooltip direction="top" offset={[0, -40]} opacity={1}>
            {s.name}
          </Tooltip>
        </Marker>
      )),
    [stores, storeFilter, onToggleStore],
  );

  return (
    <MapContainer
      center={UP_CENTER}
      zoom={UP_ZOOM}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {farmerMarkers}
      {showStorePins && storeMarkers}
    </MapContainer>
  );
}
