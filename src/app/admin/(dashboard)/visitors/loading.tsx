import {
  AdminSkeletonHeader,
  AdminSkeletonChart,
  AdminSkeletonSection,
  AdminSkeletonStats,
  AdminSkeletonTable,
} from "@/components/admin/skeletons";

export default function VisitorsLoading() {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      <AdminSkeletonHeader />
      <AdminSkeletonStats count={4} />
      <AdminSkeletonChart />
      <AdminSkeletonSection>
        <AdminSkeletonTable rows={4} />
      </AdminSkeletonSection>
    </div>
  );
}
