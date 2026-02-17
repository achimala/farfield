export class AppServerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AppServerError";
  }
}

export class DesktopIpcError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DesktopIpcError";
  }
}
