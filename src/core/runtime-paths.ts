import path from "node:path";

export interface RuntimePaths {
  appdata: string;
  xdgConfig: string;
}

export function resolveRuntimePaths(home: string): RuntimePaths {
  const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const xdgRaw = process.env.XDG_CONFIG_HOME;
  const xdgConfig =
    xdgRaw && path.isAbsolute(xdgRaw) ? xdgRaw : path.join(home, ".config");
  return { appdata, xdgConfig };
}

export function resolveTargetTemplate(template: string, home: string): string {
  const { appdata, xdgConfig } = resolveRuntimePaths(home);
  return template
    .replace("{home}", home)
    .replace("{appdata}", appdata)
    .replace("{xdg_config}", xdgConfig);
}
