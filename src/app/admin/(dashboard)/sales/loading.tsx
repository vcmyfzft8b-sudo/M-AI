import {
  AdminSkeletonHeader,
  AdminSkeletonChart,
  AdminSkeletonList,
  AdminSkeletonSection,
  AdminSkeletonStats,
} from "@/components/admin/skeletons";

export default function SalesLoading() {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      <AdminSkeletonHeader />
      <AdminSkeletonStats count={4} />
      <AdminSkeletonChart />
      <AdminSkeletonSection>
        <AdminSkeletonList rows={4} />
      </AdminSkeletonSection>
    </div>
  );
}
