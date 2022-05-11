export const LARGE_CURRENT_TIME = 1e101;

import { Fragment, getFragFromHash, is } from "@base/hash-tool";
import {
  createSlice,
  PayloadAction,
  SliceCaseReducers,
  ValidateSliceCaseReducers,
} from "@reduxjs/toolkit";
import { isTimestamp, parseTF } from "mx-lib";
import { parse as parseQS } from "query-string";

// larger the value, lower the priority
const enum UserSeekSource {
  MANUAL = 1,
  PROGRESS_BAR,
  KEYBOARD,
  DRAG,
}

export interface ControlsState {
  /**
   * the currentTime of the provider
   * one-way binded to the currentTime of the provider
   * (provider -> store, updated via onTimeUpdate)
   * setting this value won't applied to provider
   */
  currentTime: number;
  paused: boolean;
  fullscreen: boolean;
  /** -1 if not explicitly specified */
  fragment: null | Fragment;
  playbackRate: number;
  volume: number;
  muted: boolean;
  autoplay: boolean;
  duration: number | null;
  /**
   * indicate that provider is trying to set new currentTime
   * set to false when the new currentTime is applied
   * (loaded and can continue to play, aka seeked)
   */
  seeking: boolean;
  /**
   * indicate that user is using the progress bar to seek new currentTime,
   * one-way binding to the currentTime of the provider
   * (store -> provider)
   * changing back to null means user seek end and binding is revoked
   */
  userSeek: {
    initialTime: number;
    currentTime: number;
    pausedBeforeSeek: boolean;
    source: UserSeekSource;
  } | null;
  loop: boolean;
  /**
   * buffered range in seconds
   */
  buffered: number;
  waiting: boolean;
  ended: boolean;
  hasStarted: boolean;
  activeTextTrack: null;
  error: string | null;
  ignoreEvent: {
    playpause: boolean;
  };
}
const initialState: ControlsState = {
  currentTime: 0,
  paused: true,
  fullscreen: false,
  fragment: null,
  playbackRate: 1,
  volume: 0.8,
  muted: false,
  autoplay: false,
  seeking: false,
  duration: null,
  userSeek: null,
  loop: false,
  buffered: 0,
  waiting: false,
  ended: false,
  hasStarted: false,
  activeTextTrack: null,
  error: null,
  ignoreEvent: {
    playpause: false,
  },
};

const getReducer = <
  CR extends SliceCaseReducers<ControlsState> = SliceCaseReducers<ControlsState>,
>(
  a: CR,
): CR => a;
const alterStateReducers = getReducer({
  setHash: (
    state,
    action: PayloadAction<{ hash: string; fromLink: boolean }>,
  ) => {
    const { hash, fromLink } = action.payload;
    const query = parseQS(hash),
      frag = getFragFromHash(hash);
    state.fragment = frag;
    state.loop = is(query, "loop");
    state.autoplay = is(query, "autoplay");
    state.muted = is(query, "muted");

    if (fromLink) state.paused = false;
    // start playing when timestamp is seeked to
    if (frag && isTimestamp(frag)) {
      state.currentTime = frag[0];
    }
  },
  setFragment: (state, action: PayloadAction<ControlsState["fragment"]>) => {
    const frag = action.payload;
    state.fragment = frag;

    // start playing when timestamp is seeked to
    if (frag && isTimestamp(frag)) state.paused = false;
  },
  play: (state) => {
    state.paused = false;
  },
  pause: (state) => {
    state.paused = true;
  },
  togglePlay: (state) => {
    state.paused = !state.paused;
  },

  setFullscreen: (state, action: PayloadAction<boolean>) => {
    state.fullscreen = action.payload;
  },

  toggleFullscreen: (state) => {
    state.fullscreen = !state.fullscreen;
  },
  setPlaybackRate: (state, action: PayloadAction<number>) => {
    if (action.payload > 0) {
      state.playbackRate = action.payload;
    } else {
      state.playbackRate = 1;
    }
  },
  setMute: (state, action: PayloadAction<boolean>) => {
    state.muted = action.payload;
  },
  toggleMute: (state) => {
    state.muted = !state.muted;
  },
  setVolume: (state, action: PayloadAction<number>) => {
    setVolumeTo(action.payload, state);
  },
  setVolumeUnmute: (state, action: PayloadAction<number>) => {
    setVolumeTo(action.payload, state);
    state.muted = false;
  },
  setVolumeByOffest: (state, action: PayloadAction<number>) => {
    setVolumeTo(state.volume + action.payload / 100, state);
  },
});

