import {
  AdminSkeletonHeader,
  AdminSkeletonChart,
  AdminSkeletonStats,
  AdminSkeletonTable,
} from "@/components/admin/skeletons";

export default function UsersLoading() {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      <AdminSkeletonHeader />
      <AdminSkeletonStats count={4} />
      <AdminSkeletonChart />
      <AdminSkeletonTable rows={8} />
    </div>
  );
}
