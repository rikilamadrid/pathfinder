/**
 * Process identity across macOS, Linux, Windows and WSL2.
 *
 * Scratch runs and dependency installs record the process that owns them, and
 * cleanup must never mistake a live owner for a dead one. A pid means nothing
 * outside its own process namespace: WSL2 shares the Windows hostname but not
 * its pids. So an owner is {pid, host, platform}, and an owner recorded on
 * another platform — or another host — is never judged dead from here.
 *
 * Ancestry comes from `ps` on POSIX systems and from one PowerShell CIM query
 * on Windows; where neither answers, the answer is "unknown", never "dead".
 */

import { spawnSync } from "node:child_process";
import { hostname, release } from "node:os";
import { basename } from "node:path";

/** True inside WSL (1 or 2): Linux binaries, a Windows host. */
export function isWsl(osRelease = release(), env = process.env) {
  return Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(osRelease);
}

/** The process namespace this code runs in: win32, darwin, linux, or linux-wsl. */
export function platformId(platform = process.platform) {
  return platform === "linux" && isWsl() ? "linux-wsl" : platform;
}

const commandName = (text) => basename(String(text).trim().replace(/\\/g, "/")).replace(/\.exe$/i, "").replace(/^-/, "").toLowerCase();

/**
 * The process and its ancestors, nearest first: [{pid, ppid, command}].
 * Empty when this system cannot say.
 */
let snapshot = null;

/**
 * Every Windows process as pid → {ppid, command}, from one CIM query. One
 * query per ancestor costs seconds each; the table is reused for a moment so
 * one engine command asks once. The script travels as -EncodedCommand, so no
 * quoting of the command line can alter it, and SystemRoot is always passed:
 * CIM fails without it.
 */
function windowsProcesses() {
  if (snapshot && Date.now() - snapshot.at < 2000) return snapshot.table;
  const script = "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.Name)\" }";
  const env = { ...process.env, SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || process.env.windir || "C:\\Windows" };
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, timeout: 20_000, env });
  if (result.status !== 0) return null;
  const table = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const m = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line.trim());
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), command: commandName(m[3]) });
  }
  snapshot = { at: Date.now(), table };
  return table;
}

export function processChain(start, { depth = 16, platform = process.platform } = {}) {
  if (!Number.isSafeInteger(start) || start < 1) return [];
  if (platform === "win32") {
    const table = windowsProcesses();
    const chain = [];
    for (let pid = start, n = 0; table && n < depth && table.has(pid); n += 1) {
      const { ppid, command } = table.get(pid);
      chain.push({ pid, ppid, command });
      if (ppid === pid || ppid === 0) break;
      pid = ppid;
    }
    return chain;
  }
  const chain = [];
  let pid = start;
  for (let n = 0; n < depth && pid > 1; n += 1) {
    const result = spawnSync("ps", ["-o", "ppid=", "-o", "comm=", "-p", String(pid)], { encoding: "utf8" });
    const match = result.status === 0 ? /^\s*(\d+)\s+(.+?)\s*$/.exec(result.stdout) : null;
    if (!match) break;
    chain.push({ pid, ppid: Number(match[1]), command: commandName(match[2]) });
    pid = Number(match[1]);
  }
  return chain;
}

export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "tcsh", "csh", "env", "timeout", "nohup", "xargs", "cmd", "powershell", "pwsh", "conhost", "wsl", "wslhost"]);

/** An owner record for `pid` on this host and platform. */
export function ownerRecord(pid, command = null) {
  return { pid, host: hostname(), platform: platformId(), command };
}

/**
 * true, false, or null when this process cannot tell. Another host or
 * platform, a missing platform, or an unanswerable check is null. A live pid
 * now running a different command is a reused pid: false.
 */
export function liveness(owner) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
  if (owner.host !== hostname() || owner.platform !== platformId()) return null;
  try { process.kill(owner.pid, 0); } catch (error) { return error.code === "ESRCH" ? false : null; }
  if (!owner.command) return true;
  const now = processChain(owner.pid, { depth: 1 })[0];
  if (!now) return null;
  return now.command === owner.command;
}

/**
 * The long-lived process that owns work started from here: the nearest
 * ancestor of `start` that is not a shell or wrapper. Harness tool calls run
 * in a fresh shell that exits at once; the harness session outlives it. Null
 * when ancestry cannot be read (a sandbox without `ps`, busybox): guessing the
 * transient shell would make a live run look dead the moment it returns.
 */
export function findOwner(start = process.ppid) {
  const owner = processChain(start).find((entry) => !SHELLS.has(entry.command));
  return owner ? ownerRecord(owner.pid, owner.command) : null;
}

/**
 * Is `owner` this process or one of its ancestors? true, false, or null when
 * this process's ancestry cannot be read here.
 */
export function callerOwns(owner, start = process.pid) {
  if (!owner || owner.host !== hostname() || owner.platform !== platformId()) return false;
  const chain = processChain(start);
  if (chain.length === 0) return null;
  return chain.some((entry) => entry.pid === owner.pid);
}