// lock event handlers when applying state changes
const actionLockReducers = getReducer({
  lockPlayPauseEvent: (state) => {
    state.ignoreEvent.playpause = true;
  },
  unlockPlayPauseEvent: (state) => {
    state.ignoreEvent.playpause = false;
  },
});

const evtHandlerReducer = getReducer({
  handleLoopChange: (state, action: PayloadAction<boolean>) => {
    state.loop = action.payload;
  },
  handleAutoplayChange: (state, action: PayloadAction<boolean>) => {
    state.autoplay = action.payload;
  },
  handleTimeUpdate: (state, action: PayloadAction<number>) => {
    if (action.payload !== LARGE_CURRENT_TIME)
      state.currentTime = action.payload;
    if (state.duration === action.payload) {
      state.ended = true;
    }
  },
  handleFullscreenChange: (state, action: PayloadAction<boolean>) => {
    state.fullscreen = action.payload;
  },
  handleVolumeChange: (
    state,
    action: PayloadAction<{ volume: number; muted: boolean }>,
  ) => {
    setVolumeTo(action.payload.volume, state);
    state.muted = action.payload.muted;
  },
  handleDurationChange: (state, action: PayloadAction<number | null>) => {
    if (checkDuration(action.payload)) {
      state.duration = action.payload;
    } else {
      state.duration === null;
    }
  },

  handleSeeking: (state) => {
    state.seeking = true;
  },
  handleSeeked: (state) => {
    state.seeking = false;
  },
  handlePlaying: (state) => {
    if (state.ignoreEvent.playpause) return;
    state.paused = false;
    state.ended = false;
    state.waiting = false;
    state.hasStarted = true;
  },
  handlePause: (state) => {
    if (state.ignoreEvent.playpause) return;
    state.paused = true;
  },
  handleRateChange: (state, action: PayloadAction<number>) => {
    state.playbackRate = action.payload;
  },
  handleProgress: (
    state,
    action: PayloadAction<{ buffered: number; duration: number }>,
  ) => {
    const { buffered, duration } = action.payload;
    if (buffered >= 0) {
      state.buffered = buffered;
    } else {
      console.error("invaild buffered value", action.payload);
    }
    if (checkDuration(duration)) {
      state.duration = duration;
    }
  },
  handleEnded: (state) => {
    state.ended = true;
  },
  handleWaiting: (state) => {
    state.waiting = true;
  },
  handleError: (
    state,
    action: PayloadAction<{ message: string; code?: number }>,
  ) => {
    state.error = `${action.payload.message} (${action.payload.code})`;
  },
});

/**
 * @returns negative: given has lower priority, 0 equal, positive: given higher
 */
const compareSeekPriority = (
  source: UserSeekSource,
  state: ControlsState,
): number => {
  if (!state.userSeek) return 1;
  const { source: toCompare } = state.userSeek;
  return toCompare - source;
};

const UserSeekEndReducerFor =
  (source: UserSeekSource) => (state: ControlsState) => {
    const priority = compareSeekPriority(source, state);
    if (priority < 0) return;
    if (!state.userSeek) return;
    if (state.userSeek.pausedBeforeSeek !== null) {
      state.paused = state.userSeek.pausedBeforeSeek;
    }
    // apply currentTime immediately to avoid latency from onTimeUpdate
    state.currentTime = state.userSeek.currentTime;
    state.userSeek = null;
  };
