import type { SetStateOptions } from "../base";
import type { EditorService } from "../editor";
import { StateKey, type StateValues } from "../save";
import type { TabService } from "../tab";
import type { ThemeService } from "../theme";
import type { WindowService } from "../window";

export async function restoreState({
  editorService,
  tabService,
  themeService,
  windowService,
  stateValues,
  options,
}: {
  themeService: ThemeService;
  tabService: TabService;
  editorService: EditorService;
  windowService: WindowService;
  stateValues: StateValues;
  options?: SetStateOptions;
}) {
  // themeService
  themeService.restoreFromState(stateValues[StateKey.ThemeState], options);

  // tabService
  tabService.restoreFromState(stateValues[StateKey.TabState], options);

  // editorService
  editorService.restoreFromState(tabService.currentEditorState, options);

  // windowService
  await windowService.restoreFromState(stateValues[StateKey.WindowState], options);
}
