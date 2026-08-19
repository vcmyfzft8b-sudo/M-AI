import {
  AdminSkeletonHeader,
  AdminSkeletonList,
  AdminSkeletonSection,
  AdminSkeletonTable,
} from "@/components/admin/skeletons";

export default function SettingsLoading() {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      <AdminSkeletonHeader />
      <AdminSkeletonSection>
        <AdminSkeletonList rows={3} />
      </AdminSkeletonSection>
      <AdminSkeletonSection>
        <AdminSkeletonTable rows={5} />
      </AdminSkeletonSection>
    </div>
  );
}
