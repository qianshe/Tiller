import type { DaemonProfile } from "../../../app/daemon-profiles";

type DeleteHelmConfigDialogProps = {
  profile: DaemonProfile;
  onClose: () => void;
  onRemove: (profile: DaemonProfile) => void;
};

export function DeleteHelmConfigDialog({
  profile,
  onClose,
  onRemove,
}: DeleteHelmConfigDialogProps) {
  return (
    <div className="fleet-modal-backdrop" role="presentation">
      <section
        className="card surface-card fleet-delete-helm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="删除 Helm 前端配置"
      >
        <div className="fleet-dialog-head fleet-dialog-head-simple">
          <h3>删除 Helm 前端配置</h3>
          <button
            className="secondary fleet-dialog-close"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="fleet-delete-confirm-body">
          <p>
            只会从 Deck 的本地 Fleet 列表删除这条 Helm 配置，不会销毁远端 Helm
            进程，也不会删除 Helm 后端配置。
          </p>
          <div className="fleet-delete-target">
            <strong>{profile.name}</strong>
            <span>
              {profile.host}:{profile.port}
            </span>
          </div>
        </div>
        <div className="section-actions fleet-delete-actions">
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="secondary helm-destroy-button"
            type="button"
            onClick={() => onRemove(profile)}
          >
            确认删除配置
          </button>
        </div>
      </section>
    </div>
  );
}
