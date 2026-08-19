import { classifyVideoAction } from "@/app/admin/(dashboard)/actions";
import type { VideoWithContext } from "@/lib/admin/ugc";

import { InlineAction } from "./forms";
import { Badge, formatCount, formatDate } from "./ui";

/** A video table with the Memo AI / personal decision inline on each row. */
export function VideoReviewList({
  videos,
  showCreator = true,
}: {
  videos: VideoWithContext[];
  showCreator?: boolean;
}) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Video</th>
            {showCreator && <th>Creator</th>}
            <th>Posted</th>
            <th className="admin-num">Views</th>
            <th className="admin-num">Likes</th>
            <th>Detected as</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => (
            <tr key={video.id}>
              <td>
                <div style={{ display: "flex", gap: "0.625rem", alignItems: "center" }}>
                  {video.cover_url && (
                    // TikTok cover URLs are signed and short-lived, so they are
                    // not routed through the image optimiser.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="admin-cover" src={video.cover_url} alt="" loading="lazy" />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <a
                      className="admin-link"
                      href={video.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open on TikTok
                    </a>
                    <div className="admin-video-caption">
                      {video.caption || "No caption"}
                    </div>
                  </div>
                </div>
              </td>
              {showCreator && (
                <td>
                  <span className="admin-creator-name">{video.creatorName}</span>
                  <br />
                  <span className="admin-creator-handle">@{video.handle}</span>
                </td>
              )}
              <td>{formatDate(video.posted_at)}</td>
              <td className="admin-num">{formatCount(video.views)}</td>
              <td className="admin-num">{formatCount(video.likes)}</td>
              <td>
                <span title={video.classification_reason ?? undefined}>
                  {video.classification === "memo" ? (
                    <Badge tone="green">Memo AI</Badge>
                  ) : video.classification === "personal" ? (
                    <Badge tone="grey">Personal</Badge>
                  ) : (
                    <Badge tone="red">Unclear</Badge>
                  )}
                </span>
                {video.classification_locked && (
                  <>
                    {" "}
                    <Badge tone="blue">manual</Badge>
                  </>
                )}
              </td>
              <td>
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                  {video.classification !== "memo" && (
                    <InlineAction
                      action={classifyVideoAction}
                      fields={{ video_id: video.id, decision: "memo" }}
                      variant="primary"
                      title="Count this video toward the campaign"
                    >
                      Memo AI
                    </InlineAction>
                  )}
                  {video.classification !== "personal" && (
                    <InlineAction
                      action={classifyVideoAction}
                      fields={{ video_id: video.id, decision: "personal" }}
                      title="Exclude this video from the campaign"
                    >
                      Personal
                    </InlineAction>
                  )}
                  {video.classification_locked && (
                    <InlineAction
                      action={classifyVideoAction}
                      fields={{ video_id: video.id, decision: "auto" }}
                      title="Hand this video back to automatic detection"
                    >
                      Auto
                    </InlineAction>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
