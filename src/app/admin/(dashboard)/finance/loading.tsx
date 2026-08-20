import {
  AdminSkeletonHeader,
  AdminSkeletonChart,
  AdminSkeletonList,
  AdminSkeletonSection,
  AdminSkeletonStats,
} from "@/components/admin/skeletons";

export default function FinanceLoading() {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      <AdminSkeletonHeader />
      <AdminSkeletonStats count={8} />
      <AdminSkeletonChart />
      <AdminSkeletonSection>
        <AdminSkeletonList rows={4} />
      </AdminSkeletonSection>
    </div>
  );
}
