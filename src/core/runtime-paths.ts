import path from "node:path";

export interface RuntimePaths {
  appdata: string;
  xdgConfig: string;
}

type TargetRoot = "home" | "appdata" | "xdg_config" | "repo";

const TARGET_TEMPLATE_RE =
  /^\{(home|appdata|xdg_config|repo)\}(?<suffix>(?:[\\/].*)?)$/;

export function getPathApi(
  root: string,
): typeof path.posix | typeof path.win32 {
  if (root.includes("\\") || /^[a-zA-Z]:/.test(root)) {
    return path.win32;
  }
  if (root.startsWith("/")) {
    return path.posix;
  }
  return process.platform === "win32" ? path.win32 : path.posix;
}

function normalizePathForComparison(
  candidate: string,
  pathApi: typeof path.posix | typeof path.win32,
): string {
  const normalized = pathApi.normalize(candidate);
  return pathApi === path.win32 ? normalized.toLowerCase() : normalized;
}

function isSameOrDescendantPath(candidate: string, root: string): boolean {
  const pathApi = getPathApi(root);
  const normalizedCandidate = normalizePathForComparison(candidate, pathApi);
  const normalizedRoot = normalizePathForComparison(root, pathApi);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + pathApi.sep)
  );
}

export function resolveRuntimePaths(home: string): RuntimePaths {
  const appdataRaw = process.env.APPDATA;
  const homePathApi = getPathApi(home);
  const appdata =
    appdataRaw && getPathApi(appdataRaw).isAbsolute(appdataRaw)
      ? appdataRaw
      : homePathApi.join(home, "AppData", "Roaming");
  const xdgRaw = process.env.XDG_CONFIG_HOME;
  const xdgConfig =
    xdgRaw && getPathApi(xdgRaw).isAbsolute(xdgRaw)
      ? xdgRaw
      : homePathApi.join(home, ".config");
  return { appdata, xdgConfig };
}

export function resolveTargetTemplate(
  template: string,
  home: string,
  repo?: string,
): string {
  const { appdata, xdgConfig } = resolveRuntimePaths(home);
  const match = TARGET_TEMPLATE_RE.exec(template);
  if (!match) {
    throw new Error(`Invalid target template: ${template}`);
  }

  const root = match[1] as TargetRoot;
  if (root === "repo") {
    if (!repo) {
      throw new Error(
        `Target template uses {repo} but no manifest directory was provided: ${template}`,
      );
    }
    const suffix = match.groups?.suffix ?? "";
    const segments = suffix.split(/[\\/]+/).filter(Boolean);
    const repoPathApi = getPathApi(repo);
    const resolved =
      segments.length === 0 ? repo : repoPathApi.join(repo, ...segments);
    if (!isSameOrDescendantPath(resolved, repo)) {
      throw new Error(
        `Target template resolves outside its placeholder root: ${template}`,
      );
    }
    return suffix === "" ? repo : `${repo}${suffix}`;
  }

  const baseByRoot: Record<Exclude<TargetRoot, "repo">, string> = {
    home,
    appdata,
    xdg_config: xdgConfig,
  };
  const suffix = match.groups?.suffix ?? "";
  const segments = suffix.split(/[\\/]+/).filter(Boolean);
  const pathApi = getPathApi(baseByRoot[root]);
  const resolved =
    segments.length === 0
      ? baseByRoot[root]
      : pathApi.join(baseByRoot[root], ...segments);

  if (!isSameOrDescendantPath(resolved, baseByRoot[root])) {
    throw new Error(
      `Target template resolves outside its placeholder root: ${template}`,
    );
  }

  return suffix === "" ? baseByRoot[root] : `${baseByRoot[root]}${suffix}`;
}
