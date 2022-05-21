import { Action, configureStore, Reducer } from "@reduxjs/toolkit";
import { createStateSyncMiddleware, MessageHandler } from "mx-store";

export const createStoreWithMsgHandler = <S, A extends Action>(
  name: string,
  reducer: Reducer<S, A>,
) => {
  const allowed = undefined;
  const msgHandler = new MessageHandler(false, allowed);
  const store = configureStore({
    reducer,
    devTools: process.env.NODE_ENV !== "production",
    enhancers: [],
    middleware: (getDefault) =>
      getDefault().concat(createStateSyncMiddleware(msgHandler, allowed)),
  });
  msgHandler.store = store;
  const storeWithMsg: typeof store & { msgHandler: typeof msgHandler } =
    Object.assign(store, { msgHandler });
  return storeWithMsg;
};