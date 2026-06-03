import type { JSONContent } from "@tiptap/core";

export interface EditorState {
  json: JSONContent;
  anchor: number;
}

export interface TabConfig extends EditorState {
  key: string;
  label: string;
  filePath?: string;
}

export interface TabState {
  tabs: TabConfig[];
  current: string;
}

export interface ThemeColor {
  light: [number, number, number];
  dark: [number, number, number];
}

export interface ThemeState {
  color: {
    spice: ThemeColor;
  };
  powerMode: boolean;
}
