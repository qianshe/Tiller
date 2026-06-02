import { spawn } from "node:child_process";

const env = {
  ...process.env,
  NODE_OPTIONS: appendNodeOption(
    process.env.NODE_OPTIONS,
    "--disable-warning=ExperimentalWarning",
  ),
  TILLER_LOG_LEVEL: process.env.TILLER_LOG_LEVEL ?? "trace",
  TILLER_LOG_FORMAT: process.env.TILLER_LOG_FORMAT ?? "pretty",
  TILLER_ACP_TRACE: process.env.TILLER_ACP_TRACE ?? "summary",
};

const command = "tsx";
const args = ["watch", "src/app/main.ts"];

if (process.env.TILLER_DEV_HELM_DRY_RUN === "1") {
  console.log(JSON.stringify({
    command,
    args,
    env: {
      NODE_OPTIONS: env.NODE_OPTIONS,
      TILLER_LOG_LEVEL: env.TILLER_LOG_LEVEL,
      TILLER_LOG_FORMAT: env.TILLER_LOG_FORMAT,
      TILLER_ACP_TRACE: env.TILLER_ACP_TRACE,
    },
    shell: process.platform === "win32",
  }));
  process.exit(0);
}

const child = spawn(command, args, {
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

function appendNodeOption(current, option) {
  if (!current) {
    return option;
  }
  return current.includes(option) ? current : `${current} ${option}`;
}
