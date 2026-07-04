"use client";

import { useMemo, useState } from "react";
import {
  MAP_LAYER_PILLS,
  LEGEND_META,
  type MapLayerKey,
} from "@/lib/map-layers";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui";
import type { MapFarmer, MapStore, StoreListItem } from "./types";
import { colorFor, valueFor } from "./layer-util";
import { MapCanvas } from "./MapCanvas";
import { FarmerDetailPanel } from "./FarmerDetailPanel";
import { StoreList } from "./StoreList";
import { StoreFarmersPanel } from "./StoreFarmersPanel";

const LABEL_CHIP =
  "mr-1 flex-none text-[10.5px] font-bold uppercase tracking-[0.8px] text-[#9E9E9E]";

export function MapView({
  farmers,
  stores,
  allStores,
  categories,
}: {
  farmers: MapFarmer[];
  stores: MapStore[];
  allStores: StoreListItem[];
  categories: string[];
}) {
  const [layer, setLayer] = useState<MapLayerKey>("segment");
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<number>>(new Set());
  const [showStorePins, setShowStorePins] = useState(true);
  const [selectedFarmerId, setSelectedFarmerId] = useState<number | null>(null);

  const selectedFarmer = useMemo(
    () => farmers.find((f) => f.id === selectedFarmerId) ?? null,
    [farmers, selectedFarmerId],
  );
  const selectedStores = useMemo(
    () => allStores.filter((s) => selectedStoreIds.has(s.id)),
    [allStores, selectedStoreIds],
  );
  const selectedIdList = useMemo(() => [...selectedStoreIds], [selectedStoreIds]);
  const activeLayerLabel = LEGEND_META[layer].label;

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

  const toggleStore = (id: number) => {
    setSelectedStoreIds((cur) => {
      const n = new Set(cur);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setSelectedFarmerId(null);
  };
  const clearStores = () => {
    setSelectedStoreIds(new Set());
    setSelectedFarmerId(null);
  };

  if (allStores.length === 0) {
    return (
      <div className="animate-[fadeUp_0.4s_ease-out]">
        <EmptyState
          title="No stores yet"
          hint="Import the store master data to build clusters."
        />
      </div>
    );
  }

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {/* Layer controls */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className={LABEL_CHIP}>Map Layer:</div>
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
          Store Pins
        </button>
      </div>

      {/* Store list + map */}
      <div className="flex flex-col gap-3.5 lg:flex-row">
        <div className="h-[420px] w-full lg:h-[520px] lg:w-[300px] lg:flex-none">
          <StoreList
            stores={allStores}
            selectedIds={selectedIdList}
            onToggle={toggleStore}
            onClear={clearStores}
          />
        </div>

        <div className="flex min-w-0 flex-1 overflow-hidden rounded-[14px] border border-black/[0.04] bg-white shadow-card">
          <div className="relative h-[420px] min-w-0 flex-1 overflow-hidden lg:h-[520px]">
            <MapCanvas
              farmers={farmers}
              stores={stores}
              layer={layer}
              selectedStoreIds={selectedIdList}
              showStorePins={showStorePins}
              selectedFarmerId={selectedFarmerId}
              onSelectFarmer={(f) => setSelectedFarmerId(f.id)}
              onToggleStore={toggleStore}
            />
          </div>
          {selectedFarmer && (
            <FarmerDetailPanel
              farmer={selectedFarmer}
              layerLabel={activeLayerLabel}
              layerValue={valueFor(layer, selectedFarmer)}
              layerColor={colorFor(layer, selectedFarmer)}
              onClose={() => setSelectedFarmerId(null)}
            />
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5 rounded-[12px] border border-black/[0.03] bg-white px-[18px] py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="mr-1.5 flex-none text-[9.5px] font-bold uppercase tracking-[0.7px] text-[#9E9E9E]">
          👤 {activeLayerLabel}
        </div>
        {legendItems.length === 0 ? (
          <span className="text-[11px] text-[#9E9E9E]">
            Farmer overlay shows geo-tagged farmers only — select a store below to work with its full list.
          </span>
        ) : (
          legendItems.map((li) => (
            <span
              key={li.label}
              className="my-0.5 flex items-center gap-1.5 rounded-[20px] bg-[#F5F5F5] px-[9px] py-[3px]"
            >
              <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: li.color }} />
              <span className="text-[11px] font-medium text-[#616161]">{li.label}</span>
              <span className="text-[10px] font-bold text-[#9E9E9E]">({li.count})</span>
            </span>
          ))
        )}
      </div>

      {/* Selected stores' farmers + cluster builder */}
      {selectedStores.length > 0 ? (
        <StoreFarmersPanel
          key={selectedIdList.join(",")}
          stores={selectedStores}
          categories={categories}
        />
      ) : (
        <div className="mt-3.5 rounded-[14px] border border-dashed border-line bg-white px-6 py-10 text-center">
          <div className="text-[14px] font-semibold text-ink">Select one or more stores to build a cluster</div>
          <div className="mt-1 text-[12px] text-ink-muted">
            Tick stores in the list (or click pins on the map) to see their farmers, filter by village,
            crop, purchase behaviour or segment, and save a cluster for later action.
          </div>
        </div>
      )}
    </div>
  );
}
