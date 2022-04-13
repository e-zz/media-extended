import assertNever from "assert-never";

import {
  InvokeMsgNames,
  MessageMap,
  MsgCallbackReq,
  MsgCallbackReqBase,
  MsgCallbackRes,
  MsgCallbackResData,
  MsgSent,
  MsgSentBase,
  SentMsgNames,
} from "./types";

//#region on/off method
type Listener<M extends MessageMap, E extends SentMsgNames<M>> = (
  ...data: M[E][0]
) => any;
//#endregion

//#region handle method
type CallbackHandler<
  M extends MessageMap,
  E extends InvokeMsgNames<M>,
  R = [resData: M[E][1], transfer?: Transferable[]] | string,
> = (...data: M[E][0]) => Promise<R> | R;
//#endregion

type CallbackHandlerMap<M extends MessageMap> = Partial<{
  [E in InvokeMsgNames<M>]: CallbackHandler<M, E>;
}>;
type EventHandlersMap<M extends MessageMap> = Partial<{
  [E in SentMsgNames<M>]: Listener<M, E>[];
}>;

type InvokeQueue<M extends MessageMap> = Partial<{
  [E in InvokeMsgNames<M>]: Record<
    number,
    Readonly<
      [
        resolve: PromiseResolve<MsgCallbackResData<M>>,
        reject: (error: string) => any,
        timeoutId: number,
      ]
    >
  >;
}>;
type PromiseResolve<T> = (value: T | PromiseLike<T>) => void;

export class EventEmitter<
  MIn extends MessageMap = MessageMap,
  MOut extends MessageMap = MessageMap,
> {
  cbHandler: CallbackHandlerMap<MIn> = {};
  evtHandlers: EventHandlersMap<MIn> = {};
  invokeQueue: InvokeQueue<MOut> = {};
  constructor(private port: Promise<MessagePort>) {
    port.then((port) => (port.onmessage = this.onMessage.bind(this)));
  }

  async addDirectListener(
    handler: (
      event: MessageEvent<
        MsgSent<MIn> | MsgCallbackReq<MIn> | MsgCallbackRes<MOut>
      >,
    ) => any,
  ) {
    (await this.port).addEventListener("message", handler);
  }
  private async onMessage({
    data: msg,
  }: MessageEvent<MsgSent<MIn> | MsgCallbackReq<MIn> | MsgCallbackRes<MOut>>) {
    switch (msg.type) {
      case "send":
        this.evtHandlers[msg.event]?.forEach((handler) => handler(...msg.data));
        return;
      case "req": {
        const { data, id, event } = msg;
        let res: MsgCallbackRes<MIn>;
        let handler = this.cbHandler[event];
        let resData: typeof res["data"], transfer: Transferable[] | undefined;
        if (handler) {
          const result = await handler(...data);
          if (typeof result === "string") {
            resData = `${id}: failed to exec ${event}, ${result}`;
          } else {
            [resData, transfer] = result;
          }
        } else {
          resData = `${id}: no handler for ${event}`;
          console.error(`${id}: no handler for ${event}`, data, this.cbHandler);
        }
        res = { ...msg, type: "res", data: resData };
        (await this.port).postMessage(res, { transfer });
        return;
      }
      case "res": {
        const { data, id, event } = msg;
        let queue = this.invokeQueue[event];
        if (!queue || !queue[id]) {
          console.warn(
            `${id}: no callback registered for ${event}`,
            data,
            this.invokeQueue,
            queue,
          );
          return;
        }
        const [resolve, reject, timeoutId] = queue[id];
        window.clearTimeout(timeoutId);
        if (typeof data === "string") {
          reject(data);
        } else {
          resolve(data);
        }
        delete queue[id];
        return;
      }
      default:
        assertNever(msg);
    }
  }

  async send<E extends SentMsgNames<MOut>>(event: E, ...data: MOut[E][0]) {
    const msg: MsgSentBase<MOut, E> = { type: "send", event, data };
    (await this.port).postMessage(msg);
  }
  async sendWithTransfer<E extends SentMsgNames<MOut>>(
    event: E,
    data: MOut[E][0],
    transfer: Transferable[],
  ) {
    const msg: MsgSentBase<MOut, E> = { type: "send", event, data };
    (await this.port).postMessage(msg, transfer);
  }

  public invokeTimeout = 5e3;
  async invoke<E extends InvokeMsgNames<MOut>>(
    event: E,
    ...data: MOut[E][0]
  ): Promise<MsgCallbackResData<MOut, E>> {
    // cache timeout
    let timeout = this.invokeTimeout;
    const port = await this.port;
    const req: MsgCallbackReqBase<MOut, E> = {
      event,
      type: "req",
      data,
      id: Date.now(),
    };
    port.postMessage(req);
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(`invoke ${event} timeout: ` + req.id);
        let queue = this.invokeQueue[event];
        if (queue) {
          delete queue[req.id];
        }
      }, timeout);
      let queue = this.invokeQueue[event];
      if (!queue) {
        this.invokeQueue[event] = {
          [req.id]: [resolve, reject, timeoutId] as const,
        };
      } else {
        queue[req.id] = [resolve, reject, timeoutId] as const;
      }
      // waiting to be resolved by onMessage
    });
  }

  on<E extends SentMsgNames<MIn>>(event: E, handler: Listener<MIn, E>) {
    const handlers = this.evtHandlers[event];
    if (!handlers) {
      this.evtHandlers[event] = [handler];
    } else {
      handlers.push(handler);
    }
  }
  off<E extends SentMsgNames<MIn>>(event: E, handler: Listener<MIn, E>) {
    const handlers = this.evtHandlers[event];
    let index = -1;
    if (!handlers) {
      return false;
    } else {
      index = handlers.indexOf(handler);
      if (index < 0) return false;
      handlers.splice(index, 1);
      return true;
    }
  }
  handle<E extends InvokeMsgNames<MIn>>(
    event: E,
    handler: CallbackHandler<MIn, E> | null,
  ) {
    if (handler) {
      this.cbHandler[event] = handler;
    } else {
      delete this.cbHandler[event];
    }
  }

  async close() {
    return (await this.port).close();
  }
}