import { AdminPageSkeleton } from "@/components/admin/skeletons";

export default function AdminOverviewLoading() {
  return <AdminPageSkeleton tiles={4} chart table={false} />;
}
