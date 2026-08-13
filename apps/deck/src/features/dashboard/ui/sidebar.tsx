import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type {
  DashboardQuickCreateHelm,
  DashboardQuickCreateProject,
  DashboardSection,
} from "../types";
import {
  Icon,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "../../../shared/ui";

export type DashboardNavigationActions = {
  activeSection: DashboardSection;
  onSelectSection: (section: DashboardSection) => void;
  onOpenMission?: () => void;
  onSearchSessions?: () => void;
  onOpenQuickCreate?: () => void;
  quickCreateHelms?: DashboardQuickCreateHelm[];
  quickCreateProjects?: DashboardQuickCreateProject[];
  quickCreateHasDraft?: boolean;
};

type DashboardNavigationItem = {
  id: DashboardSection;
  label: string;
  icon: "dashboard" | "listChecks" | "mission" | "branch" | "fileText" | "users" | "settings";
  comingSoon?: boolean;
};

type DashboardNavigationGroup = {
  label: string;
  items: DashboardNavigationItem[];
};

export const DASHBOARD_SIDEBAR_MIN_WIDTH = 220;
export const DASHBOARD_SIDEBAR_MAX_WIDTH = 360;
export const DASHBOARD_SIDEBAR_DEFAULT_WIDTH = 288;

function clampSidebarWidth(width: number) {
  return Math.min(Math.max(width, DASHBOARD_SIDEBAR_MIN_WIDTH), DASHBOARD_SIDEBAR_MAX_WIDTH);
}

function DashboardSidebarResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const [isResizing, setIsResizing] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const drag = dragState.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      onWidthChange(clampSidebarWidth(drag.startWidth + event.clientX - drag.startX));
    };
    const stopResizing = (event: globalThis.PointerEvent) => {
      if (dragState.current?.pointerId !== event.pointerId) {
        return;
      }
      dragState.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, onWidthChange]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragState.current = {
      startX: event.clientX,
      startWidth: width,
      pointerId: event.pointerId,
    };
    setIsResizing(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    let nextWidth: number | undefined;
    if (event.key === "ArrowLeft") {
      nextWidth = width - step;
    } else if (event.key === "ArrowRight") {
      nextWidth = width + step;
    } else if (event.key === "Home") {
      nextWidth = DASHBOARD_SIDEBAR_MIN_WIDTH;
    } else if (event.key === "End") {
      nextWidth = DASHBOARD_SIDEBAR_MAX_WIDTH;
    }

    if (nextWidth === undefined) {
      return;
    }
    event.preventDefault();
    onWidthChange(clampSidebarWidth(nextWidth));
  };

  return (
    <div
      data-slot="dashboard-sidebar-resize-handle"
      role="separator"
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      aria-valuemin={DASHBOARD_SIDEBAR_MIN_WIDTH}
      aria-valuemax={DASHBOARD_SIDEBAR_MAX_WIDTH}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className={`absolute inset-y-0 right-0 z-20 hidden w-2 touch-none cursor-col-resize select-none md:block hover:bg-border-ghost focus-visible:bg-border-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=offcanvas]:hidden ${isResizing ? "bg-primary" : ""}`}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}

function resolveNavigationGroups(): DashboardNavigationGroup[] {
  return [
    {
      label: "工作台",
      items: [
        { id: "overview", label: "概览", icon: "dashboard" },
        { id: "tasks", label: "任务", icon: "listChecks" },
        { id: "automations", label: "自动化", icon: "branch", comingSoon: true },
        { id: "issues", label: "Issues", icon: "fileText", comingSoon: true },
      ],
    },
    {
      label: "配置",
      items: [
        { id: "agents", label: "Agents", icon: "users" },
        { id: "settings", label: "设置", icon: "settings" },
      ],
    },
  ];
}

function selectNavigationItem(item: DashboardNavigationItem, actions: DashboardNavigationActions) {
  if (item.comingSoon) {
    return;
  }
  actions.onSelectSection(item.id);
}

function DashboardNavigation({ actions }: { actions: DashboardNavigationActions }) {
  const groups = resolveNavigationGroups();
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.label}>
          {index > 0 ? <SidebarSeparator className="mx-3 w-auto" /> : null}
          <SidebarGroup className="pt-0">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={item.id === actions.activeSection}
                      tooltip={item.comingSoon ? `${item.label}（即将推出）` : item.label}
                      disabled={item.comingSoon}
                      onClick={() => selectNavigationItem(item, actions)}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </Fragment>
      ))}
    </>
  );
}

function DashboardQuickCreate({ actions }: { actions: DashboardNavigationActions }) {
  const helms = actions.quickCreateHelms ?? [];
  const canCreateTask = helms.length > 0 && Boolean(actions.onOpenQuickCreate);

  return (
    <SidebarGroup className="pb-2">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="快速创建"
              className="min-w-8 bg-primary text-on-primary duration-200 ease-linear hover:bg-primary-strong hover:text-on-primary active:bg-primary-strong active:text-on-primary"
              disabled={!canCreateTask}
              onClick={() => actions.onOpenQuickCreate?.()}
            >
              <Icon name="plus" />
              <span>快速创建</span>
              {actions.quickCreateHasDraft ? (
                <span className="ml-auto size-2 shrink-0 rounded-full bg-warning" aria-label="有待提交的草稿" />
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="搜索会话"
              disabled={!actions.onSearchSessions}
              onClick={() => actions.onSearchSessions?.()}
            >
              <Icon name="search" />
              <span>搜索会话</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="切换到 Mission 模式"
              disabled={!actions.onOpenMission}
              onClick={() => actions.onOpenMission?.()}
            >
              <Icon name="mission" />
              <span>Mission 模式</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function DashboardSidebar({
  actions,
  width,
  onWidthChange,
}: {
  actions: DashboardNavigationActions;
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const sidebarActions: DashboardNavigationActions = {
    ...actions,
    onSelectSection: (section) => {
      actions.onSelectSection(section);
      closeMobileSidebar();
    },
    onOpenMission: actions.onOpenMission
      ? () => {
          closeMobileSidebar();
          actions.onOpenMission?.();
        }
      : undefined,
    onSearchSessions: actions.onSearchSessions
      ? () => {
          closeMobileSidebar();
          actions.onSearchSessions?.();
        }
      : undefined,
    onOpenQuickCreate: actions.onOpenQuickCreate
      ? () => {
          closeMobileSidebar();
          actions.onOpenQuickCreate?.();
        }
      : undefined,
  };

  return (
    <Sidebar
      variant="inset"
      collapsible="offcanvas"
      className="dashboard-sidebar"
      data-slot="sidebar"
      aria-label="Tiller 导航"
    >
      <SidebarHeader className="p-3 pb-2">
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="grid size-7 place-items-center rounded-full border border-border-ghost text-foreground">
            <Icon name="helm" size={18} strokeWidth={1.5} />
          </span>
          <span className="block min-w-0 truncate text-section font-semibold text-foreground">Tiller</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <DashboardQuickCreate actions={sidebarActions} />
        <SidebarSeparator className="mx-3 w-auto" />
        <DashboardNavigation actions={sidebarActions} />
      </SidebarContent>
      <DashboardSidebarResizeHandle width={width} onWidthChange={onWidthChange} />
    </Sidebar>
  );
}
