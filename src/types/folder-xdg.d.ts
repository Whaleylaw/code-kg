declare module '@folder/xdg' {
  interface XdgDirs {
    cache: string;
    config: string;
    config_dirs: string[];
    data: string;
    data_dirs: string[];
    runtime: string;
    state: string;
    logs: string;
  }

  export default function xdg(): XdgDirs;
}
