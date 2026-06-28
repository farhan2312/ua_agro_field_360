"use client";

import { useState } from "react";
import Link from "next/link";
import { CreateClusterModal } from "./CreateClusterModal";
import { ClusterGlyph, PlusGlyph, InfoGlyph, PersonGlyph } from "./icons";
import {
  type ClusterView,
  type ClusterFarmer,
  type StoreOption,
  listCriteriaText,
  detailCriteriaText,
  farmerInitials,
  avatarBg,
  segBg,
  segColor,
} from "./types";
import { cn } from "@/lib/cn";

interface Props {
  clusters: ClusterView[];
  /** All enriched demo farmers, ordered by id — used for detail rows + avatar index + modal preview. */
  farmers: ClusterFarmer[];
  stores: StoreOption[];
}

export function FarmerClustersScreen({ clusters, farmers, stores }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const hasNoCluster = clusters.length === 0;
  const selected = clusters.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {/* Header row */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="text-[22px] font-extrabold text-[#1A1C1A]">Farmer Clusters</div>
          <div className="mt-[3px] text-[12.5px] text-[#9E9E9E]">
            Segmented groups created from Map View selections · each cluster drives a targeted field action
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-[10px] bg-[#1A3A1A] px-5 py-[9px] text-[13px] font-bold text-white transition-colors hover:bg-[#2E7D32]"
        >
          <PlusGlyph />
          Create New Cluster
        </button>
      </div>

      {hasNoCluster ? (
        <EmptyClusters onCreate={() => setModalOpen(true)} />
      ) : (
        <div className="grid grid-cols-[1.1fr_1.6fr] gap-[18px]">
          {/* Left — cluster list */}
          <div className="flex flex-col gap-[10px]">
            {clusters.map((c) => (
              <ClusterListCard
                key={c.id}
                cluster={c}
                selected={c.id === selectedId}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
          </div>

          {/* Right — detail panel */}
          <div className="overflow-hidden rounded-[14px] border border-black/[0.03] bg-white shadow-card">
            {selected ? (
              <ClusterDetailPanel cluster={selected} farmers={farmers} />
            ) : (
              <ClusterEmptyHint />
            )}
          </div>
        </div>
      )}

      <CreateClusterModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        stores={stores}
        farmers={farmers}
      />
    </div>
  );
}

/* ── Empty state (no clusters) ── */
function EmptyClusters({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-[#E0E0E0] bg-white px-8 py-16 text-center shadow-card">
      <div className="mx-auto mb-[18px] flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F0F7F0]">
        <ClusterGlyph />
      </div>
      <div className="mb-2 text-base font-bold text-[#1A1C1A]">No clusters yet</div>
      <div className="mx-auto mb-[22px] max-w-[340px] text-[13px] leading-[1.6] text-[#9E9E9E]">
        Click <strong>Create New Cluster</strong> to pick a layer and store filter, or go to Map View
        to build one from a selection.
      </div>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 rounded-[10px] bg-[#1A3A1A] px-6 py-[10px] text-[13px] font-bold text-white transition-colors hover:bg-[#2E7D32]"
        >
          Create Cluster
        </button>
        <Link
          href="/map"
          className="inline-flex items-center gap-2 rounded-[10px] border border-[#E0E0E0] px-6 py-[10px] text-[13px] font-bold text-[#1A3A1A] transition-colors hover:bg-[#F0F7F0]"
        >
          Open Map View →
        </Link>
      </div>
    </div>
  );
}

/* ── Left list card ── */
function ClusterListCard({
  cluster,
  selected,
  onSelect,
}: {
  cluster: ClusterView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-[14px] border-[1.5px] bg-white px-[18px] py-4 text-left shadow-card transition-all duration-150",
        "hover:border-[#2E7D32] hover:shadow-[0_2px_8px_rgba(46,125,50,0.1)]",
        selected ? "border-[#2E7D32] shadow-[0_2px_8px_rgba(46,125,50,0.1)]" : "border-[#E0E0E0]",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-sm font-bold leading-[1.3] text-[#1A1C1A]">{cluster.name}</div>
        <div className="flex-none rounded-[20px] bg-[#E8F5E9] px-[9px] py-[2px] text-[10.5px] font-bold text-[#2E7D32]">
          {cluster.farmerCount} farmers
        </div>
      </div>
      <div className="mb-[6px] text-[11px] text-[#9E9E9E]">{listCriteriaText(cluster.criteria)}</div>
      <div className="text-[10.5px] text-[#BDBDBD]">Created {cluster.createdDate}</div>
    </button>
  );
}

/* ── Right detail panel ── */
function ClusterDetailPanel({
  cluster,
  farmers,
}: {
  cluster: ClusterView;
  farmers: ClusterFarmer[];
}) {
  const idSet = new Set(cluster.farmerIds);
  const members = farmers
    .map((f, idx) => ({ f, idx }))
    .filter(({ f }) => idSet.has(f.id));

  return (
    <>
      {/* Detail header */}
      <div className="border-b border-[#F0F0F0] px-[22px] pb-4 pt-5">
        <div className="mb-[6px] text-[17px] font-extrabold text-[#1A1C1A]">{cluster.name}</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-[5px] rounded-[20px] border border-[#C8E6C9] bg-[#E8F5E9] px-3 py-1">
            <InfoGlyph />
            <span className="text-[11px] font-bold text-[#2E7D32]">
              {detailCriteriaText(cluster.criteria)}
            </span>
          </div>
          <div className="text-[11px] text-[#BDBDBD]">Created {cluster.createdDate}</div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/actions?clusterSource=${cluster.id}`}
            className="flex-1 rounded-[10px] bg-[#1A3A1A] px-0 py-[9px] text-center text-[12.5px] font-bold text-white transition-colors hover:bg-[#2E7D32]"
          >
            View Linked Action →
          </Link>
        </div>
      </div>

      {/* Count bar */}
      <div className="flex items-center gap-[10px] border-b border-[#F0F0F0] bg-[#FAFAFA] px-[22px] py-3">
        <PersonGlyph />
        <div className="text-[13px] font-bold text-[#1A1C1A]">
          {members.length} Farmers in this cluster
        </div>
      </div>

      {/* Farmer rows */}
      <div className="flex max-h-[380px] flex-col gap-2 overflow-y-auto px-[14px] py-[10px]">
        {members.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-[#BDBDBD]">
            No member farmers available for this cluster.
          </div>
        ) : (
          members.map(({ f, idx }) => <ClusterFarmerRow key={f.id} farmer={f} globalIndex={idx} />)
        )}
      </div>
    </>
  );
}

/* ── Farmer row ── */
function ClusterFarmerRow({ farmer, globalIndex }: { farmer: ClusterFarmer; globalIndex: number }) {
  return (
    <Link
      href={`/farmers/${farmer.id}`}
      className="flex items-center gap-[10px] rounded-[10px] border border-[#F0F0F0] px-3 py-[10px] transition-colors hover:bg-[#F5FFF5]"
    >
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ background: avatarBg(globalIndex) }}
      >
        {farmerInitials(farmer.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[#1A1C1A]">{farmer.name}</div>
        <div className="mt-px text-[11px] text-[#9E9E9E]">
          {farmer.village} · {farmer.crop} · {farmer.land} acres
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div
          className="rounded-[20px] px-[9px] py-[2px] text-[10px] font-bold"
          style={{ background: segBg(farmer.segment), color: segColor(farmer.segment) }}
        >
          {farmer.segment}
        </div>
        <div className="text-[10px] text-[#BDBDBD]">{farmer.lastVisit}</div>
      </div>
    </Link>
  );
}

/* ── No-selection hint ── */
function ClusterEmptyHint() {
  return (
    <div className="px-8 py-16 text-center">
      <div className="text-[13px] leading-[1.7] text-[#BDBDBD]">
        Select a cluster on the left
        <br />
        to view its farmers and criteria.
      </div>
    </div>
  );
}
