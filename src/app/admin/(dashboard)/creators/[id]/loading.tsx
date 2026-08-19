import {
  AdminSkeletonHeader,
  AdminSkeletonChart,
  AdminSkeletonSection,
  AdminSkeletonStats,
  AdminSkeletonTable,
} from "@/components/admin/skeletons";

export default function CreatorDetailLoading() {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      <AdminSkeletonHeader />
      <AdminSkeletonStats count={6} />
      <AdminSkeletonChart />
      <AdminSkeletonSection>
        <AdminSkeletonTable rows={5} />
      </AdminSkeletonSection>
    </div>
  );
}
