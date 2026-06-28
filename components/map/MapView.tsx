"use client";

import { useMemo, useState } from "react";
import {
  MAP_LAYER_PILLS,
  LAYER_LABELS,
  LEGEND_META,
  type MapLayerKey,
} from "@/lib/map-layers";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui";
import type { MapFarmer, MapStore } from "./types";
import { colorFor, valueFor, matchesFilter } from "./layer-util";
import { MapCanvas } from "./MapCanvas";
import { FarmerDetailPanel } from "./FarmerDetailPanel";
import { ClusterModal } from "./ClusterModal";

const LABEL_CHIP =
  "mr-1 flex-none text-[10.5px] font-bold uppercase tracking-[0.8px] text-[#9E9E9E]";

export function MapView({
  farmers,
  stores,
}: {
  farmers: MapFarmer[];
  stores: MapStore[];
}) {
  const [layer, setLayer] = useState<MapLayerKey>("segment");
  const [storeFilter, setStoreFilter] = useState<number | null>(null);
  const [showStorePins, setShowStorePins] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [modalFilter, setModalFilter] = useState("all");

  const selected = useMemo(
    () => farmers.find((f) => f.id === selectedId) ?? null,
    [farmers, selectedId],
  );

  const activeLayerLabel = LEGEND_META[layer].label;
  const narrowLabel = LAYER_LABELS[layer];
  const currentStoreName =
    storeFilter === null
      ? "All Stores"
      : stores.find((s) => s.id === storeFilter)?.name ?? "All Stores";

  // Legend chips: count plotted farmers whose colour matches each legend item; hide zero.
  const legendItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of farmers) {
      const c = colorFor(layer, f);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return LEGEND_META[layer].items
      .map((it) => ({ ...it, count: counts.get(it.color) ?? 0 }))
      .filter((it) => it.count > 0);
  }, [farmers, layer]);

  // Cluster preview: farmers in the (optional) store filter that match the narrow-by value.
  const modalFarmers = useMemo(
    () =>
      farmers.filter(
        (f) =>
          (storeFilter === null || f.storeId === storeFilter) &&
          matchesFilter(layer, f, modalFilter),
      ),
    [farmers, storeFilter, layer, modalFilter],
  );

  function openModal(seedFilter: string) {
    setDraftName("");
    setModalFilter(seedFilter);
    setShowModal(true);
  }

  function toggleStore(id: number) {
    setStoreFilter((cur) => (cur === id ? null : id));
    setSelectedId(null);
  }

  if (farmers.length === 0 && stores.length === 0) {
    return (
      <div className="animate-[fadeUp_0.4s_ease-out]">
        <EmptyState
          title="No mappable data yet"
          hint="Seed the database to plot farmers and stores on the map."
        />
      </div>
    );
  }

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {/* Layer Controls Bar */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className={LABEL_CHIP}>Farmer Layer:</div>
        {MAP_LAYER_PILLS.map((ml) => {
          const active = ml.key === layer;
          return (
            <button
              key={ml.key}
              type="button"
              onClick={() => setLayer(ml.key)}
              className="flex items-center gap-1.5 rounded-[20px] border-[1.5px] px-3.5 py-1.5 text-[12px] font-semibold transition-all hover:opacity-85"
              style={{
                background: active ? "#1A3A1A" : "#FFFFFF",
                color: active ? "#FFFFFF" : "#616161",
                borderColor: active ? "#1A3A1A" : "#E0E0E0",
              }}
            >
              <span className="h-2 w-2 rounded-[2px]" style={{ background: ml.swatch }} />
              {ml.label}
            </button>
          );
        })}
        <div className="ml-auto text-[12px] font-medium text-[#9E9E9E]">
          {farmers.length} farmers · {stores.length} stores
        </div>
      </div>

      {/* Store Filter Bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className={LABEL_CHIP}>Store Filter:</div>
        {[null, ...stores.map((s) => s.id)].map((id) => {
          const store = id === null ? null : stores.find((s) => s.id === id) ?? null;
          const active = storeFilter === id;
          const accent = store?.color ?? "#1A3A1A";
          return (
            <button
              key={id ?? "all"}
              type="button"
              onClick={() => {
                if (id === null) {
                  setStoreFilter(null);
                  setSelectedId(null);
                } else {
                  toggleStore(id);
                }
              }}
              className="flex items-center gap-1.5 rounded-[20px] border-[1.5px] px-3.5 py-1.5 text-[11.5px] font-semibold transition-all hover:opacity-[0.82]"
              style={{
                background: active ? accent : "#FFFFFF",
                color: active ? "#FFFFFF" : "#616161",
                borderColor: active ? accent : "#E0E0E0",
              }}
            >
              {store && (
                <span
                  className="h-[7px] w-[7px] rounded-[1px] active:scale-[0.97]"
                  style={{ background: active ? "#FFFFFF" : store.color }}
                />
              )}
              {store ? store.shortName : "All Stores"}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowStorePins((v) => !v)}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-[20px] border-[1.5px] px-3.5 py-1.5 text-[11.5px] font-semibold",
            showStorePins
              ? "border-[#C8E6C9] bg-[#E8F5E9] text-[#2E7D32]"
              : "border-[#E0E0E0] bg-[#F5F5F5] text-[#616161] hover:bg-[#EEEEEE]",
          )}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="1" y="3" width="10" height="7" rx="1" />
            <path d="M4 3V2a2 2 0 014 0v1" />
          </svg>
          Store Pins
        </button>
      </div>

      {/* Sub-header + New Action */}
      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-[12px] text-[#9E9E9E]">
          <span className="font-semibold text-[#1A1C1A]">{farmers.length}</span> farmers · Layer:{" "}
          <span className="font-semibold text-[#1A1C1A]">{activeLayerLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => openModal("all")}
          className="flex items-center gap-2 rounded-[10px] bg-[#1A3A1A] px-5 py-[9px] text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(26,58,26,0.25)] transition-colors hover:bg-[#2E7D32]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          New Action
        </button>
      </div>

      {/* Map Container */}
      <div className="mb-3.5 flex overflow-hidden rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="relative h-[564px] min-w-0 flex-1 overflow-hidden">
          <MapCanvas
            farmers={farmers}
            stores={stores}
            layer={layer}
            storeFilter={storeFilter}
            showStorePins={showStorePins}
            selectedFarmerId={selectedId}
            onSelectFarmer={(f) => setSelectedId(f.id)}
            onToggleStore={toggleStore}
          />
        </div>

        {selected && (
          <FarmerDetailPanel
            farmer={selected}
            layerLabel={activeLayerLabel}
            layerValue={valueFor(layer, selected)}
            layerColor={colorFor(layer, selected)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* Legend Bars */}
      <div className="flex flex-wrap gap-3">
        {/* Farmer legend */}
        <div className="flex min-w-[300px] flex-1 flex-wrap items-center gap-1.5 rounded-[12px] border border-black/[0.03] bg-white px-[18px] py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mr-1.5 flex-none text-[9.5px] font-bold uppercase tracking-[0.7px] text-[#9E9E9E]">
            👤 {activeLayerLabel}
          </div>
          {legendItems.length === 0 ? (
            <span className="text-[11px] text-[#9E9E9E]">No farmers in this layer.</span>
          ) : (
            legendItems.map((li) => (
              <button
                key={li.label}
                type="button"
                onClick={() => openModal("all")}
                className="my-0.5 flex items-center gap-1.5 rounded-[20px] bg-[#F5F5F5] px-[9px] py-[3px] hover:bg-[#E8F5E9] hover:outline hover:outline-[1.5px] hover:outline-[#A5D6A7]"
              >
                <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: li.color }} />
                <span className="text-[11px] font-medium text-[#616161]">{li.label}</span>
                <span className="text-[10px] font-bold text-[#9E9E9E]">({li.count})</span>
              </button>
            ))
          )}
        </div>

        {/* Store legend */}
        <div className="flex min-w-[300px] flex-1 flex-wrap items-center gap-1.5 rounded-[12px] border border-black/[0.03] bg-white px-[18px] py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mr-1.5 flex-none text-[9.5px] font-bold uppercase tracking-[0.7px] text-[#9E9E9E]">
            🏪 Stores
          </div>
          {stores.length === 0 ? (
            <span className="text-[11px] text-[#9E9E9E]">No stores located.</span>
          ) : (
            stores.map((sp) => (
              <div
                key={sp.id}
                className="my-0.5 flex items-center gap-1.5 rounded-[20px] bg-[#F5F5F5] px-[9px] py-[3px]"
              >
                <span className="h-[9px] w-[9px] flex-none rounded-[2px]" style={{ background: sp.color }} />
                <span className="text-[11px] font-medium text-[#616161]">{sp.shortName}</span>
                <span className="text-[10px] font-bold text-[#9E9E9E]">({sp.farmerCount})</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Cluster Modal */}
      {showModal && (
        <ClusterModal
          layer={layer}
          layerLabel={narrowLabel}
          storeName={currentStoreName}
          draftName={draftName}
          filterValue={modalFilter}
          matchedFarmers={modalFarmers}
          onChangeName={setDraftName}
          onChangeFilter={setModalFilter}
          onClose={() => setShowModal(false)}
          onSave={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
