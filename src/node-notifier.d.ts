declare module 'node-notifier' {
  interface NotifyOptions {
    title?: string;
    message?: string;
    sound?: boolean;
  }
  function notify(opts: NotifyOptions): void;
  export default { notify };
}
