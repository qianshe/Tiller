import type { PermissionDecision, PermissionRequest } from "@tiller/shared";

type MissionPermissionDrawerCopy = {
  permissionRequest: string;
  allowOnce: string;
  deny: string;
};

type MissionPermissionDrawerProps = {
  request: PermissionRequest;
  copy: MissionPermissionDrawerCopy;
  showWorkspace: boolean;
  onRespond: (decision: PermissionDecision) => void;
};

/**
 * Permission request drawer pinned below the active mission conversation.
 */
export function MissionPermissionDrawer({
  request,
  copy,
  showWorkspace,
  onRespond,
}: MissionPermissionDrawerProps) {
  return (
    <section
      className="mission-permission-drawer"
      role="region"
      aria-live="polite"
      aria-label={copy.permissionRequest}
    >
      <div className="mission-permission-copy">
        <p className="eyebrow">{copy.permissionRequest}</p>
        <strong>{request.command}</strong>
        <p className="muted compact">{request.reason}</p>
        {showWorkspace ? (
          <p className="subtle compact">{request.workspacePath}</p>
        ) : null}
      </div>
      <div className="permission-actions mission-permission-actions">
        <button
          className="primary"
          type="button"
          onClick={() => onRespond("allow")}
        >
          {copy.allowOnce}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => onRespond("deny")}
        >
          {copy.deny}
        </button>
      </div>
    </section>
  );
}
