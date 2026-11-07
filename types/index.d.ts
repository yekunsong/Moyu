export type ProbeState = {
  last: string;
  ticks: number;
  lines: string[];
}

declare module 'claude-code' {
  interface PluginState {
    transom: {
      probe: { last: string; ticks: number; lines: string[] }
    }
  }
}
