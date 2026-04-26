import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";
import type { ClientToDaemon, DaemonToClient } from "@tiller/sync-protocol";
import type {
  AcpAgentProvider,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";

const WS_URL = "ws://127.0.0.1:47631";
const AGENT_DRAFT_STORAGE_KEY = "tiller.agent-draft";

type AgentDraft = {
  name: string;
  command: string;
  args: string;
};

export function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const requestCounter = useRef(0);

  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [agents, setAgents] = useState<AcpAgentProvider[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [messages, setMessages] = useState<Record<string, AgentMessage[]>>({});
  const [permissionRequests, setPermissionRequests] = useState<Record<string, PermissionRequest | null>>({});
  const [outputs, setOutputs] = useState<Record<string, CommandChunk[]>>({});
  const [diffs, setDiffs] = useState<Record<string, FileDiffSummary[]>>({});
  const [prompt, setPrompt] = useState("Please audit the current login flow and propose the smallest safe refactor.");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [agentTestResult, setAgentTestResult] = useState<string>("Not run yet.");
  const [agentDraft, setAgentDraft] = useState<AgentDraft>({
    name: "OpenCode",
    command: "opencode",
    args: "acp",
  });
  const [draftSaveMessage, setDraftSaveMessage] = useState<string>("Draft not saved yet.");
  const [configSaveMessage, setConfigSaveMessage] = useState<string>("Not written to daemon config yet.");

  useEffect(() => {
    const savedDraft = window.localStorage.getItem(AGENT_DRAFT_STORAGE_KEY);
    if (savedDraft) {
      try {
        setAgentDraft(JSON.parse(savedDraft) as AgentDraft);
        setDraftSaveMessage("Loaded local draft from browser storage.");
      } catch {
        setDraftSaveMessage("Failed to parse saved draft. Using default example.");
      }
    }

    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setConnection("connected");
      send(socket, { type: "workspace.list", requestId: nextRequestId(requestCounter) });
      send(socket, { type: "agent.list", requestId: nextRequestId(requestCounter) });
    });

    socket.addEventListener("close", () => {
      setConnection("disconnected");
      socketRef.current = null;
    });

    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as DaemonToClient;
      handleServerEvent(payload);
    });

    return () => socket.close();
  }, []);

  function handleServerEvent(payload: DaemonToClient) {
    switch (payload.type) {
      case "workspace.list.result":
        setWorkspaces(payload.workspaces);
        return;
      case "agent.list.result":
        setAgents(payload.agents);
        return;
      case "agent.test.result":
        setAgentTestResult(payload.message);
        return;
      case "agent.save.result":
        setConfigSaveMessage(payload.message);
        if (socketRef.current) {
          send(socketRef.current, { type: "agent.list", requestId: nextRequestId(requestCounter) });
        }
        return;
      case "session.created":
        setSessions((current) => [payload.session, ...current.filter((session) => session.id !== payload.session.id)]);
        setStatuses((current) => ({ ...current, [payload.session.id]: payload.session.status }));
        setActiveSessionId(payload.session.id);
        return;
      case "session.status":
        setStatuses((current) => ({ ...current, [payload.sessionId]: payload.status }));
        return;
      case "agent.message":
        setMessages((current) => ({
          ...current,
          [payload.sessionId]: [...(current[payload.sessionId] ?? []), payload.message],
        }));
        return;
      case "permission.request":
        setPermissionRequests((current) => ({ ...current, [payload.sessionId]: payload.permissionRequest }));
        return;
      case "permission.resolved":
        setPermissionRequests((current) => ({ ...current, [payload.sessionId]: null }));
        return;
      case "command.output":
        setOutputs((current) => ({
          ...current,
          [payload.sessionId]: [...(current[payload.sessionId] ?? []), payload.chunk],
        }));
        return;
      case "diff.update":
        setDiffs((current) => ({ ...current, [payload.sessionId]: payload.files }));
        return;
      case "error":
        if (payload.sessionId) {
          appendSystemMessage(payload.sessionId, payload.message);
        }
        return;
      default:
        return;
    }
  }

  function appendSystemMessage(sessionId: string, text: string) {
    setMessages((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []),
        {
          id: `${sessionId}-system-${Date.now()}`,
          role: "system",
          text,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
  }

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  function createSession() {
    const workspace = workspaces[0];
    const agent = agents.find((item) => item.id === "mock-agent");
    if (!workspace || !agent || !socketRef.current) {
      return;
    }

    send(socketRef.current, {
      type: "session.create",
      requestId: nextRequestId(requestCounter),
      workspaceId: workspace.id,
      agentId: agent.id,
    });
  }

  function testAgent() {
    const agent = agents.find((item) => item.id !== "mock-agent") ?? agents[0];
    if (!agent || !socketRef.current) {
      return;
    }

    setAgentTestResult(`Testing ${agent.name}...`);
    send(socketRef.current, {
      type: "agent.test",
      requestId: nextRequestId(requestCounter),
      providerId: agent.id,
    });
  }

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.localStorage.setItem(AGENT_DRAFT_STORAGE_KEY, JSON.stringify(agentDraft));
    setDraftSaveMessage(`Saved local draft only: ${agentDraft.command} ${agentDraft.args}`.trim());
  }

  function writeDraftToConfig() {
    if (!socketRef.current) {
      return;
    }

    const providerId = slugify(agentDraft.name || agentDraft.command || "custom-agent");
    setConfigSaveMessage("Writing provider to daemon config...");
    send(socketRef.current, {
      type: "agent.save",
      requestId: nextRequestId(requestCounter),
      provider: {
        id: providerId,
        name: agentDraft.name || providerId,
        kind: "custom",
        command: agentDraft.command,
        args: splitArgs(agentDraft.args),
        installHint: `Ensure \`${agentDraft.command} ${agentDraft.args}\` works in your terminal.`,
      },
    });
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || !activeSessionId || !socketRef.current) {
      return;
    }

    send(socketRef.current, {
      type: "session.prompt",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
      text: prompt.trim(),
    });
  }

  function respondToPermission(decision: PermissionDecision) {
    if (!activeSessionId || !socketRef.current) {
      return;
    }

    const permissionRequest = permissionRequests[activeSessionId];
    if (!permissionRequest) {
      return;
    }

    send(socketRef.current, {
      type: "permission.respond",
      requestId: nextRequestId(requestCounter),
      permissionRequestId: permissionRequest.id,
      decision,
    });
  }

  function cancelSession() {
    if (!activeSessionId || !socketRef.current) {
      return;
    }

    send(socketRef.current, {
      type: "session.cancel",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
    });
  }

  return (
    <main className="shell">
      <header className="hero card">
        <div>
          <p className="eyebrow">ACP-first mobile control plane</p>
          <h1>Tiller</h1>
          <p className="muted">
            Mock-first local loop for any ACP-compatible coding agent. Real ACP integration is intentionally left as TODO hooks.
          </p>
        </div>
        <div className={`status-pill status-${connection}`}>
          <span className="dot" />
          {connection}
        </div>
      </header>

      <section className="grid two-up">
        <div className="card stack-gap">
          <div className="section-head">
            <h2>Control plane</h2>
            <div className="section-actions">
              <button className="secondary" type="button" onClick={testAgent} disabled={connection !== "connected" || !agents.length}>
                Test configured ACP
              </button>
              <button className="primary" onClick={createSession} disabled={connection !== "connected" || !agents.some((item) => item.id === "mock-agent") || !workspaces.length}>
                Create mock session
              </button>
            </div>
          </div>

          <div className="meta-grid">
            <InfoList title="Workspaces" items={workspaces.map((workspace) => `${workspace.name} · ${workspace.path}`)} empty="No workspaces" />
            <InfoList title="ACP Agents" items={agents.map((agent) => `${agent.name} · ${agent.kind ?? "custom"}`)} empty="No agents" />
          </div>

          <form className="config-form" onSubmit={saveDraft}>
            <div className="section-head">
              <h3>Add ACP Agent (draft)</h3>
              <div className="section-actions">
                <button className="secondary" type="submit">
                  Save draft locally
                </button>
                <button className="primary" type="button" onClick={writeDraftToConfig} disabled={connection !== "connected" || !agentDraft.command.trim()}>
                  Write to daemon config
                </button>
              </div>
            </div>

            <label>
              <span>Name</span>
              <input
                value={agentDraft.name}
                onChange={(event) => setAgentDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="OpenCode"
              />
            </label>

            <label>
              <span>Command</span>
              <input
                value={agentDraft.command}
                onChange={(event) => setAgentDraft((current) => ({ ...current, command: event.target.value }))}
                placeholder="opencode"
              />
            </label>

            <label>
              <span>Arguments</span>
              <input
                value={agentDraft.args}
                onChange={(event) => setAgentDraft((current) => ({ ...current, args: event.target.value }))}
                placeholder="acp"
              />
            </label>

            <div className="note-box compact-note">
              <strong>Draft-only placeholder</strong>
              <p>{draftSaveMessage}</p>
              <p className="muted compact">
                Example real ACP commands: `opencode acp`, or `codex-acp` if you install a local adapter.
              </p>
            </div>

            <div className="note-box compact-note">
              <strong>Daemon config write</strong>
              <p>{configSaveMessage}</p>
              <p className="muted compact">
                This writes a minimal provider entry into `~/.tiller/config.json`. Real session runtime is still deferred.
              </p>
            </div>
          </form>

          <div className="note-box">
            <strong>TODO hooks for real ACP</strong>
            <p>
              Registry and runtime packages already expose agent-agnostic seams for future config loading, stdio launch, initialize, and capability detection.
            </p>
          </div>

          <div className="note-box">
            <strong>Agent test</strong>
            <p>{agentTestResult}</p>
          </div>
        </div>

        <div className="card stack-gap">
          <div className="section-head">
            <h2>Sessions</h2>
            <span className="subtle">{sessions.length} total</span>
          </div>

          <div className="session-list">
            {sessions.length ? (
              sessions.map((session) => {
                const status = statuses[session.id] ?? session.status;
                const selected = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    className={`session-item ${selected ? "selected" : ""}`}
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    <span>{session.workspaceName}</span>
                    <strong>{status}</strong>
                  </button>
                );
              })
            ) : (
              <div className="empty-state">Create a mock session to start the loop.</div>
            )}
          </div>
        </div>
      </section>

      <section className="card stack-gap">
        <div className="section-head">
          <div>
            <h2>Session detail</h2>
            <p className="muted compact">
              {activeSession ? `${activeSession.agentName} in ${activeSession.workspaceName}` : "No active session yet."}
            </p>
          </div>
          <div className="section-actions">
            <button className="secondary" type="button" onClick={cancelSession} disabled={!activeSession}>
              Cancel session
            </button>
            <span className="status-chip">{activeSession ? statuses[activeSession.id] ?? activeSession.status : "idle"}</span>
          </div>
        </div>

        <form className="prompt-form" onSubmit={submitPrompt}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Send a prompt to the session"
            rows={4}
            disabled={!activeSession}
          />
          <button className="primary" type="submit" disabled={!activeSession || !prompt.trim()}>
            Send prompt
          </button>
        </form>

        {activeSession && permissionRequests[activeSession.id] ? (
          <PermissionCard permissionRequest={permissionRequests[activeSession.id]!} onRespond={respondToPermission} />
        ) : null}

        <div className="detail-grid">
          <Panel title="Agent stream">
            <MessageStream items={activeSession ? messages[activeSession.id] ?? [] : []} />
          </Panel>
          <Panel title="Command output">
            <CommandOutput items={activeSession ? outputs[activeSession.id] ?? [] : []} />
          </Panel>
          <Panel title="Diff summary">
            <DiffSummary items={activeSession ? diffs[activeSession.id] ?? [] : []} />
          </Panel>
        </div>
      </section>
    </main>
  );
}

