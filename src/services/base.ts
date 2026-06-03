import { createNanoEvents, type Emitter } from "nanoevents";
import { Logger } from "../utils/common/logger";

interface EventsMap {
  [event: string]: any;
}

interface DefaultEvents extends EventsMap {
  [event: string]: (...args: any) => void;
}

type SingleEvents<State> = {
  [K in keyof State]: (value: State[K]) => void;
};

type Events<State extends EventsMap, NonStateEvents extends EventsMap = DefaultEvents> = SingleEvents<State> &
  NonStateEvents & {
    all: (value: [State, (keyof State)[]]) => void;
  } & NonStateEvents;

export interface SetStateOptions {
  emit?: boolean;
  apply?: boolean;
}

const DEFAULT_SET_STATE_OPTIONS: Required<SetStateOptions> = {
  emit: true,
  apply: true,
};

function getSetStateOptions(options?: SetStateOptions) {
  return {
    ...DEFAULT_SET_STATE_OPTIONS,
    ...options,
  };
}

export abstract class BaseService<
  State extends { [key: string]: any },
  NonStateEvents extends EventsMap = DefaultEvents,
> {
  // state
  protected abstract _state: State;

  get state(): Readonly<State> {
    return this._state;
  }

  // event
  protected readonly _emitter: Emitter<Events<State, NonStateEvents>>;

  on<K extends keyof Events<State, NonStateEvents>>(event: K, callback: Events<State, NonStateEvents>[K]) {
    return this._emitter.on(event, callback);
  }

  protected abstract _applyFnMap: Partial<{
    [E in keyof State]: (value: State[E]) => void | Promise<void> | boolean;
  }>;

  constructor() {
    this._emitter = createNanoEvents<Events<State, NonStateEvents>>();
  }

  setState<K extends keyof State>(key: K, value: State[K], options?: SetStateOptions): boolean {
    const { apply, emit } = getSetStateOptions(options);

    if (this._state[key] === value) {
      // Logger.warn(`setState: ${key as string} is already set to ${value}`);
      // be caution that initial value may be same with the default value
      // and that will cause apply not to be called
      return false;
    }

    Logger.debug(`[${this.constructor.name}#setState] apply=${apply} emit=${emit} ~${key.toString()}~`);

    if (apply) {
      const success = this._applyFnMap[key]?.(value);
      if (success === false) {
        return false;
      }
    }

    this._state[key] = value;

    if (emit) {
      // emitted value should be static, otherwise it will be changed by other setState calls
      // @fixme may need deep clone, but for performance reason, do shallow copy for now
      // @ts-ignore
      this._emitter.emit(key, value);
      // @ts-ignore
      this._emitter.emit("all", [{ ...this._state }, [key]]);
    }

    return true;
  }

  setStates(states: Partial<State>, _options?: SetStateOptions): boolean {
    const options = getSetStateOptions(_options);
    const changedKeys: string[] = [];

    for (const key in states) {
      const stateKey = key as keyof State;
      const value = states[stateKey];
      // @ts-ignore
      const success = this.setState(stateKey, value, {
        ...options,
        emit: false,
      });

      if (success) {
        changedKeys.push(key);
        if (options.emit) {
          // @ts-ignore
          this._emitter.emit(key, value);
        }
      }
    }

    if (changedKeys.length && options.emit) {
      // @ts-ignore
      this._emitter.emit("all", [{ ...this._state }, changedKeys]);
    }

    Logger.debug(
      `[${this.constructor.name}#setStates]: apply=${options.apply} emit=${options.emit} ~[${changedKeys}]~`,
    );

    return changedKeys.length > 0;
  }

  restoreFromState(state: State, options?: SetStateOptions) {
    this.setStates(state, options);
  }
}
