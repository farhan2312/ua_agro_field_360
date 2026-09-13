import { notFound } from "next/navigation";
import { getStoreDetail } from "@/app/actions/store-360";
import { StoreDetailView } from "@/components/store-360/StoreDetailView";

export const dynamic = "force-dynamic";

export default async function StoreDetailPage({ params }: { params: { id: string } }) {
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  // Returns null for no-access (officer/campaigner), out-of-scope RM, or unknown store.
  const store = await getStoreDetail(id);
  if (!store) notFound();

  return <StoreDetailView store={store} />;
}