function nextRequestId(counter: MutableRefObject<number>) {
  counter.current += 1;
  return `req-${counter.current}`;
}

function send(socket: WebSocket, payload: ClientToDaemon) {
  socket.send(JSON.stringify(payload));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom-agent";
}

function splitArgs(value: string) {
  return value
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function InfoList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3>{title}</h3>
      {items.length ? (
        <ul className="info-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">{empty}</div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function MessageStream({ items }: { items: AgentMessage[] }) {
  if (!items.length) {
    return <div className="empty-state">Waiting for agent activity.</div>;
  }

  return (
    <div className="stream-list">
      {items.map((item) => (
        <article key={item.id} className={`bubble role-${item.role}`}>
          <span className="bubble-role">{item.role}</span>
          <p>{item.text}</p>
        </article>
      ))}
    </div>
  );
}

function PermissionCard({
  permissionRequest,
  onRespond,
}: {
  permissionRequest: PermissionRequest;
  onRespond: (decision: PermissionDecision) => void;
}) {
  return (
    <section className="permission-card">
      <div>
        <p className="eyebrow">Permission request</p>
        <strong>{permissionRequest.command}</strong>
        <p className="muted compact">{permissionRequest.reason}</p>
      </div>
      <div className="permission-actions">
        <button className="primary" type="button" onClick={() => onRespond("allow")}>
          Allow once
        </button>
        <button className="secondary" type="button" onClick={() => onRespond("deny")}>
          Deny
        </button>
      </div>
    </section>
  );
}

function CommandOutput({ items }: { items: CommandChunk[] }) {
  if (!items.length) {
    return <div className="empty-state">No command output yet.</div>;
  }

  return (
    <div className="output-list">
      {items.map((item) => (
        <pre key={item.id} className={`output-block stream-${item.stream}`}>
          {item.text}
        </pre>
      ))}
    </div>
  );
}

function DiffSummary({ items }: { items: FileDiffSummary[] }) {
  if (!items.length) {
    return <div className="empty-state">No changed files yet.</div>;
  }

  return (
    <ul className="diff-list">
      {items.map((item) => (
        <li key={item.path}>
          <strong>{item.status}</strong> {item.path}
          <span className="diff-meta">
            +{item.additions} / -{item.deletions}
          </span>
        </li>
      ))}
    </ul>
  );
}