const PreciseSeekReducerFor =
  (source: UserSeekSource) =>
  (state: ControlsState, action: PayloadAction<number>) => {
    const priority = compareSeekPriority(source, state);
    if (priority < 0) return;
    const time = clampTime(action.payload, state.duration);
    if (priority === 0) {
      // only update seek time
      state.userSeek!.currentTime = time;
    } else {
      // new seek action or override existing seek action
      state.userSeek = {
        initialTime: time,
        currentTime: time,
        source,
        pausedBeforeSeek: state.paused,
      };
      // state.paused = true;
    }
  };
const userSeekReducers = getReducer({
  progressBarSeek: PreciseSeekReducerFor(UserSeekSource.PROGRESS_BAR),
  progressBarSeekEnd: UserSeekEndReducerFor(UserSeekSource.PROGRESS_BAR),
  keyboardSeek: PreciseSeekReducerFor(UserSeekSource.KEYBOARD),
  keyboardSeekEnd: UserSeekEndReducerFor(UserSeekSource.KEYBOARD),
  dragSeek: (state, action: PayloadAction<number>) => {
    const source = UserSeekSource.DRAG;
    const priority = compareSeekPriority(source, state);
    if (priority < 0) return;
    if (priority > 0) {
      // new seek action
      let time = state.currentTime;
      state.userSeek = {
        initialTime: time,
        currentTime: time,
        source,
        pausedBeforeSeek: state.paused,
      };
      // state.paused = true;
    } else {
      const forwardSeconds = action.payload;
      const { initialTime } = state.userSeek!,
        { duration } = state;
      state.userSeek!.currentTime = clampTime(
        forwardSeconds + initialTime,
        duration,
      );
    }
  },
  dragSeekEnd: UserSeekEndReducerFor(UserSeekSource.DRAG),
  requestManualSeek: (state, action: PayloadAction<number>) => {
    const source = UserSeekSource.MANUAL;
    const priority = compareSeekPriority(source, state);
    if (priority < 0) return;
    if (priority === 0)
      throw new Error("manual seek request is called before manual seek ends");
    let time = action.payload;
    time = clampTime(time, state.duration);
    state.userSeek = {
      initialTime: time,
      currentTime: time,
      source,
      pausedBeforeSeek: state.paused,
    };
    // state.paused = true;
  },
  requestManualOffsetSeek: (state, action: PayloadAction<number>) => {
    const source = UserSeekSource.MANUAL;
    const priority = compareSeekPriority(source, state);
    if (priority < 0) return;
    if (priority === 0)
      throw new Error("manual seek request is called before manual seek ends");
    const offset = action.payload;
    state.userSeek = {
      initialTime: state.currentTime,
      currentTime: clampTime(offset + state.currentTime, state.duration),
      source,
      pausedBeforeSeek: state.paused,
    };
    // state.paused = true;
  },
  manualSeekDone: UserSeekEndReducerFor(UserSeekSource.MANUAL),
});

export const controlsSlice = createSlice({
  name: "controls",
  initialState,
  reducers: {
    reset: () => {
      return initialState;
    },
    updateBasicInfo: (
      state,
      action: PayloadAction<{
        seeking: boolean;
        duration: number;
        buffered: number | null;
      }>,
    ) => {
      const { buffered, duration, seeking } = action.payload;
      if (buffered && buffered >= 0) {
        state.buffered = buffered;
      } else if (buffered !== null) {
        console.error("invaild buffered value", action.payload);
      }
      if (checkDuration(duration)) {
        state.duration = duration;
      }
      state.seeking = seeking;
    },
    revertDuration: (state, action: PayloadAction<number>) => {
      state.duration = action.payload;
    },
    ...alterStateReducers,
    ...actionLockReducers,
    ...evtHandlerReducer,
    ...userSeekReducers,
  },
});

const clampTime = (time: number, duration: number | null) => {
  if (duration && time > duration) {
    time = duration;
  } else if (time < 0) {
    time = 0;
  }
  return time;
};

const setVolumeTo = (newVolume: number, state: ControlsState) => {
  if (newVolume < 0) {
    state.volume = 0;
  } else if (newVolume > 1) {
    state.volume = 1;
  } else {
    state.volume = newVolume;
  }
};

const checkDuration = (duration: unknown): duration is number =>
  typeof duration === "number" && !!duration && duration > 0;
