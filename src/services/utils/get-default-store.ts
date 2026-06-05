import { DEFAULT_THEME } from "../../constants/default";
import { JSON_EMPTY, JSON_LANDING_PAGE } from "../../constants/json-content";
import { getRandomEmoji } from "../../utils/common/get-random-emoji";
import { StateKey, type StateValues } from "../save";

export function getDefaultStateValues(): StateValues {
  const tabs = [
    {
      key: "primary",
      json: JSON_LANDING_PAGE,
      label: getRandomEmoji(),
      anchor: 0,
    },
    {
      key: "secondary",
      json: JSON_EMPTY,
      label: getRandomEmoji(),
      anchor: 0,
    },
  ];

  return structuredClone({
    [StateKey.TabState]: {
      current: tabs[0].key,
      tabs: tabs,
    },
    [StateKey.WindowState]: {
      float: true,
      size: null,
      position: null,
      fold: false,
      scaleFactor: 0,
      sizeBeforeFold: null,
    },
    [StateKey.ThemeState]: DEFAULT_THEME,
    [StateKey.TranscriptSettingsState]: {
      selectedSource: "both",
      locale: "auto",
      backend: "apple",
      senseVoiceModel: "",
      includeTimestamp: true,
      includeSpeaker: true,
    },
  });
}
